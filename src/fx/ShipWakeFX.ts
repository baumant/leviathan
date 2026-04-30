import * as THREE from 'three';

import { Ship, ShipRole } from '../entities/Ship';
import {
  WATER_FOAM_GOLDEN_ANGLE,
  WATER_FOAM_STAMP_VARIANTS,
  WaterFoamStampLayer,
} from './WaterFoamStampLayer';

const MAX_BUBBLES = 24;
const MAX_WAKE_TRAIL_STAMPS = 220;
const MAX_WAKE_TRAIL_CUTOUTS = MAX_WAKE_TRAIL_STAMPS * 3;
const UNDERWATER_OFFSET = -0.18;
const TRAIL_SURFACE_OFFSET = 0.075;
const SURFACE_WAKE_LOOK = {
  trailColor: '#d7e6e2',
  trailOpacity: 0.42,
} as const;
const UNDERWATER_WAKE_LOOK = {
  ribbonColor: '#173742',
  bubbleColor: '#587680',
  ribbonOpacity: 0.12,
  bubbleOpacity: 0.22,
} as const;

interface WakeRoleConfig {
  sternPatchScale: THREE.Vector2;
  surfaceFanLength: number;
  surfaceFanWidth: number;
  underwaterRibbonLength: number;
  underwaterRibbonWidth: number;
  bubbleCount: number;
  bubbleTrailLength: number;
  bubbleLateral: number;
  bubbleRise: number;
  expectedFloatHeight: number;
  airborneThreshold: number;
  sinkThreshold: number;
}

const WAKE_ROLE_CONFIGS: Record<ShipRole, WakeRoleConfig> = {
  rowboat: {
    sternPatchScale: new THREE.Vector2(1.32, 2.05),
    surfaceFanLength: 5.2,
    surfaceFanWidth: 1.18,
    underwaterRibbonLength: 5.4,
    underwaterRibbonWidth: 2.1,
    bubbleCount: 12,
    bubbleTrailLength: 4.8,
    bubbleLateral: 0.6,
    bubbleRise: 0.9,
    expectedFloatHeight: 0.18,
    airborneThreshold: 0.95,
    sinkThreshold: -1.1,
  },
  flagship: {
    sternPatchScale: new THREE.Vector2(3.8, 5.2),
    surfaceFanLength: 12.8,
    surfaceFanWidth: 3.1,
    underwaterRibbonLength: 13.4,
    underwaterRibbonWidth: 5.2,
    bubbleCount: 18,
    bubbleTrailLength: 10.8,
    bubbleLateral: 1.4,
    bubbleRise: 1.3,
    expectedFloatHeight: 0.62,
    airborneThreshold: 1.55,
    sinkThreshold: -1.8,
  },
  corporate_whaler: {
    sternPatchScale: new THREE.Vector2(6.4, 8.8),
    surfaceFanLength: 20.8,
    surfaceFanWidth: 5.4,
    underwaterRibbonLength: 23.5,
    underwaterRibbonWidth: 8.8,
    bubbleCount: 24,
    bubbleTrailLength: 18.2,
    bubbleLateral: 2.2,
    bubbleRise: 1.7,
    expectedFloatHeight: 1.12,
    airborneThreshold: 2.3,
    sinkThreshold: -2.6,
  },
};

interface WakeSlot {
  readonly shipId: string;
  readonly roleConfig: WakeRoleConfig;
  readonly root: THREE.Group;
  readonly underwaterRoot: THREE.Group;
  readonly trailFoamLayer: WaterFoamStampLayer;
  readonly trailStamps: WakeTrailStamp[];
  readonly lastTrailPoint: THREE.Vector3;
  readonly underwaterRibbon: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly bubbles: THREE.InstancedMesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  strength: number;
  phase: number;
  bowWakeTrailLength: number;
  nextTrailStamp: number;
  hasTrailPoint: boolean;
}

interface WakeTrailStamp {
  readonly position: THREE.Vector3;
  age: number;
  lifetime: number;
  yaw: number;
  width: number;
  length: number;
  phase: number;
  variant: number;
  active: boolean;
}

export interface ShipWakeSnapshot {
  deltaSeconds: number;
  underwaterRatio: number;
  cameraPosition: THREE.Vector3;
  sampleSurfaceHeight: (x: number, z: number) => number;
  ships: readonly Ship[];
}

export class ShipWakeFX {
  private readonly root = new THREE.Group();
  private readonly underwaterRibbonGeometry = this.createUnderwaterRibbonGeometry();
  private readonly bubbleGeometry = new THREE.IcosahedronGeometry(0.12, 0);
  private readonly bubbleDummy = new THREE.Object3D();
  private readonly trailPrevious = new THREE.Vector3();
  private readonly slots = new Map<string, WakeSlot>();
  private readonly sternOrigin = new THREE.Vector3();

  constructor(scene: THREE.Scene, ships: readonly Ship[]) {
    this.root.renderOrder = 4;
    scene.add(this.root);

    for (const ship of ships) {
      this.slots.set(ship.id, this.createSlot(ship));
    }
  }

  update(snapshot: ShipWakeSnapshot): void {
    for (const ship of snapshot.ships) {
      let slot = this.slots.get(ship.id);

      if (!slot) {
        slot = this.createSlot(ship);
        this.slots.set(ship.id, slot);
      }

      ship.getBowWakeOrigin(this.sternOrigin);
      slot.bowWakeTrailLength = ship.getBowWakeTrailLength();
      const surfaceHeight = snapshot.sampleSurfaceHeight(this.sternOrigin.x, this.sternOrigin.z);
      const floatOffset = ship.root.position.y - surfaceHeight;
      const speedRatio = THREE.MathUtils.clamp(ship.travelSpeed / Math.max(ship.fleeSpeed, 0.0001), 0, 1);
      const sinkFade = THREE.MathUtils.smoothstep(floatOffset, slot.roleConfig.sinkThreshold, slot.roleConfig.expectedFloatHeight - 0.08);
      const airborneFade = 1 - THREE.MathUtils.smoothstep(
        slot.roleConfig.expectedFloatHeight + 0.18,
        slot.roleConfig.airborneThreshold,
        floatOffset,
      );
      const movementFade = THREE.MathUtils.smoothstep(speedRatio, 0.02, 0.16);
      const targetStrength =
        ship.sunk || ship.sinking ? 0 : THREE.MathUtils.clamp(movementFade * sinkFade * airborneFade, 0, 1);

      slot.phase += snapshot.deltaSeconds * THREE.MathUtils.lerp(1.2, 2.8, speedRatio);
      slot.strength = THREE.MathUtils.damp(slot.strength, targetStrength, targetStrength > slot.strength ? 4.2 : 2.6, snapshot.deltaSeconds);
      slot.root.position.set(this.sternOrigin.x, surfaceHeight, this.sternOrigin.z);
      slot.root.rotation.set(0, ship.heading, 0, 'YXZ');
      slot.root.visible = slot.strength > 0.01;
      const cameraDistance = slot.root.position.distanceTo(snapshot.cameraPosition);
      const distanceFade = 1 - THREE.MathUtils.smoothstep(cameraDistance, 190, 270);

      this.updateTrailLayer(
        slot,
        speedRatio,
        targetStrength * distanceFade * (1 - THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.08, 0.78)),
        snapshot,
      );
      this.updateUnderwaterLayer(slot, speedRatio, snapshot.underwaterRatio, distanceFade);
    }
  }

  reset(): void {
    for (const slot of this.slots.values()) {
      slot.strength = 0;
      slot.phase = Math.random() * Math.PI * 2;
      slot.root.visible = false;
      slot.trailFoamLayer.reset();
      slot.nextTrailStamp = 0;
      slot.hasTrailPoint = false;
      for (const stamp of slot.trailStamps) {
        stamp.active = false;
        stamp.age = 0;
      }
      slot.underwaterRibbon.material.opacity = 0;
      slot.bubbles.material.opacity = 0;
      slot.bubbles.count = 0;
    }
  }

  removeShip(shipId: string): void {
    const slot = this.slots.get(shipId);

    if (!slot) {
      return;
    }

    this.disposeSlot(slot);
    this.slots.delete(shipId);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.underwaterRibbonGeometry.dispose();
    this.bubbleGeometry.dispose();

    for (const slot of this.slots.values()) {
      this.disposeSlot(slot);
    }

    this.slots.clear();
  }

  private disposeSlot(slot: WakeSlot): void {
    slot.root.removeFromParent();
    slot.trailFoamLayer.dispose();
    slot.underwaterRibbon.material.dispose();
    slot.bubbles.material.dispose();
  }

  private createSlot(ship: Ship): WakeSlot {
    const roleConfig = WAKE_ROLE_CONFIGS[ship.role];
    const root = new THREE.Group();
    const underwaterRoot = new THREE.Group();

    const trailFoamLayer = new WaterFoamStampLayer(this.root, {
      maxStamps: MAX_WAKE_TRAIL_STAMPS,
      maxCutouts: MAX_WAKE_TRAIL_CUTOUTS,
      color: SURFACE_WAKE_LOOK.trailColor,
      opacity: SURFACE_WAKE_LOOK.trailOpacity,
      blending: THREE.NormalBlending,
      renderOrder: 21,
      cutoutRenderOrder: 20.8,
    });

    const trailStamps: WakeTrailStamp[] = [];
    for (let index = 0; index < MAX_WAKE_TRAIL_STAMPS; index += 1) {
      trailStamps.push({
        position: new THREE.Vector3(),
        age: 0,
        lifetime: 1,
        yaw: 0,
        width: 1,
        length: 1,
        phase: 0,
        variant: index % WATER_FOAM_STAMP_VARIANTS,
        active: false,
      });
    }

    const underwaterRibbonMaterial = this.createWakeMaterial(
      UNDERWATER_WAKE_LOOK.ribbonColor,
      UNDERWATER_WAKE_LOOK.ribbonOpacity,
      THREE.NormalBlending,
      false,
      true,
    );
    const underwaterRibbon = new THREE.Mesh(this.underwaterRibbonGeometry, underwaterRibbonMaterial);
    underwaterRibbon.rotation.x = -Math.PI / 2;
    underwaterRibbon.position.y = UNDERWATER_OFFSET;
    underwaterRibbon.frustumCulled = false;
    underwaterRibbon.renderOrder = 3;

    const bubbleMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(UNDERWATER_WAKE_LOOK.bubbleColor),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    bubbleMaterial.fog = true;
    bubbleMaterial.toneMapped = false;

    const bubbles = new THREE.InstancedMesh(this.bubbleGeometry, bubbleMaterial, MAX_BUBBLES);
    bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bubbles.count = roleConfig.bubbleCount;
    bubbles.frustumCulled = false;
    bubbles.renderOrder = 4;

    underwaterRoot.add(underwaterRibbon, bubbles);
    root.add(underwaterRoot);
    root.visible = false;
    this.root.add(root);

    return {
      shipId: ship.id,
      roleConfig,
      root,
      underwaterRoot,
      trailFoamLayer,
      trailStamps,
      lastTrailPoint: new THREE.Vector3(),
      underwaterRibbon,
      bubbles,
      strength: 0,
      phase: Math.random() * Math.PI * 2,
      bowWakeTrailLength: ship.getBowWakeTrailLength(),
      nextTrailStamp: 0,
      hasTrailPoint: false,
    };
  }

  private createWakeMaterial(
    color: string,
    baseOpacity: number,
    blending: THREE.Blending,
    polygonOffset: boolean,
    doubleSided = true,
  ): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: false,
      blending,
      polygonOffset,
      polygonOffsetFactor: polygonOffset ? -2 : 0,
      polygonOffsetUnits: polygonOffset ? -2 : 0,
    });
    material.userData.baseOpacity = baseOpacity;
    material.fog = true;
    material.toneMapped = false;
    return material;
  }

  private createUnderwaterRibbonGeometry(): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.32, 0);
    shape.lineTo(0.32, 0);
    shape.lineTo(1.4, 1);
    shape.lineTo(-1.4, 1);
    shape.closePath();
    return new THREE.ShapeGeometry(shape, 1);
  }

  private updateTrailLayer(
    slot: WakeSlot,
    speedRatio: number,
    surfaceOpacity: number,
    snapshot: ShipWakeSnapshot,
  ): void {
    const aboveWaterAlpha = 1 - THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.08, 0.78);

    if (aboveWaterAlpha <= 0.005 && surfaceOpacity <= 0.015) {
      this.clearTrailLayer(slot, true);
      return;
    }

    if (surfaceOpacity > 0.015) {
      this.emitTrailBetweenPoints(slot, speedRatio, surfaceOpacity);
    } else {
      slot.hasTrailPoint = false;
    }

    let visibleCount = 0;
    slot.trailFoamLayer.begin(aboveWaterAlpha);

    for (const stamp of slot.trailStamps) {
      if (!stamp.active) {
        continue;
      }

      stamp.age += snapshot.deltaSeconds;

      if (stamp.age >= stamp.lifetime) {
        stamp.active = false;
        continue;
      }

      const progress = stamp.age / stamp.lifetime;
      const ripple = 0.92 + Math.sin(stamp.phase + progress * Math.PI * 2) * 0.08;
      const foamShrink = 1 - THREE.MathUtils.smoothstep(progress, 0.12, 0.96);
      const foamScale = Math.max(0.001, foamShrink * ripple);
      const surfaceHeight = snapshot.sampleSurfaceHeight(stamp.position.x, stamp.position.z);

      slot.trailFoamLayer.addStamp({
        x: stamp.position.x + Math.sin(stamp.phase + stamp.age * 0.55) * 0.025,
        y: surfaceHeight + TRAIL_SURFACE_OFFSET + (visibleCount % 7) * 0.001,
        z: stamp.position.z + Math.cos(stamp.phase * 1.3 + stamp.age * 0.42) * 0.025,
        yaw: stamp.yaw + Math.sin(stamp.phase + stamp.age * 0.7) * 0.04,
        width: stamp.width * foamScale,
        length: stamp.length * foamScale,
        phase: stamp.phase,
        progress,
        variant: stamp.variant,
      });
      visibleCount += 1;
    }

    slot.trailFoamLayer.end();
  }

  private clearTrailLayer(slot: WakeSlot, clearStamps: boolean): void {
    slot.hasTrailPoint = false;
    slot.trailFoamLayer.reset();

    if (clearStamps) {
      for (const stamp of slot.trailStamps) {
        stamp.active = false;
      }
    }
  }

  private emitTrailBetweenPoints(slot: WakeSlot, speedRatio: number, surfaceOpacity: number): void {
    const current = slot.root.position;

    if (!slot.hasTrailPoint) {
      slot.lastTrailPoint.copy(current);
      slot.hasTrailPoint = true;
      this.emitWakeTrailStampCluster(slot, current.x, current.z, speedRatio, surfaceOpacity);
      return;
    }

    this.trailPrevious.copy(slot.lastTrailPoint);
    const distance = this.trailPrevious.distanceTo(current);
    const roleScale = Math.max(0.8, Math.sqrt(slot.roleConfig.sternPatchScale.x * slot.roleConfig.sternPatchScale.y) * 0.42);
    const spacing = THREE.MathUtils.lerp(0.32, 0.62, speedRatio) * roleScale;

    if (distance < spacing) {
      return;
    }

    const steps = Math.min(4, Math.floor(distance / spacing));

    for (let step = 1; step <= steps; step += 1) {
      const alpha = step / steps;
      const x = THREE.MathUtils.lerp(this.trailPrevious.x, current.x, alpha);
      const z = THREE.MathUtils.lerp(this.trailPrevious.z, current.z, alpha);
      this.emitWakeTrailStampCluster(slot, x, z, speedRatio, surfaceOpacity);
    }

    slot.lastTrailPoint.copy(current);
  }

  private emitWakeTrailStampCluster(slot: WakeSlot, x: number, z: number, speedRatio: number, surfaceOpacity: number): void {
    const heading = slot.root.rotation.y;
    const forwardX = Math.sin(heading);
    const forwardZ = Math.cos(heading);
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);
    const roleScale = Math.max(0.9, Math.sqrt(slot.roleConfig.sternPatchScale.x * slot.roleConfig.sternPatchScale.y) * 0.38);
    const wakeWidth = slot.roleConfig.surfaceFanWidth * (0.74 + speedRatio * 0.62);
    const wakeLength = Math.max(slot.roleConfig.surfaceFanLength * 0.24, slot.bowWakeTrailLength);
    const stampCount = Math.min(12, (speedRatio > 0.42 ? 5 : 3) + Math.floor(wakeLength / 16));
    const bowStampCount = Math.max(2, Math.ceil(stampCount * 0.3));

    for (let index = 0; index < stampCount; index += 1) {
      const laneBias = Math.sin(slot.phase * 1.37 + index * 2.41 + Math.random() * 0.4);
      const centerBias = index < bowStampCount ? THREE.MathUtils.randFloatSpread(0.22) : laneBias;
      const spread = wakeWidth * centerBias * THREE.MathUtils.lerp(0.24, 0.82, Math.random());
      const longitudinal =
        (index < bowStampCount
          ? THREE.MathUtils.lerp(0, wakeLength * 0.42, Math.random())
          : THREE.MathUtils.lerp(wakeLength * 0.22, wakeLength * 1.05, Math.random()));
      const noise = THREE.MathUtils.randFloatSpread(wakeWidth * 0.18);
      const centerWeight = 1 - Math.min(1, Math.abs(centerBias));
      const stamp = slot.trailStamps[slot.nextTrailStamp];

      slot.nextTrailStamp = (slot.nextTrailStamp + 1) % slot.trailStamps.length;
      stamp.active = true;
      stamp.age = 0;
      stamp.lifetime = THREE.MathUtils.lerp(2.4, 4.1, speedRatio) * THREE.MathUtils.lerp(0.74, 1.02, surfaceOpacity);
      stamp.position.set(
        x - forwardX * longitudinal + rightX * (spread + noise),
        0,
        z - forwardZ * longitudinal + rightZ * (spread + noise),
      );
      stamp.yaw = heading + Math.PI * 0.5 + THREE.MathUtils.randFloatSpread(0.92) + centerBias * 0.26;
      const stampSize =
        roleScale *
        THREE.MathUtils.lerp(0.3 + centerWeight * 0.16, 0.74 + centerWeight * 0.18, Math.random());
      stamp.width = stampSize * THREE.MathUtils.lerp(0.9, 1.12, Math.random());
      stamp.length = stampSize * THREE.MathUtils.lerp(0.86, 1.08, Math.random());
      stamp.phase = slot.phase + index * WATER_FOAM_GOLDEN_ANGLE + Math.random() * 0.08;
      stamp.variant = Math.floor(Math.random() * WATER_FOAM_STAMP_VARIANTS);
    }
  }

  private updateUnderwaterLayer(slot: WakeSlot, speedRatio: number, underwaterRatio: number, distanceFade: number): void {
    const underwaterVisibility = THREE.MathUtils.smoothstep(underwaterRatio, 0.04, 0.42) * distanceFade;
    const underwaterBias = THREE.MathUtils.lerp(0.24, 0.72, underwaterRatio) * underwaterVisibility;
    const underwaterOpacity = slot.strength * underwaterBias;

    if (underwaterOpacity <= 0.01) {
      slot.underwaterRoot.visible = false;
      slot.underwaterRibbon.material.opacity = 0;
      slot.bubbles.material.opacity = 0;

      if (slot.bubbles.count !== 0) {
        slot.bubbles.count = 0;
        slot.bubbles.instanceMatrix.needsUpdate = true;
      }

      return;
    }

    slot.underwaterRoot.visible = true;

    slot.underwaterRibbon.scale.set(
      slot.roleConfig.underwaterRibbonWidth * (0.74 + speedRatio * 0.42),
      slot.roleConfig.underwaterRibbonLength * (0.66 + speedRatio * 0.48),
      1,
    );
    slot.underwaterRibbon.material.opacity =
      (slot.underwaterRibbon.material.userData.baseOpacity as number) * underwaterOpacity;

    slot.bubbles.count = slot.roleConfig.bubbleCount;
    slot.bubbles.material.opacity = underwaterOpacity * UNDERWATER_WAKE_LOOK.bubbleOpacity;

    for (let index = 0; index < slot.roleConfig.bubbleCount; index += 1) {
      const progress = (slot.phase * 0.18 + index / slot.roleConfig.bubbleCount) % 1;
      const distance = progress * slot.roleConfig.bubbleTrailLength * (0.42 + speedRatio * 0.88);
      const lateral =
        Math.sin(slot.phase * 1.7 + index * 1.37) *
        slot.roleConfig.bubbleLateral *
        (0.18 + (1 - progress) * 0.82);
      const rise = progress * slot.roleConfig.bubbleRise + Math.sin(slot.phase * 2.2 + index) * 0.05;
      const scale = THREE.MathUtils.lerp(0.05, 0.14, 1 - progress) * (0.75 + speedRatio * 0.55);

      this.bubbleDummy.position.set(lateral, UNDERWATER_OFFSET + rise, -0.35 - distance);
      this.bubbleDummy.rotation.set(0, slot.phase * 0.2 + index * 0.3, 0);
      this.bubbleDummy.scale.setScalar(scale);
      this.bubbleDummy.updateMatrix();
      slot.bubbles.setMatrixAt(index, this.bubbleDummy.matrix);
    }

    slot.bubbles.instanceMatrix.needsUpdate = slot.bubbles.count > 0;
  }
}

import * as THREE from 'three';

import { PlayerWhale } from '../entities/PlayerWhale';
import { Ship, ShipRole } from '../entities/Ship';

const SURFACE_OFFSET = 0.07;
const SILHOUETTE_OFFSET = -0.09;
const WORLD_PATCH_COUNT = 8;
const BREACH_BURST_COUNT = 6;
const MAX_SILHOUETTES = 8;
const WHALE_MAX_SPEED = 34;
const WHALE_ACCELERATION_RANGE = 18;

const SURFACE_DISTURBANCE_LOOK = {
  worldPatchColor: '#445665',
  shipChurnColor: '#aab8c5',
  shipFanColor: '#7c8c98',
  whaleChurnColor: '#b3c2cf',
  whaleFanColor: '#93a7b4',
  whaleRingColor: '#dbe5eb',
  breachOuterColor: '#8fa5b4',
  breachInnerColor: '#eff5f8',
} as const;

const WHALE_DISTURBANCE_TUNING = {
  nearSurfaceStart: 0.2,
  nearSurfaceEnd: 3.8,
  energyRise: 4.4,
  energyFall: 2.1,
  pulseDecay: 3.8,
  boostBonus: 0.16,
} as const;

interface ShipFoamConfig {
  churnScale: THREE.Vector2;
  fanWidth: number;
  fanLength: number;
  spread: number;
  opacity: number;
}

const SHIP_FOAM_CONFIGS: Record<ShipRole, ShipFoamConfig> = {
  rowboat: {
    churnScale: new THREE.Vector2(1.45, 2.1),
    fanWidth: 1.3,
    fanLength: 4.8,
    spread: 0.46,
    opacity: 0.16,
  },
  flagship: {
    churnScale: new THREE.Vector2(3.9, 5.8),
    fanWidth: 3.1,
    fanLength: 11.2,
    spread: 0.32,
    opacity: 0.2,
  },
};

interface WorldPatchSlot {
  readonly mesh: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly basePosition: THREE.Vector2;
  readonly baseScale: THREE.Vector2;
  readonly driftPhase: number;
  readonly rotationPhase: number;
}

interface ShipFoamSlot {
  readonly shipId: string;
  readonly root: THREE.Group;
  readonly churn: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly leftFan: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly rightFan: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly config: ShipFoamConfig;
  strength: number;
  phase: number;
}

interface BreachBurstSlot {
  readonly root: THREE.Group;
  readonly outer: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly inner: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  age: number;
  lifetime: number;
  intensity: number;
  x: number;
  z: number;
  kind: 'launch' | 'reentry';
}

interface SilhouetteSlot {
  readonly root: THREE.Group;
  readonly core: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly penumbra: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  strength: number;
}

interface WhaleDisturbanceSlot {
  readonly root: THREE.Group;
  readonly churn: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly leftFan: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly rightFan: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly ring: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  energy: number;
  pulse: number;
  previousSpeed: number;
}

export interface SurfaceSeafoamSnapshot {
  deltaSeconds: number;
  elapsedSeconds: number;
  underwaterRatio: number;
  cameraPosition: THREE.Vector3;
  sampleSurfaceHeight: (x: number, z: number) => number;
  whale: PlayerWhale;
  whaleStrokePulseStrength: number;
  ships: readonly Ship[];
}

export class SurfaceSeafoamFX {
  private readonly root = new THREE.Group();
  private readonly worldPatchGeometry = this.createFoamPatchGeometry();
  private readonly wakeFanGeometry = this.createWakeFanGeometry();
  private readonly silhouetteGeometry = this.createSilhouetteGeometry();
  private readonly shipFoamSlots = new Map<string, ShipFoamSlot>();
  private readonly worldPatchSlots: WorldPatchSlot[] = [];
  private readonly breachBursts: BreachBurstSlot[] = [];
  private readonly silhouetteSlots: SilhouetteSlot[] = [];
  private readonly whaleDisturbance: WhaleDisturbanceSlot;
  private readonly tempWakeOrigin = new THREE.Vector3();
  private readonly tempPoint = new THREE.Vector3();

  constructor(scene: THREE.Scene, ships: readonly Ship[]) {
    this.root.renderOrder = 6;
    scene.add(this.root);

    for (let index = 0; index < WORLD_PATCH_COUNT; index += 1) {
      this.worldPatchSlots.push(this.createWorldPatchSlot(index));
    }

    for (const ship of ships) {
      this.shipFoamSlots.set(ship.id, this.createShipFoamSlot(ship));
    }

    for (let index = 0; index < BREACH_BURST_COUNT; index += 1) {
      this.breachBursts.push(this.createBreachBurstSlot());
    }

    for (let index = 0; index < MAX_SILHOUETTES; index += 1) {
      this.silhouetteSlots.push(this.createSilhouetteSlot());
    }

    this.whaleDisturbance = this.createWhaleDisturbanceSlot();
  }

  spawnLaunch(origin: THREE.Vector3, intensity: number): void {
    this.spawnBreachBurst(origin, intensity, 'launch');
  }

  spawnReentry(origin: THREE.Vector3, intensity: number): void {
    this.spawnBreachBurst(origin, intensity, 'reentry');
  }

  update(snapshot: SurfaceSeafoamSnapshot): void {
    const aboveWaterAlpha = 1 - THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.08, 0.78);
    const seafoamAlpha = aboveWaterAlpha * 0.8;

    this.updateWorldPatches(snapshot, seafoamAlpha);
    this.updateShipFoam(snapshot, seafoamAlpha);
    this.updateBreachBursts(snapshot, seafoamAlpha);
    this.updateWhaleDisturbance(snapshot, seafoamAlpha);
    this.updateSilhouettes(snapshot, aboveWaterAlpha);
  }

  reset(): void {
    for (const slot of this.shipFoamSlots.values()) {
      slot.strength = 0;
      slot.phase = Math.random() * Math.PI * 2;
      slot.root.visible = false;
      slot.churn.material.opacity = 0;
      slot.leftFan.material.opacity = 0;
      slot.rightFan.material.opacity = 0;
    }

    for (const burst of this.breachBursts) {
      burst.active = false;
      burst.root.visible = false;
      burst.age = 0;
      burst.outer.material.opacity = 0;
      burst.inner.material.opacity = 0;
    }

    for (const slot of this.worldPatchSlots) {
      slot.mesh.visible = false;
      slot.mesh.material.opacity = 0;
    }

    for (const slot of this.silhouetteSlots) {
      slot.strength = 0;
      slot.root.visible = false;
      slot.core.material.opacity = 0;
      slot.penumbra.material.opacity = 0;
    }

    this.whaleDisturbance.energy = 0;
    this.whaleDisturbance.pulse = 0;
    this.whaleDisturbance.previousSpeed = 0;
    this.whaleDisturbance.root.visible = false;
    this.whaleDisturbance.churn.material.opacity = 0;
    this.whaleDisturbance.leftFan.material.opacity = 0;
    this.whaleDisturbance.rightFan.material.opacity = 0;
    this.whaleDisturbance.ring.material.opacity = 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.worldPatchGeometry.dispose();
    this.wakeFanGeometry.dispose();
    this.silhouetteGeometry.dispose();

    for (const slot of this.worldPatchSlots) {
      slot.mesh.material.dispose();
    }

    for (const slot of this.shipFoamSlots.values()) {
      slot.churn.material.dispose();
      slot.leftFan.material.dispose();
      slot.rightFan.material.dispose();
    }

    for (const burst of this.breachBursts) {
      burst.outer.material.dispose();
      burst.inner.material.dispose();
    }

    for (const slot of this.silhouetteSlots) {
      slot.core.material.dispose();
      slot.penumbra.material.dispose();
    }

    this.whaleDisturbance.churn.material.dispose();
    this.whaleDisturbance.leftFan.material.dispose();
    this.whaleDisturbance.rightFan.material.dispose();
    this.whaleDisturbance.ring.material.dispose();
  }

  private updateWorldPatches(snapshot: SurfaceSeafoamSnapshot, aboveWaterAlpha: number): void {
    for (const slot of this.worldPatchSlots) {
      const driftX = Math.sin(snapshot.elapsedSeconds * 0.045 + slot.driftPhase) * 3.4;
      const driftZ = Math.cos(snapshot.elapsedSeconds * 0.04 + slot.driftPhase * 1.2) * 2.8;
      const x = slot.basePosition.x + driftX;
      const z = slot.basePosition.y + driftZ;
      const surfaceHeight = snapshot.sampleSurfaceHeight(x, z);
      const opacityPulse = 0.82 + Math.sin(snapshot.elapsedSeconds * 0.3 + slot.rotationPhase) * 0.18;

      slot.mesh.position.set(x, surfaceHeight + SURFACE_OFFSET, z);
      slot.mesh.rotation.set(-Math.PI / 2, slot.rotationPhase + Math.sin(snapshot.elapsedSeconds * 0.04 + slot.rotationPhase) * 0.18, 0);
      slot.mesh.scale.set(
        slot.baseScale.x * (0.94 + opacityPulse * 0.18),
        slot.baseScale.y * (0.92 + opacityPulse * 0.22),
        1,
      );
      slot.mesh.material.opacity =
        (slot.mesh.material.userData.baseOpacity as number) * aboveWaterAlpha * opacityPulse;
      slot.mesh.visible = slot.mesh.material.opacity > 0.01;
    }
  }

  private updateShipFoam(snapshot: SurfaceSeafoamSnapshot, aboveWaterAlpha: number): void {
    for (const ship of snapshot.ships) {
      const slot = this.shipFoamSlots.get(ship.id);
      if (!slot) {
        continue;
      }

      ship.getWakeOrigin(this.tempWakeOrigin);
      const surfaceHeight = snapshot.sampleSurfaceHeight(this.tempWakeOrigin.x, this.tempWakeOrigin.z);
      const speedRatio = THREE.MathUtils.clamp(ship.travelSpeed / Math.max(ship.fleeSpeed, 0.001), 0, 1);
      const floatOffset = ship.root.position.y - surfaceHeight;
      const surfaceStrength =
        ship.sunk || ship.sinking
          ? 0
          : aboveWaterAlpha *
            THREE.MathUtils.smoothstep(speedRatio, 0.03, 0.18) *
            (1 - THREE.MathUtils.smoothstep(floatOffset, 1.4, 3.2)) *
            0.82;

      slot.phase += snapshot.deltaSeconds * THREE.MathUtils.lerp(1.2, 2.6, speedRatio);
      slot.strength = THREE.MathUtils.damp(slot.strength, surfaceStrength, surfaceStrength > slot.strength ? 4.4 : 2.2, snapshot.deltaSeconds);
      slot.root.visible = slot.strength > 0.01;
      slot.root.position.set(this.tempWakeOrigin.x, surfaceHeight, this.tempWakeOrigin.z);
      slot.root.rotation.set(0, ship.heading, 0, 'YXZ');

      const foamPulse = 0.9 + Math.sin(slot.phase * 2.2) * 0.1;
      const churnScaleX = slot.config.churnScale.x * (0.78 + speedRatio * 0.4);
      const churnScaleZ = slot.config.churnScale.y * (0.82 + speedRatio * 0.46);
      const fanWidth = slot.config.fanWidth * (0.76 + speedRatio * 0.52);
      const fanLength = slot.config.fanLength * (0.62 + speedRatio * 0.58);

      slot.churn.scale.set(churnScaleX, churnScaleZ, 1);
      slot.leftFan.scale.set(fanWidth, fanLength, 1);
      slot.rightFan.scale.set(fanWidth, fanLength, 1);
      slot.leftFan.rotation.set(-Math.PI / 2, 0, slot.config.spread);
      slot.rightFan.rotation.set(-Math.PI / 2, 0, -slot.config.spread);

      slot.churn.material.opacity = slot.strength * slot.config.opacity * foamPulse;
      slot.leftFan.material.opacity = slot.strength * slot.config.opacity * 0.58 * foamPulse;
      slot.rightFan.material.opacity = slot.strength * slot.config.opacity * 0.58 * foamPulse;
    }
  }

  private updateBreachBursts(snapshot: SurfaceSeafoamSnapshot, aboveWaterAlpha: number): void {
    for (const burst of this.breachBursts) {
      if (!burst.active) {
        continue;
      }

      burst.age += snapshot.deltaSeconds;
      if (burst.age >= burst.lifetime) {
        burst.active = false;
        burst.root.visible = false;
        burst.outer.material.opacity = 0;
        burst.inner.material.opacity = 0;
        continue;
      }

      const progress = burst.age / burst.lifetime;
      const surfaceHeight = snapshot.sampleSurfaceHeight(burst.x, burst.z);
      const burstAlpha = aboveWaterAlpha * (1 - progress);
      const sizeScale = burst.kind === 'launch' ? 4.8 : 8.6;
      const innerScale = burst.kind === 'launch' ? 1.9 : 3.2;

      burst.root.position.set(burst.x, surfaceHeight + SURFACE_OFFSET, burst.z);
      burst.root.rotation.set(0, progress * 0.5, 0);
      burst.root.visible = burstAlpha > 0.01;

      burst.outer.scale.setScalar((0.55 + progress * sizeScale) * burst.intensity);
      burst.inner.scale.setScalar((0.42 + progress * innerScale) * burst.intensity);
      burst.outer.material.opacity = burstAlpha * (burst.kind === 'launch' ? 0.14 : 0.18);
      burst.inner.material.opacity = burstAlpha * (burst.kind === 'launch' ? 0.22 : 0.28);
    }
  }

  private updateWhaleDisturbance(snapshot: SurfaceSeafoamSnapshot, aboveWaterAlpha: number): void {
    const slot = this.whaleDisturbance;
    const surfaceHeight = snapshot.sampleSurfaceHeight(snapshot.whale.position.x, snapshot.whale.position.z);
    const depthBelow = surfaceHeight - snapshot.whale.position.y;
    const nearSurfaceFactor =
      aboveWaterAlpha *
      (1 - THREE.MathUtils.smoothstep(depthBelow, WHALE_DISTURBANCE_TUNING.nearSurfaceStart, WHALE_DISTURBANCE_TUNING.nearSurfaceEnd));
    const speedRatio = THREE.MathUtils.clamp(snapshot.whale.speed / WHALE_MAX_SPEED, 0, 1.2);
    const acceleration = Math.max(0, snapshot.whale.speed - slot.previousSpeed) / Math.max(snapshot.deltaSeconds, 0.0001);
    const accelerationRatio = THREE.MathUtils.clamp(acceleration / WHALE_ACCELERATION_RANGE, 0, 1.2);
    const strokePulse = THREE.MathUtils.clamp(snapshot.whaleStrokePulseStrength / 7.2, 0, 1.2);
    const targetEnergy =
      nearSurfaceFactor *
      THREE.MathUtils.clamp(
        0.04 + speedRatio * 0.36 + accelerationRatio * 0.24 + (snapshot.whale.boostActive ? WHALE_DISTURBANCE_TUNING.boostBonus : 0),
        0,
        1.12,
      );

    slot.energy = THREE.MathUtils.damp(
      slot.energy,
      targetEnergy,
      targetEnergy > slot.energy ? WHALE_DISTURBANCE_TUNING.energyRise : WHALE_DISTURBANCE_TUNING.energyFall,
      snapshot.deltaSeconds,
    );
    slot.pulse = THREE.MathUtils.damp(slot.pulse, 0, WHALE_DISTURBANCE_TUNING.pulseDecay, snapshot.deltaSeconds);

    const pulseKick =
      nearSurfaceFactor *
      (strokePulse * 0.82 + accelerationRatio * 0.34 + (snapshot.whale.boostActive ? 0.12 : 0));
    if (pulseKick > slot.pulse) {
      slot.pulse = pulseKick;
    }

    slot.previousSpeed = snapshot.whale.speed;
    slot.root.visible = slot.energy > 0.01 || slot.pulse > 0.01;
    slot.root.position.set(snapshot.whale.position.x, surfaceHeight + SURFACE_OFFSET, snapshot.whale.position.z);
    slot.root.rotation.set(0, snapshot.whale.yaw, 0, 'YXZ');

    const churnWidth = THREE.MathUtils.lerp(2.6, 5.8, speedRatio) * (0.82 + slot.energy * 0.72);
    const churnLength = THREE.MathUtils.lerp(5.2, 13.2, speedRatio) * (0.78 + slot.energy * 0.84 + slot.pulse * 0.22);
    const fanWidth = THREE.MathUtils.lerp(1.8, 4.6, speedRatio) * (0.84 + slot.energy * 0.66);
    const fanLength = THREE.MathUtils.lerp(4.4, 11.8, speedRatio) * (0.8 + slot.energy * 0.88 + slot.pulse * 0.18);

    slot.churn.scale.set(churnWidth, churnLength, 1);
    slot.leftFan.scale.set(fanWidth, fanLength, 1);
    slot.rightFan.scale.set(fanWidth, fanLength, 1);
    slot.leftFan.rotation.set(-Math.PI / 2, 0, 0.38);
    slot.rightFan.rotation.set(-Math.PI / 2, 0, -0.38);
    slot.ring.scale.setScalar(1.1 + slot.pulse * 6.8 + speedRatio * 0.8);

    slot.churn.material.opacity = nearSurfaceFactor * (0.03 + slot.energy * 0.12 + slot.pulse * 0.05);
    slot.leftFan.material.opacity = nearSurfaceFactor * (0.018 + slot.energy * 0.07 + slot.pulse * 0.03);
    slot.rightFan.material.opacity = nearSurfaceFactor * (0.018 + slot.energy * 0.07 + slot.pulse * 0.03);
    slot.ring.material.opacity = nearSurfaceFactor * slot.pulse * 0.2;
  }

  private updateSilhouettes(snapshot: SurfaceSeafoamSnapshot, aboveWaterAlpha: number): void {
    let visibleCount = 0;

    const aboveSurfaceAlpha = aboveWaterAlpha * 0.92;
    const whaleSurfaceHeight = snapshot.sampleSurfaceHeight(snapshot.whale.position.x, snapshot.whale.position.z);
    const whaleDepthBelow = whaleSurfaceHeight - snapshot.whale.position.y;
    visibleCount = this.updateSilhouetteSlot(
      visibleCount,
      snapshot.whale.position,
      snapshot.whale.yaw,
      snapshot.whale.surfaceSilhouetteScale,
      whaleDepthBelow,
      snapshot.cameraPosition.distanceTo(snapshot.whale.position),
      aboveSurfaceAlpha,
      snapshot.deltaSeconds,
    );

    for (const ship of snapshot.ships) {
      if (visibleCount >= this.silhouetteSlots.length) {
        break;
      }

      const surfaceHeight = snapshot.sampleSurfaceHeight(ship.root.position.x, ship.root.position.z);
      const depthBelow = surfaceHeight - ship.root.position.y;
      if (depthBelow <= 0.1) {
        continue;
      }

      this.tempPoint.copy(ship.root.position);
      visibleCount = this.updateSilhouetteSlot(
        visibleCount,
        this.tempPoint,
        ship.heading,
        new THREE.Vector2(ship.surfaceShadowScale.x * 0.42, ship.surfaceShadowScale.y * 0.42),
        depthBelow,
        snapshot.cameraPosition.distanceTo(this.tempPoint),
        aboveSurfaceAlpha,
        snapshot.deltaSeconds,
      );
    }

    for (let index = visibleCount; index < this.silhouetteSlots.length; index += 1) {
      const slot = this.silhouetteSlots[index];
      slot.strength = THREE.MathUtils.damp(slot.strength, 0, 6.4, snapshot.deltaSeconds);
      slot.root.visible = false;
      slot.core.material.opacity = 0;
      slot.penumbra.material.opacity = 0;
    }
  }

  private updateSilhouetteSlot(
    slotIndex: number,
    position: THREE.Vector3,
    heading: number,
    scale: THREE.Vector2,
    depthBelow: number,
    cameraDistance: number,
    aboveWaterAlpha: number,
    deltaSeconds: number,
  ): number {
    if (slotIndex >= this.silhouetteSlots.length || depthBelow <= 0.38 || depthBelow >= 1.45 || aboveWaterAlpha <= 0.01) {
      return slotIndex;
    }

    const slot = this.silhouetteSlots[slotIndex];
    const depthAlpha = 1 - THREE.MathUtils.smoothstep(depthBelow, 0.42, 1.45);
    const distanceAlpha = 1 - THREE.MathUtils.smoothstep(cameraDistance, 8, 32);
    const targetAlpha = aboveWaterAlpha * depthAlpha * distanceAlpha;

    if (targetAlpha <= 0.01) {
      return slotIndex;
    }

    slot.strength = THREE.MathUtils.damp(slot.strength, targetAlpha, 4.8, deltaSeconds);
    slot.root.visible = true;
    slot.root.position.set(position.x, position.y + depthBelow + SILHOUETTE_OFFSET, position.z);
    slot.root.rotation.set(0, heading, 0);
    slot.root.scale.set(scale.x, 1, scale.y);
    slot.core.material.opacity = slot.strength * 0.05;
    slot.penumbra.material.opacity = slot.strength * 0.018;
    return slotIndex + 1;
  }

  private createWorldPatchSlot(index: number): WorldPatchSlot {
    const material = this.createFoamMaterial(SURFACE_DISTURBANCE_LOOK.worldPatchColor, 0.034, THREE.NormalBlending);
    const mesh = new THREE.Mesh(this.worldPatchGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    this.root.add(mesh);

    return {
      mesh,
      basePosition: new THREE.Vector2(
        THREE.MathUtils.randFloatSpread(220),
        THREE.MathUtils.randFloatSpread(220),
      ),
      baseScale: new THREE.Vector2(
        THREE.MathUtils.randFloat(6.8, 12.6),
        THREE.MathUtils.randFloat(12.4, 22.4),
      ),
      driftPhase: index * 0.83 + Math.random() * Math.PI,
      rotationPhase: Math.random() * Math.PI * 2,
    };
  }

  private createShipFoamSlot(ship: Ship): ShipFoamSlot {
    const root = new THREE.Group();
    const config = SHIP_FOAM_CONFIGS[ship.role];
    const churn = new THREE.Mesh(
      this.worldPatchGeometry,
      this.createFoamMaterial(SURFACE_DISTURBANCE_LOOK.shipChurnColor, config.opacity, THREE.NormalBlending),
    );
    churn.rotation.x = -Math.PI / 2;
    churn.position.y = SURFACE_OFFSET;
    churn.frustumCulled = false;
    churn.renderOrder = 7;

    const leftFan = new THREE.Mesh(
      this.wakeFanGeometry,
      this.createFoamMaterial(SURFACE_DISTURBANCE_LOOK.shipFanColor, config.opacity * 0.72, THREE.NormalBlending),
    );
    leftFan.position.set(-0.12, SURFACE_OFFSET + 0.01, -0.24);
    leftFan.frustumCulled = false;
    leftFan.renderOrder = 7;

    const rightFan = new THREE.Mesh(
      this.wakeFanGeometry,
      this.createFoamMaterial(SURFACE_DISTURBANCE_LOOK.shipFanColor, config.opacity * 0.72, THREE.NormalBlending),
    );
    rightFan.position.set(0.12, SURFACE_OFFSET + 0.01, -0.24);
    rightFan.frustumCulled = false;
    rightFan.renderOrder = 7;

    root.visible = false;
    root.add(churn, leftFan, rightFan);
    this.root.add(root);

    return {
      shipId: ship.id,
      root,
      churn,
      leftFan,
      rightFan,
      config,
      strength: 0,
      phase: Math.random() * Math.PI * 2,
    };
  }

  private createBreachBurstSlot(): BreachBurstSlot {
    const root = new THREE.Group();
    const outer = new THREE.Mesh(
      this.worldPatchGeometry,
      this.createFoamMaterial(SURFACE_DISTURBANCE_LOOK.breachOuterColor, 0.18, THREE.NormalBlending),
    );
    const inner = new THREE.Mesh(
      this.worldPatchGeometry,
      this.createFoamMaterial(SURFACE_DISTURBANCE_LOOK.breachInnerColor, 0.26, THREE.AdditiveBlending),
    );
    outer.rotation.x = -Math.PI / 2;
    inner.rotation.x = -Math.PI / 2;
    outer.frustumCulled = false;
    inner.frustumCulled = false;
    outer.renderOrder = 8;
    inner.renderOrder = 9;
    root.visible = false;
    root.add(outer, inner);
    this.root.add(root);

    return {
      root,
      outer,
      inner,
      active: false,
      age: 0,
      lifetime: 0.7,
      intensity: 1,
      x: 0,
      z: 0,
      kind: 'launch',
    };
  }

  private createWhaleDisturbanceSlot(): WhaleDisturbanceSlot {
    const root = new THREE.Group();
    const churn = new THREE.Mesh(
      this.worldPatchGeometry,
      this.createFoamMaterial(SURFACE_DISTURBANCE_LOOK.whaleChurnColor, 0.18, THREE.NormalBlending),
    );
    churn.rotation.x = -Math.PI / 2;
    churn.position.set(0, 0, -1.1);
    churn.frustumCulled = false;
    churn.renderOrder = 8;

    const leftFan = new THREE.Mesh(
      this.wakeFanGeometry,
      this.createFoamMaterial(SURFACE_DISTURBANCE_LOOK.whaleFanColor, 0.1, THREE.NormalBlending),
    );
    leftFan.position.set(-0.42, 0.01, -1.9);
    leftFan.frustumCulled = false;
    leftFan.renderOrder = 8;

    const rightFan = new THREE.Mesh(
      this.wakeFanGeometry,
      this.createFoamMaterial(SURFACE_DISTURBANCE_LOOK.whaleFanColor, 0.1, THREE.NormalBlending),
    );
    rightFan.position.set(0.42, 0.01, -1.9);
    rightFan.frustumCulled = false;
    rightFan.renderOrder = 8;

    const ring = new THREE.Mesh(
      this.worldPatchGeometry,
      this.createFoamMaterial(SURFACE_DISTURBANCE_LOOK.whaleRingColor, 0.22, THREE.AdditiveBlending),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.02, -0.45);
    ring.frustumCulled = false;
    ring.renderOrder = 9;

    root.visible = false;
    root.add(churn, leftFan, rightFan, ring);
    this.root.add(root);

    return {
      root,
      churn,
      leftFan,
      rightFan,
      ring,
      energy: 0,
      pulse: 0,
      previousSpeed: 0,
    };
  }

  private spawnBreachBurst(origin: THREE.Vector3, intensity: number, kind: 'launch' | 'reentry'): void {
    const burst =
      this.breachBursts.find((slot) => !slot.active) ??
      this.breachBursts.reduce((oldest, slot) => (slot.age > oldest.age ? slot : oldest), this.breachBursts[0]);

    burst.active = true;
    burst.age = 0;
    burst.lifetime = kind === 'launch' ? 0.82 : 1.04;
    burst.intensity = THREE.MathUtils.lerp(kind === 'launch' ? 1.2 : 1.45, kind === 'launch' ? 1.75 : 2.25, intensity);
    burst.x = origin.x;
    burst.z = origin.z;
    burst.kind = kind;
    burst.root.visible = true;
    burst.outer.material.opacity = 0;
    burst.inner.material.opacity = 0;
  }

  private createSilhouetteSlot(): SilhouetteSlot {
    const core = new THREE.Mesh(
      this.silhouetteGeometry,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#051f26'),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.NormalBlending,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    core.material.toneMapped = false;
    core.renderOrder = 5;

    const penumbra = new THREE.Mesh(
      this.silhouetteGeometry,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#0b3239'),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.NormalBlending,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    penumbra.material.toneMapped = false;
    penumbra.scale.set(1.26, 1, 1.16);
    penumbra.renderOrder = 4;

    const root = new THREE.Group();
    root.visible = false;
    root.add(penumbra, core);
    this.root.add(root);

    return {
      root,
      core,
      penumbra,
      strength: 0,
    };
  }

  private createFoamPatchGeometry(): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(0.1, -1.18);
    shape.bezierCurveTo(0.48, -1.06, 0.92, -0.84, 1.02, -0.42);
    shape.bezierCurveTo(1.16, -0.12, 0.98, 0.08, 0.72, 0.2);
    shape.bezierCurveTo(0.98, 0.38, 0.94, 0.78, 0.46, 1.02);
    shape.bezierCurveTo(0.08, 1.18, -0.38, 1.12, -0.78, 0.74);
    shape.bezierCurveTo(-1.12, 0.42, -1.08, 0.08, -0.82, -0.16);
    shape.bezierCurveTo(-1.12, -0.44, -0.9, -0.96, 0.1, -1.18);
    return new THREE.ShapeGeometry(shape, 20);
  }

  private createWakeFanGeometry(): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.14, 0);
    shape.lineTo(0.14, 0);
    shape.lineTo(1.18, 1);
    shape.lineTo(-1.18, 1);
    shape.closePath();
    return new THREE.ShapeGeometry(shape, 1);
  }

  private createSilhouetteGeometry(): THREE.ShapeGeometry {
    const radius = 0.34;
    const halfLength = 0.92;
    const shape = new THREE.Shape();

    shape.moveTo(radius, -halfLength);
    shape.lineTo(radius, halfLength);
    shape.absarc(0, halfLength, radius, 0, Math.PI, false);
    shape.lineTo(-radius, -halfLength);
    shape.absarc(0, -halfLength, radius, Math.PI, Math.PI * 2, false);

    const geometry = new THREE.ShapeGeometry(shape, 24);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  private createFoamMaterial(
    color: string,
    opacity: number,
    blending: THREE.Blending,
  ): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    material.userData.baseOpacity = opacity;
    material.toneMapped = false;
    material.fog = true;
    return material;
  }
}

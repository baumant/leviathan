import * as THREE from 'three';

import { Ship, ShipRole } from '../entities/Ship';

const MAX_BUBBLES = 24;
const SURFACE_OFFSET = 0.05;
const UNDERWATER_OFFSET = -0.18;
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
  surfaceSpread: number;
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
    surfaceSpread: 0.44,
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
    surfaceSpread: 0.3,
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
};

interface WakeSlot {
  readonly shipId: string;
  readonly roleConfig: WakeRoleConfig;
  readonly root: THREE.Group;
  readonly surfaceRoot: THREE.Group;
  readonly underwaterRoot: THREE.Group;
  readonly sternPatch: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  readonly leftFan: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly rightFan: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly underwaterRibbon: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly bubbles: THREE.InstancedMesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  strength: number;
  phase: number;
}

export interface ShipWakeSnapshot {
  deltaSeconds: number;
  underwaterRatio: number;
  sampleSurfaceHeight: (x: number, z: number) => number;
  ships: readonly Ship[];
}

export class ShipWakeFX {
  private readonly root = new THREE.Group();
  private readonly sternPatchGeometry = new THREE.CircleGeometry(1, 24);
  private readonly wakeFanGeometry = this.createWakeFanGeometry();
  private readonly underwaterRibbonGeometry = this.createUnderwaterRibbonGeometry();
  private readonly bubbleGeometry = new THREE.IcosahedronGeometry(0.12, 0);
  private readonly bubbleDummy = new THREE.Object3D();
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
      const slot = this.slots.get(ship.id);

      if (!slot) {
        continue;
      }

      ship.getWakeOrigin(this.sternOrigin);
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

      this.updateSurfaceLayer(slot, speedRatio);
      this.updateUnderwaterLayer(slot, speedRatio, snapshot.underwaterRatio);
    }
  }

  reset(): void {
    for (const slot of this.slots.values()) {
      slot.strength = 0;
      slot.phase = Math.random() * Math.PI * 2;
      slot.root.visible = false;
      slot.sternPatch.material.opacity = 0;
      slot.leftFan.material.opacity = 0;
      slot.rightFan.material.opacity = 0;
      slot.underwaterRibbon.material.opacity = 0;
      slot.bubbles.material.opacity = 0;
      slot.bubbles.count = 0;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.sternPatchGeometry.dispose();
    this.wakeFanGeometry.dispose();
    this.underwaterRibbonGeometry.dispose();
    this.bubbleGeometry.dispose();

    for (const slot of this.slots.values()) {
      slot.sternPatch.material.dispose();
      slot.leftFan.material.dispose();
      slot.rightFan.material.dispose();
      slot.underwaterRibbon.material.dispose();
      slot.bubbles.material.dispose();
    }
  }

  private createSlot(ship: Ship): WakeSlot {
    const roleConfig = WAKE_ROLE_CONFIGS[ship.role];
    const root = new THREE.Group();
    const surfaceRoot = new THREE.Group();
    const underwaterRoot = new THREE.Group();

    const sternPatchMaterial = this.createWakeMaterial('#eef7ea', 0.3, THREE.NormalBlending, true);
    const sternPatch = new THREE.Mesh(this.sternPatchGeometry, sternPatchMaterial);
    sternPatch.rotation.x = -Math.PI / 2;
    sternPatch.position.y = SURFACE_OFFSET;
    sternPatch.frustumCulled = false;
    sternPatch.renderOrder = 5;

    const leftFanMaterial = this.createWakeMaterial('#f2f7ea', 0.24, THREE.NormalBlending, true);
    const leftFan = new THREE.Mesh(this.wakeFanGeometry, leftFanMaterial);
    leftFan.rotation.x = -Math.PI / 2;
    leftFan.position.set(-0.08, SURFACE_OFFSET + 0.01, -0.24);
    leftFan.frustumCulled = false;
    leftFan.renderOrder = 5;

    const rightFanMaterial = this.createWakeMaterial('#f2f7ea', 0.24, THREE.NormalBlending, true);
    const rightFan = new THREE.Mesh(this.wakeFanGeometry, rightFanMaterial);
    rightFan.rotation.x = -Math.PI / 2;
    rightFan.position.set(0.08, SURFACE_OFFSET + 0.01, -0.24);
    rightFan.frustumCulled = false;
    rightFan.renderOrder = 5;

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

    surfaceRoot.add(sternPatch, leftFan, rightFan);
    underwaterRoot.add(underwaterRibbon, bubbles);
    root.add(surfaceRoot, underwaterRoot);
    root.visible = false;
    this.root.add(root);

    return {
      shipId: ship.id,
      roleConfig,
      root,
      surfaceRoot,
      underwaterRoot,
      sternPatch,
      leftFan,
      rightFan,
      underwaterRibbon,
      bubbles,
      strength: 0,
      phase: Math.random() * Math.PI * 2,
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

  private createWakeFanGeometry(): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(-0.12, 0);
    shape.lineTo(0.12, 0);
    shape.lineTo(1.08, 1);
    shape.lineTo(-1.08, 1);
    shape.closePath();
    return new THREE.ShapeGeometry(shape, 1);
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

  private updateSurfaceLayer(slot: WakeSlot, speedRatio: number): void {
    void speedRatio;
    slot.surfaceRoot.visible = false;
    slot.sternPatch.material.opacity = 0;
    slot.leftFan.material.opacity = 0;
    slot.rightFan.material.opacity = 0;
  }

  private updateUnderwaterLayer(slot: WakeSlot, speedRatio: number, underwaterRatio: number): void {
    const underwaterBias = THREE.MathUtils.lerp(0.24, 0.72, underwaterRatio);
    const underwaterOpacity = slot.strength * underwaterBias;

    slot.underwaterRoot.visible = underwaterOpacity > 0.01;

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

    slot.bubbles.instanceMatrix.needsUpdate = true;
  }
}

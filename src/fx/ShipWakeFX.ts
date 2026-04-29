import * as THREE from 'three';

import { Ship, ShipRole } from '../entities/Ship';

const MAX_BUBBLES = 24;
const MAX_SURFACE_SPRAY = 24;
const MAX_SURFACE_FOAM = 72;
const MAX_WAKE_TRAIL_STAMPS = 220;
const MAX_WAKE_TRAIL_CUTOUTS = MAX_WAKE_TRAIL_STAMPS * 3;
const TRAIL_FOAM_VARIANTS = 5;
const FOAM_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SURFACE_OFFSET = 0.05;
const UNDERWATER_OFFSET = -0.18;
const TRAIL_SURFACE_OFFSET = 0.075;
const SURFACE_WAKE_LOOK = {
  sternColor: '#eef7ea',
  fanColor: '#d8e5e2',
  foamColor: '#f2f8f1',
  trailColor: '#e8f1ee',
  sprayColor: '#f4fffb',
  sternOpacity: 0.026,
  fanOpacity: 0.006,
  foamOpacity: 0.96,
  trailOpacity: 0.86,
  sprayOpacity: 0.72,
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
  corporate_whaler: {
    sternPatchScale: new THREE.Vector2(6.4, 8.8),
    surfaceFanLength: 20.8,
    surfaceFanWidth: 5.4,
    surfaceSpread: 0.22,
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
  readonly surfaceRoot: THREE.Group;
  readonly underwaterRoot: THREE.Group;
  readonly sternPatch: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  readonly leftFan: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly rightFan: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly surfaceFoam: THREE.InstancedMesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly surfaceSpray: THREE.InstancedMesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  readonly trailFoam: readonly THREE.InstancedMesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>[];
  readonly trailCutouts: THREE.InstancedMesh<THREE.CircleGeometry, THREE.Material>;
  readonly trailVariantCounts: number[];
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
  sampleSurfaceHeight: (x: number, z: number) => number;
  ships: readonly Ship[];
}

export class ShipWakeFX {
  private readonly root = new THREE.Group();
  private readonly sternPatchGeometry = new THREE.CircleGeometry(1, 24);
  private readonly wakeFanGeometry = this.createWakeFanGeometry();
  private readonly surfaceFoamGeometry = this.createFoamFleckGeometry();
  private readonly trailFoamGeometries = Array.from({ length: TRAIL_FOAM_VARIANTS }, (_, index) =>
    this.createTrailFoamGeometry(index),
  );
  private readonly trailCutoutGeometry = new THREE.CircleGeometry(1, 18);
  private readonly underwaterRibbonGeometry = this.createUnderwaterRibbonGeometry();
  private readonly bubbleGeometry = new THREE.IcosahedronGeometry(0.12, 0);
  private readonly surfaceSprayGeometry = new THREE.IcosahedronGeometry(0.1, 0);
  private readonly bubbleDummy = new THREE.Object3D();
  private readonly cutoutDummy = new THREE.Object3D();
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

      this.updateSurfaceLayer(slot, speedRatio, snapshot.underwaterRatio);
      this.updateTrailLayer(slot, speedRatio, targetStrength * (1 - THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.08, 0.78)), snapshot);
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
      slot.surfaceFoam.material.opacity = 0;
      slot.surfaceFoam.count = 0;
      slot.surfaceSpray.material.opacity = 0;
      slot.surfaceSpray.count = 0;
      for (const trailFoam of slot.trailFoam) {
        trailFoam.material.opacity = 0;
        trailFoam.count = 0;
      }
      slot.trailCutouts.count = 0;
      slot.trailVariantCounts.fill(0);
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

  dispose(): void {
    this.root.removeFromParent();
    this.sternPatchGeometry.dispose();
    this.wakeFanGeometry.dispose();
    this.surfaceFoamGeometry.dispose();
    for (const geometry of this.trailFoamGeometries) {
      geometry.dispose();
    }
    this.trailCutoutGeometry.dispose();
    this.underwaterRibbonGeometry.dispose();
    this.bubbleGeometry.dispose();
    this.surfaceSprayGeometry.dispose();

    for (const slot of this.slots.values()) {
      slot.sternPatch.material.dispose();
      slot.leftFan.material.dispose();
      slot.rightFan.material.dispose();
      slot.surfaceFoam.material.dispose();
      slot.surfaceSpray.material.dispose();
      for (const trailFoam of slot.trailFoam) {
        trailFoam.material.dispose();
      }
      slot.trailCutouts.material.dispose();
      slot.underwaterRibbon.material.dispose();
      slot.bubbles.material.dispose();
    }
  }

  private createSlot(ship: Ship): WakeSlot {
    const roleConfig = WAKE_ROLE_CONFIGS[ship.role];
    const root = new THREE.Group();
    const surfaceRoot = new THREE.Group();
    const underwaterRoot = new THREE.Group();

    const sternPatchMaterial = this.createWakeMaterial(
      SURFACE_WAKE_LOOK.sternColor,
      SURFACE_WAKE_LOOK.sternOpacity,
      THREE.NormalBlending,
      true,
    );
    const sternPatch = new THREE.Mesh(this.sternPatchGeometry, sternPatchMaterial);
    sternPatch.rotation.x = -Math.PI / 2;
    sternPatch.position.y = SURFACE_OFFSET;
    sternPatch.frustumCulled = false;
    sternPatch.renderOrder = 22;

    const leftFanMaterial = this.createWakeMaterial(
      SURFACE_WAKE_LOOK.fanColor,
      SURFACE_WAKE_LOOK.fanOpacity,
      THREE.NormalBlending,
      true,
    );
    const leftFan = new THREE.Mesh(this.wakeFanGeometry, leftFanMaterial);
    leftFan.rotation.x = -Math.PI / 2;
    leftFan.position.set(-0.08, SURFACE_OFFSET + 0.01, -0.24);
    leftFan.frustumCulled = false;
    leftFan.renderOrder = 22;

    const rightFanMaterial = this.createWakeMaterial(
      SURFACE_WAKE_LOOK.fanColor,
      SURFACE_WAKE_LOOK.fanOpacity,
      THREE.NormalBlending,
      true,
    );
    const rightFan = new THREE.Mesh(this.wakeFanGeometry, rightFanMaterial);
    rightFan.rotation.x = -Math.PI / 2;
    rightFan.position.set(0.08, SURFACE_OFFSET + 0.01, -0.24);
    rightFan.frustumCulled = false;
    rightFan.renderOrder = 22;

    const surfaceFoamMaterial = this.createWakeMaterial(
      SURFACE_WAKE_LOOK.foamColor,
      SURFACE_WAKE_LOOK.foamOpacity,
      THREE.NormalBlending,
      true,
    );
    const surfaceFoam = new THREE.InstancedMesh(this.surfaceFoamGeometry, surfaceFoamMaterial, MAX_SURFACE_FOAM);
    surfaceFoam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    surfaceFoam.count = 0;
    surfaceFoam.frustumCulled = false;
    surfaceFoam.renderOrder = 24;

    const surfaceSprayMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(SURFACE_WAKE_LOOK.sprayColor),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    surfaceSprayMaterial.fog = true;
    surfaceSprayMaterial.toneMapped = false;
    surfaceSprayMaterial.userData.baseOpacity = SURFACE_WAKE_LOOK.sprayOpacity;

    const surfaceSpray = new THREE.InstancedMesh(this.surfaceSprayGeometry, surfaceSprayMaterial, MAX_SURFACE_SPRAY);
    surfaceSpray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    surfaceSpray.count = 0;
    surfaceSpray.frustumCulled = false;
    surfaceSpray.renderOrder = 23;

    const trailFoam = this.trailFoamGeometries.map((geometry, index) => {
      const mesh = new THREE.InstancedMesh(
        geometry,
        this.createTrailFoamMaterial(),
        MAX_WAKE_TRAIL_STAMPS,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 21 + index * 0.01;
      this.root.add(mesh);
      return mesh;
    });
    const trailVariantCounts = Array.from({ length: TRAIL_FOAM_VARIANTS }, () => 0);

    const trailCutouts = new THREE.InstancedMesh(
      this.trailCutoutGeometry,
      this.createStencilCutoutMaterial(),
      MAX_WAKE_TRAIL_CUTOUTS,
    );
    trailCutouts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    trailCutouts.count = 0;
    trailCutouts.frustumCulled = false;
    trailCutouts.renderOrder = 20.8;
    this.root.add(trailCutouts);

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
        variant: index % TRAIL_FOAM_VARIANTS,
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

    surfaceRoot.add(sternPatch, leftFan, rightFan, surfaceFoam, surfaceSpray);
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
      surfaceFoam,
      surfaceSpray,
      trailFoam,
      trailCutouts,
      trailVariantCounts,
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

  private createTrailFoamMaterial(): THREE.MeshBasicMaterial {
    const material = this.createWakeMaterial(
      SURFACE_WAKE_LOOK.trailColor,
      SURFACE_WAKE_LOOK.trailOpacity,
      THREE.NormalBlending,
      true,
    );
    material.stencilWrite = true;
    material.stencilWriteMask = 0x00;
    material.stencilFunc = THREE.NotEqualStencilFunc;
    material.stencilRef = 1;
    material.stencilFuncMask = 0xff;
    material.stencilFail = THREE.KeepStencilOp;
    material.stencilZFail = THREE.KeepStencilOp;
    material.stencilZPass = THREE.KeepStencilOp;
    return material;
  }

  private createStencilCutoutMaterial(): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#000000'),
      colorWrite: false,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.toneMapped = false;
    material.stencilWrite = true;
    material.stencilFunc = THREE.AlwaysStencilFunc;
    material.stencilRef = 1;
    material.stencilFuncMask = 0xff;
    material.stencilWriteMask = 0xff;
    material.stencilFail = THREE.KeepStencilOp;
    material.stencilZFail = THREE.KeepStencilOp;
    material.stencilZPass = THREE.ReplaceStencilOp;
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

  private createFoamFleckGeometry(): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    const points = [
      new THREE.Vector2(-0.56, -0.1),
      new THREE.Vector2(-0.42, 0.13),
      new THREE.Vector2(-0.16, 0.22),
      new THREE.Vector2(0.2, 0.18),
      new THREE.Vector2(0.54, 0.07),
      new THREE.Vector2(0.62, -0.12),
      new THREE.Vector2(0.32, -0.24),
      new THREE.Vector2(-0.06, -0.22),
      new THREE.Vector2(-0.38, -0.18),
    ];

    shape.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      shape.lineTo(points[index].x, points[index].y);
    }
    shape.closePath();
    return new THREE.ShapeGeometry(shape, 1);
  }

  private createTrailFoamGeometry(variant: number): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    const basePoints = [
      [-0.58, -0.2],
      [-0.48, 0.16],
      [-0.26, 0.42],
      [0.05, 0.52],
      [0.36, 0.42],
      [0.58, 0.18],
      [0.62, -0.08],
      [0.5, -0.34],
      [0.2, -0.52],
      [-0.14, -0.48],
      [-0.44, -0.34],
    ];
    const points = basePoints.map(([x, y], index) => {
      const chip = Math.sin(variant * 2.17 + index * 1.61);
      const tangent = Math.cos(variant * 1.31 + index * 2.29);
      return new THREE.Vector2(x + chip * 0.035, y + tangent * 0.028);
    });

    shape.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      shape.lineTo(points[index].x, points[index].y);
    }
    shape.closePath();

    const holeCount = 3 + (variant % 3);
    for (let index = 0; index < holeCount; index += 1) {
      const seed = variant * 11.73 + index * 5.19;
      const hole = new THREE.Path();
      hole.absellipse(
        THREE.MathUtils.clamp(Math.sin(seed) * 0.34, -0.46, 0.46),
        THREE.MathUtils.clamp(Math.cos(seed * 1.37) * 0.18, -0.2, 0.2),
        THREE.MathUtils.lerp(0.055, 0.17, (Math.sin(seed * 0.73) + 1) * 0.5),
        THREE.MathUtils.lerp(0.035, 0.095, (Math.cos(seed * 0.91) + 1) * 0.5),
        0,
        Math.PI * 2,
        false,
        seed,
      );
      shape.holes.push(hole);
    }

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

  private updateSurfaceLayer(slot: WakeSlot, speedRatio: number, underwaterRatio: number): void {
    void speedRatio;
    void underwaterRatio;
    slot.surfaceRoot.visible = false;
    slot.sternPatch.material.opacity = 0;
    slot.leftFan.material.opacity = 0;
    slot.rightFan.material.opacity = 0;
    slot.surfaceFoam.material.opacity = 0;
    slot.surfaceFoam.count = 0;
    slot.surfaceSpray.material.opacity = 0;
    slot.surfaceSpray.count = 0;
  }

  private updateTrailLayer(
    slot: WakeSlot,
    speedRatio: number,
    surfaceOpacity: number,
    snapshot: ShipWakeSnapshot,
  ): void {
    if (surfaceOpacity > 0.015) {
      this.emitTrailBetweenPoints(slot, speedRatio, surfaceOpacity);
    } else {
      slot.hasTrailPoint = false;
    }

    let visibleCount = 0;
    let cutoutCount = 0;
    const aboveWaterAlpha = 1 - THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.08, 0.78);
    slot.trailVariantCounts.fill(0);
    for (const trailFoam of slot.trailFoam) {
      trailFoam.material.opacity = (trailFoam.material.userData.baseOpacity as number) * aboveWaterAlpha;
    }

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
      const variant = THREE.MathUtils.clamp(stamp.variant, 0, slot.trailFoam.length - 1);
      const variantCount = slot.trailVariantCounts[variant];

      this.bubbleDummy.position.set(
        stamp.position.x + Math.sin(stamp.phase + stamp.age * 0.55) * 0.025,
        surfaceHeight + TRAIL_SURFACE_OFFSET + (visibleCount % 7) * 0.001,
        stamp.position.z + Math.cos(stamp.phase * 1.3 + stamp.age * 0.42) * 0.025,
      );
      this.bubbleDummy.rotation.set(-Math.PI / 2, 0, stamp.yaw + Math.sin(stamp.phase + stamp.age * 0.7) * 0.04);
      this.bubbleDummy.scale.set(
        Math.max(0.001, stamp.width * foamScale),
        Math.max(0.001, stamp.length * foamScale),
        1,
      );
      this.bubbleDummy.updateMatrix();
      slot.trailFoam[variant].setMatrixAt(variantCount, this.bubbleDummy.matrix);
      slot.trailVariantCounts[variant] = variantCount + 1;
      cutoutCount = this.writeTrailCutouts(slot, stamp, surfaceHeight, cutoutCount);
      visibleCount += 1;
    }

    for (let index = 0; index < slot.trailFoam.length; index += 1) {
      const trailFoam = slot.trailFoam[index];
      trailFoam.count = slot.trailVariantCounts[index];
      trailFoam.instanceMatrix.needsUpdate = trailFoam.count > 0;
    }
    slot.trailCutouts.count = cutoutCount;
    slot.trailCutouts.instanceMatrix.needsUpdate = cutoutCount > 0;
  }

  private writeTrailCutouts(
    slot: WakeSlot,
    stamp: WakeTrailStamp,
    surfaceHeight: number,
    firstIndex: number,
  ): number {
    let cutoutIndex = firstIndex;
    const cutoutCount = stamp.width > 1.15 ? 3 : 2;
    const rightX = Math.cos(stamp.yaw);
    const rightZ = Math.sin(stamp.yaw);
    const forwardX = -Math.sin(stamp.yaw);
    const forwardZ = Math.cos(stamp.yaw);
    const progress = THREE.MathUtils.clamp(stamp.age / Math.max(stamp.lifetime, 0.0001), 0, 1);
    const coverSeed = stamp.phase * 1.63;
    const coverStart = THREE.MathUtils.lerp(0.16, 0.32, (Math.sin(coverSeed) + 1) * 0.5);
    const coverEnd = THREE.MathUtils.lerp(1.26, 1.46, (Math.cos(coverSeed * 1.37) + 1) * 0.5);
    const coverExpansion = THREE.MathUtils.lerp(coverStart, coverEnd, THREE.MathUtils.smoothstep(progress, 0.08, 0.86));
    const holeStart = THREE.MathUtils.lerp(0.34, 0.54, (Math.sin(coverSeed * 0.73) + 1) * 0.5);
    const holeEnd = THREE.MathUtils.lerp(1.36, 1.62, (Math.cos(coverSeed * 0.91) + 1) * 0.5);
    const holeExpansion = THREE.MathUtils.lerp(holeStart, holeEnd, THREE.MathUtils.smoothstep(progress, 0.02, 0.68));
    const cutoutDrift = THREE.MathUtils.lerp(0.55, 1.22, THREE.MathUtils.smoothstep(progress, 0.1, 1));
    const coverAngle = coverSeed * 2.41;
    const coverRadius = THREE.MathUtils.lerp(
      0.08,
      0.56,
      Math.pow((Math.sin(coverSeed * 2.19) + 1) * 0.5, 0.36),
    );
    const coverOffsetX = Math.cos(coverAngle) * stamp.width * coverRadius;
    const coverOffsetZ = Math.sin(coverAngle) * stamp.length * coverRadius;
    const coverWander = 1 - THREE.MathUtils.smoothstep(progress, 0.22, 0.84);

    for (let index = 0; index < cutoutCount && cutoutIndex < MAX_WAKE_TRAIL_CUTOUTS; index += 1) {
      const seed = stamp.phase * 2.31 + index * 3.17;
      const isCoverCutout = index === 0;
      const localX = isCoverCutout
        ? coverOffsetX * coverWander
        : Math.sin(seed) * stamp.width * THREE.MathUtils.lerp(0.24, 0.42, (Math.cos(seed * 1.11) + 1) * 0.5) * cutoutDrift;
      const localZ = isCoverCutout
        ? coverOffsetZ * coverWander
        : Math.cos(seed * 1.29) * stamp.length * THREE.MathUtils.lerp(0.24, 0.44, (Math.sin(seed * 0.97) + 1) * 0.5) * cutoutDrift;
      const scaleX = isCoverCutout
        ? stamp.width * coverExpansion
        : stamp.width *
          THREE.MathUtils.lerp(0.14, 0.28, (Math.sin(seed * 0.71) + 1) * 0.5) *
          holeExpansion;
      const scaleY = isCoverCutout
        ? stamp.length * coverExpansion
        : stamp.length *
          THREE.MathUtils.lerp(0.14, 0.3, (Math.cos(seed * 0.83) + 1) * 0.5) *
          holeExpansion;

      this.cutoutDummy.position.set(
        stamp.position.x + rightX * localX + forwardX * localZ,
        surfaceHeight + TRAIL_SURFACE_OFFSET + 0.012 + (cutoutIndex % 5) * 0.001,
        stamp.position.z + rightZ * localX + forwardZ * localZ,
      );
      this.cutoutDummy.rotation.set(-Math.PI / 2, 0, stamp.yaw + Math.sin(seed) * 0.45);
      this.cutoutDummy.scale.set(
        Math.max(0.001, scaleX),
        Math.max(0.001, scaleY),
        1,
      );
      this.cutoutDummy.updateMatrix();
      slot.trailCutouts.setMatrixAt(cutoutIndex, this.cutoutDummy.matrix);
      cutoutIndex += 1;
    }

    return cutoutIndex;
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
    const stampCount = Math.min(18, (speedRatio > 0.42 ? 7 : 5) + Math.floor(wakeLength / 12));
    const bowStampCount = Math.max(3, Math.ceil(stampCount * 0.32));

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
      stamp.lifetime = THREE.MathUtils.lerp(2.9, 5.2, speedRatio) * THREE.MathUtils.lerp(0.82, 1.18, surfaceOpacity);
      stamp.position.set(
        x - forwardX * longitudinal + rightX * (spread + noise),
        0,
        z - forwardZ * longitudinal + rightZ * (spread + noise),
      );
      stamp.yaw = heading + Math.PI * 0.5 + THREE.MathUtils.randFloatSpread(0.92) + centerBias * 0.26;
      const stampSize =
        roleScale *
        THREE.MathUtils.lerp(0.36 + centerWeight * 0.2, 0.92 + centerWeight * 0.24, Math.random());
      stamp.width = stampSize * THREE.MathUtils.lerp(0.9, 1.12, Math.random());
      stamp.length = stampSize * THREE.MathUtils.lerp(0.86, 1.08, Math.random());
      stamp.phase = slot.phase + index * FOAM_GOLDEN_ANGLE + Math.random() * 0.08;
      stamp.variant = Math.floor(Math.random() * slot.trailFoam.length);
    }
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

import * as THREE from 'three';

import { PlayerWhale } from '../entities/PlayerWhale';
import { WHALE_SPEED_PROFILE } from '../tuning/whaleSpeedProfile';

const MAX_SURFACE_SPRAY = 32;
const MAX_SURFACE_FOAM = 64;
const MAX_WAKE_TRAIL_STAMPS = 180;
const MAX_WAKE_TRAIL_CUTOUTS = MAX_WAKE_TRAIL_STAMPS * 3;
const TRAIL_FOAM_VARIANTS = 5;
const FOAM_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SURFACE_OFFSET = 0.1;
const TRAIL_SURFACE_OFFSET = 0.085;
const WHALE_ACCELERATION_RANGE = WHALE_SPEED_PROFILE.surfaceDisturbanceAccelerationRange;

const WHALE_SURFACE_SPRAY_LOOK = {
  churnColor: '#aab8c5',
  fanColor: '#8195a0',
  foamColor: '#e8f4f3',
  trailColor: '#deebe9',
  ringColor: '#e5f0f1',
  sprayColor: '#f4ffff',
  churnOpacity: 0.028,
  fanOpacity: 0.006,
  foamOpacity: 0.78,
  trailOpacity: 0.62,
  ringOpacity: 0.16,
  sprayOpacity: 0.68,
} as const;

export interface WhaleSurfaceSpraySnapshot {
  deltaSeconds: number;
  underwaterRatio: number;
  sampleSurfaceHeight: (x: number, z: number) => number;
  whale: PlayerWhale;
  whaleStrokePulseStrength: number;
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

export class WhaleSurfaceSprayFX {
  private readonly root = new THREE.Group();
  private readonly trailRoot = new THREE.Group();
  private readonly foamGeometry = new THREE.CircleGeometry(1, 28);
  private readonly fanGeometry = this.createWakeFanGeometry();
  private readonly foamFleckGeometry = this.createFoamFleckGeometry();
  private readonly trailFoamGeometries = Array.from({ length: TRAIL_FOAM_VARIANTS }, (_, index) =>
    this.createTrailFoamGeometry(index),
  );
  private readonly trailCutoutGeometry = new THREE.CircleGeometry(1, 18);
  private readonly ringGeometry = new THREE.RingGeometry(0.72, 1, 42, 1);
  private readonly sprayGeometry = new THREE.IcosahedronGeometry(0.11, 0);
  private readonly churn: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly leftFan: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly rightFan: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly foamFlecks: THREE.InstancedMesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly trailFoam: readonly THREE.InstancedMesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>[];
  private readonly trailCutouts: THREE.InstancedMesh<THREE.CircleGeometry, THREE.Material>;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly spray: THREE.InstancedMesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  private readonly dummy = new THREE.Object3D();
  private readonly cutoutDummy = new THREE.Object3D();
  private readonly lastTrailPoint = new THREE.Vector3();
  private readonly trailPrevious = new THREE.Vector3();
  private readonly trailStamps: WakeTrailStamp[] = [];
  private readonly trailVariantCounts = Array.from({ length: TRAIL_FOAM_VARIANTS }, () => 0);

  private energy = 0;
  private pulse = 0;
  private phase = Math.random() * Math.PI * 2;
  private previousSpeed = 0;
  private nextTrailStamp = 0;
  private hasTrailPoint = false;

  constructor(scene: THREE.Scene) {
    this.root.renderOrder = 23;
    scene.add(this.root);
    scene.add(this.trailRoot);

    this.churn = new THREE.Mesh(
      this.foamGeometry,
      this.createSurfaceMaterial(WHALE_SURFACE_SPRAY_LOOK.churnColor, WHALE_SURFACE_SPRAY_LOOK.churnOpacity, THREE.NormalBlending),
    );
    this.churn.rotation.x = -Math.PI / 2;
    this.churn.position.set(0, SURFACE_OFFSET, -1.1);
    this.churn.frustumCulled = false;
    this.churn.renderOrder = 23;

    this.leftFan = new THREE.Mesh(
      this.fanGeometry,
      this.createSurfaceMaterial(WHALE_SURFACE_SPRAY_LOOK.fanColor, WHALE_SURFACE_SPRAY_LOOK.fanOpacity, THREE.NormalBlending),
    );
    this.leftFan.rotation.x = -Math.PI / 2;
    this.leftFan.position.set(-0.44, SURFACE_OFFSET + 0.01, -1.8);
    this.leftFan.frustumCulled = false;
    this.leftFan.renderOrder = 23;

    this.rightFan = new THREE.Mesh(
      this.fanGeometry,
      this.createSurfaceMaterial(WHALE_SURFACE_SPRAY_LOOK.fanColor, WHALE_SURFACE_SPRAY_LOOK.fanOpacity, THREE.NormalBlending),
    );
    this.rightFan.rotation.x = -Math.PI / 2;
    this.rightFan.position.set(0.44, SURFACE_OFFSET + 0.01, -1.8);
    this.rightFan.frustumCulled = false;
    this.rightFan.renderOrder = 23;

    this.foamFlecks = new THREE.InstancedMesh(
      this.foamFleckGeometry,
      this.createSurfaceMaterial(WHALE_SURFACE_SPRAY_LOOK.foamColor, WHALE_SURFACE_SPRAY_LOOK.foamOpacity, THREE.NormalBlending),
      MAX_SURFACE_FOAM,
    );
    this.foamFlecks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.foamFlecks.count = 0;
    this.foamFlecks.frustumCulled = false;
    this.foamFlecks.renderOrder = 24;

    this.trailFoam = this.trailFoamGeometries.map((geometry, index) => {
      const mesh = new THREE.InstancedMesh(
        geometry,
        this.createTrailFoamMaterial(),
        MAX_WAKE_TRAIL_STAMPS,
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 22 + index * 0.01;
      this.trailRoot.add(mesh);
      return mesh;
    });

    this.trailCutouts = new THREE.InstancedMesh(
      this.trailCutoutGeometry,
      this.createStencilCutoutMaterial(),
      MAX_WAKE_TRAIL_CUTOUTS,
    );
    this.trailCutouts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.trailCutouts.count = 0;
    this.trailCutouts.frustumCulled = false;
    this.trailCutouts.renderOrder = 20.8;
    this.trailRoot.add(this.trailCutouts);

    for (let index = 0; index < MAX_WAKE_TRAIL_STAMPS; index += 1) {
      this.trailStamps.push({
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

    this.ring = new THREE.Mesh(
      this.ringGeometry,
      this.createSurfaceMaterial(WHALE_SURFACE_SPRAY_LOOK.ringColor, WHALE_SURFACE_SPRAY_LOOK.ringOpacity, THREE.AdditiveBlending),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(0, SURFACE_OFFSET + 0.02, -0.45);
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 24;

    const sprayMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(WHALE_SURFACE_SPRAY_LOOK.sprayColor),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    sprayMaterial.fog = true;
    sprayMaterial.toneMapped = false;
    sprayMaterial.userData.baseOpacity = WHALE_SURFACE_SPRAY_LOOK.sprayOpacity;

    this.spray = new THREE.InstancedMesh(this.sprayGeometry, sprayMaterial, MAX_SURFACE_SPRAY);
    this.spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.spray.count = 0;
    this.spray.frustumCulled = false;
    this.spray.renderOrder = 25;

    this.root.add(this.churn, this.leftFan, this.rightFan, this.foamFlecks, this.ring, this.spray);
    this.reset();
  }

  update(snapshot: WhaleSurfaceSpraySnapshot): void {
    const surfaceHeight = snapshot.sampleSurfaceHeight(snapshot.whale.position.x, snapshot.whale.position.z);
    const signedSurfaceOffset = snapshot.whale.position.y - surfaceHeight;
    const aboveWaterAlpha = 1 - THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.08, 0.78);
    const nearSurfaceAlpha = 1 - THREE.MathUtils.smoothstep(Math.abs(signedSurfaceOffset), 0.22, 3.6);
    const breachSuppression = snapshot.whale.actionState === 'breach' ? 0.18 : 1;
    const speedRatio = THREE.MathUtils.clamp(snapshot.whale.speed / WHALE_SPEED_PROFILE.maxTravelSpeed, 0, 1.2);
    const acceleration = Math.max(0, snapshot.whale.speed - this.previousSpeed) / Math.max(snapshot.deltaSeconds, 0.0001);
    const accelerationRatio = THREE.MathUtils.clamp(acceleration / WHALE_ACCELERATION_RANGE, 0, 1.2);
    const strokePulse = THREE.MathUtils.clamp(
      snapshot.whaleStrokePulseStrength / WHALE_SPEED_PROFILE.strokeImpulseMax,
      0,
      1.2,
    );
    const targetEnergy =
      aboveWaterAlpha *
      nearSurfaceAlpha *
      breachSuppression *
      THREE.MathUtils.clamp(0.02 + speedRatio * 0.42 + accelerationRatio * 0.2, 0, 1.1);

    this.phase += snapshot.deltaSeconds * THREE.MathUtils.lerp(1.15, 3.2, speedRatio);
    this.energy = THREE.MathUtils.damp(this.energy, targetEnergy, targetEnergy > this.energy ? 4.8 : 2.8, snapshot.deltaSeconds);
    this.pulse = THREE.MathUtils.damp(this.pulse, 0, 4.2, snapshot.deltaSeconds);

    const pulseKick = aboveWaterAlpha * nearSurfaceAlpha * breachSuppression * (strokePulse * 0.78 + accelerationRatio * 0.24);
    if (pulseKick > this.pulse) {
      this.pulse = pulseKick;
    }

    this.previousSpeed = snapshot.whale.speed;

    const visibleStrength = THREE.MathUtils.clamp(this.energy + this.pulse * 0.42, 0, 1.25);
    this.updateTrailLayer(snapshot, visibleStrength, speedRatio, nearSurfaceAlpha, aboveWaterAlpha);
    this.root.visible = false;
    this.clearLocalMaterials();
  }

  reset(): void {
    this.energy = 0;
    this.pulse = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.previousSpeed = 0;
    this.nextTrailStamp = 0;
    this.hasTrailPoint = false;
    for (const stamp of this.trailStamps) {
      stamp.active = false;
      stamp.age = 0;
    }
    this.root.visible = false;
    this.clearLocalMaterials();
    this.trailVariantCounts.fill(0);
    for (const trailFoam of this.trailFoam) {
      trailFoam.material.opacity = 0;
      trailFoam.count = 0;
    }
    this.trailCutouts.count = 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.trailRoot.removeFromParent();
    this.foamGeometry.dispose();
    this.fanGeometry.dispose();
    this.foamFleckGeometry.dispose();
    for (const geometry of this.trailFoamGeometries) {
      geometry.dispose();
    }
    this.trailCutoutGeometry.dispose();
    this.ringGeometry.dispose();
    this.sprayGeometry.dispose();
    this.churn.material.dispose();
    this.leftFan.material.dispose();
    this.rightFan.material.dispose();
    this.foamFlecks.material.dispose();
    for (const trailFoam of this.trailFoam) {
      trailFoam.material.dispose();
    }
    this.trailCutouts.material.dispose();
    this.ring.material.dispose();
    this.spray.material.dispose();
  }

  private clearLocalMaterials(): void {
    this.churn.material.opacity = 0;
    this.leftFan.material.opacity = 0;
    this.rightFan.material.opacity = 0;
    this.foamFlecks.material.opacity = 0;
    this.foamFlecks.count = 0;
    this.ring.material.opacity = 0;
    this.spray.material.opacity = 0;
    this.spray.count = 0;
  }

  private updateTrailLayer(
    snapshot: WhaleSurfaceSpraySnapshot,
    visibleStrength: number,
    speedRatio: number,
    nearSurfaceAlpha: number,
    aboveWaterAlpha: number,
  ): void {
    const trailStrength = visibleStrength * nearSurfaceAlpha;

    if (trailStrength > 0.025) {
      this.emitTrailBetweenPoints(snapshot.whale.position, snapshot.whale.yaw, speedRatio, trailStrength);
    } else {
      this.hasTrailPoint = false;
    }

    let visibleCount = 0;
    let cutoutCount = 0;
    this.trailVariantCounts.fill(0);
    for (const trailFoam of this.trailFoam) {
      trailFoam.material.opacity = (trailFoam.material.userData.baseOpacity as number) * aboveWaterAlpha;
    }

    for (const stamp of this.trailStamps) {
      if (!stamp.active) {
        continue;
      }

      stamp.age += snapshot.deltaSeconds;

      if (stamp.age >= stamp.lifetime) {
        stamp.active = false;
        continue;
      }

      const progress = stamp.age / stamp.lifetime;
      const ripple = 0.9 + Math.sin(stamp.phase + progress * Math.PI * 2) * 0.1;
      const foamShrink = 1 - THREE.MathUtils.smoothstep(progress, 0.12, 0.96);
      const foamScale = Math.max(0.001, foamShrink * ripple);
      const surfaceHeight = snapshot.sampleSurfaceHeight(stamp.position.x, stamp.position.z);
      const variant = THREE.MathUtils.clamp(stamp.variant, 0, this.trailFoam.length - 1);
      const variantCount = this.trailVariantCounts[variant];

      this.dummy.position.set(
        stamp.position.x + Math.sin(stamp.phase + stamp.age * 0.48) * 0.025,
        surfaceHeight + TRAIL_SURFACE_OFFSET + (visibleCount % 7) * 0.001,
        stamp.position.z + Math.cos(stamp.phase * 1.2 + stamp.age * 0.38) * 0.025,
      );
      this.dummy.rotation.set(-Math.PI / 2, 0, stamp.yaw + Math.sin(stamp.phase + stamp.age * 0.62) * 0.04);
      this.dummy.scale.set(
        Math.max(0.001, stamp.width * foamScale),
        Math.max(0.001, stamp.length * foamScale),
        1,
      );
      this.dummy.updateMatrix();
      this.trailFoam[variant].setMatrixAt(variantCount, this.dummy.matrix);
      this.trailVariantCounts[variant] = variantCount + 1;
      cutoutCount = this.writeTrailCutouts(stamp, surfaceHeight, cutoutCount);
      visibleCount += 1;
    }

    for (let index = 0; index < this.trailFoam.length; index += 1) {
      const trailFoam = this.trailFoam[index];
      trailFoam.count = this.trailVariantCounts[index];
      trailFoam.instanceMatrix.needsUpdate = trailFoam.count > 0;
    }
    this.trailCutouts.count = cutoutCount;
    this.trailCutouts.instanceMatrix.needsUpdate = cutoutCount > 0;
  }

  private writeTrailCutouts(
    stamp: WakeTrailStamp,
    surfaceHeight: number,
    firstIndex: number,
  ): number {
    let cutoutIndex = firstIndex;
    const cutoutCount = stamp.width > 1.05 ? 3 : 2;
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
      this.trailCutouts.setMatrixAt(cutoutIndex, this.cutoutDummy.matrix);
      cutoutIndex += 1;
    }

    return cutoutIndex;
  }

  private emitTrailBetweenPoints(
    position: THREE.Vector3,
    yaw: number,
    speedRatio: number,
    trailStrength: number,
  ): void {
    if (!this.hasTrailPoint) {
      this.lastTrailPoint.copy(position);
      this.hasTrailPoint = true;
      this.emitTrailStampCluster(position.x, position.z, yaw, speedRatio, trailStrength);
      return;
    }

    this.trailPrevious.copy(this.lastTrailPoint);
    const distance = this.trailPrevious.distanceTo(position);
    const spacing = THREE.MathUtils.lerp(0.42, 0.82, speedRatio);

    if (distance < spacing) {
      return;
    }

    const steps = Math.min(4, Math.floor(distance / spacing));

    for (let step = 1; step <= steps; step += 1) {
      const alpha = step / steps;
      const x = THREE.MathUtils.lerp(this.trailPrevious.x, position.x, alpha);
      const z = THREE.MathUtils.lerp(this.trailPrevious.z, position.z, alpha);
      this.emitTrailStampCluster(x, z, yaw, speedRatio, trailStrength);
    }

    this.lastTrailPoint.copy(position);
  }

  private emitTrailStampCluster(
    x: number,
    z: number,
    yaw: number,
    speedRatio: number,
    trailStrength: number,
  ): void {
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const baseWidth = THREE.MathUtils.lerp(1.5, 3.6, speedRatio) * (0.9 + trailStrength * 0.5);
    const baseLength = THREE.MathUtils.lerp(0.72, 1.62, speedRatio);
    const stampCount = speedRatio > 0.44 ? 7 : 5;

    for (let index = 0; index < stampCount; index += 1) {
      const laneBias = Math.sin(this.phase * 1.27 + index * 2.33 + Math.random() * 0.4);
      const centerBias = index < 2 ? THREE.MathUtils.randFloatSpread(0.24) : laneBias;
      const spread = baseWidth * centerBias * THREE.MathUtils.lerp(0.24, 0.84, Math.random());
      const back = baseLength * THREE.MathUtils.lerp(0.42, 2.1, Math.random());
      const noise = THREE.MathUtils.randFloatSpread(baseWidth * 0.16);
      const centerWeight = 1 - Math.min(1, Math.abs(centerBias));
      const stamp = this.trailStamps[this.nextTrailStamp];

      this.nextTrailStamp = (this.nextTrailStamp + 1) % this.trailStamps.length;
      stamp.active = true;
      stamp.age = 0;
      stamp.lifetime = THREE.MathUtils.lerp(3.1, 5.6, speedRatio) * THREE.MathUtils.lerp(0.82, 1.16, trailStrength);
      stamp.position.set(
        x - forwardX * back + rightX * (spread + noise),
        0,
        z - forwardZ * back + rightZ * (spread + noise),
      );
      stamp.yaw = yaw + Math.PI * 0.5 + THREE.MathUtils.randFloatSpread(0.96) + centerBias * 0.24;
      const stampSize = THREE.MathUtils.lerp(0.46 + centerWeight * 0.22, 1.08 + centerWeight * 0.28, Math.random());
      stamp.width = stampSize * THREE.MathUtils.lerp(0.9, 1.12, Math.random());
      stamp.length = stampSize * THREE.MathUtils.lerp(0.86, 1.08, Math.random());
      stamp.phase = this.phase + index * FOAM_GOLDEN_ANGLE + Math.random() * 0.08;
      stamp.variant = Math.floor(Math.random() * this.trailFoam.length);
    }
  }

  private createSurfaceMaterial(color: string, baseOpacity: number, blending: THREE.Blending): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    material.userData.baseOpacity = baseOpacity;
    material.fog = true;
    material.toneMapped = false;
    return material;
  }

  private createTrailFoamMaterial(): THREE.MeshBasicMaterial {
    const material = this.createSurfaceMaterial(
      WHALE_SURFACE_SPRAY_LOOK.trailColor,
      WHALE_SURFACE_SPRAY_LOOK.trailOpacity,
      THREE.NormalBlending,
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
    shape.moveTo(-0.1, 0);
    shape.lineTo(0.1, 0);
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
}

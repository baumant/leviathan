import * as THREE from 'three';

import { PlayerWhale } from '../entities/PlayerWhale';
import { WHALE_SPEED_PROFILE } from '../tuning/whaleSpeedProfile';
import {
  WATER_FOAM_GOLDEN_ANGLE,
  WATER_FOAM_STAMP_VARIANTS,
  WaterFoamStampLayer,
} from './WaterFoamStampLayer';

const MAX_LOCAL_STAMPS = 112;
const MAX_LOCAL_CUTOUTS = MAX_LOCAL_STAMPS * 3;
const MAX_WAKE_TRAIL_STAMPS = 180;
const MAX_WAKE_TRAIL_CUTOUTS = MAX_WAKE_TRAIL_STAMPS * 3;
const SURFACE_OFFSET = 0.1;
const TRAIL_SURFACE_OFFSET = 0.085;
const WHALE_ACCELERATION_RANGE = WHALE_SPEED_PROFILE.surfaceDisturbanceAccelerationRange;

const WHALE_SURFACE_SPRAY_LOOK = {
  localColor: '#d8e7e4',
  trailColor: '#d5e2df',
  localOpacity: 0.34,
  trailOpacity: 0.46,
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
  private readonly localFoam: WaterFoamStampLayer;
  private readonly trailFoam: WaterFoamStampLayer;
  private readonly lastTrailPoint = new THREE.Vector3();
  private readonly trailPrevious = new THREE.Vector3();
  private readonly trailStamps: WakeTrailStamp[] = [];

  private energy = 0;
  private pulse = 0;
  private phase = Math.random() * Math.PI * 2;
  private previousSpeed = 0;
  private nextTrailStamp = 0;
  private hasTrailPoint = false;

  constructor(scene: THREE.Scene) {
    this.root.renderOrder = 23;
    this.trailRoot.renderOrder = 22;
    scene.add(this.root, this.trailRoot);

    this.localFoam = new WaterFoamStampLayer(this.root, {
      maxStamps: MAX_LOCAL_STAMPS,
      maxCutouts: MAX_LOCAL_CUTOUTS,
      color: WHALE_SURFACE_SPRAY_LOOK.localColor,
      opacity: WHALE_SURFACE_SPRAY_LOOK.localOpacity,
      blending: THREE.NormalBlending,
      renderOrder: 24,
      cutoutRenderOrder: 23.7,
    });
    this.trailFoam = new WaterFoamStampLayer(this.trailRoot, {
      maxStamps: MAX_WAKE_TRAIL_STAMPS,
      maxCutouts: MAX_WAKE_TRAIL_CUTOUTS,
      color: WHALE_SURFACE_SPRAY_LOOK.trailColor,
      opacity: WHALE_SURFACE_SPRAY_LOOK.trailOpacity,
      blending: THREE.NormalBlending,
      renderOrder: 22,
      cutoutRenderOrder: 20.8,
    });

    for (let index = 0; index < MAX_WAKE_TRAIL_STAMPS; index += 1) {
      this.trailStamps.push({
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
    this.updateLocalDisturbance(
      snapshot,
      surfaceHeight,
      visibleStrength,
      speedRatio,
      nearSurfaceAlpha,
      aboveWaterAlpha,
      breachSuppression,
    );
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
    this.localFoam.reset();
    this.trailFoam.reset();
  }

  dispose(): void {
    this.root.removeFromParent();
    this.trailRoot.removeFromParent();
    this.localFoam.dispose();
    this.trailFoam.dispose();
  }

  private updateTrailLayer(
    snapshot: WhaleSurfaceSpraySnapshot,
    visibleStrength: number,
    speedRatio: number,
    nearSurfaceAlpha: number,
    aboveWaterAlpha: number,
  ): void {
    const trailStrength = visibleStrength * nearSurfaceAlpha;

    if (aboveWaterAlpha <= 0.005 && trailStrength <= 0.025) {
      this.clearTrailLayer(true);
      return;
    }

    if (trailStrength > 0.025) {
      this.emitTrailBetweenPoints(snapshot.whale.position, snapshot.whale.yaw, speedRatio, trailStrength);
    } else {
      this.hasTrailPoint = false;
    }

    this.trailFoam.begin(aboveWaterAlpha);
    let visibleCount = 0;

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

      this.trailFoam.addStamp({
        x: stamp.position.x + Math.sin(stamp.phase + stamp.age * 0.48) * 0.025,
        y: surfaceHeight + TRAIL_SURFACE_OFFSET + (visibleCount % 7) * 0.001,
        z: stamp.position.z + Math.cos(stamp.phase * 1.2 + stamp.age * 0.38) * 0.025,
        yaw: stamp.yaw + Math.sin(stamp.phase + stamp.age * 0.62) * 0.04,
        width: stamp.width * foamScale,
        length: stamp.length * foamScale,
        phase: stamp.phase,
        progress,
        variant: stamp.variant,
      });
      visibleCount += 1;
    }

    this.trailFoam.end();
  }

  private clearTrailLayer(clearStamps: boolean): void {
    this.hasTrailPoint = false;
    this.trailFoam.reset();

    if (clearStamps) {
      for (const stamp of this.trailStamps) {
        stamp.active = false;
      }
    }
  }

  private updateLocalDisturbance(
    snapshot: WhaleSurfaceSpraySnapshot,
    surfaceHeight: number,
    visibleStrength: number,
    speedRatio: number,
    nearSurfaceAlpha: number,
    aboveWaterAlpha: number,
    breachSuppression: number,
  ): void {
    const disturbanceStrength =
      aboveWaterAlpha *
      nearSurfaceAlpha *
      breachSuppression *
      THREE.MathUtils.clamp(this.energy * 0.48 + this.pulse * 0.72, 0, 1.1);
    const pulseStrength = aboveWaterAlpha * nearSurfaceAlpha * breachSuppression * this.pulse;

    this.root.visible = disturbanceStrength > 0.018 || pulseStrength > 0.025;

    if (!this.root.visible) {
      this.localFoam.reset();
      return;
    }

    this.root.position.set(snapshot.whale.position.x, surfaceHeight, snapshot.whale.position.z);
    this.root.rotation.set(0, snapshot.whale.yaw, 0, 'YXZ');

    const churnWidth = THREE.MathUtils.lerp(2.2, 5.4, speedRatio) * (0.72 + visibleStrength * 0.4);
    const churnLength = THREE.MathUtils.lerp(4.1, 11.4, speedRatio) * (0.72 + this.energy * 0.48 + this.pulse * 0.24);
    const fanWidth = THREE.MathUtils.lerp(1.45, 4.1, speedRatio) * (0.68 + disturbanceStrength * 0.42);
    const fanLength = THREE.MathUtils.lerp(3.2, 9.4, speedRatio) * (0.68 + this.energy * 0.58 + this.pulse * 0.22);
    const opacity =
      THREE.MathUtils.clamp(disturbanceStrength * 1.12 + pulseStrength * 0.34, 0, 1) *
      (0.92 + Math.sin(this.phase * 2.4) * 0.08);

    this.localFoam.begin(opacity);
    this.writeChurnStamps(visibleStrength, speedRatio, disturbanceStrength, churnWidth, churnLength);
    this.writeFanStamps(speedRatio, disturbanceStrength, fanWidth, fanLength);
    this.writePulseStamps(pulseStrength, speedRatio, churnWidth);
    this.localFoam.end();
  }

  private writeChurnStamps(
    visibleStrength: number,
    speedRatio: number,
    disturbanceStrength: number,
    churnWidth: number,
    churnLength: number,
  ): void {
    const count = Math.min(
      34,
      Math.ceil(THREE.MathUtils.lerp(8, 24, speedRatio) * THREE.MathUtils.clamp(0.45 + visibleStrength, 0.45, 1.4)),
    );

    for (let index = 0; index < count; index += 1) {
      const progress = (this.phase * 0.15 + index * 0.113) % 1;
      const seed = this.phase * 1.47 + index * 2.17;
      const lateral = Math.sin(seed) * churnWidth * 0.5 * (0.14 + progress * 0.62);
      const localZ = -0.52 - progress * churnLength * 0.62 + Math.cos(seed * 0.71) * 0.28;
      const centerBias = 1 - THREE.MathUtils.clamp(Math.abs(lateral) / Math.max(churnWidth * 0.5, 0.001), 0, 1);
      const scale =
        THREE.MathUtils.lerp(0.18, 0.52, 1 - progress) *
        THREE.MathUtils.lerp(0.82, 1.36, (Math.sin(seed * 0.43) + 1) * 0.5) *
        (0.78 + disturbanceStrength * 0.5);

      this.localFoam.addStamp({
        x: lateral,
        y: SURFACE_OFFSET + (index % 7) * 0.001,
        z: localZ,
        yaw: Math.sin(seed * 0.84) * 0.74,
        width: scale * THREE.MathUtils.lerp(0.88, 1.22, centerBias),
        length: scale * THREE.MathUtils.lerp(0.76, 1.12, (Math.cos(seed * 0.57) + 1) * 0.5),
        phase: seed,
        progress,
        variant: index,
      });
    }
  }

  private writeFanStamps(
    speedRatio: number,
    disturbanceStrength: number,
    fanWidth: number,
    fanLength: number,
  ): void {
    const sideCount = Math.min(18, Math.ceil(THREE.MathUtils.lerp(5, 12, speedRatio) * (0.55 + disturbanceStrength)));

    for (const side of [-1, 1]) {
      for (let index = 0; index < sideCount; index += 1) {
        const progress = (index + 0.5) / sideCount;
        const seed = this.phase * 1.22 + index * 1.91 + side * 0.67;
        const lateral = side * (0.48 + fanWidth * progress * THREE.MathUtils.lerp(0.18, 0.54, (Math.sin(seed) + 1) * 0.5));
        const localZ = -1.12 - fanLength * progress + Math.cos(seed * 0.8) * 0.18;
        const scale = THREE.MathUtils.lerp(0.18, 0.42, 1 - progress * 0.55) * (0.82 + speedRatio * 0.3);

        this.localFoam.addStamp({
          x: lateral,
          y: SURFACE_OFFSET + 0.012 + (index % 5) * 0.001,
          z: localZ,
          yaw: side * 0.42 + Math.sin(seed * 0.73) * 0.46,
          width: scale * THREE.MathUtils.lerp(0.7, 1.1, (Math.cos(seed * 0.61) + 1) * 0.5),
          length: scale * THREE.MathUtils.lerp(0.96, 1.42, progress),
          phase: seed,
          progress,
          variant: index + sideCount,
          cutoutScale: 0.82,
        });
      }
    }
  }

  private writePulseStamps(pulseStrength: number, speedRatio: number, churnWidth: number): void {
    const count =
      pulseStrength > 0.2
        ? Math.min(28, Math.ceil((pulseStrength - 0.12) * THREE.MathUtils.lerp(10, 22, speedRatio)))
        : 0;

    for (let index = 0; index < count; index += 1) {
      const seed = this.phase * 2.1 + index * 2.79;
      const lift = THREE.MathUtils.lerp(0.04, 0.24, (Math.sin(seed * 0.71) + 1) * 0.5) * pulseStrength;
      const scale = THREE.MathUtils.lerp(0.13, 0.32, (Math.cos(seed * 0.93) + 1) * 0.5);

      this.localFoam.addStamp({
        x: Math.sin(seed) * churnWidth * 0.34,
        y: SURFACE_OFFSET + 0.05 + lift + (index % 4) * 0.001,
        z: -0.6 - Math.abs(Math.cos(seed * 0.57)) * THREE.MathUtils.lerp(0.4, 2.4, speedRatio),
        yaw: seed * 0.13,
        width: scale * (0.82 + pulseStrength * 0.28),
        length: scale * (0.72 + pulseStrength * 0.22),
        phase: seed,
        progress: THREE.MathUtils.clamp(1 - pulseStrength * 0.45, 0, 1),
        variant: index + 2,
        cutoutCount: 2,
      });
    }
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
      const longitudinal =
        baseLength *
        (index < 3
          ? THREE.MathUtils.lerp(-0.5, 0.24, Math.random())
          : THREE.MathUtils.lerp(0.08, 1.72, Math.random()));
      const noise = THREE.MathUtils.randFloatSpread(baseWidth * 0.16);
      const centerWeight = 1 - Math.min(1, Math.abs(centerBias));
      const stamp = this.trailStamps[this.nextTrailStamp];

      this.nextTrailStamp = (this.nextTrailStamp + 1) % this.trailStamps.length;
      stamp.active = true;
      stamp.age = 0;
      stamp.lifetime = THREE.MathUtils.lerp(3.1, 5.6, speedRatio) * THREE.MathUtils.lerp(0.82, 1.16, trailStrength);
      stamp.position.set(
        x - forwardX * longitudinal + rightX * (spread + noise),
        0,
        z - forwardZ * longitudinal + rightZ * (spread + noise),
      );
      stamp.yaw = yaw + Math.PI * 0.5 + THREE.MathUtils.randFloatSpread(0.96) + centerBias * 0.24;
      const stampSize = THREE.MathUtils.lerp(0.46 + centerWeight * 0.22, 1.08 + centerWeight * 0.28, Math.random());
      stamp.width = stampSize * THREE.MathUtils.lerp(0.9, 1.12, Math.random());
      stamp.length = stampSize * THREE.MathUtils.lerp(0.86, 1.08, Math.random());
      stamp.phase = this.phase + index * WATER_FOAM_GOLDEN_ANGLE + Math.random() * 0.08;
      stamp.variant = Math.floor(Math.random() * WATER_FOAM_STAMP_VARIANTS);
    }
  }
}

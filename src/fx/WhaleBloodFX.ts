import * as THREE from 'three';

import { type CaptiveWhale } from '../entities/CaptiveWhale';
import {
  WATER_FOAM_GOLDEN_ANGLE,
  WATER_FOAM_STAMP_VARIANTS,
  WaterFoamStampLayer,
} from './WaterFoamStampLayer';

const MAX_HIT_SPRAYS = 7;
const MAX_HIT_SURFACE_STAMPS = 44;
const MAX_HIT_SURFACE_CUTOUTS = MAX_HIT_SURFACE_STAMPS * 2;
const MAX_HIT_AIR_STAMPS = 96;
const MAX_HIT_AIR_CUTOUTS = MAX_HIT_AIR_STAMPS * 2;
const MAX_TRAIL_STAMPS = 150;
const MAX_TRAIL_CUTOUTS = MAX_TRAIL_STAMPS * 3;
const SURFACE_OFFSET = 0.12;
const TRAIL_SURFACE_OFFSET = 0.095;
const HIT_LIFETIME_MIN = 0.58;
const HIT_LIFETIME_MAX = 0.92;
const HIT_GRAVITY = 12.5;
const HIT_DRAG = 2.2;
const TAU = Math.PI * 2;

const WHALE_BLOOD_LOOK = {
  hitColor: '#9a2531',
  trailColor: '#781924',
  hitSurfaceOpacity: 0.5,
  hitAirOpacity: 0.58,
  trailOpacity: 0.42,
} as const;

export interface WhaleBloodCapturedTrailSnapshot {
  deltaSeconds: number;
  underwaterRatio: number;
  sampleSurfaceHeight: (x: number, z: number) => number;
  captiveWhale: CaptiveWhale;
}

interface BloodParticleState {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly rotation: THREE.Euler;
  readonly spin: THREE.Vector3;
  baseScale: number;
  stretch: number;
  phase: number;
  variant: number;
}

interface BloodHitSlot {
  readonly root: THREE.Group;
  readonly surfaceFoam: WaterFoamStampLayer;
  readonly airFoam: WaterFoamStampLayer;
  readonly particles: BloodParticleState[];
  readonly anchor: THREE.Vector3;
  active: boolean;
  age: number;
  lifetime: number;
  intensity: number;
  particleCount: number;
}

interface BloodTrailStamp {
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

export class WhaleBloodFX {
  private readonly root = new THREE.Group();
  private readonly hitSlots: BloodHitSlot[] = [];
  private readonly trailRoot = new THREE.Group();
  private readonly trailFoam: WaterFoamStampLayer;
  private readonly trailStamps: BloodTrailStamp[] = [];
  private readonly lastTrailPoint = new THREE.Vector3();
  private readonly trailPrevious = new THREE.Vector3();
  private readonly hitDirection = new THREE.Vector3();
  private readonly trailDirection = new THREE.Vector3();

  private nextTrailStamp = 0;
  private hasTrailPoint = false;
  private phase = Math.random() * TAU;

  constructor(scene: THREE.Scene) {
    this.root.renderOrder = 27;
    this.trailRoot.renderOrder = 25;
    scene.add(this.root, this.trailRoot);

    for (let index = 0; index < MAX_HIT_SPRAYS; index += 1) {
      this.hitSlots.push(this.createHitSlot());
    }

    this.trailFoam = new WaterFoamStampLayer(this.trailRoot, {
      maxStamps: MAX_TRAIL_STAMPS,
      maxCutouts: MAX_TRAIL_CUTOUTS,
      color: WHALE_BLOOD_LOOK.trailColor,
      opacity: WHALE_BLOOD_LOOK.trailOpacity,
      blending: THREE.NormalBlending,
      renderOrder: 25,
      cutoutRenderOrder: 24.7,
      polygonOffsetFactor: -2.4,
      polygonOffsetUnits: -2.4,
    });

    for (let index = 0; index < MAX_TRAIL_STAMPS; index += 1) {
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

  spawnHitSpray(origin: THREE.Vector3, direction: THREE.Vector3, intensity: number): void {
    const slot = this.claimHitSlot();
    const normalizedIntensity = THREE.MathUtils.clamp(intensity, 0.18, 1);

    this.hitDirection.copy(direction).setY(0);

    if (this.hitDirection.lengthSq() <= 0.0001) {
      this.hitDirection.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    }

    if (this.hitDirection.lengthSq() <= 0.0001) {
      this.hitDirection.set(0, 0, 1);
    } else {
      this.hitDirection.normalize();
    }

    slot.active = true;
    slot.age = 0;
    slot.intensity = normalizedIntensity;
    slot.lifetime = THREE.MathUtils.lerp(HIT_LIFETIME_MIN, HIT_LIFETIME_MAX, normalizedIntensity);
    slot.anchor.copy(origin);
    slot.root.position.copy(origin);
    slot.root.rotation.set(0, Math.atan2(this.hitDirection.x, this.hitDirection.z), 0);
    slot.root.visible = true;
    this.seedHitParticles(slot);
    this.emitHitWakeTrailBurst(origin, Math.atan2(this.hitDirection.x, this.hitDirection.z), normalizedIntensity);
    this.updateHitSurfaceFoam(slot, 0, origin.y);
    this.updateHitAirFoam(slot, 0, 0);
  }

  updateCapturedTrail(snapshot: WhaleBloodCapturedTrailSnapshot): void {
    this.phase += snapshot.deltaSeconds * 1.4;
    this.updateHitSprays(snapshot.deltaSeconds, snapshot.sampleSurfaceHeight);
    this.updateTrail(snapshot);
  }

  reset(): void {
    this.phase = Math.random() * TAU;
    this.nextTrailStamp = 0;
    this.hasTrailPoint = false;
    this.trailFoam.reset();

    for (const stamp of this.trailStamps) {
      stamp.active = false;
      stamp.age = 0;
    }

    for (const slot of this.hitSlots) {
      this.deactivateHitSlot(slot);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.trailRoot.removeFromParent();
    this.trailFoam.dispose();

    for (const slot of this.hitSlots) {
      slot.surfaceFoam.dispose();
      slot.airFoam.dispose();
    }
  }

  private createHitSlot(): BloodHitSlot {
    const root = new THREE.Group();
    root.visible = false;
    this.root.add(root);

    const surfaceFoam = new WaterFoamStampLayer(root, {
      maxStamps: MAX_HIT_SURFACE_STAMPS,
      maxCutouts: MAX_HIT_SURFACE_CUTOUTS,
      color: WHALE_BLOOD_LOOK.hitColor,
      opacity: WHALE_BLOOD_LOOK.hitSurfaceOpacity,
      blending: THREE.NormalBlending,
      renderOrder: 27,
      cutoutRenderOrder: 26.7,
      polygonOffsetFactor: -2.8,
      polygonOffsetUnits: -2.8,
    });
    const airFoam = new WaterFoamStampLayer(root, {
      maxStamps: MAX_HIT_AIR_STAMPS,
      maxCutouts: MAX_HIT_AIR_CUTOUTS,
      color: WHALE_BLOOD_LOOK.hitColor,
      opacity: WHALE_BLOOD_LOOK.hitAirOpacity,
      blending: THREE.NormalBlending,
      renderOrder: 29,
      cutoutRenderOrder: 28.7,
    });

    const particles: BloodParticleState[] = [];
    for (let index = 0; index < MAX_HIT_AIR_STAMPS; index += 1) {
      particles.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        rotation: new THREE.Euler(),
        spin: new THREE.Vector3(),
        baseScale: 0,
        stretch: 1,
        phase: 0,
        variant: index % WATER_FOAM_STAMP_VARIANTS,
      });
    }

    return {
      root,
      surfaceFoam,
      airFoam,
      particles,
      anchor: new THREE.Vector3(),
      active: false,
      age: 0,
      lifetime: 0,
      intensity: 0,
      particleCount: 0,
    };
  }

  private claimHitSlot(): BloodHitSlot {
    const inactive = this.hitSlots.find((slot) => !slot.active);

    if (inactive) {
      return inactive;
    }

    let oldest = this.hitSlots[0];
    let oldestProgress = oldest.age / Math.max(oldest.lifetime, 0.0001);

    for (let index = 1; index < this.hitSlots.length; index += 1) {
      const slot = this.hitSlots[index];
      const progress = slot.age / Math.max(slot.lifetime, 0.0001);

      if (progress > oldestProgress) {
        oldest = slot;
        oldestProgress = progress;
      }
    }

    this.deactivateHitSlot(oldest);
    return oldest;
  }

  private deactivateHitSlot(slot: BloodHitSlot): void {
    slot.active = false;
    slot.age = 0;
    slot.lifetime = 0;
    slot.particleCount = 0;
    slot.root.visible = false;
    slot.surfaceFoam.reset();
    slot.airFoam.reset();
  }

  private seedHitParticles(slot: BloodHitSlot): void {
    const count = Math.round(THREE.MathUtils.lerp(42, 86, slot.intensity));
    slot.particleCount = Math.min(MAX_HIT_AIR_STAMPS, count);

    for (let index = 0; index < slot.particleCount; index += 1) {
      const particle = slot.particles[index];
      const fan = THREE.MathUtils.randFloatSpread(1.28);
      const forward = THREE.MathUtils.lerp(0.44, 1.8, Math.random());
      const upwardBias = Math.pow(Math.random(), 0.62);
      const spraySpeed = THREE.MathUtils.lerp(3.8, 11.2, Math.random()) * THREE.MathUtils.lerp(0.78, 1.32, slot.intensity);

      particle.position.set(
        THREE.MathUtils.randFloatSpread(0.28),
        0.16 + Math.random() * 0.46,
        THREE.MathUtils.randFloat(0.02, 0.32),
      );
      particle.velocity.set(
        fan * THREE.MathUtils.lerp(1.6, 4.8, Math.random()) * slot.intensity,
        THREE.MathUtils.lerp(2.2, 6.4, upwardBias) * slot.intensity,
        forward * spraySpeed,
      );
      particle.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      particle.spin.set(
        THREE.MathUtils.randFloatSpread(3.4),
        THREE.MathUtils.randFloatSpread(3.4),
        THREE.MathUtils.randFloatSpread(3.4),
      );
      particle.baseScale =
        THREE.MathUtils.lerp(0.14, 0.46, Math.random()) *
        THREE.MathUtils.lerp(0.86, 1.38, slot.intensity);
      particle.stretch = THREE.MathUtils.lerp(0.9, 2.1, Math.random());
      particle.phase = Math.random() * TAU + index * WATER_FOAM_GOLDEN_ANGLE;
      particle.variant = Math.floor(Math.random() * WATER_FOAM_STAMP_VARIANTS);
    }
  }

  private updateHitSprays(deltaSeconds: number, sampleSurfaceHeight: (x: number, z: number) => number): void {
    for (const slot of this.hitSlots) {
      if (!slot.active) {
        continue;
      }

      slot.age += deltaSeconds;

      if (slot.age >= slot.lifetime) {
        this.deactivateHitSlot(slot);
        continue;
      }

      const progress = THREE.MathUtils.clamp(slot.age / slot.lifetime, 0, 1);
      const surfaceHeight = sampleSurfaceHeight(slot.anchor.x, slot.anchor.z);
      slot.root.position.set(slot.anchor.x, surfaceHeight + SURFACE_OFFSET, slot.anchor.z);
      this.updateHitSurfaceFoam(slot, progress, surfaceHeight);
      this.updateHitAirFoam(slot, deltaSeconds, progress);
    }
  }

  private updateHitSurfaceFoam(slot: BloodHitSlot, progress: number, _surfaceHeight: number): void {
    const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.16, 1);
    const opacity = fadeOut * slot.intensity;

    slot.surfaceFoam.begin(opacity);

    const count = Math.round(THREE.MathUtils.lerp(12, 24, slot.intensity));
    for (let index = 0; index < count; index += 1) {
      const seed = slot.age * 1.3 + index * WATER_FOAM_GOLDEN_ANGLE;
      const spread = THREE.MathUtils.lerp(0.12, 2.2 + slot.intensity * 0.84, Math.random());
      const forward = THREE.MathUtils.lerp(0.14, 4.8 + slot.intensity * 1.9, Math.random());
      const scale =
        THREE.MathUtils.lerp(0.18, 0.68, Math.random()) *
        THREE.MathUtils.lerp(0.5, 1.16, fadeOut) *
        (0.82 + slot.intensity * 0.54);

      slot.surfaceFoam.addStamp({
        x: Math.sin(seed) * spread,
        y: 0,
        z: forward + Math.cos(seed * 0.7) * 0.22,
        yaw: Math.sin(seed * 0.71) * 0.74,
        width: scale * THREE.MathUtils.lerp(0.8, 1.36, Math.random()),
        length: scale * THREE.MathUtils.lerp(0.9, 1.72, Math.random()),
        phase: seed,
        progress,
        variant: index,
        cutoutScale: 0.78,
      });
    }

    slot.surfaceFoam.end();
  }

  private updateHitAirFoam(slot: BloodHitSlot, deltaSeconds: number, progress: number): void {
    const fadeOut = 1 - progress;
    slot.airFoam.begin(Math.pow(fadeOut, 0.6) * slot.intensity);

    for (let index = 0; index < slot.particleCount; index += 1) {
      const particle = slot.particles[index];

      if (deltaSeconds > 0) {
        particle.velocity.y -= HIT_GRAVITY * deltaSeconds;
        particle.velocity.multiplyScalar(Math.exp(-HIT_DRAG * deltaSeconds));
        particle.position.addScaledVector(particle.velocity, deltaSeconds);
        particle.rotation.x += particle.spin.x * deltaSeconds;
        particle.rotation.y += particle.spin.y * deltaSeconds;
        particle.rotation.z += particle.spin.z * deltaSeconds;
      }

      const waterFade = particle.position.y < -0.12 ? THREE.MathUtils.clamp(1 + particle.position.y / 0.5, 0, 1) : 1;
      const scale = particle.baseScale * Math.pow(fadeOut, 0.34) * waterFade;

      if (scale <= 0.006) {
        continue;
      }

      slot.airFoam.addStamp({
        x: particle.position.x,
        y: particle.position.y,
        z: particle.position.z,
        rotation: particle.rotation,
        width: scale * particle.stretch,
        length: scale * THREE.MathUtils.lerp(0.68, 1.06, (Math.sin(particle.phase) + 1) * 0.5),
        phase: particle.phase,
        progress,
        variant: particle.variant,
        cutoutCount: 1,
        cutoutScale: 0.58,
      });
    }

    slot.airFoam.end();
  }

  private updateTrail(snapshot: WhaleBloodCapturedTrailSnapshot): void {
    const aboveWaterAlpha = 1 - THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.08, 0.78);
    const activeTrail =
      snapshot.captiveWhale.state === 'towed' ||
      snapshot.captiveWhale.state === 'captured';

    if (activeTrail && aboveWaterAlpha > 0.005) {
      this.emitTrailBetweenPoints(snapshot.captiveWhale.position);
    } else {
      this.hasTrailPoint = false;
    }

    this.trailFoam.begin(aboveWaterAlpha);
    let visibleCount = 0;
    let activeCount = 0;

    for (const stamp of this.trailStamps) {
      if (!stamp.active) {
        continue;
      }

      activeCount += 1;
      stamp.age += snapshot.deltaSeconds;

      if (stamp.age >= stamp.lifetime) {
        stamp.active = false;
        continue;
      }

      const progress = stamp.age / stamp.lifetime;
      const ripple = 0.92 + Math.sin(stamp.phase + progress * TAU) * 0.08;
      const stainShrink = 1 - THREE.MathUtils.smoothstep(progress, 0.1, 0.98);
      const scale = Math.max(0.001, stainShrink * ripple);
      const surfaceHeight = snapshot.sampleSurfaceHeight(stamp.position.x, stamp.position.z);

      this.trailFoam.addStamp({
        x: stamp.position.x + Math.sin(stamp.phase + stamp.age * 0.36) * 0.018,
        y: surfaceHeight + TRAIL_SURFACE_OFFSET + (visibleCount % 7) * 0.001,
        z: stamp.position.z + Math.cos(stamp.phase * 1.3 + stamp.age * 0.28) * 0.018,
        yaw: stamp.yaw + Math.sin(stamp.phase + stamp.age * 0.45) * 0.05,
        width: stamp.width * scale,
        length: stamp.length * scale,
        phase: stamp.phase,
        progress,
        variant: stamp.variant,
        cutoutScale: 0.9,
      });
      visibleCount += 1;
    }

    this.trailFoam.end();

    if (activeCount === 0 && !activeTrail) {
      this.trailFoam.reset();
    }
  }

  private emitTrailBetweenPoints(position: THREE.Vector3): void {
    if (!this.hasTrailPoint) {
      this.lastTrailPoint.copy(position);
      this.hasTrailPoint = true;
      this.emitTrailStampCluster(position.x, position.z, 0, 0.72);
      return;
    }

    this.trailPrevious.copy(this.lastTrailPoint);
    const distance = this.trailPrevious.distanceTo(position);

    if (distance < 0.55) {
      return;
    }

    this.trailDirection.copy(position).sub(this.trailPrevious).setY(0);
    const yaw =
      this.trailDirection.lengthSq() > 0.0001
        ? Math.atan2(this.trailDirection.x, this.trailDirection.z)
        : 0;
    const steps = Math.min(4, Math.floor(distance / 0.55));

    for (let step = 1; step <= steps; step += 1) {
      const alpha = step / steps;
      const x = THREE.MathUtils.lerp(this.trailPrevious.x, position.x, alpha);
      const z = THREE.MathUtils.lerp(this.trailPrevious.z, position.z, alpha);
      this.emitTrailStampCluster(x, z, yaw, THREE.MathUtils.clamp(distance / 3.8, 0.32, 1));
    }

    this.lastTrailPoint.copy(position);
  }

  private emitTrailStampCluster(x: number, z: number, yaw: number, movementStrength: number): void {
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const width = THREE.MathUtils.lerp(1.6, 4.2, movementStrength);
    const stampCount = Math.round(THREE.MathUtils.lerp(5, 9, movementStrength));

    for (let index = 0; index < stampCount; index += 1) {
      const seed = this.phase * 1.17 + index * 2.23 + Math.random() * 0.35;
      const lateral = Math.sin(seed) * width * THREE.MathUtils.lerp(0.16, 0.64, Math.random());
      const longitudinal = THREE.MathUtils.lerp(-0.65, 2.8, Math.random());
      const stamp = this.trailStamps[this.nextTrailStamp];
      const centerWeight = 1 - THREE.MathUtils.clamp(Math.abs(lateral) / Math.max(width, 0.001), 0, 1);
      const scale = THREE.MathUtils.lerp(0.48, 1.26, Math.random()) * (0.9 + centerWeight * 0.34);

      this.nextTrailStamp = (this.nextTrailStamp + 1) % this.trailStamps.length;
      stamp.active = true;
      stamp.age = 0;
      stamp.lifetime = THREE.MathUtils.lerp(3.2, 5.8, Math.random());
      stamp.position.set(
        x - forwardX * longitudinal + rightX * lateral,
        0,
        z - forwardZ * longitudinal + rightZ * lateral,
      );
      stamp.yaw = yaw + Math.PI * 0.5 + THREE.MathUtils.randFloatSpread(0.88);
      stamp.width = scale * THREE.MathUtils.lerp(0.9, 1.28, Math.random());
      stamp.length = scale * THREE.MathUtils.lerp(0.92, 1.56, Math.random());
      stamp.phase = this.phase + index * WATER_FOAM_GOLDEN_ANGLE + Math.random() * 0.08;
      stamp.variant = Math.floor(Math.random() * WATER_FOAM_STAMP_VARIANTS);
    }
  }

  private emitHitWakeTrailBurst(origin: THREE.Vector3, yaw: number, intensity: number): void {
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const count = Math.round(THREE.MathUtils.lerp(16, 32, intensity));
    const fanWidth = THREE.MathUtils.lerp(2.8, 6.6, intensity);
    const fanLength = THREE.MathUtils.lerp(4.6, 10.4, intensity);

    for (let index = 0; index < count; index += 1) {
      const laneBias = Math.sin(this.phase * 1.31 + index * 2.11 + Math.random() * 0.4);
      const centerBias = index < count * 0.28 ? THREE.MathUtils.randFloatSpread(0.22) : laneBias;
      const longitudinal = THREE.MathUtils.lerp(0.12, fanLength, Math.pow(Math.random(), 0.72));
      const lateral =
        centerBias *
        fanWidth *
        THREE.MathUtils.lerp(0.16, 0.72, Math.random()) *
        THREE.MathUtils.lerp(0.38, 1, longitudinal / Math.max(fanLength, 0.001));
      const stamp = this.trailStamps[this.nextTrailStamp];
      const centerWeight = 1 - THREE.MathUtils.clamp(Math.abs(centerBias), 0, 1);
      const scale =
        THREE.MathUtils.lerp(0.62, 1.55, Math.random()) *
        THREE.MathUtils.lerp(0.86, 1.32, intensity) *
        (0.88 + centerWeight * 0.34);

      this.nextTrailStamp = (this.nextTrailStamp + 1) % this.trailStamps.length;
      stamp.active = true;
      stamp.age = 0;
      stamp.lifetime = THREE.MathUtils.lerp(2.6, 5.2, Math.random()) * THREE.MathUtils.lerp(0.9, 1.2, intensity);
      stamp.position.set(
        origin.x + forwardX * longitudinal + rightX * lateral,
        0,
        origin.z + forwardZ * longitudinal + rightZ * lateral,
      );
      stamp.yaw = yaw + Math.PI * 0.5 + THREE.MathUtils.randFloatSpread(1.08) + centerBias * 0.22;
      stamp.width = scale * THREE.MathUtils.lerp(0.82, 1.22, Math.random());
      stamp.length = scale * THREE.MathUtils.lerp(1.08, 1.86, Math.random());
      stamp.phase = this.phase + index * WATER_FOAM_GOLDEN_ANGLE + Math.random() * 0.14;
      stamp.variant = Math.floor(Math.random() * WATER_FOAM_STAMP_VARIANTS);
    }
  }
}

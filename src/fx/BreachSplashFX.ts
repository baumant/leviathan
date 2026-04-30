import * as THREE from 'three';

import {
  WATER_FOAM_GOLDEN_ANGLE,
  WATER_FOAM_STAMP_VARIANTS,
  WaterFoamStampLayer,
} from './WaterFoamStampLayer';

const MAX_SPLASHES = 10;
const MAX_SURFACE_STAMPS = 132;
const MAX_SURFACE_CUTOUTS = MAX_SURFACE_STAMPS * 3;
const MAX_AIR_STAMPS = 320;
const MAX_AIR_CUTOUTS = MAX_AIR_STAMPS * 2;
const BASE_SURFACE_OFFSET = 0.1;
const LAUNCH_LIFETIME_MIN = 0.86;
const LAUNCH_LIFETIME_MAX = 1.12;
const REENTRY_LIFETIME_MIN = 1.18;
const REENTRY_LIFETIME_MAX = 1.48;
const SURFACE_PLUME_LIFETIME_MIN = 1.46;
const SURFACE_PLUME_LIFETIME_MAX = 1.88;
const IMPACT_LIFETIME_MIN = 0.44;
const IMPACT_LIFETIME_MAX = 0.62;
const GRAVITY = 16.5;
const DRAG = 1.55;
const TAU = Math.PI * 2;

type SplashMode = 'launch' | 'surface_plume' | 'reentry' | 'impact';

interface SplashParticleState {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly rotation: THREE.Euler;
  readonly spin: THREE.Vector3;
  baseScale: number;
  stretch: number;
  phase: number;
  variant: number;
  verticalBias: number;
}

interface SplashSlot {
  readonly root: THREE.Group;
  readonly surfaceFoam: WaterFoamStampLayer;
  readonly airFoam: WaterFoamStampLayer;
  readonly particles: SplashParticleState[];
  readonly anchor: THREE.Vector3;
  active: boolean;
  mode: SplashMode;
  age: number;
  lifetime: number;
  intensity: number;
  radiusScale: number;
  particleCount: number;
}

export class BreachSplashFX {
  private readonly root = new THREE.Group();
  private readonly slots: SplashSlot[] = [];

  constructor(scene: THREE.Scene) {
    this.root.renderOrder = 6;
    scene.add(this.root);

    for (let index = 0; index < MAX_SPLASHES; index += 1) {
      this.slots.push(this.createSlot());
    }

    this.reset();
  }

  spawnLaunch(origin: THREE.Vector3, intensity: number): void {
    this.activateSlot('launch', origin, THREE.MathUtils.clamp(intensity, 0, 1));
  }

  spawnSurfacePlume(origin: THREE.Vector3, intensity: number): void {
    this.activateSlot('surface_plume', origin, THREE.MathUtils.clamp(intensity, 0, 1));
  }

  spawnReentry(origin: THREE.Vector3, intensity: number): void {
    this.activateSlot('reentry', origin, THREE.MathUtils.clamp(intensity, 0, 1));
  }

  spawnImpact(origin: THREE.Vector3, intensity: number, radiusScale = 1): void {
    this.activateSlot(
      'impact',
      origin,
      THREE.MathUtils.clamp(intensity, 0, 1),
      THREE.MathUtils.clamp(radiusScale, 0.55, 1.6),
    );
  }

  update(deltaSeconds: number, sampleSurfaceHeight: (x: number, z: number) => number): void {
    for (const slot of this.slots) {
      if (!slot.active) {
        continue;
      }

      slot.age += deltaSeconds;

      if (slot.age >= slot.lifetime) {
        this.deactivateSlot(slot);
        continue;
      }

      const progress = THREE.MathUtils.clamp(slot.age / slot.lifetime, 0, 1);
      const surfaceHeight = sampleSurfaceHeight(slot.anchor.x, slot.anchor.z);
      slot.root.position.set(slot.anchor.x, surfaceHeight, slot.anchor.z);

      this.updateSurfaceFoam(slot, progress);
      this.updateAirFoam(slot, deltaSeconds, progress);
    }
  }

  reset(): void {
    for (const slot of this.slots) {
      this.deactivateSlot(slot);
    }
  }

  dispose(): void {
    this.root.removeFromParent();

    for (const slot of this.slots) {
      slot.surfaceFoam.dispose();
      slot.airFoam.dispose();
    }
  }

  private createSlot(): SplashSlot {
    const root = new THREE.Group();
    root.visible = false;
    this.root.add(root);

    const surfaceFoam = new WaterFoamStampLayer(root, {
      maxStamps: MAX_SURFACE_STAMPS,
      maxCutouts: MAX_SURFACE_CUTOUTS,
      color: '#d7e6e2',
      opacity: 0.62,
      blending: THREE.NormalBlending,
      renderOrder: 24,
      cutoutRenderOrder: 23.7,
    });
    const airFoam = new WaterFoamStampLayer(root, {
      maxStamps: MAX_AIR_STAMPS,
      maxCutouts: MAX_AIR_CUTOUTS,
      color: '#eff8f6',
      opacity: 0.48,
      blending: THREE.NormalBlending,
      renderOrder: 28,
      cutoutRenderOrder: 27.7,
    });

    const particles: SplashParticleState[] = [];
    for (let index = 0; index < MAX_AIR_STAMPS; index += 1) {
      particles.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        rotation: new THREE.Euler(),
        spin: new THREE.Vector3(),
        baseScale: 0,
        stretch: 1,
        phase: 0,
        variant: index % WATER_FOAM_STAMP_VARIANTS,
        verticalBias: 0,
      });
    }

    return {
      root,
      surfaceFoam,
      airFoam,
      particles,
      anchor: new THREE.Vector3(),
      active: false,
      mode: 'launch',
      age: 0,
      lifetime: 0,
      intensity: 0,
      radiusScale: 1,
      particleCount: 0,
    };
  }

  private activateSlot(mode: SplashMode, origin: THREE.Vector3, intensity: number, radiusScale = 1): void {
    const slot = this.claimSlot();
    const normalizedIntensity =
      mode === 'impact'
        ? THREE.MathUtils.lerp(0.35, 0.78, intensity)
        : THREE.MathUtils.lerp(0.45, 1, intensity);

    slot.active = true;
    slot.mode = mode;
    slot.age = 0;
    slot.intensity = normalizedIntensity;
    slot.radiusScale = radiusScale;
    slot.lifetime = this.getLifetime(mode, normalizedIntensity);
    slot.anchor.set(origin.x, 0, origin.z);
    slot.root.position.copy(origin);
    slot.root.rotation.set(0, Math.random() * TAU, 0);
    slot.root.visible = true;

    this.seedAirFoam(slot);
    this.updateSurfaceFoam(slot, 0);
    this.updateAirFoam(slot, 0, 0);
  }

  private getLifetime(mode: SplashMode, intensity: number): number {
    if (mode === 'launch') {
      return THREE.MathUtils.lerp(LAUNCH_LIFETIME_MIN, LAUNCH_LIFETIME_MAX, intensity);
    }

    if (mode === 'surface_plume') {
      return THREE.MathUtils.lerp(SURFACE_PLUME_LIFETIME_MIN, SURFACE_PLUME_LIFETIME_MAX, intensity);
    }

    if (mode === 'impact') {
      return THREE.MathUtils.lerp(IMPACT_LIFETIME_MIN, IMPACT_LIFETIME_MAX, intensity);
    }

    return THREE.MathUtils.lerp(REENTRY_LIFETIME_MIN, REENTRY_LIFETIME_MAX, intensity);
  }

  private claimSlot(): SplashSlot {
    const inactive = this.slots.find((slot) => !slot.active);

    if (inactive) {
      return inactive;
    }

    let oldest = this.slots[0];
    let oldestProgress = oldest.age / Math.max(oldest.lifetime, 0.0001);

    for (let index = 1; index < this.slots.length; index += 1) {
      const slot = this.slots[index];
      const progress = slot.age / Math.max(slot.lifetime, 0.0001);

      if (progress > oldestProgress) {
        oldest = slot;
        oldestProgress = progress;
      }
    }

    this.deactivateSlot(oldest);
    return oldest;
  }

  private deactivateSlot(slot: SplashSlot): void {
    slot.active = false;
    slot.age = 0;
    slot.lifetime = 0;
    slot.particleCount = 0;
    slot.root.visible = false;
    slot.surfaceFoam.reset();
    slot.airFoam.reset();
  }

  private seedAirFoam(slot: SplashSlot): void {
    const isLaunch = slot.mode === 'launch';
    const isSurfacePlume = slot.mode === 'surface_plume';
    const isImpact = slot.mode === 'impact';
    const spread = (isImpact ? 2.0 : isLaunch ? 5.2 : isSurfacePlume ? 6.8 : 8.4) * slot.radiusScale;
    const verticalMin = isImpact ? 2.4 : isLaunch ? 8.8 : isSurfacePlume ? 24 : 10.8;
    const verticalMax = isImpact ? 4.6 : isLaunch ? 17.6 : isSurfacePlume ? 42 : 24.8;
    const count = isImpact
      ? Math.round(THREE.MathUtils.lerp(12, 22, slot.intensity))
      : isLaunch
        ? Math.round(THREE.MathUtils.lerp(118, 168, slot.intensity))
        : isSurfacePlume
          ? Math.round(THREE.MathUtils.lerp(230, 320, slot.intensity))
          : Math.round(THREE.MathUtils.lerp(158, 220, slot.intensity));

    slot.particleCount = Math.min(MAX_AIR_STAMPS, count);

    for (let index = 0; index < slot.particleCount; index += 1) {
      const particle = slot.particles[index];
      const radial = Math.random() * TAU;
      const radialStrength = Math.random();
      const plumeBias = isImpact ? 0 : Math.pow(Math.random(), isSurfacePlume ? 4.4 : isLaunch ? 2.8 : 2.2);
      const sheetBias = isImpact ? 1 : Math.pow(Math.random(), isSurfacePlume ? 0.74 : 0.62);
      const capBias = slot.mode === 'reentry' && index > slot.particleCount * 0.44 ? 1 : 0;
      const verticalBias = isImpact ? 0 : 1 - sheetBias;
      const localRadius =
        (isImpact ? 0.36 : isLaunch ? 0.86 : isSurfacePlume ? 0.98 : 1.35) *
        slot.radiusScale *
        (isImpact ? radialStrength : THREE.MathUtils.lerp(plumeBias * 0.22, sheetBias, Math.random() * (isSurfacePlume ? 0.44 : 0.58)));
      const radialVelocity =
        spread *
        (isImpact
          ? 0.4 + radialStrength * 0.92
          : isSurfacePlume
            ? THREE.MathUtils.lerp(0.08 + plumeBias * 0.16, 0.68 + sheetBias * 0.74, sheetBias)
            : THREE.MathUtils.lerp(0.14 + plumeBias * 0.22, 0.84 + sheetBias * 0.9, sheetBias)) *
        (1 + capBias * 0.32) *
        slot.intensity;
      const verticalVelocity =
        THREE.MathUtils.lerp(verticalMin, verticalMax, Math.random()) *
        (isImpact ? 1 : THREE.MathUtils.lerp(isSurfacePlume ? 1.44 : 1.24, isSurfacePlume ? 0.7 : 0.72, sheetBias)) *
        (capBias ? 0.9 : 1) *
        slot.intensity;

      particle.position.set(
        Math.cos(radial) * localRadius,
        0.04 + Math.random() * (isImpact ? 0.2 : isLaunch ? 0.84 : isSurfacePlume ? 1.45 : 1.12),
        Math.sin(radial) * localRadius,
      );
      particle.velocity.set(
        Math.cos(radial) * radialVelocity,
        verticalVelocity,
        Math.sin(radial) * radialVelocity,
      );
      particle.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      particle.spin.set(
        THREE.MathUtils.randFloatSpread(4.8),
        THREE.MathUtils.randFloatSpread(4.8),
        THREE.MathUtils.randFloatSpread(4.8),
      );
      particle.baseScale =
        (isImpact ? 0.2 : isLaunch ? 0.4 : isSurfacePlume ? 0.54 : 0.52) *
        THREE.MathUtils.lerp(0.72, isImpact ? 1.32 : isSurfacePlume ? 2.24 : 2.08, Math.random()) *
        (isImpact ? 1 : THREE.MathUtils.lerp(1.22, 0.82, sheetBias)) *
        slot.intensity *
        slot.radiusScale;
      particle.stretch = THREE.MathUtils.lerp(isImpact ? 0.7 : 0.86, isImpact ? 1.45 : isSurfacePlume ? 2.08 : 1.82, Math.random());
      particle.phase = Math.random() * TAU + index * WATER_FOAM_GOLDEN_ANGLE;
      particle.variant = Math.floor(Math.random() * WATER_FOAM_STAMP_VARIANTS);
      particle.verticalBias = verticalBias;
    }
  }

  private updateSurfaceFoam(slot: SplashSlot, progress: number): void {
    const fadeOut = 1 - progress;
    const eased = 1 - Math.pow(1 - progress, 2);
    const modeOpacity = slot.mode === 'impact' ? 0.42 : slot.mode === 'launch' ? 0.64 : slot.mode === 'surface_plume' ? 0.9 : 0.82;
    const opacity = modeOpacity * Math.pow(fadeOut, slot.mode === 'impact' ? 1.05 : 0.86) * slot.intensity;

    slot.surfaceFoam.begin(opacity);

    if (slot.mode === 'impact') {
      const radius = THREE.MathUtils.lerp(0.38, (2.35 + slot.intensity * 0.95) * slot.radiusScale, eased);
      const count = Math.round(THREE.MathUtils.lerp(8, 14, slot.intensity));
      this.writeFoamRing(slot, radius, count, progress, 0.36 * slot.radiusScale, 0);
      this.writeFoamCluster(slot, radius * 0.38, 5, progress, 0.24 * slot.radiusScale, 1.7);
      slot.surfaceFoam.end();
      return;
    }

    if (slot.mode === 'launch') {
      const outerRadius = THREE.MathUtils.lerp(0.82, 6.7 + slot.intensity * 1.9, eased);
      const innerRadius = THREE.MathUtils.lerp(0.48, 3.2 + slot.intensity * 0.9, Math.sqrt(progress));
      this.writeFoamRing(slot, outerRadius, Math.round(THREE.MathUtils.lerp(16, 24, slot.intensity)), progress, 0.54, 0);
      this.writeFoamRing(slot, innerRadius, Math.round(THREE.MathUtils.lerp(10, 16, slot.intensity)), progress, 0.4, 1.3);
      this.writeFoamCluster(slot, innerRadius * 0.48, 8, progress, 0.34, 2.6);
      slot.surfaceFoam.end();
      return;
    }

    if (slot.mode === 'surface_plume') {
      const outerRadius = THREE.MathUtils.lerp(1.2, 8.4 + slot.intensity * 3.2, eased);
      const innerRadius = THREE.MathUtils.lerp(0.66, 4.1 + slot.intensity * 1.2, Math.sqrt(progress));
      this.writeFoamRing(slot, outerRadius, Math.round(THREE.MathUtils.lerp(26, 38, slot.intensity)), progress, 0.68, 0);
      this.writeFoamRing(slot, innerRadius, Math.round(THREE.MathUtils.lerp(16, 24, slot.intensity)), progress, 0.48, 1.3);
      this.writeFoamCluster(slot, innerRadius * 0.58, 18, progress, 0.42, 2.6);
      slot.surfaceFoam.end();
      return;
    }

    const delayed = THREE.MathUtils.clamp((progress - 0.12) / 0.88, 0, 1);
    const outerRadius = THREE.MathUtils.lerp(1.1, 10.6 + slot.intensity * 3.4, eased);
    const innerRadius = THREE.MathUtils.lerp(0.82, 7.1 + slot.intensity * 2.6, Math.sqrt(delayed));
    this.writeFoamRing(slot, outerRadius, Math.round(THREE.MathUtils.lerp(24, 36, slot.intensity)), progress, 0.7, 0);

    if (delayed > 0) {
      this.writeFoamRing(slot, innerRadius, Math.round(THREE.MathUtils.lerp(16, 26, slot.intensity)), delayed, 0.54, 1.9);
    }

    this.writeFoamCluster(slot, outerRadius * 0.28, 14, progress, 0.48, 3.2);
    slot.surfaceFoam.end();
  }

  private writeFoamRing(
    slot: SplashSlot,
    radius: number,
    count: number,
    progress: number,
    baseScale: number,
    phaseOffset: number,
  ): void {
    const scaleFade = 1 - THREE.MathUtils.smoothstep(progress, 0.78, 1);

    for (let index = 0; index < count; index += 1) {
      const alpha = index / count;
      const angle = alpha * TAU + phaseOffset + Math.sin(slot.age * 3.1 + index) * 0.015;
      const seed = slot.age * 1.7 + index * WATER_FOAM_GOLDEN_ANGLE + phaseOffset;
      const localRadius = radius * THREE.MathUtils.lerp(0.92, 1.08, (Math.sin(seed) + 1) * 0.5);
      const stampScale =
        baseScale *
        THREE.MathUtils.lerp(0.82, 1.28, (Math.cos(seed * 0.83) + 1) * 0.5) *
        Math.max(0.18, scaleFade);

      slot.surfaceFoam.addStamp({
        x: Math.cos(angle) * localRadius,
        y: BASE_SURFACE_OFFSET + (index % 9) * 0.001,
        z: Math.sin(angle) * localRadius,
        yaw: angle + Math.PI * 0.5 + Math.sin(seed * 0.6) * 0.4,
        width: stampScale * THREE.MathUtils.lerp(0.92, 1.36, (Math.sin(seed * 0.41) + 1) * 0.5),
        length: stampScale * THREE.MathUtils.lerp(0.72, 1.08, (Math.cos(seed * 0.37) + 1) * 0.5),
        phase: seed,
        progress,
        variant: index,
      });
    }
  }

  private writeFoamCluster(
    slot: SplashSlot,
    radius: number,
    count: number,
    progress: number,
    baseScale: number,
    phaseOffset: number,
  ): void {
    const fadeScale = 1 - THREE.MathUtils.smoothstep(progress, 0.5, 1);

    for (let index = 0; index < count; index += 1) {
      const seed = phaseOffset + index * 2.31 + slot.age * 1.2;
      const alpha = (index * WATER_FOAM_GOLDEN_ANGLE + phaseOffset) % TAU;
      const localRadius = radius * Math.sqrt((index + 0.5) / count) * THREE.MathUtils.lerp(0.72, 1.18, (Math.sin(seed) + 1) * 0.5);
      const scale = baseScale * THREE.MathUtils.lerp(0.72, 1.18, (Math.cos(seed * 0.71) + 1) * 0.5) * Math.max(0.15, fadeScale);

      slot.surfaceFoam.addStamp({
        x: Math.cos(alpha) * localRadius,
        y: BASE_SURFACE_OFFSET + 0.014 + (index % 5) * 0.001,
        z: Math.sin(alpha) * localRadius,
        yaw: seed,
        width: scale,
        length: scale * THREE.MathUtils.lerp(0.82, 1.18, (Math.sin(seed * 0.57) + 1) * 0.5),
        phase: seed,
        progress,
        variant: index + 3,
        cutoutScale: 0.86,
      });
    }
  }

  private updateAirFoam(slot: SplashSlot, deltaSeconds: number, progress: number): void {
    const fadeOut = 1 - progress;
    const modeOpacity = slot.mode === 'impact' ? 0.46 : slot.mode === 'launch' ? 0.88 : slot.mode === 'surface_plume' ? 1.08 : 1;
    slot.airFoam.begin(modeOpacity * Math.pow(fadeOut, slot.mode === 'impact' ? 1.04 : slot.mode === 'surface_plume' ? 0.42 : 0.58));

    for (let index = 0; index < slot.particleCount; index += 1) {
      const particle = slot.particles[index];

      if (deltaSeconds > 0) {
        particle.velocity.y -= GRAVITY * deltaSeconds;
        particle.velocity.multiplyScalar(Math.exp(-DRAG * deltaSeconds));
        particle.position.addScaledVector(particle.velocity, deltaSeconds);
        particle.rotation.x += particle.spin.x * deltaSeconds;
        particle.rotation.y += particle.spin.y * deltaSeconds;
        particle.rotation.z += particle.spin.z * deltaSeconds;
      }

      const waterFade =
        particle.position.y < -0.08 ? THREE.MathUtils.clamp(1 + particle.position.y / 0.45, 0, 1) : 1;
      const scale =
        particle.baseScale *
        Math.pow(fadeOut, slot.mode === 'impact' ? 0.52 : 0.34) *
        waterFade *
        (1 + particle.verticalBias * 0.28);

      if (scale <= 0.006) {
        continue;
      }

      slot.airFoam.addStamp({
        x: particle.position.x,
        y: particle.position.y,
        z: particle.position.z,
        rotation: particle.rotation,
        width: scale * particle.stretch,
        length: scale * THREE.MathUtils.lerp(0.72, 1.08, (Math.sin(particle.phase) + 1) * 0.5),
        phase: particle.phase,
        progress,
        variant: particle.variant,
        cutoutCount: slot.mode === 'impact' ? 1 : 2,
        cutoutScale: 0.62,
      });
    }

    slot.airFoam.end();
  }
}

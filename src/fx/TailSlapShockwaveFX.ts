import * as THREE from 'three';

import {
  WATER_FOAM_GOLDEN_ANGLE,
  WaterFoamStampLayer,
} from './WaterFoamStampLayer';

const MAX_IMPACT_SHOCKWAVES = 3;
const MAX_ARC_STAMPS = 72;
const MAX_ARC_CUTOUTS = MAX_ARC_STAMPS * 3;
const IMPACT_LIFETIME = 0.56;
const TELEGRAPH_LIFETIME = 0.18;
const SURFACE_OFFSET = 0.14;
const TELEGRAPH_HALF_ANGLE = THREE.MathUtils.degToRad(34);
const TELEGRAPH_INNER_RADIUS = 2.8;
const TELEGRAPH_OUTER_RADIUS = 5.0;
const TELEGRAPH_OPACITY = 0.62;
const IMPACT_OPACITY = 0.82;

interface ImpactShockwaveSlot {
  readonly root: THREE.Group;
  readonly foam: WaterFoamStampLayer;
  active: boolean;
  age: number;
  x: number;
  z: number;
  yaw: number;
  startRadius: number;
  endRadius: number;
  intensity: number;
  halfAngle: number;
}

export class TailSlapShockwaveFX {
  private readonly root = new THREE.Group();
  private readonly impactSlots: ImpactShockwaveSlot[] = [];
  private readonly telegraphRoot = new THREE.Group();
  private readonly telegraphFoam: WaterFoamStampLayer;

  private telegraphActive = false;
  private telegraphAge = 0;
  private telegraphX = 0;
  private telegraphZ = 0;
  private telegraphYaw = 0;

  constructor(scene: THREE.Scene) {
    this.root.renderOrder = 28;
    scene.add(this.root);

    for (let index = 0; index < MAX_IMPACT_SHOCKWAVES; index += 1) {
      this.impactSlots.push(this.createImpactSlot());
    }

    this.telegraphFoam = new WaterFoamStampLayer(this.telegraphRoot, {
      maxStamps: 42,
      maxCutouts: 126,
      color: '#d7e6e2',
      opacity: TELEGRAPH_OPACITY,
      blending: THREE.NormalBlending,
      renderOrder: 29,
      cutoutRenderOrder: 28.7,
    });
    this.telegraphRoot.visible = false;
    this.root.add(this.telegraphRoot);

    this.reset();
  }

  startTelegraph(origin: THREE.Vector3, direction: THREE.Vector3): void {
    this.telegraphActive = true;
    this.telegraphAge = 0;
    this.telegraphRoot.visible = true;
    this.telegraphFoam.reset();
    this.updateTelegraph(origin, direction);
  }

  updateTelegraph(origin: THREE.Vector3, direction: THREE.Vector3): void {
    if (!this.telegraphActive) {
      return;
    }

    this.telegraphX = origin.x;
    this.telegraphZ = origin.z;
    this.telegraphYaw = Math.atan2(direction.x, direction.z);
  }

  clearTelegraph(): void {
    this.telegraphActive = false;
    this.telegraphAge = 0;
    this.telegraphRoot.visible = false;
    this.telegraphFoam.reset();
  }

  spawnImpact(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    innerRadius: number,
    outerRadius: number,
    halfAngle: number,
    intensity = 1,
  ): void {
    const slot = this.claimImpactSlot();
    const yaw = Math.atan2(direction.x, direction.z);
    const normalizedIntensity = THREE.MathUtils.clamp(intensity, 0.7, 1.3);

    slot.active = true;
    slot.age = 0;
    slot.x = origin.x;
    slot.z = origin.z;
    slot.yaw = yaw;
    slot.startRadius = Math.max(3, innerRadius * 0.28);
    slot.endRadius = outerRadius + 1.5;
    slot.intensity = normalizedIntensity;
    slot.halfAngle = halfAngle;
    slot.root.visible = true;
    slot.foam.reset();
  }

  update(
    deltaSeconds: number,
    underwaterRatio: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
  ): void {
    const aboveWaterAlpha = 1 - THREE.MathUtils.smoothstep(underwaterRatio, 0.08, 0.78);

    this.updateTelegraphVisual(deltaSeconds, aboveWaterAlpha, sampleSurfaceHeight);
    this.updateImpactVisuals(deltaSeconds, aboveWaterAlpha, sampleSurfaceHeight);
  }

  reset(): void {
    this.clearTelegraph();

    for (const slot of this.impactSlots) {
      this.deactivateImpactSlot(slot);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.telegraphFoam.dispose();

    for (const slot of this.impactSlots) {
      slot.foam.dispose();
    }
  }

  private updateTelegraphVisual(
    deltaSeconds: number,
    aboveWaterAlpha: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
  ): void {
    if (!this.telegraphActive) {
      return;
    }

    this.telegraphAge += deltaSeconds;

    if (this.telegraphAge >= TELEGRAPH_LIFETIME || aboveWaterAlpha <= 0.01) {
      this.clearTelegraph();
      return;
    }

    const progress = this.telegraphAge / TELEGRAPH_LIFETIME;
    const fadeIn = THREE.MathUtils.smoothstep(progress, 0, 0.18);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.44, 1);
    const opacityAlpha = fadeIn * fadeOut * aboveWaterAlpha;
    const surfaceHeight = sampleSurfaceHeight(this.telegraphX, this.telegraphZ);
    const pulseScale = THREE.MathUtils.lerp(0.96, 1.04, progress);

    this.telegraphRoot.position.set(this.telegraphX, surfaceHeight + SURFACE_OFFSET, this.telegraphZ);
    this.telegraphRoot.rotation.set(0, this.telegraphYaw, 0);
    this.telegraphRoot.visible = true;

    this.telegraphFoam.begin(opacityAlpha);
    this.writeArcStamps(
      this.telegraphFoam,
      TELEGRAPH_HALF_ANGLE,
      TELEGRAPH_OUTER_RADIUS * pulseScale,
      20,
      progress,
      0.34,
      0,
    );
    this.writeArcStamps(
      this.telegraphFoam,
      TELEGRAPH_HALF_ANGLE * 0.82,
      TELEGRAPH_INNER_RADIUS * pulseScale,
      12,
      progress,
      0.24,
      1.1,
    );
    this.telegraphFoam.end();
  }

  private updateImpactVisuals(
    deltaSeconds: number,
    aboveWaterAlpha: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
  ): void {
    for (const slot of this.impactSlots) {
      if (!slot.active) {
        continue;
      }

      slot.age += deltaSeconds;

      if (slot.age >= IMPACT_LIFETIME || aboveWaterAlpha <= 0.01) {
        this.deactivateImpactSlot(slot);
        continue;
      }

      const progress = slot.age / IMPACT_LIFETIME;
      const eased = 1 - Math.pow(1 - progress, 2);
      const radius = THREE.MathUtils.lerp(slot.startRadius, slot.endRadius, eased);
      const surfaceHeight = sampleSurfaceHeight(slot.x, slot.z);
      const opacityFalloff = (1 - THREE.MathUtils.smoothstep(progress, 0.22, 1)) * aboveWaterAlpha;
      const count = THREE.MathUtils.clamp(Math.round(slot.halfAngle * radius * 1.1), 16, MAX_ARC_STAMPS);

      slot.root.position.set(slot.x, surfaceHeight + SURFACE_OFFSET, slot.z);
      slot.root.rotation.set(0, slot.yaw, 0);
      slot.root.visible = true;
      slot.foam.begin(opacityFalloff * IMPACT_OPACITY * slot.intensity);
      this.writeArcStamps(slot.foam, slot.halfAngle, radius, count, progress, 0.48, 0);
      this.writeArcStamps(slot.foam, slot.halfAngle * 0.86, radius * 0.72, Math.max(8, Math.floor(count * 0.48)), progress, 0.32, 1.8);
      slot.foam.end();
    }
  }

  private createImpactSlot(): ImpactShockwaveSlot {
    const root = new THREE.Group();
    const foam = new WaterFoamStampLayer(root, {
      maxStamps: MAX_ARC_STAMPS,
      maxCutouts: MAX_ARC_CUTOUTS,
      color: '#d7e6e2',
      opacity: IMPACT_OPACITY,
      blending: THREE.NormalBlending,
      renderOrder: 31,
      cutoutRenderOrder: 30.7,
    });

    root.visible = false;
    this.root.add(root);

    return {
      root,
      foam,
      active: false,
      age: 0,
      x: 0,
      z: 0,
      yaw: 0,
      startRadius: 3,
      endRadius: 18,
      intensity: 1,
      halfAngle: THREE.MathUtils.degToRad(78),
    };
  }

  private writeArcStamps(
    layer: WaterFoamStampLayer,
    halfAngle: number,
    radius: number,
    count: number,
    progress: number,
    baseScale: number,
    phaseOffset: number,
  ): void {
    const clampedCount = Math.max(2, Math.floor(count));

    for (let index = 0; index < clampedCount; index += 1) {
      const alpha = clampedCount === 1 ? 0.5 : index / (clampedCount - 1);
      const angle = THREE.MathUtils.lerp(-halfAngle, halfAngle, alpha);
      const seed = phaseOffset + index * WATER_FOAM_GOLDEN_ANGLE + progress * 2.4;
      const jitteredRadius = radius * THREE.MathUtils.lerp(0.96, 1.04, (Math.sin(seed) + 1) * 0.5);
      const scale =
        baseScale *
        THREE.MathUtils.lerp(0.78, 1.24, (Math.cos(seed * 0.73) + 1) * 0.5) *
        (1 - THREE.MathUtils.smoothstep(progress, 0.78, 1) * 0.55);

      layer.addStamp({
        x: Math.sin(angle) * jitteredRadius,
        y: (index % 7) * 0.001,
        z: Math.cos(angle) * jitteredRadius,
        yaw: -angle + Math.sin(seed * 0.61) * 0.34,
        width: scale * THREE.MathUtils.lerp(0.82, 1.3, (Math.sin(seed * 0.41) + 1) * 0.5),
        length: scale * THREE.MathUtils.lerp(0.72, 1.08, (Math.cos(seed * 0.59) + 1) * 0.5),
        phase: seed,
        progress,
        variant: index,
      });
    }
  }

  private claimImpactSlot(): ImpactShockwaveSlot {
    const inactive = this.impactSlots.find((slot) => !slot.active);

    if (inactive) {
      return inactive;
    }

    let oldest = this.impactSlots[0];

    for (let index = 1; index < this.impactSlots.length; index += 1) {
      if (this.impactSlots[index].age > oldest.age) {
        oldest = this.impactSlots[index];
      }
    }

    this.deactivateImpactSlot(oldest);
    return oldest;
  }

  private deactivateImpactSlot(slot: ImpactShockwaveSlot): void {
    slot.active = false;
    slot.age = 0;
    slot.root.visible = false;
    slot.foam.reset();
  }
}

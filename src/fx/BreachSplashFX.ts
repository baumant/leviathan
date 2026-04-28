import * as THREE from 'three';

const MAX_SPLASHES = 10;
const MAX_DROPLETS = 96;
const BASE_RING_OFFSET = 0.08;
const BASE_FOAM_OFFSET = 0.12;
const LAUNCH_LIFETIME_MIN = 0.48;
const LAUNCH_LIFETIME_MAX = 0.64;
const REENTRY_LIFETIME_MIN = 0.86;
const REENTRY_LIFETIME_MAX = 1.08;
const IMPACT_LIFETIME_MIN = 0.42;
const IMPACT_LIFETIME_MAX = 0.58;
const GRAVITY = 16.5;
const DRAG = 1.9;

type SplashMode = 'launch' | 'reentry' | 'impact';

interface SplashParticleState {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly rotation: THREE.Vector3;
  readonly spin: THREE.Vector3;
  baseScale: number;
}

interface SplashSlot {
  readonly root: THREE.Group;
  readonly primaryRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly secondaryRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  readonly foamPatch: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  readonly plumeColumn: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  readonly plumeCap: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  readonly plumeVeil: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  readonly spray: THREE.InstancedMesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  readonly particles: SplashParticleState[];
  readonly anchor: THREE.Vector3;
  active: boolean;
  mode: SplashMode;
  age: number;
  lifetime: number;
  intensity: number;
  radiusScale: number;
  dropletCount: number;
}

export class BreachSplashFX {
  private readonly root = new THREE.Group();
  private readonly ringGeometry = new THREE.RingGeometry(0.78, 1, 48, 1);
  private readonly foamGeometry = new THREE.CircleGeometry(1, 28);
  private readonly plumeGeometry = new THREE.SphereGeometry(1, 14, 8);
  private readonly dropletGeometry = new THREE.IcosahedronGeometry(0.22, 0);
  private readonly slots: SplashSlot[] = [];
  private readonly dummy = new THREE.Object3D();

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

      this.updateRings(slot, progress);
      this.updatePlume(slot, progress);
      this.updateSpray(slot, deltaSeconds, progress);
    }
  }

  reset(): void {
    for (const slot of this.slots) {
      this.deactivateSlot(slot);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.ringGeometry.dispose();
    this.foamGeometry.dispose();
    this.plumeGeometry.dispose();
    this.dropletGeometry.dispose();

    for (const slot of this.slots) {
      slot.primaryRing.material.dispose();
      slot.secondaryRing.material.dispose();
      slot.foamPatch.material.dispose();
      slot.plumeColumn.material.dispose();
      slot.plumeCap.material.dispose();
      slot.plumeVeil.material.dispose();
      slot.spray.material.dispose();
    }
  }

  private createSlot(): SplashSlot {
    const root = new THREE.Group();
    root.visible = false;

    const primaryRingMaterial = this.createSurfaceMaterial('#d9fbff', 0.72);
    const primaryRing = new THREE.Mesh(this.ringGeometry, primaryRingMaterial);
    primaryRing.rotation.x = -Math.PI / 2;
    primaryRing.position.y = BASE_RING_OFFSET;
    primaryRing.frustumCulled = false;
    primaryRing.renderOrder = 24;

    const secondaryRingMaterial = this.createSurfaceMaterial('#b9f5ff', 0.86);
    const secondaryRing = new THREE.Mesh(this.ringGeometry, secondaryRingMaterial);
    secondaryRing.rotation.x = -Math.PI / 2;
    secondaryRing.position.y = BASE_RING_OFFSET + 0.01;
    secondaryRing.frustumCulled = false;
    secondaryRing.renderOrder = 25;

    const foamMaterial = this.createSurfaceMaterial('#8fdde2', 0.56);
    const foamPatch = new THREE.Mesh(this.foamGeometry, foamMaterial);
    foamPatch.rotation.x = -Math.PI / 2;
    foamPatch.position.y = BASE_FOAM_OFFSET;
    foamPatch.frustumCulled = false;
    foamPatch.renderOrder = 24;

    const plumeColumn = new THREE.Mesh(
      this.plumeGeometry,
      this.createMistMaterial('#a9c8cf', 0.16, THREE.NormalBlending),
    );
    plumeColumn.frustumCulled = false;
    plumeColumn.renderOrder = 25;

    const plumeVeil = new THREE.Mesh(
      this.plumeGeometry,
      this.createMistMaterial('#d7edf0', 0.1, THREE.AdditiveBlending),
    );
    plumeVeil.frustumCulled = false;
    plumeVeil.renderOrder = 26;

    const plumeCap = new THREE.Mesh(
      this.plumeGeometry,
      this.createMistMaterial('#edf9fa', 0.18, THREE.NormalBlending),
    );
    plumeCap.frustumCulled = false;
    plumeCap.renderOrder = 27;

    const sprayMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#f3ffff'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    sprayMaterial.fog = true;
    sprayMaterial.toneMapped = false;

    const spray = new THREE.InstancedMesh(this.dropletGeometry, sprayMaterial, MAX_DROPLETS);
    spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    spray.count = 0;
    spray.frustumCulled = false;
    spray.renderOrder = 28;

    const particles: SplashParticleState[] = [];
    for (let index = 0; index < MAX_DROPLETS; index += 1) {
      particles.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        rotation: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        baseScale: 0,
      });
    }

    root.add(primaryRing, secondaryRing, foamPatch, plumeColumn, plumeVeil, plumeCap, spray);
    this.root.add(root);

    return {
      root,
      primaryRing,
      secondaryRing,
      foamPatch,
      plumeColumn,
      plumeCap,
      plumeVeil,
      spray,
      particles,
      anchor: new THREE.Vector3(),
      active: false,
      mode: 'launch',
      age: 0,
      lifetime: 0,
      intensity: 0,
      radiusScale: 1,
      dropletCount: 0,
    };
  }

  private createSurfaceMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    material.fog = true;
    material.toneMapped = false;
    material.userData.baseOpacity = opacity;
    return material;
  }

  private createMistMaterial(color: string, opacity: number, blending: THREE.Blending): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending,
    });
    material.fog = true;
    material.toneMapped = false;
    material.userData.baseOpacity = opacity;
    return material;
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
    slot.root.rotation.set(0, Math.random() * Math.PI * 2, 0);
    slot.root.visible = true;

    this.seedSpray(slot);
    this.updateRings(slot, 0);
    this.updatePlume(slot, 0);
    this.updateSpray(slot, 0, 0);
  }

  private getLifetime(mode: SplashMode, intensity: number): number {
    if (mode === 'launch') {
      return THREE.MathUtils.lerp(LAUNCH_LIFETIME_MIN, LAUNCH_LIFETIME_MAX, intensity);
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
    slot.dropletCount = 0;
    slot.root.visible = false;
    slot.primaryRing.material.opacity = 0;
    slot.secondaryRing.material.opacity = 0;
    slot.foamPatch.material.opacity = 0;
    slot.plumeColumn.material.opacity = 0;
    slot.plumeCap.material.opacity = 0;
    slot.plumeVeil.material.opacity = 0;
    slot.spray.material.opacity = 0;
    slot.spray.count = 0;
  }

  private seedSpray(slot: SplashSlot): void {
    const isLaunch = slot.mode === 'launch';
    const isImpact = slot.mode === 'impact';
    const spread = (isImpact ? 1.35 : isLaunch ? 2.6 : 4.7) * slot.radiusScale;
    const verticalMin = isImpact ? 2.8 : isLaunch ? 7.4 : 9.4;
    const verticalMax = isImpact ? 4.8 : isLaunch ? 10.6 : 15.2;
    const count = isImpact
      ? Math.round(THREE.MathUtils.lerp(10, 18, slot.intensity))
      : isLaunch
        ? Math.round(THREE.MathUtils.lerp(38, 56, slot.intensity))
        : Math.round(THREE.MathUtils.lerp(58, 88, slot.intensity));

    slot.dropletCount = Math.min(MAX_DROPLETS, count);
    slot.spray.count = slot.dropletCount;

    for (let index = 0; index < slot.dropletCount; index += 1) {
      const particle = slot.particles[index];
      const radial = Math.random() * Math.PI * 2;
      const radialStrength = Math.random();
      const capBias = slot.mode === 'reentry' && index > slot.dropletCount * 0.48 ? 1 : 0;
      const localRadius = (isImpact ? 0.28 : isLaunch ? 0.5 : 0.92) * slot.radiusScale * radialStrength;
      const radialVelocity = spread * (0.45 + radialStrength * 0.95 + capBias * 0.55) * slot.intensity;
      const verticalVelocity = THREE.MathUtils.lerp(verticalMin, verticalMax, Math.random()) *
        (capBias ? 0.86 : 1) *
        slot.intensity;

      particle.position.set(
        Math.cos(radial) * localRadius,
        0.02 + Math.random() * (isImpact ? 0.18 : isLaunch ? 0.36 : 0.62),
        Math.sin(radial) * localRadius,
      );
      particle.velocity.set(
        Math.cos(radial) * radialVelocity,
        verticalVelocity,
        Math.sin(radial) * radialVelocity,
      );
      particle.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      particle.spin.set(
        THREE.MathUtils.randFloatSpread(5.4),
        THREE.MathUtils.randFloatSpread(5.4),
        THREE.MathUtils.randFloatSpread(5.4),
      );
      particle.baseScale =
        (isImpact ? 0.07 : isLaunch ? 0.14 : 0.18) *
        THREE.MathUtils.lerp(0.8, isImpact ? 1.25 : 1.75, Math.random()) *
        slot.intensity *
        slot.radiusScale;
    }
  }

  private updateRings(slot: SplashSlot, progress: number): void {
    const fadeOut = 1 - progress;
    const eased = 1 - Math.pow(1 - progress, 2);
    const isLaunch = slot.mode === 'launch';
    const isImpact = slot.mode === 'impact';

    if (isImpact) {
      const primaryScale = THREE.MathUtils.lerp(0.38, (2.15 + slot.intensity * 0.9) * slot.radiusScale, eased);
      const foamRingScale = THREE.MathUtils.lerp(0.28, (1.25 + slot.intensity * 0.48) * slot.radiusScale, Math.sqrt(progress));
      const foamPatchScale = THREE.MathUtils.lerp(0.22, (0.9 + slot.intensity * 0.32) * slot.radiusScale, eased);

      slot.primaryRing.scale.setScalar(primaryScale);
      slot.secondaryRing.scale.setScalar(foamRingScale);
      slot.foamPatch.scale.setScalar(foamPatchScale);

      slot.primaryRing.material.opacity = (slot.primaryRing.material.userData.baseOpacity as number) * fadeOut * 0.34;
      slot.secondaryRing.material.opacity =
        (slot.secondaryRing.material.userData.baseOpacity as number) * fadeOut * 0.3;
      slot.foamPatch.material.opacity =
        (slot.foamPatch.material.userData.baseOpacity as number) * Math.pow(fadeOut, 1.2) * 0.22;
      return;
    }

    if (isLaunch) {
      const primaryScale = THREE.MathUtils.lerp(0.8, 6.4 + slot.intensity * 1.8, eased);
      const foamRingScale = THREE.MathUtils.lerp(0.62, 3.2 + slot.intensity * 0.8, Math.sqrt(progress));
      const foamPatchScale = THREE.MathUtils.lerp(0.4, 2.4 + slot.intensity * 0.65, eased);

      slot.primaryRing.scale.setScalar(primaryScale);
      slot.secondaryRing.scale.setScalar(foamRingScale);
      slot.foamPatch.scale.setScalar(foamPatchScale);

      slot.primaryRing.material.opacity = (slot.primaryRing.material.userData.baseOpacity as number) * fadeOut * 0.62;
      slot.secondaryRing.material.opacity =
        (slot.secondaryRing.material.userData.baseOpacity as number) * fadeOut * 0.58;
      slot.foamPatch.material.opacity =
        (slot.foamPatch.material.userData.baseOpacity as number) * Math.pow(fadeOut, 1.15) * 0.42;
      return;
    }

    const delayed = THREE.MathUtils.clamp((progress - 0.12) / 0.88, 0, 1);
    const primaryScale = THREE.MathUtils.lerp(1.1, 10.6 + slot.intensity * 3.4, eased);
    const secondaryScale = THREE.MathUtils.lerp(0.82, 7.1 + slot.intensity * 2.6, Math.sqrt(delayed));
    const foamPatchScale = THREE.MathUtils.lerp(0.78, 4.2 + slot.intensity * 1.4, eased);

    slot.primaryRing.scale.setScalar(primaryScale);
    slot.secondaryRing.scale.setScalar(secondaryScale);
    slot.foamPatch.scale.setScalar(foamPatchScale);

    slot.primaryRing.material.opacity = (slot.primaryRing.material.userData.baseOpacity as number) * fadeOut * 0.8;
    slot.secondaryRing.material.opacity =
      (slot.secondaryRing.material.userData.baseOpacity as number) * (1 - delayed * 0.15) * delayed * 0.72;
    slot.foamPatch.material.opacity =
      (slot.foamPatch.material.userData.baseOpacity as number) * Math.pow(fadeOut, 0.9) * 0.6;
  }

  private updatePlume(slot: SplashSlot, progress: number): void {
    const rise = THREE.MathUtils.smoothstep(progress, 0, slot.mode === 'impact' ? 0.22 : 0.34);
    const fade = 1 - THREE.MathUtils.smoothstep(progress, slot.mode === 'impact' ? 0.28 : 0.46, 1);
    const capFade = slot.mode === 'impact'
      ? (1 - THREE.MathUtils.smoothstep(progress, 0.18, 1)) * 0.28
      : (1 - THREE.MathUtils.smoothstep(progress, 0.52, 1));
    const pulse = 0.92 + Math.sin(progress * Math.PI * 2.4) * 0.08;
    const plumeBase = slot.intensity * slot.radiusScale;

    if (slot.mode === 'impact') {
      const height = THREE.MathUtils.lerp(0.36, 1.75 + slot.intensity * 0.75, rise) * slot.radiusScale;
      const columnY = height * 0.5;
      const radius = THREE.MathUtils.lerp(0.18, 0.48 + slot.intensity * 0.2, rise) * slot.radiusScale;

      slot.plumeColumn.position.set(0, columnY + 0.04, 0);
      slot.plumeColumn.scale.set(radius, columnY, radius);
      slot.plumeCap.position.set(0, height * 0.78 + 0.1, 0);
      slot.plumeCap.scale.set(radius * 2.15, radius * 0.46, radius * 1.75);
      slot.plumeVeil.position.set(0, height * 0.5, 0);
      slot.plumeVeil.scale.set(radius * 1.45, columnY * 0.8, radius * 1.45);

      slot.plumeColumn.material.opacity = (slot.plumeColumn.material.userData.baseOpacity as number) * fade * plumeBase * 0.55;
      slot.plumeCap.material.opacity = (slot.plumeCap.material.userData.baseOpacity as number) * capFade * plumeBase * 0.46;
      slot.plumeVeil.material.opacity = (slot.plumeVeil.material.userData.baseOpacity as number) * fade * plumeBase * 0.36;
      return;
    }

    const isLaunch = slot.mode === 'launch';
    const height = THREE.MathUtils.lerp(
      isLaunch ? 1.4 : 2.2,
      isLaunch ? 6.2 + slot.intensity * 1.9 : 9.6 + slot.intensity * 3.2,
      rise,
    );
    const columnY = height * 0.5;
    const columnRadius = THREE.MathUtils.lerp(
      isLaunch ? 0.48 : 0.72,
      isLaunch ? 1.08 + slot.intensity * 0.34 : 1.42 + slot.intensity * 0.56,
      rise,
    ) * pulse;
    const capRadius = THREE.MathUtils.lerp(
      isLaunch ? 0.88 : 1.35,
      isLaunch ? 2.9 + slot.intensity * 0.9 : 5.2 + slot.intensity * 1.6,
      rise,
    ) * pulse;

    slot.plumeColumn.position.set(0, columnY + 0.18, 0);
    slot.plumeColumn.scale.set(columnRadius, columnY, columnRadius);
    slot.plumeVeil.position.set(0, columnY + 0.18, 0);
    slot.plumeVeil.scale.set(columnRadius * 1.82, columnY * 0.92, columnRadius * 1.48);
    slot.plumeCap.position.set(0, height * (isLaunch ? 0.76 : 0.72), 0);
    slot.plumeCap.scale.set(capRadius, isLaunch ? 0.46 + slot.intensity * 0.16 : 0.78 + slot.intensity * 0.24, capRadius * 0.78);

    slot.plumeColumn.material.opacity =
      (slot.plumeColumn.material.userData.baseOpacity as number) * fade * plumeBase * (isLaunch ? 0.72 : 0.9);
    slot.plumeVeil.material.opacity =
      (slot.plumeVeil.material.userData.baseOpacity as number) * fade * plumeBase * (isLaunch ? 0.72 : 1);
    slot.plumeCap.material.opacity =
      (slot.plumeCap.material.userData.baseOpacity as number) * capFade * plumeBase * (isLaunch ? 0.58 : 0.82);
  }

  private updateSpray(slot: SplashSlot, deltaSeconds: number, progress: number): void {
    const fadeOut = 1 - progress;
    const modeOpacity = slot.mode === 'impact' ? 0.42 : slot.mode === 'launch' ? 0.56 : 0.68;
    slot.spray.material.opacity = modeOpacity * Math.pow(fadeOut, slot.mode === 'impact' ? 0.95 : 0.8);

    for (let index = 0; index < slot.dropletCount; index += 1) {
      const particle = slot.particles[index];

      if (deltaSeconds > 0) {
        particle.velocity.y -= GRAVITY * deltaSeconds;
        particle.velocity.multiplyScalar(Math.exp(-DRAG * deltaSeconds));
        particle.position.addScaledVector(particle.velocity, deltaSeconds);
        particle.rotation.addScaledVector(particle.spin, deltaSeconds);
      }

      const waterFade =
        particle.position.y < -0.08 ? THREE.MathUtils.clamp(1 + particle.position.y / 0.45, 0, 1) : 1;
      const scale = particle.baseScale * Math.pow(fadeOut, 0.55) * waterFade;

      this.dummy.position.copy(particle.position);
      this.dummy.rotation.set(particle.rotation.x, particle.rotation.y, particle.rotation.z);
      this.dummy.scale.setScalar(Math.max(scale, 0.0001));
      this.dummy.updateMatrix();
      slot.spray.setMatrixAt(index, this.dummy.matrix);
    }

    slot.spray.instanceMatrix.needsUpdate = true;
  }
}

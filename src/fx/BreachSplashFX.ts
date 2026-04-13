import * as THREE from 'three';

const MAX_SPLASHES = 6;
const MAX_DROPLETS = 40;
const BASE_RING_OFFSET = 0.08;
const BASE_FOAM_OFFSET = 0.12;
const LAUNCH_LIFETIME_MIN = 0.48;
const LAUNCH_LIFETIME_MAX = 0.64;
const REENTRY_LIFETIME_MIN = 0.86;
const REENTRY_LIFETIME_MAX = 1.08;
const GRAVITY = 16.5;
const DRAG = 1.9;

type SplashMode = 'launch' | 'reentry';

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
  readonly spray: THREE.InstancedMesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  readonly particles: SplashParticleState[];
  readonly anchor: THREE.Vector3;
  active: boolean;
  mode: SplashMode;
  age: number;
  lifetime: number;
  intensity: number;
  dropletCount: number;
}

export class BreachSplashFX {
  private readonly root = new THREE.Group();
  private readonly ringGeometry = new THREE.RingGeometry(0.78, 1, 48, 1);
  private readonly foamGeometry = new THREE.CircleGeometry(1, 28);
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
    this.dropletGeometry.dispose();

    for (const slot of this.slots) {
      slot.primaryRing.material.dispose();
      slot.secondaryRing.material.dispose();
      slot.foamPatch.material.dispose();
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
    primaryRing.renderOrder = 7;

    const secondaryRingMaterial = this.createSurfaceMaterial('#b9f5ff', 0.86);
    const secondaryRing = new THREE.Mesh(this.ringGeometry, secondaryRingMaterial);
    secondaryRing.rotation.x = -Math.PI / 2;
    secondaryRing.position.y = BASE_RING_OFFSET + 0.01;
    secondaryRing.frustumCulled = false;
    secondaryRing.renderOrder = 8;

    const foamMaterial = this.createSurfaceMaterial('#8fdde2', 0.56);
    const foamPatch = new THREE.Mesh(this.foamGeometry, foamMaterial);
    foamPatch.rotation.x = -Math.PI / 2;
    foamPatch.position.y = BASE_FOAM_OFFSET;
    foamPatch.frustumCulled = false;
    foamPatch.renderOrder = 8;

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
    spray.renderOrder = 9;

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

    root.add(primaryRing, secondaryRing, foamPatch, spray);
    this.root.add(root);

    return {
      root,
      primaryRing,
      secondaryRing,
      foamPatch,
      spray,
      particles,
      anchor: new THREE.Vector3(),
      active: false,
      mode: 'launch',
      age: 0,
      lifetime: 0,
      intensity: 0,
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

  private activateSlot(mode: SplashMode, origin: THREE.Vector3, intensity: number): void {
    const slot = this.claimSlot();
    const normalizedIntensity = THREE.MathUtils.lerp(0.45, 1, intensity);

    slot.active = true;
    slot.mode = mode;
    slot.age = 0;
    slot.intensity = normalizedIntensity;
    slot.lifetime =
      mode === 'launch'
        ? THREE.MathUtils.lerp(LAUNCH_LIFETIME_MIN, LAUNCH_LIFETIME_MAX, normalizedIntensity)
        : THREE.MathUtils.lerp(REENTRY_LIFETIME_MIN, REENTRY_LIFETIME_MAX, normalizedIntensity);
    slot.anchor.set(origin.x, 0, origin.z);
    slot.root.position.copy(origin);
    slot.root.visible = true;

    this.seedSpray(slot);
    this.updateRings(slot, 0);
    this.updateSpray(slot, 0, 0);
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
    slot.spray.material.opacity = 0;
    slot.spray.count = 0;
  }

  private seedSpray(slot: SplashSlot): void {
    const isLaunch = slot.mode === 'launch';
    const spread = isLaunch ? 1.6 : 3.4;
    const verticalMin = isLaunch ? 5.8 : 7.6;
    const verticalMax = isLaunch ? 8.2 : 11.8;
    const count = isLaunch
      ? Math.round(THREE.MathUtils.lerp(14, 22, slot.intensity))
      : Math.round(THREE.MathUtils.lerp(24, 36, slot.intensity));

    slot.dropletCount = Math.min(MAX_DROPLETS, count);
    slot.spray.count = slot.dropletCount;

    for (let index = 0; index < slot.dropletCount; index += 1) {
      const particle = slot.particles[index];
      const radial = Math.random() * Math.PI * 2;
      const radialStrength = Math.random();
      const localRadius = (isLaunch ? 0.35 : 0.75) * radialStrength;

      particle.position.set(
        Math.cos(radial) * localRadius,
        0.02 + Math.random() * (isLaunch ? 0.28 : 0.5),
        Math.sin(radial) * localRadius,
      );
      particle.velocity.set(
        Math.cos(radial) * (spread * (0.5 + radialStrength * 0.85) * slot.intensity),
        THREE.MathUtils.lerp(verticalMin, verticalMax, Math.random()) * slot.intensity,
        Math.sin(radial) * (spread * (0.5 + radialStrength * 0.85) * slot.intensity),
      );
      particle.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      particle.spin.set(
        THREE.MathUtils.randFloatSpread(5.4),
        THREE.MathUtils.randFloatSpread(5.4),
        THREE.MathUtils.randFloatSpread(5.4),
      );
      particle.baseScale =
        (isLaunch ? 0.12 : 0.16) * THREE.MathUtils.lerp(0.8, 1.5, Math.random()) * slot.intensity;
    }
  }

  private updateRings(slot: SplashSlot, progress: number): void {
    const fadeOut = 1 - progress;
    const eased = 1 - Math.pow(1 - progress, 2);
    const isLaunch = slot.mode === 'launch';

    if (isLaunch) {
      const primaryScale = THREE.MathUtils.lerp(0.8, 4.8 + slot.intensity * 1.4, eased);
      const foamRingScale = THREE.MathUtils.lerp(0.62, 2.35 + slot.intensity * 0.55, Math.sqrt(progress));
      const foamPatchScale = THREE.MathUtils.lerp(0.4, 1.75 + slot.intensity * 0.5, eased);

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
    const primaryScale = THREE.MathUtils.lerp(1.1, 7.6 + slot.intensity * 2.3, eased);
    const secondaryScale = THREE.MathUtils.lerp(0.82, 5.3 + slot.intensity * 1.9, Math.sqrt(delayed));
    const foamPatchScale = THREE.MathUtils.lerp(0.78, 2.8 + slot.intensity * 1.1, eased);

    slot.primaryRing.scale.setScalar(primaryScale);
    slot.secondaryRing.scale.setScalar(secondaryScale);
    slot.foamPatch.scale.setScalar(foamPatchScale);

    slot.primaryRing.material.opacity = (slot.primaryRing.material.userData.baseOpacity as number) * fadeOut * 0.8;
    slot.secondaryRing.material.opacity =
      (slot.secondaryRing.material.userData.baseOpacity as number) * (1 - delayed * 0.15) * delayed * 0.72;
    slot.foamPatch.material.opacity =
      (slot.foamPatch.material.userData.baseOpacity as number) * Math.pow(fadeOut, 0.9) * 0.6;
  }

  private updateSpray(slot: SplashSlot, deltaSeconds: number, progress: number): void {
    const fadeOut = 1 - progress;
    slot.spray.material.opacity = (slot.mode === 'launch' ? 0.52 : 0.74) * Math.pow(fadeOut, 0.8);

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

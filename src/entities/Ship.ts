import * as THREE from 'three';

export class Ship {
  readonly root = new THREE.Group();
  readonly halfExtents = new THREE.Vector3(2.9, 2.2, 7.1);

  health: number;
  readonly maxHealth: number;

  private sinkProgress = 0;
  private readonly hullMaterial: THREE.MeshStandardMaterial;
  private readonly mastMaterial: THREE.MeshStandardMaterial;
  private readonly sailMaterial: THREE.MeshStandardMaterial;
  private readonly lanternMaterial: THREE.MeshStandardMaterial;
  private readonly lanternHalo: THREE.Mesh;
  private readonly lanternHaloMaterial: THREE.MeshBasicMaterial;
  private readonly lanternLight: THREE.PointLight;
  private readonly baseYaw: number;
  private readonly bobOffset = Math.random() * Math.PI * 2;
  private impactRoll = 0;
  private impactPitch = 0;

  constructor(maxHealth = 140) {
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.baseYaw = Math.PI * 0.18;

    this.hullMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#5e4330'),
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true,
    });

    this.mastMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#8c674d'),
      roughness: 0.9,
      metalness: 0.01,
      flatShading: true,
    });

    this.lanternMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ffd18f'),
      emissive: new THREE.Color('#ffac4c'),
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0.05,
    });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(5, 1.8, 12), this.hullMaterial);
    hull.position.y = 0.4;

    const foredeck = new THREE.Mesh(new THREE.BoxGeometry(4, 0.7, 3.4), this.hullMaterial);
    foredeck.position.set(0, 1.15, 3.4);

    const sternDeck = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.8, 2.6), this.hullMaterial);
    sternDeck.position.set(0, 1.25, -3.4);

    const bow = new THREE.Mesh(new THREE.ConeGeometry(2.35, 4.2, 5), this.hullMaterial);
    bow.rotation.x = Math.PI / 2;
    bow.position.set(0, 0.42, 7.4);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 8.2, 5), this.mastMaterial);
    mast.position.set(0, 4.7, -0.35);

    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 6.2), this.mastMaterial);
    boom.position.set(0, 5.2, -0.25);
    boom.rotation.x = Math.PI / 2;

    this.sailMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ccb996'),
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });

    const sail = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 3.6, 4.2),
      this.sailMaterial,
    );
    sail.position.set(0, 5.1, 0.55);

    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 6), this.lanternMaterial);
    lantern.position.set(0, 2.25, 3.9);

    this.lanternHaloMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffcf8f'),
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.lanternHaloMaterial.toneMapped = false;

    this.lanternHalo = new THREE.Mesh(
      new THREE.SphereGeometry(1.2, 10, 10),
      this.lanternHaloMaterial,
    );
    this.lanternHalo.position.copy(lantern.position);

    this.lanternLight = new THREE.PointLight('#ffb25a', 2.2, 22, 2);
    this.lanternLight.position.copy(lantern.position);

    this.root.add(
      hull,
      foredeck,
      sternDeck,
      bow,
      mast,
      boom,
      sail,
      lantern,
      this.lanternHalo,
      this.lanternLight,
    );
    this.root.position.set(36, 0.8, 58);
    this.root.rotation.order = 'YXZ';
  }

  get sinking(): boolean {
    return this.health <= 0;
  }

  get sunk(): boolean {
    return this.sinkProgress >= 1;
  }

  get healthPercent(): number {
    return THREE.MathUtils.clamp(this.health / this.maxHealth, 0, 1);
  }

  applyDamage(amount: number): void {
    if (this.sinking || this.sunk) {
      return;
    }

    this.health = Math.max(0, this.health - amount);
    this.impactRoll += THREE.MathUtils.clamp(amount / 180, 0.02, 0.28);
    this.impactPitch -= THREE.MathUtils.clamp(amount / 260, 0.01, 0.12);
    this.updateDamageLook();
  }

  update(deltaSeconds: number, elapsedSeconds: number, oceanHeightAt: (x: number, z: number) => number): void {
    const seaLevel = oceanHeightAt(this.root.position.x, this.root.position.z);
    const damageRatio = 1 - this.healthPercent;
    const bob = Math.sin(elapsedSeconds * 1.1 + this.bobOffset) * 0.22;
    const pitchWave = Math.cos(elapsedSeconds * 0.9 + this.bobOffset * 0.7) * 0.03;
    const rollWave = Math.sin(elapsedSeconds * 1.2 + this.bobOffset) * 0.04;

    this.impactRoll = THREE.MathUtils.damp(this.impactRoll, damageRatio * 0.11, 2.8, deltaSeconds);
    this.impactPitch = THREE.MathUtils.damp(this.impactPitch, damageRatio * 0.05, 2.4, deltaSeconds);

    if (this.sinking) {
      this.sinkProgress = Math.min(1, this.sinkProgress + deltaSeconds * 0.18);
    }

    this.root.position.y = seaLevel + 0.95 + bob - this.sinkProgress * 8.5;
    this.root.rotation.set(
      pitchWave + this.impactPitch - this.sinkProgress * 0.28,
      this.baseYaw,
      rollWave + this.impactRoll + this.sinkProgress * 1.28,
      'YXZ',
    );

    const lanternPulse = 0.85 + Math.sin(elapsedSeconds * 4.2 + this.bobOffset * 2) * 0.15;
    this.lanternLight.intensity = Math.max(0, (2.1 - damageRatio - this.sinkProgress * 1.6) * lanternPulse);
    this.lanternMaterial.emissiveIntensity = Math.max(0, 0.9 - this.sinkProgress * 0.72);
    this.lanternHaloMaterial.opacity = Math.max(0, (0.14 + lanternPulse * 0.06) * (1 - this.sinkProgress * 0.92));
    this.lanternHalo.scale.setScalar(1.05 + lanternPulse * 0.18 + damageRatio * 0.22);

    this.root.updateMatrixWorld();
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 0, 1).applyQuaternion(this.root.quaternion).normalize();
  }

  worldToLocalPoint(point: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 {
    target.copy(point);
    return this.root.worldToLocal(target);
  }

  setSubmergedReadabilityCue(amount: number): void {
    const cue = THREE.MathUtils.clamp(amount, 0, 1);

    this.hullMaterial.emissive.set('#8fb7df');
    this.hullMaterial.emissiveIntensity = cue * 0.14;

    this.mastMaterial.emissive.set('#86a5c8');
    this.mastMaterial.emissiveIntensity = cue * 0.11;

    this.sailMaterial.emissive.set('#98b6d6');
    this.sailMaterial.emissiveIntensity = cue * 0.08;

    this.lanternMaterial.emissiveIntensity += cue * 0.62;
    this.lanternLight.intensity *= 1 + cue * 0.8;
    this.lanternLight.distance = THREE.MathUtils.lerp(22, 32, cue);

    this.lanternHaloMaterial.opacity = Math.min(0.8, this.lanternHaloMaterial.opacity + cue * 0.34);
    this.lanternHalo.scale.multiplyScalar(1 + cue * 0.28);
  }

  private updateDamageLook(): void {
    const damageRatio = 1 - this.healthPercent;

    this.hullMaterial.color.set('#5e4330').lerp(new THREE.Color('#23150f'), damageRatio * 0.75);
    this.mastMaterial.color.set('#8c674d').lerp(new THREE.Color('#403127'), damageRatio * 0.68);
    this.sailMaterial.color.set('#ccb996').lerp(new THREE.Color('#6f6351'), damageRatio * 0.42);
    this.lanternMaterial.color.set('#ffd18f').lerp(new THREE.Color('#6d4d28'), damageRatio * 0.6);
  }
}

import * as THREE from 'three';

import { Ship } from '../entities/Ship';

const VAULT_RADIUS = 84;
const AMBIENT_COUNT = 88;
const STREAK_COUNT = 18;

export interface UnderwaterReadabilitySnapshot {
  deltaSeconds: number;
  elapsedSeconds: number;
  camera: THREE.PerspectiveCamera;
  whalePosition: THREE.Vector3;
  whaleSpeed: number;
  whaleBoostActive: boolean;
  underwaterRatio: number;
  submerged: boolean;
  surfaceHeightAtCamera: number;
  ship: Ship;
}

export class UnderwaterReadabilityFX {
  private readonly root = new THREE.Group();
  private readonly particleRoot = new THREE.Group();
  private readonly shipVector = new THREE.Vector3();
  private readonly ambientGeometry = new THREE.BufferGeometry();
  private readonly ambientMaterial = new THREE.PointsMaterial({
    color: new THREE.Color('#b8daff'),
    size: 0.22,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
  });
  private readonly ambientPositions = new Float32Array(AMBIENT_COUNT * 3);
  private readonly ambientSpeeds = new Float32Array(AMBIENT_COUNT);
  private readonly ambientDrift = new Float32Array(AMBIENT_COUNT);
  private readonly ambientParticles: THREE.Points;
  private readonly streakGeometry = new THREE.BufferGeometry();
  private readonly streakMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color('#dcecff'),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private readonly streakPositions = new Float32Array(STREAK_COUNT * 2 * 3);
  private readonly streakSpeeds = new Float32Array(STREAK_COUNT);
  private readonly streakLengths = new Float32Array(STREAK_COUNT);
  private readonly streakDrift = new Float32Array(STREAK_COUNT * 2);
  private readonly streaks: THREE.LineSegments;
  private readonly vaultMaterial: THREE.MeshBasicMaterial;
  private readonly surfaceBandMaterial: THREE.MeshBasicMaterial;
  private readonly surfaceBand: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private underwaterAlpha = 0;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (!camera.parent) {
      scene.add(camera);
    }

    this.root.renderOrder = -10;
    this.particleRoot.renderOrder = 10;

    this.vaultMaterial = this.createVaultMaterial();
    const vault = new THREE.Mesh(this.createVaultGeometry(), this.vaultMaterial);
    vault.frustumCulled = false;

    this.surfaceBandMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#8fb4dc'),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.surfaceBandMaterial.toneMapped = false;

    this.surfaceBand = new THREE.Mesh(
      new THREE.RingGeometry(16, 48, 48, 1),
      this.surfaceBandMaterial,
    );
    this.surfaceBand.rotation.x = -Math.PI / 2;
    this.surfaceBand.frustumCulled = false;

    this.ambientMaterial.fog = false;
    this.ambientMaterial.toneMapped = false;
    this.seedAmbientParticles();
    this.ambientGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.ambientPositions, 3),
    );
    this.ambientParticles = new THREE.Points(this.ambientGeometry, this.ambientMaterial);
    this.ambientParticles.frustumCulled = false;

    this.streakMaterial.fog = false;
    this.streakMaterial.toneMapped = false;
    this.seedStreaks();
    this.streakGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.streakPositions, 3),
    );
    this.streaks = new THREE.LineSegments(this.streakGeometry, this.streakMaterial);
    this.streaks.frustumCulled = false;

    this.root.add(vault, this.surfaceBand);
    this.particleRoot.add(this.ambientParticles, this.streaks);
    scene.add(this.root);
    camera.add(this.particleRoot);
  }

  update(snapshot: UnderwaterReadabilitySnapshot): void {
    const targetAlpha = snapshot.submerged ? THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.08, 0.82) : 0;
    this.underwaterAlpha = THREE.MathUtils.damp(this.underwaterAlpha, targetAlpha, 3.4, snapshot.deltaSeconds);

    this.root.position.copy(snapshot.camera.position);
    this.vaultMaterial.opacity = this.underwaterAlpha * 0.92;

    const surfaceOffset = snapshot.surfaceHeightAtCamera - snapshot.camera.position.y - 0.45;
    this.surfaceBand.position.set(0, THREE.MathUtils.clamp(surfaceOffset, 4, 30), 0);
    this.surfaceBandMaterial.opacity = this.underwaterAlpha * 0.42;
    this.surfaceBand.scale.setScalar(1 + this.underwaterAlpha * 0.08);

    this.updateAmbientParticles(snapshot);
    this.updateStreaks(snapshot);
    this.updateShipReadability(snapshot);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.particleRoot.removeFromParent();
    this.ambientGeometry.dispose();
    this.streakGeometry.dispose();
    this.vaultMaterial.dispose();
    this.surfaceBandMaterial.dispose();
    this.ambientMaterial.dispose();
    this.streakMaterial.dispose();
    this.surfaceBand.geometry.dispose();
  }

  private createVaultGeometry(): THREE.SphereGeometry {
    const geometry = new THREE.SphereGeometry(VAULT_RADIUS, 24, 16);
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const baseLow = new THREE.Color('#021018');
    const mid = new THREE.Color('#0f2231');
    const top = new THREE.Color('#6f8fb0');
    const bandTint = new THREE.Color('#bfdfff');
    const color = new THREE.Color();

    for (let index = 0; index < positions.count; index += 1) {
      const y = positions.getY(index) / VAULT_RADIUS;
      const normalizedY = THREE.MathUtils.clamp((y + 1) * 0.5, 0, 1);
      const band = THREE.MathUtils.smoothstep(normalizedY, 0.72, 0.9) * (1 - THREE.MathUtils.smoothstep(normalizedY, 0.92, 1));

      color.copy(baseLow).lerp(mid, normalizedY * 0.75);
      color.lerp(top, Math.pow(normalizedY, 2.1));
      color.lerp(bandTint, band * 0.55);

      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  private createVaultMaterial(): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    material.fog = false;
    material.toneMapped = false;
    return material;
  }

  private seedAmbientParticles(): void {
    for (let index = 0; index < AMBIENT_COUNT; index += 1) {
      this.resetAmbientParticle(index, true);
    }
  }

  private seedStreaks(): void {
    for (let index = 0; index < STREAK_COUNT; index += 1) {
      this.resetStreak(index, true);
    }
  }

  private updateAmbientParticles(snapshot: UnderwaterReadabilitySnapshot): void {
    const speedFactor = THREE.MathUtils.clamp(snapshot.whaleSpeed / 28, 0, 1.4);
    this.ambientMaterial.opacity = this.underwaterAlpha * (0.22 + speedFactor * 0.09);
    this.ambientParticles.visible = this.ambientMaterial.opacity > 0.005;

    for (let index = 0; index < AMBIENT_COUNT; index += 1) {
      const baseIndex = index * 3;
      this.ambientPositions[baseIndex] += Math.sin(snapshot.elapsedSeconds * 0.8 + this.ambientDrift[index]) * snapshot.deltaSeconds * 0.16;
      this.ambientPositions[baseIndex + 1] += Math.cos(snapshot.elapsedSeconds * 0.6 + this.ambientDrift[index]) * snapshot.deltaSeconds * 0.08;
      this.ambientPositions[baseIndex + 2] += snapshot.deltaSeconds * (this.ambientSpeeds[index] + speedFactor * 10);

      if (
        this.ambientPositions[baseIndex + 2] > 3 ||
        Math.abs(this.ambientPositions[baseIndex]) > 22 ||
        Math.abs(this.ambientPositions[baseIndex + 1]) > 12
      ) {
        this.resetAmbientParticle(index, false);
      }
    }

    this.ambientGeometry.attributes.position.needsUpdate = true;
  }

  private updateStreaks(snapshot: UnderwaterReadabilitySnapshot): void {
    const burstAlpha = THREE.MathUtils.clamp(
      THREE.MathUtils.inverseLerp(14, 28, snapshot.whaleSpeed) + (snapshot.whaleBoostActive ? 0.4 : 0),
      0,
      1,
    );

    this.streakMaterial.opacity = this.underwaterAlpha * burstAlpha * 0.58;
    this.streaks.visible = this.streakMaterial.opacity > 0.01;

    for (let index = 0; index < STREAK_COUNT; index += 1) {
      const start = index * 6;
      const drift = index * 2;
      const speed = this.streakSpeeds[index] + snapshot.whaleSpeed * 1.2 + (snapshot.whaleBoostActive ? 22 : 0);
      const length = this.streakLengths[index] + burstAlpha * 1.8;

      this.streakPositions[start] += Math.sin(snapshot.elapsedSeconds * 0.7 + this.streakDrift[drift]) * snapshot.deltaSeconds * 0.08;
      this.streakPositions[start + 1] += Math.cos(snapshot.elapsedSeconds * 0.9 + this.streakDrift[drift + 1]) * snapshot.deltaSeconds * 0.05;
      this.streakPositions[start + 2] += speed * snapshot.deltaSeconds;

      if (this.streakPositions[start + 2] > 5) {
        this.resetStreak(index, false);
      }

      this.streakPositions[start + 3] = this.streakPositions[start];
      this.streakPositions[start + 4] = this.streakPositions[start + 1];
      this.streakPositions[start + 5] = this.streakPositions[start + 2] - length;
    }

    this.streakGeometry.attributes.position.needsUpdate = true;
  }

  private updateShipReadability(snapshot: UnderwaterReadabilitySnapshot): void {
    const shipDistance = this.shipVector
      .copy(snapshot.ship.root.position)
      .sub(snapshot.whalePosition)
      .length();
    const proximity = 1 - THREE.MathUtils.smoothstep(shipDistance, 28, 92);
    const cue = this.underwaterAlpha * proximity;
    snapshot.ship.setSubmergedReadabilityCue(cue);
  }

  private resetAmbientParticle(index: number, initialSeed: boolean): void {
    const baseIndex = index * 3;

    this.ambientPositions[baseIndex] = THREE.MathUtils.randFloatSpread(34);
    this.ambientPositions[baseIndex + 1] = THREE.MathUtils.randFloatSpread(16);
    this.ambientPositions[baseIndex + 2] = initialSeed
      ? THREE.MathUtils.randFloat(-36, 2)
      : THREE.MathUtils.randFloat(-40, -8);

    this.ambientSpeeds[index] = THREE.MathUtils.randFloat(1.8, 4.8);
    this.ambientDrift[index] = Math.random() * Math.PI * 2;
  }

  private resetStreak(index: number, initialSeed: boolean): void {
    const start = index * 6;
    const drift = index * 2;
    const x = THREE.MathUtils.randFloatSpread(14);
    const y = THREE.MathUtils.randFloatSpread(8);
    const z = initialSeed ? THREE.MathUtils.randFloat(-34, 2) : THREE.MathUtils.randFloat(-40, -10);

    this.streakPositions[start] = x;
    this.streakPositions[start + 1] = y;
    this.streakPositions[start + 2] = z;

    this.streakLengths[index] = THREE.MathUtils.randFloat(2.6, 5.8);
    this.streakSpeeds[index] = THREE.MathUtils.randFloat(9, 16);
    this.streakDrift[drift] = Math.random() * Math.PI * 2;
    this.streakDrift[drift + 1] = Math.random() * Math.PI * 2;

    this.streakPositions[start + 3] = x;
    this.streakPositions[start + 4] = y;
    this.streakPositions[start + 5] = z - this.streakLengths[index];
  }
}

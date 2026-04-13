import * as THREE from 'three';

import { Ship } from '../entities/Ship';

const VAULT_RADIUS = 84;
const BASIN_RADIUS = 220;
const AMBIENT_COUNT = 88;
const STREAK_COUNT = 18;
const BEAM_COUNT = 5;
const OCCLUDER_COUNT = 8;
const DOWN_AXIS = new THREE.Vector3(0, -1, 0);
const UNDERWATER_LOOK = {
  ambientColor: new THREE.Color('#30444a'),
  streakColor: new THREE.Color('#41565d'),
  surfaceBandColor: new THREE.Color('#35535c'),
  hullShadowCore: new THREE.Color('#01060b'),
  hullShadowPenumbra: new THREE.Color('#09131c'),
  basinCore: new THREE.Color('#031018'),
  basinEdge: new THREE.Color('#06141b'),
} as const;

const BEAM_DEFINITIONS = [
  { offset: new THREE.Vector2(-28, -18), width: 26, length: 54, opacity: 0.3, drift: 0.21 },
  { offset: new THREE.Vector2(-10, 26), width: 30, length: 60, opacity: 0.34, drift: 0.47 },
  { offset: new THREE.Vector2(14, -8), width: 28, length: 58, opacity: 0.36, drift: 0.73 },
  { offset: new THREE.Vector2(32, 16), width: 32, length: 64, opacity: 0.31, drift: 1.08 },
  { offset: new THREE.Vector2(4, -32), width: 27, length: 56, opacity: 0.28, drift: 1.41 },
] as const;

const OCEAN_UNDERSIDE_VERTEX_SHADER = `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const OCEAN_UNDERSIDE_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uUnderwaterAlpha;
uniform float uTransmissionStrength;
uniform vec3 uFocusPosition;
uniform vec3 uMoonDirection;
uniform float uArenaRadius;
uniform float uArenaFadeStart;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

float layeredWave(vec2 point, float time) {
  float primary = sin(point.x * 0.045 + time * 1.12) * 0.5 + 0.5;
  float cross = cos(point.y * 0.058 - time * 0.94) * 0.5 + 0.5;
  float chop = sin((point.x + point.y) * 0.11 + time * 1.58) * 0.5 + 0.5;
  return clamp(primary * 0.34 + cross * 0.28 + chop * 0.38, 0.0, 1.0);
}

void main() {
  float arenaDistance = length(vWorldPosition.xz);
  float arenaMask = 1.0 - smoothstep(uArenaFadeStart, uArenaRadius, arenaDistance);
  if (arenaMask <= 0.001) discard;

  vec2 focusDelta = vWorldPosition.xz - uFocusPosition.xz;
  vec2 stretchedDelta = focusDelta / vec2(176.0, 154.0);
  float centerFalloff = 1.0 - smoothstep(0.14, 1.22, length(stretchedDelta));

  vec2 moonOffset = focusDelta + uMoonDirection.xz * 44.0;
  float moonPatch = 1.0 - smoothstep(0.06, 1.32, length(moonOffset / vec2(132.0, 108.0)));

  float ripple = layeredWave(vWorldPosition.xz, uTime);
  float caustic = pow(layeredWave(vWorldPosition.zx * vec2(1.2, 0.82), uTime * 1.08 + 4.0), 1.75);
  float crest = smoothstep(-0.18, 1.12, vWorldPosition.y);
  float normalLift = clamp(dot(normalize(vWorldNormal), normalize(-uMoonDirection)), 0.0, 1.0);
  float outerShadow = smoothstep(0.84, 1.4, length(stretchedDelta));

  float lightMix =
    (0.06 +
      centerFalloff * 0.13 +
      moonPatch * 0.07 +
      ripple * 0.04 +
      caustic * 0.11 +
      crest * 0.05 +
      normalLift * 0.04) *
    uTransmissionStrength *
    uUnderwaterAlpha;

  vec3 baseColor = mix(vec3(0.006, 0.018, 0.028), vec3(0.014, 0.048, 0.064), centerFalloff * 0.24 + moonPatch * 0.06);
  vec3 litColor = mix(vec3(0.08, 0.14, 0.18), vec3(0.22, 0.3, 0.34), caustic * 0.26 + moonPatch * 0.06);
  vec3 color = mix(baseColor, litColor, smoothstep(0.0, 0.92, lightMix));
  color *= 1.0 - outerShadow * 0.32;
  color *= arenaMask;

  gl_FragColor = vec4(color, 1.0);
}
`;

const BEAM_VERTEX_SHADER = `
varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const BEAM_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uAlpha;
uniform float uSeed;

varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  float lateral = abs(vUv.x - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.0, 1.0, lateral);
  float depthFade = 1.0 - smoothstep(0.04, 1.0, vUv.y);
  float breakup =
    0.72 +
    0.12 * sin(vWorldPosition.x * 0.09 + uTime * 1.0 + uSeed * 11.0) +
    0.1 * cos(vWorldPosition.z * 0.08 - uTime * 0.82 + uSeed * 17.0);
  float flutter = 0.84 + 0.16 * sin(vUv.y * 8.0 + uTime * 1.4 + uSeed * 23.0);
  float beam = pow(core, 1.18) * pow(depthFade, 0.72) * breakup * flutter;

  vec3 color = mix(vec3(0.05, 0.11, 0.14), vec3(0.18, 0.26, 0.29), clamp(beam * 0.9, 0.0, 1.0));
  gl_FragColor = vec4(color, max(0.0, beam) * uAlpha);
}
`;

interface BeamSlot {
  readonly root: THREE.Group;
  readonly planeA: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly planeB: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly materialA: THREE.ShaderMaterial;
  readonly materialB: THREE.ShaderMaterial;
  readonly offset: THREE.Vector2;
  readonly width: number;
  readonly length: number;
  readonly opacity: number;
  readonly drift: number;
}

interface HullOccluderSlot {
  readonly root: THREE.Group;
  readonly core: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly penumbra: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
}

export interface UnderwaterReadabilitySnapshot {
  deltaSeconds: number;
  elapsedSeconds: number;
  approxWaterDepth: number;
  camera: THREE.PerspectiveCamera;
  whalePosition: THREE.Vector3;
  whaleSpeed: number;
  whaleBoostActive: boolean;
  underwaterRatio: number;
  submerged: boolean;
  surfaceHeightAtCamera: number;
  sampleSurfaceHeight: (x: number, z: number) => number;
  moonDirection: THREE.Vector3;
  oceanUndersideMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  ships: readonly Ship[];
}

export function createOceanUndersideMaterial(arenaRadius: number): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uUnderwaterAlpha: { value: 0 },
      uTransmissionStrength: { value: 1 },
      uFocusPosition: { value: new THREE.Vector3() },
      uMoonDirection: { value: new THREE.Vector3(0.35, -0.9, 0.15).normalize() },
      uArenaRadius: { value: arenaRadius },
      uArenaFadeStart: { value: arenaRadius * 0.9 },
    },
    vertexShader: OCEAN_UNDERSIDE_VERTEX_SHADER,
    fragmentShader: OCEAN_UNDERSIDE_FRAGMENT_SHADER,
    side: THREE.BackSide,
    transparent: false,
    depthWrite: true,
  });

  material.fog = false;
  material.toneMapped = false;
  return material;
}

export class UnderwaterReadabilityFX {
  private readonly root = new THREE.Group();
  private readonly particleRoot = new THREE.Group();
  private readonly surfaceOverlayRoot = new THREE.Group();
  private readonly beamSlots: BeamSlot[] = [];
  private readonly hullOccluderSlots: HullOccluderSlot[] = [];
  private readonly beamPlaneGeometry = new THREE.PlaneGeometry(1, 1, 1, 20);
  private readonly hullOccluderGeometry = this.createHullOccluderGeometry();
  private readonly shipVector = new THREE.Vector3();
  private readonly shadowScale = new THREE.Vector2();
  private readonly ceilingFocusTarget = new THREE.Vector3();
  private readonly ceilingFocus = new THREE.Vector3();
  private readonly beamAnchor = new THREE.Vector3();
  private readonly beamDirection = new THREE.Vector3(0.3, -0.94, 0.14);
  private readonly beamQuaternion = new THREE.Quaternion();
  private readonly ambientGeometry = new THREE.BufferGeometry();
  private readonly ambientMaterial = new THREE.PointsMaterial({
    color: UNDERWATER_LOOK.ambientColor,
    size: 0.2,
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
    color: UNDERWATER_LOOK.streakColor,
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
  private readonly beamAlpha = new Float32Array(BEAM_COUNT);
  private readonly occluderStrength = new Float32Array(OCCLUDER_COUNT);
  private readonly vaultMaterial: THREE.MeshBasicMaterial;
  private readonly surfaceBandMaterial: THREE.MeshBasicMaterial;
  private readonly surfaceBand: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly basinFloorMaterial: THREE.MeshBasicMaterial;
  private readonly basinFloor: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private underwaterAlpha = 0;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (!camera.parent) {
      scene.add(camera);
    }

    this.root.renderOrder = -10;
    this.particleRoot.renderOrder = 10;
    this.surfaceOverlayRoot.renderOrder = -3;

    this.beamPlaneGeometry.translate(0, -0.5, 0);

    this.vaultMaterial = this.createVaultMaterial();
    const vault = new THREE.Mesh(this.createVaultGeometry(), this.vaultMaterial);
    vault.frustumCulled = false;

    this.surfaceBandMaterial = new THREE.MeshBasicMaterial({
      color: UNDERWATER_LOOK.surfaceBandColor,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.surfaceBandMaterial.toneMapped = false;

    this.surfaceBand = new THREE.Mesh(
      new THREE.RingGeometry(14, 34, 48, 1),
      this.surfaceBandMaterial,
    );
    this.surfaceBand.rotation.x = -Math.PI / 2;
    this.surfaceBand.frustumCulled = false;

    this.basinFloorMaterial = this.createBasinFloorMaterial();
    this.basinFloor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), this.basinFloorMaterial);
    this.basinFloor.rotation.x = -Math.PI / 2;
    this.basinFloor.scale.setScalar(BASIN_RADIUS);
    this.basinFloor.frustumCulled = false;
    this.basinFloor.renderOrder = -6;

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

    this.createBeamSlots();
    this.createHullOccluderSlots();

    this.root.add(vault, this.basinFloor, this.surfaceBand);
    this.particleRoot.add(this.ambientParticles, this.streaks);
    scene.add(this.root, this.surfaceOverlayRoot);
    camera.add(this.particleRoot);
  }

  update(snapshot: UnderwaterReadabilitySnapshot): void {
    const targetAlpha = snapshot.submerged ? THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.08, 0.82) : 0;
    this.underwaterAlpha = THREE.MathUtils.damp(this.underwaterAlpha, targetAlpha, 2.4, snapshot.deltaSeconds);

    this.root.position.copy(snapshot.camera.position);
    this.vaultMaterial.opacity = this.underwaterAlpha * 0.94;
    this.basinFloor.position.set(0, snapshot.surfaceHeightAtCamera - snapshot.camera.position.y - snapshot.approxWaterDepth, 0);
    this.basinFloorMaterial.opacity = this.underwaterAlpha * THREE.MathUtils.lerp(0.16, 0.3, snapshot.underwaterRatio);
    this.basinFloor.visible = this.basinFloorMaterial.opacity > 0.01;
    this.surfaceOverlayRoot.visible = this.underwaterAlpha > 0.01;

    const surfaceOffset = snapshot.surfaceHeightAtCamera - snapshot.camera.position.y - 0.45;
    this.surfaceBand.position.set(0, THREE.MathUtils.clamp(surfaceOffset, 4, 26), 0);
    this.surfaceBandMaterial.opacity =
      this.underwaterAlpha * 0.014 * (0.92 + Math.sin(snapshot.elapsedSeconds * 1.2) * 0.08);
    this.surfaceBand.scale.set(1 + this.underwaterAlpha * 0.04, 1 + this.underwaterAlpha * 0.02, 1);

    this.ceilingFocusTarget.copy(snapshot.whalePosition).lerp(snapshot.camera.position, 0.18);
    this.ceilingFocusTarget.y = snapshot.surfaceHeightAtCamera;
    this.ceilingFocus.lerp(this.ceilingFocusTarget, 1 - Math.exp(-snapshot.deltaSeconds * 1.35));

    this.updateUndersideMaterial(snapshot);
    this.updateBeamVolumes(snapshot);
    this.updateHullOccluders(snapshot);
    this.updateAmbientParticles(snapshot);
    this.updateStreaks(snapshot);
    this.updateShipReadability(snapshot);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.particleRoot.removeFromParent();
    this.surfaceOverlayRoot.removeFromParent();
    this.ambientGeometry.dispose();
    this.streakGeometry.dispose();
    this.beamPlaneGeometry.dispose();
    this.hullOccluderGeometry.dispose();
    this.vaultMaterial.dispose();
    this.basinFloorMaterial.dispose();
    this.surfaceBandMaterial.dispose();
    this.ambientMaterial.dispose();
    this.streakMaterial.dispose();
    this.basinFloor.geometry.dispose();
    this.surfaceBand.geometry.dispose();

    for (const beam of this.beamSlots) {
      beam.materialA.dispose();
      beam.materialB.dispose();
    }

    for (const occluder of this.hullOccluderSlots) {
      occluder.core.material.dispose();
      occluder.penumbra.material.dispose();
    }
  }

  private createVaultGeometry(): THREE.SphereGeometry {
    const geometry = new THREE.SphereGeometry(VAULT_RADIUS, 24, 16);
    const positions = geometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const baseLow = new THREE.Color('#00060b');
    const mid = new THREE.Color('#07131b');
    const top = new THREE.Color('#17323a');
    const bandTint = new THREE.Color('#5e7a80');
    const moonBreak = new THREE.Color('#9fb5b7');
    const color = new THREE.Color();

    for (let index = 0; index < positions.count; index += 1) {
      const y = positions.getY(index) / VAULT_RADIUS;
      const normalizedY = THREE.MathUtils.clamp((y + 1) * 0.5, 0, 1);
      const band = THREE.MathUtils.smoothstep(normalizedY, 0.7, 0.9) * (1 - THREE.MathUtils.smoothstep(normalizedY, 0.94, 1));
      const moonBand = THREE.MathUtils.smoothstep(normalizedY, 0.8, 1);

      color.copy(baseLow).lerp(mid, normalizedY * 0.58);
      color.lerp(top, Math.pow(normalizedY, 1.9) * 0.56);
      color.lerp(bandTint, band * 0.26);
      color.lerp(moonBreak, moonBand * 0.05);

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

  private createBasinFloorMaterial(): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: UNDERWATER_LOOK.basinCore,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: 0,
      fog: true,
    });
    material.toneMapped = false;
    return material;
  }

  private createBeamSlots(): void {
    for (let index = 0; index < BEAM_COUNT; index += 1) {
      const definition = BEAM_DEFINITIONS[index];
      const materialA = this.createBeamMaterial(index * 2 + 1);
      const materialB = this.createBeamMaterial(index * 2 + 2);
      const planeA = new THREE.Mesh(this.beamPlaneGeometry, materialA);
      const planeB = new THREE.Mesh(this.beamPlaneGeometry, materialB);

      planeA.frustumCulled = false;
      planeB.frustumCulled = false;
      planeB.rotation.y = Math.PI * 0.5;

      const root = new THREE.Group();
      root.visible = false;
      root.add(planeA, planeB);

      this.beamSlots.push({
        root,
        planeA,
        planeB,
        materialA,
        materialB,
        offset: definition.offset.clone(),
        width: definition.width,
        length: definition.length,
        opacity: definition.opacity,
        drift: definition.drift,
      });
      this.surfaceOverlayRoot.add(root);
    }
  }

  private createHullOccluderSlots(): void {
    for (let index = 0; index < OCCLUDER_COUNT; index += 1) {
      const core = new THREE.Mesh(
        this.hullOccluderGeometry,
        new THREE.MeshBasicMaterial({
          color: UNDERWATER_LOOK.hullShadowCore,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.NormalBlending,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      core.material.toneMapped = false;
      core.renderOrder = 1;

      const penumbra = new THREE.Mesh(
        this.hullOccluderGeometry,
        new THREE.MeshBasicMaterial({
          color: UNDERWATER_LOOK.hullShadowPenumbra,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.NormalBlending,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        }),
      );
      penumbra.material.toneMapped = false;
      penumbra.scale.set(1.24, 1, 1.14);
      penumbra.renderOrder = 0;

      const root = new THREE.Group();
      root.visible = false;
      root.add(penumbra, core);

      this.hullOccluderSlots.push({ root, core, penumbra });
      this.surfaceOverlayRoot.add(root);
    }
  }

  private createHullOccluderGeometry(): THREE.ShapeGeometry {
    const radius = 0.34;
    const halfLength = 0.92;
    const shape = new THREE.Shape();

    shape.moveTo(radius, -halfLength);
    shape.lineTo(radius, halfLength);
    shape.absarc(0, halfLength, radius, 0, Math.PI, false);
    shape.lineTo(-radius, -halfLength);
    shape.absarc(0, -halfLength, radius, Math.PI, Math.PI * 2, false);

    const geometry = new THREE.ShapeGeometry(shape, 24);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  private createBeamMaterial(seed: number): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uSeed: { value: seed * 0.173 },
      },
      vertexShader: BEAM_VERTEX_SHADER,
      fragmentShader: BEAM_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
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

  private updateUndersideMaterial(snapshot: UnderwaterReadabilitySnapshot): void {
    const uniforms = snapshot.oceanUndersideMesh.material.uniforms;
    this.beamDirection.copy(snapshot.moonDirection).normalize();

    uniforms.uTime.value = snapshot.elapsedSeconds;
    uniforms.uUnderwaterAlpha.value = this.underwaterAlpha;
    uniforms.uTransmissionStrength.value = THREE.MathUtils.lerp(0.48, 0.66, snapshot.underwaterRatio);
    uniforms.uFocusPosition.value.copy(this.ceilingFocus);
    uniforms.uMoonDirection.value.copy(this.beamDirection);
  }

  private updateBeamVolumes(snapshot: UnderwaterReadabilitySnapshot): void {
    this.beamDirection.copy(snapshot.moonDirection).normalize();

    if (this.beamDirection.lengthSq() < 0.001) {
      this.beamDirection.set(0.3, -0.94, 0.14);
    }

    this.beamQuaternion.setFromUnitVectors(DOWN_AXIS, this.beamDirection);

    for (let index = 0; index < this.beamSlots.length; index += 1) {
      const slot = this.beamSlots[index];
      const swayX = Math.sin(snapshot.elapsedSeconds * 0.065 + slot.drift * 6.4) * 4.2;
      const swayZ = Math.cos(snapshot.elapsedSeconds * 0.078 + slot.drift * 4.8) * 3.4;
      const targetX = this.ceilingFocus.x + slot.offset.x + swayX;
      const targetZ = this.ceilingFocus.z + slot.offset.y + swayZ;
      const surfaceHeight = snapshot.sampleSurfaceHeight(targetX, targetZ);
      const horizontalDistance = Math.hypot(targetX - snapshot.whalePosition.x, targetZ - snapshot.whalePosition.z);
      const distanceFade = 1 - THREE.MathUtils.smoothstep(horizontalDistance, 10, 82);
      const targetBeamAlpha =
        this.underwaterAlpha *
        THREE.MathUtils.lerp(0.12, 0.28, snapshot.underwaterRatio) *
        distanceFade *
        slot.opacity *
        0.08;

      this.beamAlpha[index] = THREE.MathUtils.damp(this.beamAlpha[index], targetBeamAlpha, 2.1, snapshot.deltaSeconds);
      const beamAlpha = this.beamAlpha[index];

      slot.root.visible = beamAlpha > 0.008;
      this.beamAnchor.set(targetX, surfaceHeight - 0.12, targetZ);
      slot.root.position.lerp(this.beamAnchor, 1 - Math.exp(-snapshot.deltaSeconds * 1.1));
      slot.root.quaternion.slerp(this.beamQuaternion, 1 - Math.exp(-snapshot.deltaSeconds * 1.5));

      const lengthScale = THREE.MathUtils.lerp(0.82, 1.04, snapshot.underwaterRatio);
      slot.planeA.scale.set(slot.width, slot.length * lengthScale, 1);
      slot.planeB.scale.set(slot.width * 0.82, slot.length * lengthScale * 1.06, 1);

      slot.materialA.uniforms.uTime.value = snapshot.elapsedSeconds;
      slot.materialA.uniforms.uAlpha.value = beamAlpha;
      slot.materialB.uniforms.uTime.value = snapshot.elapsedSeconds * 1.07;
      slot.materialB.uniforms.uAlpha.value = beamAlpha * 0.92;
    }
  }

  private updateHullOccluders(snapshot: UnderwaterReadabilitySnapshot): void {
    let visibleOccluders = 0;

    for (const ship of snapshot.ships) {
      if (visibleOccluders >= this.hullOccluderSlots.length) {
        break;
      }

      if (ship.sinking || ship.sunk) {
        continue;
      }

      const shipDistance = this.shipVector.copy(ship.root.position).sub(snapshot.whalePosition).length();
      const proximity = 1 - THREE.MathUtils.smoothstep(shipDistance, 14, 122);
      const strength = this.underwaterAlpha * proximity * 1.08;

      if (strength <= 0.02) {
        continue;
      }

      const occluder = this.hullOccluderSlots[visibleOccluders];
      const surfaceHeight = snapshot.sampleSurfaceHeight(ship.root.position.x, ship.root.position.z);

      occluder.root.visible = true;
      occluder.root.position.set(ship.root.position.x, surfaceHeight - 0.14, ship.root.position.z);
      occluder.root.rotation.set(0, ship.heading, 0);

      this.shadowScale.copy(ship.surfaceShadowScale);
      occluder.root.scale.set(this.shadowScale.x, 1, this.shadowScale.y);
      this.occluderStrength[visibleOccluders] = THREE.MathUtils.damp(
        this.occluderStrength[visibleOccluders],
        strength,
        3,
        snapshot.deltaSeconds,
      );
      occluder.core.material.opacity = this.occluderStrength[visibleOccluders] * 0.5;
      occluder.penumbra.material.opacity = this.occluderStrength[visibleOccluders] * 0.18;

      visibleOccluders += 1;
    }

    for (let index = visibleOccluders; index < this.hullOccluderSlots.length; index += 1) {
      const occluder = this.hullOccluderSlots[index];
      this.occluderStrength[index] = THREE.MathUtils.damp(this.occluderStrength[index], 0, 4, snapshot.deltaSeconds);
      occluder.root.visible = false;
      occluder.core.material.opacity = 0;
      occluder.penumbra.material.opacity = 0;
    }
  }

  private updateAmbientParticles(snapshot: UnderwaterReadabilitySnapshot): void {
    const speedFactor = THREE.MathUtils.clamp(snapshot.whaleSpeed / 28, 0, 1.4);
    this.ambientMaterial.opacity = this.underwaterAlpha * (0.07 + speedFactor * 0.03);
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

    this.streakMaterial.opacity = this.underwaterAlpha * burstAlpha * 0.22;
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
    for (const ship of snapshot.ships) {
      const shipDistance = this.shipVector.copy(ship.root.position).sub(snapshot.whalePosition).length();
      const proximity = 1 - THREE.MathUtils.smoothstep(shipDistance, 22, 94);
      const cue = ship.sinking ? 0 : this.underwaterAlpha * proximity * 0.18;
      ship.setSubmergedReadabilityCue(cue);
    }
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

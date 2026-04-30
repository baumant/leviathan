import * as THREE from 'three';

import { Ship } from '../entities/Ship';

const AMBIENT_COUNT = 88;
const STREAK_COUNT = 18;
const BEAM_COUNT = 5;
const MAX_UNDERSIDE_REVEAL_WINDOWS = 8;
const DORMANT_ALPHA = 0.005;
const DOWN_AXIS = new THREE.Vector3(0, -1, 0);
const UNDERWATER_LOOK = {
  ambientColor: new THREE.Color('#30444a'),
  streakColor: new THREE.Color('#41565d'),
  surfaceBandColor: new THREE.Color('#426878'),
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
uniform vec4 uRevealWindows[${MAX_UNDERSIDE_REVEAL_WINDOWS}];
uniform float uRevealStrengths[${MAX_UNDERSIDE_REVEAL_WINDOWS}];

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

float layeredWave(vec2 point, float time) {
  float primary = sin(point.x * 0.045 + time * 1.12) * 0.5 + 0.5;
  float cross = cos(point.y * 0.058 - time * 0.94) * 0.5 + 0.5;
  float chop = sin((point.x + point.y) * 0.11 + time * 1.58) * 0.5 + 0.5;
  return clamp(primary * 0.34 + cross * 0.28 + chop * 0.38, 0.0, 1.0);
}

float revealWindowMask(vec2 point, vec2 halfSize) {
  vec2 safeHalfSize = max(halfSize, vec2(0.001));
  vec2 scaled = point / safeHalfSize;
  float radial = dot(scaled, scaled);
  return 1.0 - smoothstep(0.54, 1.26, radial);
}

float undersideRevealWindow(vec2 waterPoint) {
  float revealStrength = 0.0;

  for (int index = 0; index < ${MAX_UNDERSIDE_REVEAL_WINDOWS}; index++) {
    vec4 bounds = uRevealWindows[index];
    float strength = uRevealStrengths[index];

    if (strength <= 0.001 || bounds.z <= 0.0 || bounds.w <= 0.0) {
      continue;
    }

    vec2 delta = waterPoint - bounds.xy;
    float mask = revealWindowMask(delta, bounds.zw);
    revealStrength = max(revealStrength, mask * strength);
  }

  return clamp(revealStrength, 0.0, 1.0);
}

void main() {
  float arenaDistance = length(vWorldPosition.xz);
  float arenaMist = smoothstep(uArenaFadeStart, uArenaRadius, arenaDistance);

  vec2 focusDelta = vWorldPosition.xz - uFocusPosition.xz;
  vec2 stretchedDelta = focusDelta / vec2(176.0, 154.0);
  float centerFalloff = 1.0 - smoothstep(0.14, 1.22, length(stretchedDelta));

  vec2 moonOffset = focusDelta + uMoonDirection.xz * 44.0;
  float moonPatch = 1.0 - smoothstep(0.06, 1.32, length(moonOffset / vec2(132.0, 108.0)));
  float revealMask = undersideRevealWindow(vWorldPosition.xz);

  float ripple = layeredWave(vWorldPosition.xz, uTime);
  float caustic = pow(layeredWave(vWorldPosition.zx * vec2(1.2, 0.82), uTime * 1.08 + 4.0), 1.75);
  float crest = smoothstep(-0.18, 1.12, vWorldPosition.y);
  float normalLift = clamp(dot(normalize(vWorldNormal), normalize(-uMoonDirection)), 0.0, 1.0);
  float outerShadow = smoothstep(0.84, 1.4, length(stretchedDelta));

  float lightMix =
    (0.08 +
      centerFalloff * 0.13 +
      moonPatch * 0.07 +
      ripple * 0.04 +
      caustic * 0.11 +
      crest * 0.06 +
      normalLift * 0.04) *
    uTransmissionStrength *
    uUnderwaterAlpha;

  vec3 baseColor = mix(vec3(0.002, 0.014, 0.056), vec3(0.008, 0.034, 0.104), centerFalloff * 0.24 + moonPatch * 0.06);
  vec3 litColor = mix(vec3(0.036, 0.07, 0.132), vec3(0.078, 0.132, 0.212), caustic * 0.22 + moonPatch * 0.04);
  vec3 color = mix(baseColor, litColor, smoothstep(0.0, 0.92, lightMix));
  vec3 revealColor = mix(vec3(0.062, 0.12, 0.19), vec3(0.128, 0.214, 0.314), moonPatch * 0.16 + centerFalloff * 0.2);
  color = mix(color, max(color, revealColor), revealMask * uUnderwaterAlpha * 0.62);
  color *= 1.0 - outerShadow * 0.56;
  color = mix(color, vec3(0.002, 0.01, 0.062), arenaMist * 0.82);

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

export interface UnderwaterReadabilitySnapshot {
  deltaSeconds: number;
  elapsedSeconds: number;
  camera: THREE.PerspectiveCamera;
  cameraUnderwater: boolean;
  whalePosition: THREE.Vector3;
  whaleSpeed: number;
  underwaterRatio: number;
  surfaceHeightAtCamera: number;
  floorHeightAtCamera: number;
  sampleSurfaceHeight: (x: number, z: number) => number;
  sampleFloorHeight: (x: number, z: number) => number;
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
      uArenaRadius: { value: arenaRadius * 1.55 },
      uArenaFadeStart: { value: arenaRadius * 0.86 },
      uRevealWindows: {
        value: Array.from({ length: MAX_UNDERSIDE_REVEAL_WINDOWS }, () => new THREE.Vector4()),
      },
      uRevealStrengths: {
        value: Array.from({ length: MAX_UNDERSIDE_REVEAL_WINDOWS }, () => 0),
      },
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
  private readonly beamPlaneGeometry = new THREE.PlaneGeometry(1, 1, 1, 20);
  private readonly shipVector = new THREE.Vector3();
  private readonly shipRevealPoint = new THREE.Vector3();
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
  private readonly revealSlotDistances = new Float32Array(MAX_UNDERSIDE_REVEAL_WINDOWS);
  private readonly surfaceBandMaterial: THREE.MeshBasicMaterial;
  private readonly surfaceBand: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private underwaterAlpha = 0;
  private readabilityActive = false;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (!camera.parent) {
      scene.add(camera);
    }

    this.root.renderOrder = -10;
    this.root.visible = false;
    this.particleRoot.renderOrder = 10;
    this.surfaceOverlayRoot.renderOrder = -3;
    this.surfaceOverlayRoot.visible = false;

    this.beamPlaneGeometry.translate(0, -0.5, 0);

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

    this.root.add(this.surfaceBand);
    this.particleRoot.add(this.ambientParticles, this.streaks);
    scene.add(this.root, this.surfaceOverlayRoot);
    camera.add(this.particleRoot);
  }

  reset(): void {
    this.underwaterAlpha = 0;
    this.readabilityActive = false;
    this.root.visible = false;
    this.surfaceOverlayRoot.visible = false;
    this.surfaceBandMaterial.opacity = 0;
    this.ambientMaterial.opacity = 0;
    this.streakMaterial.opacity = 0;
    this.ambientParticles.visible = false;
    this.streaks.visible = false;
    this.beamAlpha.fill(0);

    for (const beam of this.beamSlots) {
      beam.root.visible = false;
      beam.materialA.uniforms.uAlpha.value = 0;
      beam.materialB.uniforms.uAlpha.value = 0;
    }
  }

  update(snapshot: UnderwaterReadabilitySnapshot): void {
    const targetAlpha = snapshot.cameraUnderwater
      ? THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.08, 0.82)
      : 0;
    this.underwaterAlpha = THREE.MathUtils.damp(this.underwaterAlpha, targetAlpha, 2.4, snapshot.deltaSeconds);

    if (this.underwaterAlpha <= DORMANT_ALPHA) {
      if (this.readabilityActive) {
        this.deactivateVisibleState(snapshot);
      }

      return;
    }

    this.readabilityActive = true;
    this.root.position.copy(snapshot.camera.position);
    this.root.visible = true;
    this.surfaceOverlayRoot.visible = true;

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
    this.updateAmbientParticles(snapshot);
    this.updateStreaks(snapshot);
    this.updateShipReadability(snapshot);
  }

  private deactivateVisibleState(snapshot: UnderwaterReadabilitySnapshot): void {
    this.readabilityActive = false;
    this.root.visible = false;
    this.surfaceOverlayRoot.visible = false;
    this.surfaceBandMaterial.opacity = 0;
    this.ambientMaterial.opacity = 0;
    this.streakMaterial.opacity = 0;
    this.ambientParticles.visible = false;
    this.streaks.visible = false;
    this.beamAlpha.fill(0);
    snapshot.oceanUndersideMesh.material.uniforms.uUnderwaterAlpha.value = 0;

    for (const beam of this.beamSlots) {
      beam.root.visible = false;
      beam.materialA.uniforms.uAlpha.value = 0;
      beam.materialB.uniforms.uAlpha.value = 0;
    }

    for (const ship of snapshot.ships) {
      ship.setSubmergedReadabilityCue(0);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.particleRoot.removeFromParent();
    this.surfaceOverlayRoot.removeFromParent();
    this.ambientGeometry.dispose();
    this.streakGeometry.dispose();
    this.beamPlaneGeometry.dispose();
    this.surfaceBandMaterial.dispose();
    this.ambientMaterial.dispose();
    this.streakMaterial.dispose();
    this.surfaceBand.geometry.dispose();

    for (const beam of this.beamSlots) {
      beam.materialA.dispose();
      beam.materialB.dispose();
    }
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
    const localWaterColumnDepth = THREE.MathUtils.clamp(
      snapshot.surfaceHeightAtCamera - snapshot.floorHeightAtCamera,
      18,
      86,
    );
    const depthBoost = THREE.MathUtils.lerp(
      0.92,
      1.06,
      THREE.MathUtils.inverseLerp(24, 72, localWaterColumnDepth),
    );

    uniforms.uTime.value = snapshot.elapsedSeconds;
    uniforms.uUnderwaterAlpha.value = this.underwaterAlpha;
    uniforms.uTransmissionStrength.value =
      THREE.MathUtils.lerp(0.46, 0.68, snapshot.underwaterRatio) * depthBoost;
    uniforms.uFocusPosition.value.copy(this.ceilingFocus);
    uniforms.uMoonDirection.value.copy(this.beamDirection);

    const revealWindows = uniforms.uRevealWindows.value as THREE.Vector4[];
    const revealStrengths = uniforms.uRevealStrengths.value as number[];

    for (let index = 0; index < MAX_UNDERSIDE_REVEAL_WINDOWS; index += 1) {
      revealWindows[index].set(0, 0, 0, 0);
      revealStrengths[index] = 0;
    }

    this.revealSlotDistances.fill(Number.POSITIVE_INFINITY);

    for (const ship of snapshot.ships) {
      if (ship.sunk) {
        continue;
      }

      ship.getSubsurfaceRevealPoint(this.shipRevealPoint);
      const distanceSq = snapshot.camera.position.distanceToSquared(this.shipRevealPoint);
      const distanceFade = 1 - THREE.MathUtils.smoothstep(Math.sqrt(distanceSq), 18, 112);

      if (distanceFade <= 0.01) {
        continue;
      }

      const surfaceHeight = snapshot.sampleSurfaceHeight(this.shipRevealPoint.x, this.shipRevealPoint.z);
      const depthBelowSurface = surfaceHeight - this.shipRevealPoint.y;
      const shallowFade = 1 - THREE.MathUtils.smoothstep(depthBelowSurface, 1.8, 9.5);
      const strength = distanceFade * shallowFade * (ship.isCapitalShip ? 0.88 : 0.68);

      if (strength <= 0.01) {
        continue;
      }

      let insertIndex = -1;
      for (let index = 0; index < MAX_UNDERSIDE_REVEAL_WINDOWS; index += 1) {
        if (distanceSq < this.revealSlotDistances[index]) {
          insertIndex = index;
          break;
        }
      }

      if (insertIndex < 0) {
        continue;
      }

      for (let index = MAX_UNDERSIDE_REVEAL_WINDOWS - 1; index > insertIndex; index -= 1) {
        this.revealSlotDistances[index] = this.revealSlotDistances[index - 1];
        revealWindows[index].copy(revealWindows[index - 1]);
        revealStrengths[index] = revealStrengths[index - 1];
      }

      this.revealSlotDistances[insertIndex] = distanceSq;
      revealWindows[insertIndex].set(
        this.shipRevealPoint.x,
        this.shipRevealPoint.z,
        ship.subsurfaceRevealHalfExtents.x * (ship.isCapitalShip ? 1.18 : 1.26),
        ship.subsurfaceRevealHalfExtents.y * (ship.isCapitalShip ? 1.1 : 1.18),
      );
      revealStrengths[insertIndex] = strength;
    }
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
      const floorHeight = snapshot.sampleFloorHeight(targetX, targetZ);
      const waterColumnDepth = THREE.MathUtils.clamp(surfaceHeight - floorHeight, 18, 88);
      const horizontalDistance = Math.hypot(targetX - snapshot.whalePosition.x, targetZ - snapshot.whalePosition.z);
      const distanceFade = 1 - THREE.MathUtils.smoothstep(horizontalDistance, 10, 82);
      const depthFade = THREE.MathUtils.lerp(
        0.78,
        1.04,
        THREE.MathUtils.inverseLerp(22, 72, waterColumnDepth),
      );
      const targetBeamAlpha =
        this.underwaterAlpha *
        THREE.MathUtils.lerp(0.12, 0.28, snapshot.underwaterRatio) *
        distanceFade *
        depthFade *
        slot.opacity *
        0.05;

      this.beamAlpha[index] = THREE.MathUtils.damp(this.beamAlpha[index], targetBeamAlpha, 2.1, snapshot.deltaSeconds);
      const beamAlpha = this.beamAlpha[index];

      slot.root.visible = beamAlpha > 0.008;
      this.beamAnchor.set(targetX, surfaceHeight - 0.12, targetZ);
      slot.root.position.lerp(this.beamAnchor, 1 - Math.exp(-snapshot.deltaSeconds * 1.1));
      slot.root.quaternion.slerp(this.beamQuaternion, 1 - Math.exp(-snapshot.deltaSeconds * 1.5));

      const lengthScale = THREE.MathUtils.clamp(
        THREE.MathUtils.lerp(0.72, 1.12, THREE.MathUtils.inverseLerp(20, 80, waterColumnDepth)),
        0.72,
        1.16,
      );
      slot.planeA.scale.set(slot.width, slot.length * lengthScale, 1);
      slot.planeB.scale.set(slot.width * 0.82, slot.length * lengthScale * 1.06, 1);

      slot.materialA.uniforms.uTime.value = snapshot.elapsedSeconds;
      slot.materialA.uniforms.uAlpha.value = beamAlpha;
      slot.materialB.uniforms.uTime.value = snapshot.elapsedSeconds * 1.07;
      slot.materialB.uniforms.uAlpha.value = beamAlpha * 0.92;
    }
  }

  private updateAmbientParticles(snapshot: UnderwaterReadabilitySnapshot): void {
    const speedFactor = THREE.MathUtils.clamp(snapshot.whaleSpeed / 28, 0, 1.4);
    const floorSupport = THREE.MathUtils.smoothstep(
      snapshot.camera.position.y - snapshot.floorHeightAtCamera,
      -8,
      14,
    );

    this.ambientMaterial.opacity = this.underwaterAlpha * floorSupport * (0.06 + speedFactor * 0.03);
    this.ambientParticles.visible = this.ambientMaterial.opacity > 0.005;

    if (!this.ambientParticles.visible) {
      return;
    }

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
    const burstAlpha = THREE.MathUtils.clamp(THREE.MathUtils.inverseLerp(14, 28, snapshot.whaleSpeed), 0, 1);
    const floorSupport = THREE.MathUtils.smoothstep(
      snapshot.camera.position.y - snapshot.floorHeightAtCamera,
      -8,
      16,
    );

    this.streakMaterial.opacity = this.underwaterAlpha * floorSupport * burstAlpha * 0.22;
    this.streaks.visible = this.streakMaterial.opacity > 0.01;

    if (!this.streaks.visible) {
      return;
    }

    for (let index = 0; index < STREAK_COUNT; index += 1) {
      const start = index * 6;
      const drift = index * 2;
      const speed = this.streakSpeeds[index] + snapshot.whaleSpeed * 1.2;
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

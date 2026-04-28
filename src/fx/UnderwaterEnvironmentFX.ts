import * as THREE from 'three';

import {
  UnderwaterEnvironmentLayout,
  UnderwaterFishSchoolAnchor,
  UnderwaterKelpClusterLayout,
  UnderwaterRockClusterLayout,
  UnderwaterShaftAnchor,
} from './underwaterRockLayout';

const FLOOR_SIZE = 720;
const FLOOR_SEGMENTS = 112;
const WORLD_PARTICLE_COUNT = 180;
const ENVIRONMENT_EDGE_FADE_START_RATIO = 0.55;
const ENVIRONMENT_EDGE_FADE_END_RATIO = 1.72;
const FLOOR_FADE_NEAR = 8;
const FLOOR_FADE_FAR = 104;
const FLOOR_MIN_VISIBILITY = 0.98;
const ROCK_FLOOR_CLIP_RISE = 0.08;
const TAU = Math.PI * 2;
const DOWN_AXIS = new THREE.Vector3(0, -1, 0);
const UP_AXIS = new THREE.Vector3(0, 1, 0);

const SEAFLOOR_VERTEX_SHADER = `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vViewDepth;

#include <fog_pars_vertex>

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  vec4 mvPosition = viewMatrix * worldPosition;
  vViewDepth = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;

  #include <fog_vertex>
}
`;

const SEAFLOOR_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uUnderwaterAlpha;
uniform float uCameraFloorFade;
uniform float uArenaRadius;
uniform float uArenaFadeStart;
uniform vec3 uWhaleFloorPosition;
uniform float uWhaleFloorStrength;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vViewDepth;

#include <fog_pars_fragment>

float layeredPattern(vec2 point, float time) {
  float wide = sin(point.x * 0.024 + point.y * 0.014 + time * 0.03) * 0.5 + 0.5;
  float cross = cos(point.x * -0.018 + point.y * 0.022 - time * 0.02) * 0.5 + 0.5;
  float fine = sin((point.x + point.y) * 0.041 + 1.7) * 0.5 + 0.5;
  return clamp(wide * 0.42 + cross * 0.34 + fine * 0.24, 0.0, 1.0);
}

float sandBands(vec2 point) {
  float primary = sin(point.x * 0.082 + point.y * 0.024 + sin(point.y * 0.02) * 1.8) * 0.5 + 0.5;
  float cross = cos(point.x * -0.048 + point.y * 0.034 - 0.8) * 0.5 + 0.5;
  return clamp(primary * 0.72 + cross * 0.28, 0.0, 1.0);
}

void main() {
  float rawArenaDistance = length(vWorldPosition.xz);
  float edgeBreakup =
    (layeredPattern(vWorldPosition.xz * 0.72 + vec2(23.0, -17.0), uTime * 0.22) - 0.5) * 52.0 +
    sin(vWorldPosition.x * 0.034 - vWorldPosition.z * 0.023 + uTime * 0.04) * 13.0;
  float arenaDistance = rawArenaDistance + edgeBreakup;
  float arena01 = clamp(rawArenaDistance / uArenaRadius, 0.0, 1.0);
  float arenaMask = 1.0 - smoothstep(uArenaFadeStart, uArenaRadius, arenaDistance);
  arenaMask = pow(clamp(arenaMask, 0.0, 1.0), 1.34);
  float edgeFog = 1.0 - arenaMask;
  float slope = 1.0 - clamp(dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
  float strata = layeredPattern(vWorldPosition.xz, uTime);
  float shelfBand = 1.0 - smoothstep(0.22, 0.52, arena01);
  float midBand = smoothstep(0.28, 0.66, arena01) * (1.0 - smoothstep(0.62, 0.9, arena01));
  float outerBand = smoothstep(0.68, 1.02, arena01);
  float ripple = sandBands(vWorldPosition.xz);
  float distanceMask = 1.0 - smoothstep(26.0, 92.0, vViewDepth + (strata - 0.5) * 24.0);
  float distanceFog = 1.0 - distanceMask;
  float opacityDistanceMask = 1.0 - smoothstep(86.0, 176.0, vViewDepth + (strata - 0.5) * 18.0);
  float whaleDistance = length((vWorldPosition.xz - uWhaleFloorPosition.xz) / vec2(12.0, 20.0));
  float whaleShadow = 1.0 - smoothstep(0.18, 1.0, whaleDistance);
  float whaleRipple = sin(whaleDistance * 21.0 - uTime * 1.9) * 0.5 + 0.5;
  float whaleFloorCue = whaleShadow * (0.74 + whaleRipple * 0.18) * uWhaleFloorStrength;

  vec3 outerColor = vec3(0.026, 0.044, 0.048);
  vec3 midColor = vec3(0.12, 0.1, 0.062);
  vec3 shelfColor = vec3(0.25, 0.205, 0.125);
  vec3 color = mix(outerColor, midColor, clamp(midBand * 0.82 + strata * 0.34, 0.0, 1.0));
  color = mix(color, shelfColor, shelfBand * (0.76 + ripple * 0.18));
  color += vec3(0.088, 0.066, 0.03) * (ripple - 0.5) * shelfBand * 1.14;
  color += vec3(0.044, 0.034, 0.02) * (strata - 0.5) * 0.5;
  color = mix(color, shelfColor * 1.12, shelfBand * smoothstep(0.44, 1.0, ripple) * 0.34);
  color = mix(color, midColor * 0.66, clamp(slope * 1.2 + outerBand * 0.28, 0.0, 1.0) * 0.34);
  color = mix(color, color * 0.68, whaleFloorCue * 0.54);
  color += vec3(0.018, 0.027, 0.021) * whaleShadow * whaleRipple * uWhaleFloorStrength * 0.14;
  float fogBlend = clamp(max(edgeFog * 0.78, distanceFog * 0.92) + outerBand * 0.16, 0.0, 0.86);
  color = mix(color, vec3(0.01, 0.04, 0.16), fogBlend * 0.64);
  color *= 1.0 - outerBand * 0.16;
  color *= 1.0 - smoothstep(0.12, 0.8, slope) * 0.2;

  float alphaEdgeMask = smoothstep(0.06, 0.34, arenaMask);
  float alphaDistanceMask = smoothstep(0.08, 0.42, opacityDistanceMask);
  float solidFloorMask =
    smoothstep(0.32, 0.72, opacityDistanceMask) *
    smoothstep(0.24, 0.58, arenaMask);
  float fadeAlpha =
    uUnderwaterAlpha *
    mix(${FLOOR_MIN_VISIBILITY.toFixed(2)}, 1.0, uCameraFloorFade) *
    alphaEdgeMask *
    mix(1.0, 0.84, outerBand) *
    mix(0.015, 1.0, alphaDistanceMask);
  float solidAlpha = smoothstep(0.12, 0.32, uUnderwaterAlpha);
  float alpha = mix(fadeAlpha, 1.0, solidFloorMask * solidAlpha);
  alpha = min(1.0, alpha + whaleShadow * uWhaleFloorStrength * 0.08);

  if (alpha <= 0.001) {
    discard;
  }

  gl_FragColor = vec4(color, alpha);
  #include <fog_fragment>
}
`;

const WORLD_SHAFT_VERTEX_SHADER = `
varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const WORLD_SHAFT_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uAlpha;
uniform float uSeed;

varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  float lateral = abs(vUv.x - 0.5) * 2.0;
  float core = 1.0 - smoothstep(0.0, 1.0, lateral);
  float depthFade = 1.0 - smoothstep(0.0, 1.0, vUv.y);
  float breakup =
    0.76 +
    0.1 * sin(vWorldPosition.x * 0.05 + uTime * 0.32 + uSeed * 13.0) +
    0.08 * cos(vWorldPosition.z * 0.06 - uTime * 0.28 + uSeed * 17.0);
  float flutter = 0.88 + 0.12 * sin(vUv.y * 6.0 + uTime * 0.64 + uSeed * 19.0);
  float beam = pow(core, 1.06) * pow(depthFade, 0.64) * breakup * flutter;

  vec3 color = mix(vec3(0.018, 0.06, 0.14), vec3(0.078, 0.14, 0.2), clamp(beam * 0.86, 0.0, 1.0));
  gl_FragColor = vec4(color, max(0.0, beam) * uAlpha);
}
`;

interface FloorMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uTime: { value: number };
    uUnderwaterAlpha: { value: number };
    uCameraFloorFade: { value: number };
    uArenaRadius: { value: number };
    uArenaFadeStart: { value: number };
    uWhaleFloorPosition: { value: THREE.Vector3 };
    uWhaleFloorStrength: { value: number };
  };
}

interface ShaftMaterial extends THREE.ShaderMaterial {
  uniforms: {
    uTime: { value: number };
    uAlpha: { value: number };
    uSeed: { value: number };
  };
}

interface KelpStrand {
  readonly pivot: THREE.Group;
  readonly baseRotationX: number;
  readonly baseRotationZ: number;
  readonly swayAmplitudeX: number;
  readonly swayAmplitudeZ: number;
  readonly swaySpeed: number;
  readonly swayPhase: number;
}

interface FishSchool {
  readonly anchor: UnderwaterFishSchoolAnchor;
  readonly root: THREE.Group;
  readonly mesh: THREE.InstancedMesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>;
  readonly orbitAngles: Float32Array;
  readonly orbitRadii: Float32Array;
  readonly heights: Float32Array;
  readonly speeds: Float32Array;
  readonly phases: Float32Array;
  readonly scales: Float32Array;
}

interface WorldShaft {
  readonly anchor: UnderwaterShaftAnchor;
  readonly root: THREE.Group;
  readonly planeA: THREE.Mesh<THREE.PlaneGeometry, ShaftMaterial>;
  readonly planeB: THREE.Mesh<THREE.PlaneGeometry, ShaftMaterial>;
  readonly materialA: ShaftMaterial;
  readonly materialB: ShaftMaterial;
}

export interface UnderwaterEnvironmentSnapshot {
  deltaSeconds: number;
  elapsedSeconds: number;
  camera: THREE.PerspectiveCamera;
  cameraUnderwater: boolean;
  underwaterRatio: number;
  floorHeightAtCamera: number;
  whalePosition: THREE.Vector3;
  moonDirection: THREE.Vector3;
}

export interface UnderwaterEnvironmentOptions {
  arenaRadius: number;
  sampleFloorHeight: (x: number, z: number) => number;
  layout: UnderwaterEnvironmentLayout;
}

export class UnderwaterEnvironmentFX {
  private readonly root = new THREE.Group();
  private readonly floorGeometry = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, FLOOR_SEGMENTS, FLOOR_SEGMENTS);
  private readonly floorMaterial: FloorMaterial;
  private readonly floorMesh: THREE.Mesh<THREE.PlaneGeometry, FloorMaterial>;
  private readonly rockGeometries = [
    new THREE.DodecahedronGeometry(1.18, 0),
    new THREE.IcosahedronGeometry(1.0, 0),
  ];
  private readonly rockMaterial = new THREE.MeshBasicMaterial({
    color: '#080d11',
    transparent: false,
    opacity: 1,
    depthWrite: true,
    fog: true,
  });
  private readonly rockMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly kelpGeometry = this.createKelpRibbonGeometry();
  private readonly kelpMaterial = new THREE.MeshBasicMaterial({
    color: '#3b6555',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: true,
  });
  private readonly fishGeometry = new THREE.OctahedronGeometry(0.55, 0);
  private readonly fishMaterial = new THREE.MeshBasicMaterial({
    color: '#425856',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: true,
  });
  private readonly fishTransform = new THREE.Object3D();
  private readonly fishSchools: FishSchool[] = [];
  private readonly kelpStrands: KelpStrand[] = [];
  private readonly landmarkAnchors: THREE.Vector3[] = [];
  private readonly shaftPlaneGeometry = new THREE.PlaneGeometry(1, 1, 1, 20);
  private readonly worldShafts: WorldShaft[] = [];
  private readonly shaftQuaternion = new THREE.Quaternion();
  private readonly shaftDirection = new THREE.Vector3(0.3, -0.94, 0.14);
  private readonly particleGeometry = new THREE.BufferGeometry();
  private readonly particleMaterial = new THREE.PointsMaterial({
    color: '#7d908b',
    size: 0.62,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
    fog: true,
  });
  private readonly particlePositions = new Float32Array(WORLD_PARTICLE_COUNT * 3);
  private readonly particleAnchorIndex = new Uint16Array(WORLD_PARTICLE_COUNT);
  private readonly particleBaseHeight = new Float32Array(WORLD_PARTICLE_COUNT);
  private readonly particleHeightSpan = new Float32Array(WORLD_PARTICLE_COUNT);
  private readonly particleJitterX = new Float32Array(WORLD_PARTICLE_COUNT);
  private readonly particleJitterZ = new Float32Array(WORLD_PARTICLE_COUNT);
  private readonly particleDrift = new Float32Array(WORLD_PARTICLE_COUNT);
  private readonly particleSpeed = new Float32Array(WORLD_PARTICLE_COUNT);
  private readonly particlePhase = new Float32Array(WORLD_PARTICLE_COUNT);
  private readonly particles: THREE.Points;
  private readonly whaleFloorPosition = new THREE.Vector3();
  private readonly sampleFloorHeight: (x: number, z: number) => number;
  private underwaterAlpha = 0;

  constructor(scene: THREE.Scene, options: UnderwaterEnvironmentOptions) {
    this.sampleFloorHeight = options.sampleFloorHeight;
    this.root.renderOrder = -9;
    this.root.visible = false;

    this.floorGeometry.rotateX(-Math.PI / 2);
    this.populateFloorGeometry(options.sampleFloorHeight);
    this.floorMaterial = this.createFloorMaterial(options.arenaRadius);
    this.floorMesh = new THREE.Mesh(this.floorGeometry, this.floorMaterial);
    this.floorMesh.frustumCulled = false;
    this.floorMesh.renderOrder = -8;

    this.rockMaterial.toneMapped = false;
    this.kelpMaterial.toneMapped = false;
    this.fishMaterial.toneMapped = false;

    this.createRockClusters(options.layout.decorativeRockAnchors);
    this.createRockClusters(options.layout.blockerRockAnchors);
    this.createKelpClusters(options.layout.nearKelpAnchors);
    this.createKelpClusters(options.layout.outerKelpCurtains);
    this.createFishSchools(options.layout.fishSchoolAnchors);
    this.createWorldShafts(options.layout.shaftAnchors);

    this.particleMaterial.toneMapped = false;
    this.seedParticles();
    this.particleGeometry.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    this.particles = new THREE.Points(this.particleGeometry, this.particleMaterial);
    this.particles.frustumCulled = false;
    this.particles.renderOrder = -4;

    this.root.add(this.floorMesh, this.particles);
    scene.add(this.root);
  }

  reset(): void {
    this.underwaterAlpha = 0;
    this.root.visible = false;
    this.floorMesh.visible = false;
    this.floorMaterial.uniforms.uUnderwaterAlpha.value = 0;
    this.floorMaterial.uniforms.uCameraFloorFade.value = 0;
    this.floorMaterial.uniforms.uWhaleFloorStrength.value = 0;
    this.rockMaterial.opacity = 0;
    this.kelpMaterial.opacity = 0;
    this.fishMaterial.opacity = 0;
    this.particleMaterial.opacity = 0;
    this.particles.visible = false;

    for (const school of this.fishSchools) {
      school.root.visible = false;
    }

    for (const shaft of this.worldShafts) {
      shaft.root.visible = false;
      shaft.materialA.uniforms.uAlpha.value = 0;
      shaft.materialB.uniforms.uAlpha.value = 0;
    }
  }

  update(snapshot: UnderwaterEnvironmentSnapshot): void {
    const targetAlpha = snapshot.cameraUnderwater
      ? THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.08, 0.84)
      : 0;
    this.underwaterAlpha = THREE.MathUtils.damp(this.underwaterAlpha, targetAlpha, 2.3, snapshot.deltaSeconds);

    const floorDistanceAtCamera = snapshot.camera.position.y - snapshot.floorHeightAtCamera;
    const floorFade = 1 - THREE.MathUtils.smoothstep(floorDistanceAtCamera, FLOOR_FADE_NEAR, FLOOR_FADE_FAR);
    const whaleFloorHeight = this.sampleFloorHeight(snapshot.whalePosition.x, snapshot.whalePosition.z);
    const whaleFloorDistance = snapshot.whalePosition.y - whaleFloorHeight;
    const floorCueStrength =
      this.underwaterAlpha *
      THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.22, 1) *
      (1 - THREE.MathUtils.smoothstep(whaleFloorDistance, 8, 52));
    const environmentAlpha = this.underwaterAlpha;

    this.root.visible = environmentAlpha > 0.005;
    this.floorMaterial.uniforms.uTime.value = snapshot.elapsedSeconds;
    this.floorMaterial.uniforms.uUnderwaterAlpha.value = environmentAlpha;
    this.floorMaterial.uniforms.uCameraFloorFade.value = floorFade;
    this.whaleFloorPosition.set(snapshot.whalePosition.x, whaleFloorHeight, snapshot.whalePosition.z);
    this.floorMaterial.uniforms.uWhaleFloorPosition.value.copy(this.whaleFloorPosition);
    this.floorMaterial.uniforms.uWhaleFloorStrength.value = floorCueStrength;
    this.floorMesh.visible = environmentAlpha > 0.005;

    this.rockMaterial.opacity = 1;
    this.kelpMaterial.opacity = environmentAlpha * 0.86;
    this.fishMaterial.opacity = environmentAlpha * 0.3;
    this.particleMaterial.opacity = environmentAlpha * 0.14;
    this.particles.visible = this.particleMaterial.opacity > 0.004;

    for (const strand of this.kelpStrands) {
      const swayPhase = snapshot.elapsedSeconds * strand.swaySpeed + strand.swayPhase;
      strand.pivot.rotation.x =
        strand.baseRotationX + Math.sin(swayPhase) * strand.swayAmplitudeX * environmentAlpha;
      strand.pivot.rotation.z =
        strand.baseRotationZ + Math.cos(swayPhase * 0.92 + 0.6) * strand.swayAmplitudeZ * environmentAlpha;
    }

    this.updateFishSchools(snapshot, environmentAlpha);
    this.updateWorldShafts(snapshot, environmentAlpha);

    for (let index = 0; index < WORLD_PARTICLE_COUNT; index += 1) {
      const baseIndex = index * 3;
      const anchor = this.landmarkAnchors[this.particleAnchorIndex[index]];
      const rise = (snapshot.elapsedSeconds * this.particleSpeed[index] + this.particlePhase[index]) % 1;
      const driftPhase = snapshot.elapsedSeconds * 0.28 + this.particleDrift[index];

      this.particlePositions[baseIndex] =
        anchor.x +
        Math.sin(driftPhase) * this.particleJitterX[index] +
        Math.cos(driftPhase * 0.7) * 0.34;
      this.particlePositions[baseIndex + 1] =
        anchor.y + this.particleBaseHeight[index] + rise * this.particleHeightSpan[index];
      this.particlePositions[baseIndex + 2] =
        anchor.z +
        Math.cos(driftPhase * 0.9 + 0.8) * this.particleJitterZ[index] +
        Math.sin(driftPhase * 0.5) * 0.28;
    }

    this.particleGeometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.floorGeometry.dispose();
    this.floorMaterial.dispose();
    for (const geometry of this.rockGeometries) {
      geometry.dispose();
    }
    this.rockMaterial.dispose();
    for (const material of this.rockMaterials) {
      material.dispose();
    }
    this.kelpGeometry.dispose();
    this.kelpMaterial.dispose();
    this.fishGeometry.dispose();
    this.fishMaterial.dispose();
    this.shaftPlaneGeometry.dispose();
    for (const shaft of this.worldShafts) {
      shaft.materialA.dispose();
      shaft.materialB.dispose();
    }
    this.particleGeometry.dispose();
    this.particleMaterial.dispose();
  }

  private populateFloorGeometry(sampleFloorHeight: (x: number, z: number) => number): void {
    const positions = this.floorGeometry.attributes.position;

    for (let index = 0; index < positions.count; index += 1) {
      positions.setY(index, sampleFloorHeight(positions.getX(index), positions.getZ(index)));
    }

    positions.needsUpdate = true;
    this.floorGeometry.computeVertexNormals();
  }

  private createFloorMaterial(arenaRadius: number): FloorMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uUnderwaterAlpha: { value: 0 },
          uCameraFloorFade: { value: 0 },
          uArenaRadius: { value: arenaRadius * ENVIRONMENT_EDGE_FADE_END_RATIO },
          uArenaFadeStart: { value: arenaRadius * ENVIRONMENT_EDGE_FADE_START_RATIO },
          uWhaleFloorPosition: { value: new THREE.Vector3() },
          uWhaleFloorStrength: { value: 0 },
        },
      ]),
      vertexShader: SEAFLOOR_VERTEX_SHADER,
      fragmentShader: SEAFLOOR_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
    }) as FloorMaterial;

    material.toneMapped = false;
    return material;
  }

  private createRockClusters(clusters: readonly UnderwaterRockClusterLayout[]): void {
    for (const cluster of clusters) {
      const root = new THREE.Group();
      const material = this.createRockClusterMaterial(cluster.position.y);

      root.position.copy(cluster.position);
      root.rotation.y = cluster.rotationY;
      root.renderOrder = -6;

      for (const piece of cluster.pieces) {
        const mesh = new THREE.Mesh(this.rockGeometries[piece.geometryIndex], material);
        mesh.position.copy(piece.position);
        mesh.rotation.copy(piece.rotation);
        mesh.scale.copy(piece.scale);
        mesh.frustumCulled = false;
        mesh.renderOrder = -6;
        root.add(mesh);
      }

      this.landmarkAnchors.push(root.position.clone());
      this.root.add(root);
    }
  }

  private createRockClusterMaterial(floorHeight: number): THREE.MeshBasicMaterial {
    const material = this.rockMaterial.clone();
    const clipHeight = floorHeight + ROCK_FLOOR_CLIP_RISE;

    material.clippingPlanes = [new THREE.Plane(UP_AXIS.clone(), -clipHeight)];
    material.needsUpdate = true;
    this.rockMaterials.push(material);
    return material;
  }

  private createKelpClusters(clusters: readonly UnderwaterKelpClusterLayout[]): void {
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index];
      const root = new THREE.Group();

      root.position.copy(cluster.position);
      root.rotation.y = cluster.rotationY;
      root.renderOrder = -5;

      for (let strandIndex = 0; strandIndex < cluster.strandCount; strandIndex += 1) {
        const seed = index * 29 + strandIndex * 17 + 1;
        const pivot = new THREE.Group();
        const ribbonA = new THREE.Mesh(this.kelpGeometry, this.kelpMaterial);
        const ribbonB = new THREE.Mesh(this.kelpGeometry, this.kelpMaterial);
        const width = THREE.MathUtils.lerp(0.64, cluster.maxWidth, this.seed01(seed + 1));
        const length = THREE.MathUtils.lerp(cluster.minLength, cluster.maxLength, this.seed01(seed + 3));

        pivot.position.set(
          this.seedSigned(seed + 5) * cluster.spread,
          0,
          this.seedSigned(seed + 7) * cluster.spread,
        );
        pivot.rotation.y = this.seed01(seed + 9) * TAU;

        ribbonA.scale.set(width, length, 1);
        ribbonB.scale.set(width * 0.9, length, 1);
        ribbonB.rotation.y = Math.PI * 0.5;
        ribbonA.renderOrder = -5;
        ribbonB.renderOrder = -5;
        ribbonA.frustumCulled = false;
        ribbonB.frustumCulled = false;
        pivot.add(ribbonA, ribbonB);
        root.add(pivot);

        this.kelpStrands.push({
          pivot,
          baseRotationX: THREE.MathUtils.lerp(-0.12, 0.08, this.seed01(seed + 11)),
          baseRotationZ: THREE.MathUtils.lerp(-0.16, 0.16, this.seed01(seed + 13)),
          swayAmplitudeX: THREE.MathUtils.lerp(0.04, 0.12, this.seed01(seed + 17)) * cluster.swayScale,
          swayAmplitudeZ: THREE.MathUtils.lerp(0.05, 0.14, this.seed01(seed + 19)) * cluster.swayScale,
          swaySpeed: THREE.MathUtils.lerp(0.24, 0.52, this.seed01(seed + 23)),
          swayPhase: this.seed01(seed + 29) * TAU,
        });
      }

      this.landmarkAnchors.push(root.position.clone());
      this.root.add(root);
    }
  }

  private createFishSchools(anchors: readonly UnderwaterFishSchoolAnchor[]): void {
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const root = new THREE.Group();
      root.position.copy(anchor.position);
      root.rotation.y = anchor.rotationY;
      root.renderOrder = -4;

      const mesh = new THREE.InstancedMesh(this.fishGeometry, this.fishMaterial, anchor.fishCount);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(mesh);
      this.root.add(root);

      const orbitAngles = new Float32Array(anchor.fishCount);
      const orbitRadii = new Float32Array(anchor.fishCount);
      const heights = new Float32Array(anchor.fishCount);
      const speeds = new Float32Array(anchor.fishCount);
      const phases = new Float32Array(anchor.fishCount);
      const scales = new Float32Array(anchor.fishCount);

      for (let fishIndex = 0; fishIndex < anchor.fishCount; fishIndex += 1) {
        const seed = index * 31 + fishIndex * 19 + 1;
        orbitAngles[fishIndex] = this.seed01(seed + 1) * TAU;
        orbitRadii[fishIndex] = THREE.MathUtils.lerp(anchor.spread * 0.26, anchor.spread, this.seed01(seed + 3));
        heights[fishIndex] = this.seedSigned(seed + 5) * anchor.verticalSpan;
        speeds[fishIndex] = anchor.swimSpeed * THREE.MathUtils.lerp(0.84, 1.22, this.seed01(seed + 7));
        phases[fishIndex] = this.seed01(seed + 11) * TAU;
        scales[fishIndex] = anchor.scale * THREE.MathUtils.lerp(0.78, 1.18, this.seed01(seed + 13));
      }

      this.fishSchools.push({
        anchor,
        root,
        mesh,
        orbitAngles,
        orbitRadii,
        heights,
        speeds,
        phases,
        scales,
      });
    }
  }

  private createWorldShafts(anchors: readonly UnderwaterShaftAnchor[]): void {
    this.shaftPlaneGeometry.translate(0, -0.5, 0);

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const materialA = this.createShaftMaterial(index * 2 + 1);
      const materialB = this.createShaftMaterial(index * 2 + 2);
      const planeA = new THREE.Mesh(this.shaftPlaneGeometry, materialA);
      const planeB = new THREE.Mesh(this.shaftPlaneGeometry, materialB);

      planeA.frustumCulled = false;
      planeB.frustumCulled = false;
      planeB.rotation.y = Math.PI * 0.5;

      const root = new THREE.Group();
      root.position.copy(anchor.position);
      root.renderOrder = -7;
      root.visible = false;
      planeA.scale.set(anchor.width, anchor.length, 1);
      planeB.scale.set(anchor.width * 0.84, anchor.length * 1.06, 1);
      root.add(planeA, planeB);

      this.worldShafts.push({ anchor, root, planeA, planeB, materialA, materialB });
      this.root.add(root);
    }
  }

  private createShaftMaterial(seed: number): ShaftMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uSeed: { value: seed * 0.173 },
      },
      vertexShader: WORLD_SHAFT_VERTEX_SHADER,
      fragmentShader: WORLD_SHAFT_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }) as ShaftMaterial;

    material.fog = false;
    material.toneMapped = false;
    return material;
  }

  private updateFishSchools(snapshot: UnderwaterEnvironmentSnapshot, environmentAlpha: number): void {
    for (const school of this.fishSchools) {
      school.root.visible = environmentAlpha > 0.02;
      if (!school.root.visible) {
        continue;
      }

      for (let index = 0; index < school.anchor.fishCount; index += 1) {
        const phase = snapshot.elapsedSeconds * school.speeds[index] + school.phases[index];
        const swimAngle = school.orbitAngles[index] + Math.sin(phase * 0.56) * 0.28;
        const x = Math.cos(swimAngle) * school.orbitRadii[index];
        const z =
          Math.sin(swimAngle) * school.orbitRadii[index] * 0.62 +
          Math.cos(phase * 0.82) * school.anchor.spread * 0.14;
        const y = school.heights[index] + Math.sin(phase * 1.14) * school.anchor.verticalSpan * 0.24;
        const scale = school.scales[index];

        this.fishTransform.position.set(x, y, z);
        this.fishTransform.rotation.set(
          Math.sin(phase * 0.72) * 0.08,
          swimAngle + Math.PI * 0.5 + Math.cos(phase * 0.68) * 0.18,
          Math.sin(phase * 0.9) * 0.04,
        );
        this.fishTransform.scale.set(scale * 0.54, scale * 0.3, scale * 1.22);
        this.fishTransform.updateMatrix();
        school.mesh.setMatrixAt(index, this.fishTransform.matrix);
      }

      school.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private updateWorldShafts(snapshot: UnderwaterEnvironmentSnapshot, environmentAlpha: number): void {
    this.shaftDirection.copy(snapshot.moonDirection).normalize();

    if (this.shaftDirection.lengthSq() <= 0.001) {
      this.shaftDirection.set(0.3, -0.94, 0.14);
    }

    this.shaftQuaternion.setFromUnitVectors(DOWN_AXIS, this.shaftDirection);

    for (const shaft of this.worldShafts) {
      const swayX = Math.sin(snapshot.elapsedSeconds * 0.05 + shaft.anchor.drift * 3.8) * 1.6;
      const swayZ = Math.cos(snapshot.elapsedSeconds * 0.056 + shaft.anchor.drift * 4.6) * 1.2;
      const alpha = environmentAlpha * shaft.anchor.opacity;

      shaft.root.visible = alpha > 0.004;
      shaft.root.position.set(shaft.anchor.position.x + swayX, shaft.anchor.position.y, shaft.anchor.position.z + swayZ);
      shaft.root.quaternion.slerp(this.shaftQuaternion, 1 - Math.exp(-snapshot.deltaSeconds * 1.4));
      shaft.materialA.uniforms.uTime.value = snapshot.elapsedSeconds;
      shaft.materialA.uniforms.uAlpha.value = alpha;
      shaft.materialB.uniforms.uTime.value = snapshot.elapsedSeconds * 1.08;
      shaft.materialB.uniforms.uAlpha.value = alpha * 0.92;
    }
  }

  private createKelpRibbonGeometry(): THREE.PlaneGeometry {
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 12);
    const positions = geometry.attributes.position;

    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y01 = positions.getY(index) + 0.5;
      const widthScale = THREE.MathUtils.lerp(0.28, 1, Math.sin(y01 * Math.PI * 0.94));
      const curl = Math.sin(y01 * Math.PI * 0.82) * 0.1 + Math.pow(y01, 1.75) * 0.22;

      positions.setX(index, x * widthScale);
      positions.setZ(index, curl * (x >= 0 ? 1 : -1));
    }

    geometry.translate(0, 0.5, 0);
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  private seedParticles(): void {
    for (let index = 0; index < WORLD_PARTICLE_COUNT; index += 1) {
      const seed = index * 23 + 1;

      this.particleAnchorIndex[index] = index % this.landmarkAnchors.length;
      this.particleBaseHeight[index] = THREE.MathUtils.lerp(1.6, 8.6, this.seed01(seed + 1));
      this.particleHeightSpan[index] = THREE.MathUtils.lerp(8, 24, this.seed01(seed + 3));
      this.particleJitterX[index] = THREE.MathUtils.lerp(1.1, 5.4, this.seed01(seed + 5));
      this.particleJitterZ[index] = THREE.MathUtils.lerp(1.1, 5.4, this.seed01(seed + 7));
      this.particleDrift[index] = this.seed01(seed + 11) * TAU;
      this.particleSpeed[index] = THREE.MathUtils.lerp(0.04, 0.18, this.seed01(seed + 13));
      this.particlePhase[index] = this.seed01(seed + 17);
    }
  }

  private seed01(seed: number): number {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  private seedSigned(seed: number): number {
    return this.seed01(seed) * 2 - 1;
  }
}

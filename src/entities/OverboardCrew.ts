import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  INACTIVE_WATERLINE_PASSTHROUGH_STATE,
  WaterlinePassthroughState,
} from '../fx/calculateWhaleTopsideRevealState';
import {
  cloneUniqueObjectRoot,
  createWaterlineOverlay,
  disposeObject3DResources,
  WaterlineOverlayController,
} from '../fx/createWaterlineOverlay';
import { createCelMaterial } from '../fx/createCelMaterial';
import {
  WATER_FOAM_GOLDEN_ANGLE,
  WaterFoamStampLayer,
} from '../fx/WaterFoamStampLayer';

const MODEL_PATH = '/models/overboard-crew.glb';
const CREW_FAILSAFE_SECONDS = 150;
const SURFACE_FLOAT_SECONDS = 0.3;
const SINK_RATE = 1.85;
const BOTTOM_CLEARANCE = 4;
const BOTTOM_LINGER_SECONDS = 5;
const WATER_ENTRY_GRAVITY = 13.5;
const WATER_FLOAT_OFFSET = -0.34;
const BUBBLE_COUNT = 44;
const BUBBLE_COLUMN_BODY_OFFSET = -0.24;
const BUBBLE_COLUMN_SURFACE_CLEARANCE = 0.12;
const BUBBLE_RISE_SPEED_MIN = 0.9;
const BUBBLE_RISE_SPEED_MAX = 1.45;
const FOAM_FADE_SECONDS = 2.2;
const CREW_WATERLINE_COLOR = new THREE.Color('#8ca5ad');
const CREW_WATERLINE_OPACITY_MIN = 0.12;
const CREW_WATERLINE_OPACITY_MAX = 0.42;

type OverboardCrewPhase = 'airborne' | 'sinking' | 'bottom';

interface BubbleSlot {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  readonly velocity: THREE.Vector3;
  readonly columnOffset: number;
  readonly wobbleRadius: number;
  active: boolean;
  seed: number;
}

const loader = new GLTFLoader();
let crewTemplatePromise: Promise<THREE.Group> | null = null;

function loadTemplate(): Promise<THREE.Group> {
  if (!crewTemplatePromise) {
    crewTemplatePromise = loader.loadAsync(MODEL_PATH).then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      return gltf.scene;
    });
  }

  return crewTemplatePromise;
}

export function preloadOverboardCrewAsset(): Promise<void> {
  return loadTemplate()
    .then(() => undefined)
    .catch((error) => {
      console.warn('Failed to preload overboard crew asset, procedural fallback will be used.', error);
    });
}

function cloneTemplate(root: THREE.Group): THREE.Group {
  const clone = root.clone(true) as THREE.Group;

  clone.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    object.userData.sharedGeometry = true;

    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => material.clone());
      return;
    }

    object.material = object.material.clone();
  });

  return clone;
}

function createCrewMaterial(name: string): THREE.MeshToonMaterial {
  const normalized = name.toLowerCase();
  const color =
    normalized.includes('head') || normalized.includes('hand')
      ? '#8a6f58'
      : normalized.includes('hat')
        ? '#d6cfb4'
        : normalized.includes('boot') || normalized.includes('trouser') || normalized.includes('leg')
          ? '#1a2632'
          : '#284656';

  const emissive =
    normalized.includes('head') || normalized.includes('hand')
      ? '#1b2224'
      : normalized.includes('hat')
        ? '#26333a'
        : normalized.includes('boot') || normalized.includes('trouser') || normalized.includes('leg')
          ? '#101c26'
          : '#112d38';

  const emissiveIntensity =
    normalized.includes('hat') || normalized.includes('head') || normalized.includes('hand')
      ? 0.05
      : normalized.includes('boot') || normalized.includes('trouser') || normalized.includes('leg')
        ? 0.045
        : 0.07;

  return createCelMaterial({
    color,
    emissive,
    emissiveIntensity,
  });
}

function applyCrewMaterials(root: THREE.Group): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const oldMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of oldMaterials) {
      material.dispose();
    }

    object.material = createCrewMaterial(object.name);
    object.castShadow = false;
    object.receiveShadow = true;
    object.frustumCulled = true;
  });
}

function createFallbackCrewVisual(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'overboard_crew_fallback';

  const coat = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.42, 0.28), createCrewMaterial('CrewCoat'));
  coat.name = 'CrewCoat';

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), createCrewMaterial('CrewHead'));
  head.name = 'CrewHead';
  head.position.set(0.58, 0.03, 0.02);
  head.scale.set(0.92, 1.04, 0.9);

  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 8), createCrewMaterial('CrewHat'));
  hat.name = 'CrewHat';
  hat.position.set(0.74, 0.04, 0.03);
  hat.rotation.z = Math.PI / 2;

  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.58, 6), createCrewMaterial('CrewSleeveLeft'));
  leftArm.name = 'CrewSleeveLeft';
  leftArm.position.set(0.02, 0.31, 0.02);
  leftArm.rotation.z = 0.34;

  const rightArm = leftArm.clone();
  rightArm.name = 'CrewSleeveRight';
  rightArm.material = createCrewMaterial('CrewSleeveRight');
  rightArm.position.set(-0.02, -0.31, -0.02);
  rightArm.rotation.z = -0.22;

  const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.58, 6), createCrewMaterial('CrewTrouserLeft'));
  leftLeg.name = 'CrewTrouserLeft';
  leftLeg.position.set(-0.55, 0.13, 0);
  leftLeg.rotation.z = Math.PI / 2 + 0.18;

  const rightLeg = leftLeg.clone();
  rightLeg.name = 'CrewTrouserRight';
  rightLeg.material = createCrewMaterial('CrewTrouserRight');
  rightLeg.position.set(-0.55, -0.13, 0.01);
  rightLeg.rotation.z = Math.PI / 2 - 0.16;

  root.add(coat, head, hat, leftArm, rightArm, leftLeg, rightLeg);
  root.rotation.set(0.08, 0.12, -0.04);
  root.scale.setScalar(1.1);
  root.updateMatrixWorld(true);
  return root;
}

export class OverboardCrew {
  readonly root = new THREE.Group();
  readonly position = this.root.position;
  readonly velocity = new THREE.Vector3();
  readonly waterlinePassthroughKind = 'object' as const;
  readonly radius = 1.25;

  active = false;

  private solidRoot: THREE.Group;
  private waterlineOverlayController: WaterlineOverlayController;
  private readonly bubbleRoot = new THREE.Group();
  private readonly foamRoot = new THREE.Group();
  private readonly foamSplash: WaterFoamStampLayer;
  private readonly bubbles: BubbleSlot[] = [];
  private readonly driftVelocity = new THREE.Vector3();
  private readonly splashPoint = new THREE.Vector3();
  private readonly tempSurfacePoint = new THREE.Vector3();
  private phase: OverboardCrewPhase = 'airborne';
  private ageSeconds = 0;
  private waterAgeSeconds = 0;
  private bottomLingerSeconds = 0;
  private sinkDepth = 0;
  private seed = Math.random() * Math.PI * 2;
  private splashPending = false;
  private disposed = false;

  constructor() {
    this.solidRoot = createFallbackCrewVisual();
    this.waterlineOverlayController = this.createOverlay(this.solidRoot);
    this.foamSplash = new WaterFoamStampLayer(this.foamRoot, {
      maxStamps: 14,
      maxCutouts: 42,
      color: '#d7e6e2',
      opacity: 0.26,
      blending: THREE.NormalBlending,
      renderOrder: 24,
      cutoutRenderOrder: 23.7,
    });
    this.createBubbles();
    this.root.add(this.solidRoot, this.waterlineOverlayController.root, this.bubbleRoot, this.foamRoot);
    this.root.visible = false;

    void this.loadVisual();
  }

  get expired(): boolean {
    return (
      this.active &&
      (this.ageSeconds >= CREW_FAILSAFE_SECONDS ||
        (this.phase === 'bottom' && this.bottomLingerSeconds >= BOTTOM_LINGER_SECONDS))
    );
  }

  get canBeEaten(): boolean {
    return this.active && this.phase === 'sinking' && this.waterAgeSeconds >= 0.18;
  }

  launch(origin: THREE.Vector3, direction: THREE.Vector3, surfaceHeight: number): void {
    this.active = true;
    this.phase = 'airborne';
    this.ageSeconds = 0;
    this.waterAgeSeconds = 0;
    this.bottomLingerSeconds = 0;
    this.sinkDepth = 0;
    this.splashPending = false;
    this.seed = Math.random() * Math.PI * 2;
    this.position.copy(origin);
    this.position.y = Math.max(this.position.y, surfaceHeight + 0.7);
    this.velocity.copy(direction).setY(0);

    if (this.velocity.lengthSq() <= 0.0001) {
      this.velocity.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    }

    this.velocity.normalize().multiplyScalar(THREE.MathUtils.randFloat(2.8, 4.8));
    this.velocity.y = THREE.MathUtils.randFloat(3.2, 4.8);
    this.driftVelocity.copy(this.velocity).setY(0).multiplyScalar(0.12);
    this.root.rotation.set(
      THREE.MathUtils.randFloatSpread(0.42),
      THREE.MathUtils.randFloat(0, Math.PI * 2),
      THREE.MathUtils.randFloatSpread(0.36),
      'YXZ',
    );
    this.foamSplash.reset();
    this.resetBubbles();
    this.setWaterlinePassthrough(INACTIVE_WATERLINE_PASSTHROUGH_STATE);
    this.root.visible = true;
    this.root.updateMatrixWorld(true);
  }

  update(
    deltaSeconds: number,
    elapsedSeconds: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
    sampleFloorHeight: (x: number, z: number) => number,
  ): void {
    if (!this.active) {
      return;
    }

    this.ageSeconds += deltaSeconds;
    const surfaceHeight = sampleSurfaceHeight(this.position.x, this.position.z);

    if (this.phase === 'airborne') {
      this.updateAirborne(deltaSeconds, surfaceHeight);
    } else {
      this.updateSinking(deltaSeconds, elapsedSeconds, sampleSurfaceHeight, sampleFloorHeight);
    }

    this.root.updateMatrixWorld(true);
  }

  consumeWaterEntrySplash(target = new THREE.Vector3()): THREE.Vector3 | null {
    if (!this.splashPending) {
      return null;
    }

    this.splashPending = false;
    return target.copy(this.splashPoint);
  }

  getWaterlinePassthroughAnchor(target = new THREE.Vector3()): THREE.Vector3 {
    return this.root.getWorldPosition(target);
  }

  getWaterlinePassthroughBounds(target: THREE.Box3): THREE.Box3 {
    return target.makeEmpty().expandByObject(this.solidRoot, true);
  }

  setWaterlinePassthrough(state: WaterlinePassthroughState): void {
    this.waterlineOverlayController.setState(state);
  }

  deactivate(): void {
    this.active = false;
    this.root.visible = false;
    this.setWaterlinePassthrough(INACTIVE_WATERLINE_PASSTHROUGH_STATE);
    this.resetBubbles();
    this.foamSplash.reset();
    this.root.removeFromParent();
  }

  dispose(): void {
    this.disposed = true;
    this.deactivate();
    this.foamSplash.dispose();
    disposeObject3DResources(this.root);
  }

  private async loadVisual(): Promise<void> {
    try {
      const template = await loadTemplate();
      const root = cloneTemplate(template);
      root.name = 'overboard_crew_asset';
      applyCrewMaterials(root);
      root.updateMatrixWorld(true);

      if (this.disposed) {
        disposeObject3DResources(root);
        return;
      }

      this.installSolidRoot(root);
    } catch (error) {
      console.warn('Failed to load overboard crew asset, keeping procedural fallback.', error);
    }
  }

  private installSolidRoot(nextRoot: THREE.Group): void {
    const previousRoot = this.solidRoot;
    const previousOverlay = this.waterlineOverlayController;
    const nextOverlay = this.createOverlay(nextRoot);

    previousRoot.removeFromParent();
    previousOverlay.root.removeFromParent();
    disposeObject3DResources(previousRoot);
    disposeObject3DResources(previousOverlay.root, new Set([previousOverlay.material]));
    previousOverlay.material.dispose();

    this.solidRoot = nextRoot;
    this.waterlineOverlayController = nextOverlay;
    this.root.add(this.solidRoot, this.waterlineOverlayController.root);
    this.setWaterlinePassthrough(INACTIVE_WATERLINE_PASSTHROUGH_STATE);
  }

  private createOverlay(root: THREE.Group): WaterlineOverlayController {
    return createWaterlineOverlay(cloneUniqueObjectRoot(root), {
      color: CREW_WATERLINE_COLOR,
      opacityMin: CREW_WATERLINE_OPACITY_MIN,
      opacityMax: CREW_WATERLINE_OPACITY_MAX,
    });
  }

  private createBubbles(): void {
    this.bubbleRoot.renderOrder = 26;

    for (let index = 0; index < BUBBLE_COUNT; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color('#d4f7ff'),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      material.fog = true;
      material.toneMapped = false;

      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.074, 7, 6), material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.bubbleRoot.add(mesh);
      const velocity = new THREE.Vector3(
        0,
        THREE.MathUtils.randFloat(BUBBLE_RISE_SPEED_MIN, BUBBLE_RISE_SPEED_MAX),
        0,
      );

      this.bubbles.push({
        mesh,
        velocity,
        columnOffset: index / BUBBLE_COUNT,
        wobbleRadius: THREE.MathUtils.randFloat(0.12, 0.44),
        active: false,
        seed: Math.random() * Math.PI * 2,
      });
    }
  }

  private updateAirborne(deltaSeconds: number, surfaceHeight: number): void {
    this.velocity.y -= WATER_ENTRY_GRAVITY * deltaSeconds;
    this.position.addScaledVector(this.velocity, deltaSeconds);
    this.root.rotation.x += deltaSeconds * 1.6;
    this.root.rotation.z += deltaSeconds * 0.9;

    if (this.position.y > surfaceHeight + WATER_FLOAT_OFFSET) {
      return;
    }

    this.phase = 'sinking';
    this.waterAgeSeconds = 0;
    this.position.y = surfaceHeight + WATER_FLOAT_OFFSET;
    this.velocity.y = 0;
    this.driftVelocity.multiplyScalar(0.72);
    this.splashPoint.set(this.position.x, surfaceHeight, this.position.z);
    this.splashPending = true;
    this.updateFoam(surfaceHeight);
  }

  private updateSinking(
    deltaSeconds: number,
    elapsedSeconds: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
    sampleFloorHeight: (x: number, z: number) => number,
  ): void {
    this.waterAgeSeconds += deltaSeconds;

    if (this.phase === 'sinking') {
      this.driftVelocity.multiplyScalar(1 - Math.min(deltaSeconds * 0.22, 0.08));
      this.position.x += this.driftVelocity.x * deltaSeconds;
      this.position.z += this.driftVelocity.z * deltaSeconds;
    }

    const surfaceHeight = sampleSurfaceHeight(this.position.x, this.position.z);
    const bottomY = sampleFloorHeight(this.position.x, this.position.z) + BOTTOM_CLEARANCE;

    const bobStrength = Math.max(0, 1 - this.sinkDepth / 2.2);
    const bob = Math.sin(elapsedSeconds * 2.2 + this.seed) * 0.06 * bobStrength;

    if (this.phase === 'bottom') {
      this.bottomLingerSeconds += deltaSeconds;
      this.position.y = THREE.MathUtils.damp(this.position.y, bottomY, 5, deltaSeconds);
    } else {
      this.sinkDepth = Math.max(0, this.waterAgeSeconds - SURFACE_FLOAT_SECONDS) * SINK_RATE;
      const nextY = surfaceHeight + WATER_FLOAT_OFFSET + bob - this.sinkDepth;

      if (nextY <= bottomY) {
        this.phase = 'bottom';
        this.bottomLingerSeconds = 0;
        this.position.y = bottomY;
        this.driftVelocity.setScalar(0);
      } else {
        this.position.y = nextY;
      }
    }

    this.sinkDepth = Math.max(0, surfaceHeight + WATER_FLOAT_OFFSET - this.position.y);

    this.root.rotation.x = THREE.MathUtils.damp(this.root.rotation.x, 0.08 + bob * 0.3, 2.4, deltaSeconds);
    this.root.rotation.z = THREE.MathUtils.damp(this.root.rotation.z, -0.16, 1.7, deltaSeconds);
    this.updateFoam(surfaceHeight);
    this.updateBubbles(elapsedSeconds, surfaceHeight);
  }

  private updateFoam(surfaceHeight: number): void {
    const fade = 1 - THREE.MathUtils.smoothstep(this.waterAgeSeconds, 0.4, FOAM_FADE_SECONDS);

    if (fade <= 0.01) {
      this.foamSplash.reset();
      return;
    }

    this.foamRoot.quaternion.copy(this.root.quaternion).invert();
    this.foamSplash.begin(fade * 0.78);

    const progress = 1 - fade;
    const radius = THREE.MathUtils.lerp(0.62, 1.38, progress);
    const localY = surfaceHeight - this.position.y + 0.035;
    const count = 8;

    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const seed = this.seed + index * WATER_FOAM_GOLDEN_ANGLE;
      const localRadius = radius * THREE.MathUtils.lerp(0.84, 1.12, (Math.sin(seed) + 1) * 0.5);
      const scale = THREE.MathUtils.lerp(0.18, 0.34, (Math.cos(seed * 0.71) + 1) * 0.5) * (1 - progress * 0.32);

      this.foamSplash.addStamp({
        x: Math.cos(angle) * localRadius,
        y: localY + (index % 4) * 0.001,
        z: Math.sin(angle) * localRadius,
        yaw: angle + Math.PI * 0.5 + Math.sin(seed * 0.57) * 0.32,
        width: scale,
        length: scale * THREE.MathUtils.lerp(0.76, 1.08, (Math.sin(seed * 0.43) + 1) * 0.5),
        phase: seed,
        progress,
        variant: index,
        cutoutScale: 0.78,
      });
    }

    this.foamSplash.end();
  }

  private updateBubbles(elapsedSeconds: number, surfaceHeight: number): void {
    if (this.waterAgeSeconds <= 0.1 || (this.phase !== 'sinking' && this.phase !== 'bottom')) {
      this.resetBubbles();
      return;
    }

    const columnTop = surfaceHeight - this.position.y - BUBBLE_COLUMN_SURFACE_CLEARANCE;
    const columnSpan = columnTop - BUBBLE_COLUMN_BODY_OFFSET;

    if (columnSpan <= 0.4) {
      this.resetBubbles();
      return;
    }

    const bottomFade =
      this.phase === 'bottom'
        ? 1 - THREE.MathUtils.smoothstep(this.bottomLingerSeconds, BOTTOM_LINGER_SECONDS * 0.45, BOTTOM_LINGER_SECONDS)
        : 1;

    for (const bubble of this.bubbles) {
      const riseDistance =
        (elapsedSeconds * bubble.velocity.y + bubble.columnOffset * columnSpan + bubble.seed * 0.17) % columnSpan;
      const localY = BUBBLE_COLUMN_BODY_OFFSET + riseDistance;
      const columnAlpha = THREE.MathUtils.clamp((localY - BUBBLE_COLUMN_BODY_OFFSET) / columnSpan, 0, 1);
      const radius = bubble.wobbleRadius * THREE.MathUtils.lerp(0.45, 1.25, columnAlpha);
      const angle = bubble.seed + columnAlpha * 1.8 + elapsedSeconds * 0.34;
      bubble.mesh.position.set(
        Math.cos(angle) * radius + Math.sin(elapsedSeconds * 1.9 + bubble.seed) * 0.08,
        localY,
        Math.sin(angle * 0.93) * radius + Math.cos(elapsedSeconds * 1.7 + bubble.seed) * 0.07,
      );

      const nextWorldY = this.position.y + bubble.mesh.position.y;
      const bodyFade = THREE.MathUtils.smoothstep(localY, BUBBLE_COLUMN_BODY_OFFSET, 1.1);
      const surfaceFade = 1 - THREE.MathUtils.smoothstep(nextWorldY, surfaceHeight - 0.38, surfaceHeight - 0.04);
      const shimmer = 0.72 + Math.sin(elapsedSeconds * 2.1 + bubble.seed) * 0.28;
      const opacity = bodyFade * surfaceFade * bottomFade * shimmer * THREE.MathUtils.lerp(0.38, 0.22, columnAlpha);

      bubble.mesh.material.opacity = Math.max(0, opacity);
      bubble.mesh.scale.setScalar(THREE.MathUtils.lerp(0.78, 1.72, columnAlpha));
      bubble.mesh.visible = opacity > 0.004 && nextWorldY < surfaceHeight - 0.04;
      bubble.active = bubble.mesh.visible;
    }
  }

  private resetBubbles(): void {
    for (const bubble of this.bubbles) {
      this.deactivateBubble(bubble);
    }
  }

  private deactivateBubble(bubble: BubbleSlot): void {
    bubble.active = false;
    bubble.mesh.visible = false;
    bubble.mesh.material.opacity = 0;
    bubble.mesh.position.copy(this.tempSurfacePoint.set(0, 0, 0));
  }
}

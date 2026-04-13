import * as THREE from 'three';

import { ActorVisualProfile } from '../assets/ModelLibrary';

const SURFACED_START_DEPTH = -0.18;
const MAX_AIR = 12;
const WHALE_VISUAL_SCALE = 1.22;
const WHALE_COLLISION_RADIUS = 3.1;

export type WhaleActionState = 'swim' | 'breach' | 'tail_slap' | 'recovery';

export class PlayerWhale {
  readonly root = new THREE.Group();
  readonly position = this.root.position;
  readonly maxHealth = 100;
  readonly maxAir = MAX_AIR;
  readonly radius = WHALE_COLLISION_RADIUS;
  readonly visualRoot = new THREE.Group();
  readonly surfaceSilhouetteScale = new THREE.Vector2(4.4, 12.2);
  readonly breachDirection = new THREE.Vector3();
  readonly breachOrigin = new THREE.Vector3();
  readonly ramDriftVelocity = new THREE.Vector3();

  speed = 0;
  throttle = 0.35;
  yaw = 0;
  pitch = 0;
  roll = 0;
  depth = SURFACED_START_DEPTH;
  verticalSpeed = 0;
  health = this.maxHealth;
  air = this.maxAir;
  boostActive = false;
  submerged = false;
  activeTethers = 0;
  speedDragMultiplier = 1;
  strokeBuildMultiplier = 1;
  turnDragMultiplier = 1;
  actionState: WhaleActionState = 'swim';
  strokeCharge = 0;
  strokeTimer = 0.92;
  strokeVisual = 0;
  tailSlapCooldown = 0;
  tailSlapTime = 0;
  tailSlapResolved = false;
  tailSlapStartYaw = 0;
  recoveryTimer = 0;
  breachActive = false;
  breachTime = 0;
  breachImpactPending = false;
  breachLaunchYaw = 0;
  breachStartDepth = SURFACED_START_DEPTH;
  breachSpeed = 0;
  breachPrimed = false;
  ramYawVelocity = 0;

  private readonly fallbackVisualRoot = new THREE.Group();
  private readonly tetherAttachLocal = new THREE.Vector3(0, 0.16, 1.95);
  private activeVisualModel: THREE.Object3D | null = null;

  constructor() {
    const whaleMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#e9f1ff'),
      roughness: 0.7,
      metalness: 0.02,
      emissive: new THREE.Color('#6681aa'),
      emissiveIntensity: 0.2,
      flatShading: true,
    });

    const bellyMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ced9eb'),
      roughness: 0.82,
      metalness: 0.01,
      emissive: new THREE.Color('#526886'),
      emissiveIntensity: 0.12,
      flatShading: true,
    });

    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), whaleMaterial);
    body.scale.set(1.2, 0.85, 2.75);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), whaleMaterial);
    head.scale.set(1.1, 0.95, 1.4);
    head.position.set(0, -0.08, 3.9);

    const belly = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), bellyMaterial);
    belly.scale.set(0.82, 0.45, 2.1);
    belly.position.set(0, -0.85, 1.5);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(1.15, 2.7, 5), whaleMaterial);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, 0.15, -4.5);

    const fluke = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 1.15), whaleMaterial);
    fluke.position.set(0, 0, -5.8);

    const dorsalFin = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.45, 4), whaleMaterial);
    dorsalFin.position.set(0, 1.05, -0.55);
    dorsalFin.rotation.x = Math.PI / 2;

    const leftFin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.95), whaleMaterial);
    leftFin.position.set(-1.55, -0.35, 0.9);
    leftFin.rotation.z = Math.PI / 8;
    leftFin.rotation.x = -Math.PI / 4;

    const rightFin = leftFin.clone();
    rightFin.position.x *= -1;
    rightFin.rotation.z *= -1;

    this.fallbackVisualRoot.add(body, head, belly, tail, fluke, dorsalFin, leftFin, rightFin);
    this.visualRoot.add(this.fallbackVisualRoot);
    this.root.add(this.visualRoot);
    this.root.scale.setScalar(WHALE_VISUAL_SCALE);
    this.root.position.set(0, SURFACED_START_DEPTH, 0);
    this.root.rotation.order = 'YXZ';
  }

  reset(): void {
    this.speed = 0;
    this.throttle = 0.35;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.depth = SURFACED_START_DEPTH;
    this.verticalSpeed = 0;
    this.health = this.maxHealth;
    this.air = this.maxAir;
    this.boostActive = false;
    this.submerged = false;
    this.activeTethers = 0;
    this.speedDragMultiplier = 1;
    this.strokeBuildMultiplier = 1;
    this.turnDragMultiplier = 1;
    this.actionState = 'swim';
    this.strokeCharge = 0;
    this.strokeTimer = 0.92;
    this.strokeVisual = 0;
    this.tailSlapCooldown = 0;
    this.tailSlapTime = 0;
    this.tailSlapResolved = false;
    this.tailSlapStartYaw = 0;
    this.recoveryTimer = 0;
    this.breachActive = false;
    this.breachTime = 0;
    this.breachImpactPending = false;
    this.breachLaunchYaw = 0;
    this.breachStartDepth = SURFACED_START_DEPTH;
    this.breachSpeed = 0;
    this.breachPrimed = false;
    this.ramDriftVelocity.setScalar(0);
    this.ramYawVelocity = 0;
    this.breachDirection.set(0, 0, 1);
    this.breachOrigin.set(0, SURFACED_START_DEPTH, 0);
    this.root.position.set(0, SURFACED_START_DEPTH, 0);
    this.root.rotation.set(0, 0, 0, 'YXZ');
    this.root.updateMatrixWorld();
  }

  applyVisualModel(model: THREE.Object3D, profile: ActorVisualProfile): void {
    if (this.activeVisualModel) {
      this.activeVisualModel.removeFromParent();
    }

    this.fallbackVisualRoot.visible = false;
    this.activeVisualModel = model;
    this.visualRoot.add(model);

    if (profile.tetherAttach) {
      this.tetherAttachLocal.copy(profile.tetherAttach);
    }

    if (profile.surfaceSilhouetteScale) {
      this.surfaceSilhouetteScale.copy(profile.surfaceSilhouetteScale);
    }

    this.root.updateMatrixWorld();
  }

  applyDamage(amount: number): void {
    this.health = Math.max(0, this.health - amount);
  }

  consumeAir(amount: number): void {
    this.air = Math.max(0, this.air - amount);
  }

  restoreAir(amount: number): void {
    this.air = Math.min(this.maxAir, this.air + amount);
  }

  setTetherDrag(tetherCount: number): void {
    const clampedCount = Math.max(0, Math.floor(tetherCount));
    this.activeTethers = clampedCount;
    this.speedDragMultiplier = 1 - Math.min(clampedCount * 0.1, 0.5);
    this.strokeBuildMultiplier = 1 - Math.min(clampedCount * 0.18, 0.6);
    this.turnDragMultiplier = 1 - Math.min(clampedCount * 0.05, 0.25);
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 0, 1).applyQuaternion(this.root.quaternion).normalize();
  }

  getTetherAttachPoint(target = new THREE.Vector3()): THREE.Vector3 {
    return this.root.localToWorld(target.copy(this.tetherAttachLocal));
  }
}

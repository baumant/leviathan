import * as THREE from 'three';

import { createCelMaterial } from '../fx/createCelMaterial';

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
  readonly surfaceSilhouetteScale = new THREE.Vector2(5.6, 15.4);
  readonly subsurfaceRevealHalfExtents = new THREE.Vector2(3.3, 8.1);
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

  constructor() {
    const whaleMaterial = createCelMaterial({
      color: '#edf3ff',
      emissive: '#587093',
      emissiveIntensity: 0.12,
    });

    const bellyMaterial = createCelMaterial({
      color: '#d8e2f1',
      emissive: '#4d627f',
      emissiveIntensity: 0.08,
    });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.9, 5.4, 6, 12), whaleMaterial);
    body.rotation.x = Math.PI / 2;
    body.scale.set(1.22, 0.84, 1.46);

    const head = new THREE.Mesh(new THREE.SphereGeometry(1.65, 12, 10), whaleMaterial);
    head.scale.set(1.12, 0.92, 1.26);
    head.position.set(0, -0.04, 4.1);

    const brow = new THREE.Mesh(new THREE.SphereGeometry(1.26, 10, 8), whaleMaterial);
    brow.scale.set(1.18, 0.7, 1.06);
    brow.position.set(0, 0.32, 3.25);

    const belly = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 10), bellyMaterial);
    belly.scale.set(0.92, 0.46, 1.9);
    belly.position.set(0, -0.96, 1.4);

    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 1.08, 2.8, 8), whaleMaterial);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, 0.12, -4.65);

    const flukeBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.88), whaleMaterial);
    flukeBase.position.set(0, 0.02, -6.02);

    const leftFluke = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.2, 0.92), whaleMaterial);
    leftFluke.position.set(-1.25, 0, -6.18);
    leftFluke.rotation.z = -0.16;

    const rightFluke = leftFluke.clone();
    rightFluke.position.x *= -1;
    rightFluke.rotation.z *= -1;

    const dorsalFin = new THREE.Mesh(new THREE.ConeGeometry(0.44, 1.26, 5), whaleMaterial);
    dorsalFin.position.set(0, 1.05, -0.55);
    dorsalFin.rotation.x = Math.PI / 2;

    const leftFin = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.22, 1.02), whaleMaterial);
    leftFin.position.set(-1.55, -0.35, 0.9);
    leftFin.rotation.z = Math.PI / 8;
    leftFin.rotation.x = -Math.PI / 4;

    const rightFin = leftFin.clone();
    rightFin.position.x *= -1;
    rightFin.rotation.z *= -1;

    this.fallbackVisualRoot.add(body, head, brow, belly, tail, flukeBase, leftFluke, rightFluke, dorsalFin, leftFin, rightFin);
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

import * as THREE from 'three';

import { createWhaleHeroRig } from './WhaleHeroAsset';
import { createSpermWhaleVisual } from './createSpermWhaleVisual';

const SURFACED_START_DEPTH = -0.18;
const MAX_AIR = 12;
const WHALE_VISUAL_SCALE = 1.22;
const WHALE_COLLISION_RADIUS = 3.1;
const TAIL_VISUAL_WINDUP_TIME = 0.06;
const TAIL_VISUAL_SWEEP_TIME = 0.16;
const TAIL_VISUAL_ACTION_DURATION = 0.42;
const TAIL_VISUAL_RECOVERY = 0.18;
const TAIL_VISUAL_IMPACT_FLASH = 0.12;
const TAIL_VISUAL_WINDUP_ANGLE = THREE.MathUtils.degToRad(14);
const TAIL_VISUAL_SWEEP_ANGLE = THREE.MathUtils.degToRad(34);
const TAIL_VISUAL_IMPACT_OVEREXTENSION = THREE.MathUtils.degToRad(8);
const TAIL_VISUAL_FLUKE_ROLL = THREE.MathUtils.degToRad(8);

export type WhaleActionState = 'swim' | 'breach' | 'tail_slap' | 'recovery';

export class PlayerWhale {
  readonly root = new THREE.Group();
  readonly position = this.root.position;
  readonly maxHealth = 100;
  readonly maxAir = MAX_AIR;
  readonly radius = WHALE_COLLISION_RADIUS;
  readonly visualRoot = new THREE.Group();
  readonly surfaceSilhouetteScale = new THREE.Vector2(6.4, 17.8);
  readonly subsurfaceRevealHalfExtents = new THREE.Vector2(3.9, 9.4);
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

  private readonly fallbackVisualRoot: THREE.Group;
  private tailVisualPivot: THREE.Object3D;
  private flukeVisualPivot: THREE.Object3D;
  private leftFinPivot: THREE.Object3D | null = null;
  private rightFinPivot: THREE.Object3D | null = null;
  private tetherAttachNode: THREE.Object3D | null = null;
  private tailSlapAnchorNode: THREE.Object3D | null = null;
  private readonly tetherAttachLocal = new THREE.Vector3(0, 0.28, 2.34);
  private readonly tailSlapAnchorLocal = new THREE.Vector3(0, 0.02, -7.26);
  private tailVisualRecoveryTimer = 0;
  private tailVisualImpactTimer = 0;
  private tailVisualRecoveryStartYaw = 0;
  private tailVisualRecoveryStartRoll = 0;

  constructor() {
    const fallbackRig = createSpermWhaleVisual({
      palette: {
        bodyColor: '#edf3ff',
        bodyEmissive: '#587093',
        bodyEmissiveIntensity: 0.12,
        bellyColor: '#d8e2f1',
        bellyEmissive: '#4d627f',
        bellyEmissiveIntensity: 0.08,
      },
      lengthScale: 1.04,
      girthScale: 1.06,
      finScale: 1,
    });

    this.fallbackVisualRoot = fallbackRig.root;
    this.tailVisualPivot = fallbackRig.tailPivot;
    this.flukeVisualPivot = fallbackRig.flukePivot;

    this.visualRoot.add(this.fallbackVisualRoot);
    this.root.add(this.visualRoot);
    this.root.scale.setScalar(WHALE_VISUAL_SCALE);
    this.root.position.set(0, SURFACED_START_DEPTH, 0);
    this.root.rotation.order = 'YXZ';

    void this.loadHeroVisual();
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
    this.clearTailSlapVisual();
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
    if (this.tetherAttachNode) {
      return this.tetherAttachNode.getWorldPosition(target);
    }

    return this.root.localToWorld(target.copy(this.tetherAttachLocal));
  }

  getTailSlapAnchor(target = new THREE.Vector3()): THREE.Vector3 {
    if (this.tailSlapAnchorNode) {
      return this.tailSlapAnchorNode.getWorldPosition(target);
    }

    return this.root.localToWorld(target.copy(this.tailSlapAnchorLocal));
  }

  startTailSlapVisual(): void {
    this.tailVisualRecoveryTimer = 0;
    this.tailVisualImpactTimer = 0;
  }

  resolveTailSlapVisual(): void {
    this.tailVisualImpactTimer = TAIL_VISUAL_IMPACT_FLASH;
  }

  beginTailSlapVisualRecovery(): void {
    this.tailVisualRecoveryTimer = TAIL_VISUAL_RECOVERY;
    this.tailVisualRecoveryStartYaw = this.tailVisualPivot.rotation.y;
    this.tailVisualRecoveryStartRoll = this.flukeVisualPivot.rotation.z;
  }

  clearTailSlapVisual(): void {
    this.tailVisualRecoveryTimer = 0;
    this.tailVisualImpactTimer = 0;
    this.tailVisualRecoveryStartYaw = 0;
    this.tailVisualRecoveryStartRoll = 0;
    this.tailVisualPivot.rotation.set(0, 0, 0);
    this.flukeVisualPivot.rotation.set(0, 0, 0);

    if (this.leftFinPivot && this.rightFinPivot) {
      this.leftFinPivot.rotation.set(-0.28, 0.08, 0.42);
      this.rightFinPivot.rotation.set(-0.28, -0.08, -0.42);
    }
  }

  updateVisual(deltaSeconds: number): void {
    if (this.tailVisualImpactTimer > 0) {
      this.tailVisualImpactTimer = Math.max(0, this.tailVisualImpactTimer - deltaSeconds);
    }

    let tailYaw = 0;
    let flukeRoll = 0;

    if (this.actionState === 'tail_slap') {
      if (this.tailSlapTime < TAIL_VISUAL_WINDUP_TIME) {
        const alpha = THREE.MathUtils.clamp(this.tailSlapTime / TAIL_VISUAL_WINDUP_TIME, 0, 1);
        tailYaw = THREE.MathUtils.lerp(0, -TAIL_VISUAL_WINDUP_ANGLE, alpha);
      } else if (this.tailSlapTime < TAIL_VISUAL_SWEEP_TIME) {
        const alpha = THREE.MathUtils.clamp(
          (this.tailSlapTime - TAIL_VISUAL_WINDUP_TIME) / (TAIL_VISUAL_SWEEP_TIME - TAIL_VISUAL_WINDUP_TIME),
          0,
          1,
        );
        tailYaw = THREE.MathUtils.lerp(-TAIL_VISUAL_WINDUP_ANGLE, TAIL_VISUAL_SWEEP_ANGLE, alpha);
        flukeRoll = THREE.MathUtils.lerp(0, TAIL_VISUAL_FLUKE_ROLL * 0.35, alpha);
      } else {
        const alpha = THREE.MathUtils.clamp(
          (this.tailSlapTime - TAIL_VISUAL_SWEEP_TIME) / (TAIL_VISUAL_ACTION_DURATION - TAIL_VISUAL_SWEEP_TIME),
          0,
          1,
        );
        tailYaw = THREE.MathUtils.lerp(TAIL_VISUAL_SWEEP_ANGLE, TAIL_VISUAL_SWEEP_ANGLE * 0.18, alpha);
        flukeRoll = THREE.MathUtils.lerp(TAIL_VISUAL_FLUKE_ROLL * 0.35, 0, alpha);
      }
    } else if (this.tailVisualRecoveryTimer > 0) {
      this.tailVisualRecoveryTimer = Math.max(0, this.tailVisualRecoveryTimer - deltaSeconds);
      const alpha = this.tailVisualRecoveryTimer / TAIL_VISUAL_RECOVERY;
      tailYaw = this.tailVisualRecoveryStartYaw * alpha;
      flukeRoll = this.tailVisualRecoveryStartRoll * alpha;
    }

    const impactAlpha = this.tailVisualImpactTimer > 0 ? this.tailVisualImpactTimer / TAIL_VISUAL_IMPACT_FLASH : 0;
    tailYaw += impactAlpha * TAIL_VISUAL_IMPACT_OVEREXTENSION;
    flukeRoll += impactAlpha * TAIL_VISUAL_FLUKE_ROLL;

    this.tailVisualPivot.rotation.set(0, tailYaw, 0);
    this.flukeVisualPivot.rotation.set(0, 0, flukeRoll);

    if (this.leftFinPivot && this.rightFinPivot) {
      const strokeAlpha = THREE.MathUtils.clamp(this.strokeVisual, 0, 1);
      const finPitch =
        this.actionState === 'tail_slap'
          ? THREE.MathUtils.lerp(-0.32, -0.56, Math.min(this.tailSlapTime / TAIL_VISUAL_SWEEP_TIME, 1))
          : -0.28 - strokeAlpha * 0.12;
      const finRoll =
        this.actionState === 'tail_slap'
          ? 0.34 - strokeAlpha * 0.04
          : 0.42 - strokeAlpha * 0.08;

      this.leftFinPivot.rotation.set(finPitch, 0.08, finRoll);
      this.rightFinPivot.rotation.set(finPitch, -0.08, -finRoll);
    }
  }

  private async loadHeroVisual(): Promise<void> {
    try {
      const tailRotation = this.tailVisualPivot.rotation.clone();
      const flukeRotation = this.flukeVisualPivot.rotation.clone();
      const heroRig = await createWhaleHeroRig('player');

      this.visualRoot.add(heroRig.root);
      this.fallbackVisualRoot.visible = false;

      this.tailVisualPivot = heroRig.tailPivot;
      this.flukeVisualPivot = heroRig.flukePivot;
      this.leftFinPivot = heroRig.leftFinPivot;
      this.rightFinPivot = heroRig.rightFinPivot;
      this.tetherAttachNode = heroRig.tetherAttach;
      this.tailSlapAnchorNode = heroRig.tailSlapAnchor;

      this.tailVisualPivot.rotation.copy(tailRotation);
      this.flukeVisualPivot.rotation.copy(flukeRotation);

      if (this.leftFinPivot && this.rightFinPivot) {
        this.leftFinPivot.rotation.set(-0.28, 0.08, 0.42);
        this.rightFinPivot.rotation.set(-0.28, -0.08, -0.42);
      }
    } catch (error) {
      console.warn('Failed to load whale hero asset, keeping procedural fallback.', error);
    }
  }
}

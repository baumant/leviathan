import * as THREE from 'three';

import { WHALE_SPEED_PROFILE } from '../tuning/whaleSpeedProfile';
import { createWhaleHeroRig } from './WhaleHeroAsset';
import {
  WHALE_FIN_NEUTRAL_PITCH,
  WHALE_FIN_NEUTRAL_ROLL,
  applyWhaleVisualPose,
  resetWhaleVisualPose,
  sampleWhaleSwimPose,
} from './WhaleVisualMotion';
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
const SWIM_PULSE_RETRIGGER_THRESHOLD = 0.08;
const SWIM_PULSE_MIN_VISUAL = 0.28;
const SWIM_PULSE_AMPLITUDE_RISE = 7.2;
const SWIM_PULSE_AMPLITUDE_FALL = 5.2;
const SWIM_PULSE_FREQUENCY_MIN = 1.18;
const SWIM_PULSE_FREQUENCY_MAX = 1.9;
const SWIM_PULSE_RECOVERY_SUPPRESSION = 0.42;
const TOPSIDE_SUBSURFACE_COLOR = new THREE.Color('#6f8690');
const TOPSIDE_SUBSURFACE_EMISSIVE = new THREE.Color('#182932');
const TOPSIDE_SUBSURFACE_OPACITY_MIN = 0.1;
const TOPSIDE_SUBSURFACE_OPACITY_MAX = 0.44;
const TOPSIDE_SUBSURFACE_EYE_OPACITY_MAX = 0.14;
const TOPSIDE_SUBSURFACE_TINT = 0.78;
const TOPSIDE_SUBSURFACE_EMISSIVE_INTENSITY = 0.032;

export type WhaleActionState = 'swim' | 'breach' | 'tail_slap' | 'recovery';
export type WhaleVisualPresentation = 'surface' | 'topside_subsurface';

type WhalePresentationMaterial = THREE.MeshToonMaterial | THREE.MeshBasicMaterial;

interface WhalePresentationMaterialState {
  material: WhalePresentationMaterial;
  color: THREE.Color;
  emissive: THREE.Color | null;
  emissiveIntensity: number | null;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
}

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
  readonly travelVelocity = new THREE.Vector3();

  speed = 0;
  forwardSpeed = 0;
  throttle = 0.35;
  yaw = 0;
  pitch = 0;
  roll = 0;
  depth = SURFACED_START_DEPTH;
  verticalSpeed = 0;
  health = this.maxHealth;
  air = this.maxAir;
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
  private bodyVisualRoot: THREE.Object3D;
  private tailVisualPivot: THREE.Object3D;
  private flukeVisualPivot: THREE.Object3D;
  private leftFinPivot: THREE.Object3D;
  private rightFinPivot: THREE.Object3D;
  private tetherAttachNode: THREE.Object3D | null = null;
  private tailSlapAnchorNode: THREE.Object3D | null = null;
  private readonly tetherAttachLocal = new THREE.Vector3(0, 0.28, 2.34);
  private readonly tailSlapAnchorLocal = new THREE.Vector3(0, 0.02, -7.26);
  private readonly travelForward = new THREE.Vector3(0, 0, 1);
  private tailVisualRecoveryTimer = 0;
  private tailVisualImpactTimer = 0;
  private tailVisualRecoveryStartYaw = 0;
  private tailVisualRecoveryStartRoll = 0;
  private swimPulsePhase = 0;
  private swimPulseAmplitude = 0;
  private previousStrokeVisual = 0;
  private readonly presentationMaterials = new Map<WhalePresentationMaterial, WhalePresentationMaterialState>();
  private visualPresentation: WhaleVisualPresentation = 'surface';
  private visualPresentationStrength = 0;

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
    this.bodyVisualRoot = fallbackRig.bodyRoot;
    this.tailVisualPivot = fallbackRig.tailPivot;
    this.flukeVisualPivot = fallbackRig.flukePivot;
    this.leftFinPivot = fallbackRig.leftFinPivot;
    this.rightFinPivot = fallbackRig.rightFinPivot;

    this.visualRoot.add(this.fallbackVisualRoot);
    this.root.add(this.visualRoot);
    this.root.scale.setScalar(WHALE_VISUAL_SCALE);
    this.root.position.set(0, SURFACED_START_DEPTH, 0);
    this.root.rotation.order = 'YXZ';
    this.registerPresentationMaterials(this.fallbackVisualRoot);
    resetWhaleVisualPose(
      this.bodyVisualRoot,
      this.tailVisualPivot,
      this.flukeVisualPivot,
      this.leftFinPivot,
      this.rightFinPivot,
    );

    void this.loadHeroVisual();
  }

  reset(): void {
    this.speed = 0;
    this.forwardSpeed = 0;
    this.throttle = 0.35;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.depth = SURFACED_START_DEPTH;
    this.verticalSpeed = 0;
    this.health = this.maxHealth;
    this.air = this.maxAir;
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
    this.travelVelocity.setScalar(0);
    this.ramYawVelocity = 0;
    this.swimPulsePhase = 0;
    this.swimPulseAmplitude = 0;
    this.previousStrokeVisual = 0;
    this.breachDirection.set(0, 0, 1);
    this.breachOrigin.set(0, SURFACED_START_DEPTH, 0);
    this.root.position.set(0, SURFACED_START_DEPTH, 0);
    this.root.rotation.set(0, 0, 0, 'YXZ');
    this.clearTailSlapVisual();
    this.setVisualPresentation('surface');
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

  syncTravelState(): void {
    this.travelForward.set(0, 0, 1).applyQuaternion(this.root.quaternion).setY(0);

    if (this.travelForward.lengthSq() <= 0.000001) {
      this.travelForward.set(0, 0, 1);
    } else {
      this.travelForward.normalize();
    }

    this.travelVelocity.copy(this.ramDriftVelocity).addScaledVector(this.travelForward, this.forwardSpeed);
    this.travelVelocity.y = this.verticalSpeed;
    this.speed = this.travelVelocity.length();
  }

  scaleTravelMotion(scale: number): void {
    this.forwardSpeed *= scale;
    this.verticalSpeed *= scale;
    this.syncTravelState();
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
    resetWhaleVisualPose(
      this.bodyVisualRoot,
      this.tailVisualPivot,
      this.flukeVisualPivot,
      this.leftFinPivot,
      this.rightFinPivot,
    );
  }

  setVisualPresentation(presentation: WhaleVisualPresentation, strength = 1): void {
    this.visualPresentation = presentation;
    this.visualPresentationStrength =
      presentation === 'topside_subsurface' ? THREE.MathUtils.clamp(strength, 0, 1) : 0;
    this.applyVisualPresentation();
  }

  updateVisual(deltaSeconds: number): void {
    if (this.tailVisualImpactTimer > 0) {
      this.tailVisualImpactTimer = Math.max(0, this.tailVisualImpactTimer - deltaSeconds);
    }

    const swimPose = this.updateSwimPulse(deltaSeconds);
    let tailYaw = 0;
    let flukeRoll = 0;
    let finPitchOffset = 0;
    let finRollOffset = 0;

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

      finPitchOffset =
        THREE.MathUtils.lerp(-0.32, -0.56, Math.min(this.tailSlapTime / TAIL_VISUAL_SWEEP_TIME, 1)) -
        WHALE_FIN_NEUTRAL_PITCH;
      finRollOffset = (0.34 - THREE.MathUtils.clamp(this.strokeVisual, 0, 1) * 0.04) - WHALE_FIN_NEUTRAL_ROLL;
    } else if (this.tailVisualRecoveryTimer > 0) {
      this.tailVisualRecoveryTimer = Math.max(0, this.tailVisualRecoveryTimer - deltaSeconds);
      const alpha = this.tailVisualRecoveryTimer / TAIL_VISUAL_RECOVERY;
      tailYaw = this.tailVisualRecoveryStartYaw * alpha;
      flukeRoll = this.tailVisualRecoveryStartRoll * alpha;
    }

    const impactAlpha = this.tailVisualImpactTimer > 0 ? this.tailVisualImpactTimer / TAIL_VISUAL_IMPACT_FLASH : 0;
    tailYaw += impactAlpha * TAIL_VISUAL_IMPACT_OVEREXTENSION;
    flukeRoll += impactAlpha * TAIL_VISUAL_FLUKE_ROLL;

    applyWhaleVisualPose(
      this.bodyVisualRoot,
      this.tailVisualPivot,
      this.flukeVisualPivot,
      this.leftFinPivot,
      this.rightFinPivot,
      swimPose,
      {
        tailYaw,
        flukeRoll,
        finPitch: finPitchOffset,
        finRoll: finRollOffset,
      },
    );
  }

  private updateSwimPulse(deltaSeconds: number) {
    const actionSuppression =
      this.actionState === 'swim' ? 1 : this.actionState === 'recovery' ? SWIM_PULSE_RECOVERY_SUPPRESSION : 0;
    const strokeRise = this.strokeVisual - this.previousStrokeVisual;
    const speedRatio = THREE.MathUtils.clamp(
      this.speed / Math.max(WHALE_SPEED_PROFILE.maxTravelSpeed, 0.001),
      0,
      1.2,
    );

    if (
      this.actionState === 'swim' &&
      strokeRise > SWIM_PULSE_RETRIGGER_THRESHOLD &&
      this.strokeVisual > SWIM_PULSE_MIN_VISUAL
    ) {
      this.swimPulsePhase = 0;
    }

    const targetAmplitude = this.strokeVisual * actionSuppression;
    this.swimPulseAmplitude = THREE.MathUtils.damp(
      this.swimPulseAmplitude,
      targetAmplitude,
      targetAmplitude > this.swimPulseAmplitude ? SWIM_PULSE_AMPLITUDE_RISE : SWIM_PULSE_AMPLITUDE_FALL,
      deltaSeconds,
    );

    if (this.swimPulseAmplitude > 0.001 || targetAmplitude > 0.001) {
      const frequency = THREE.MathUtils.lerp(SWIM_PULSE_FREQUENCY_MIN, SWIM_PULSE_FREQUENCY_MAX, speedRatio);
      this.swimPulsePhase += deltaSeconds * frequency * Math.PI * 2;
      if (this.swimPulsePhase > Math.PI * 2) {
        this.swimPulsePhase %= Math.PI * 2;
      }
    }

    this.previousStrokeVisual = this.strokeVisual;
    return sampleWhaleSwimPose(this.swimPulsePhase, this.swimPulseAmplitude);
  }

  private async loadHeroVisual(): Promise<void> {
    try {
      const bodyRotation = this.bodyVisualRoot.rotation.clone();
      const tailRotation = this.tailVisualPivot.rotation.clone();
      const flukeRotation = this.flukeVisualPivot.rotation.clone();
      const leftFinRotation = this.leftFinPivot.rotation.clone();
      const rightFinRotation = this.rightFinPivot.rotation.clone();
      const heroRig = await createWhaleHeroRig('player');

      this.visualRoot.add(heroRig.root);
      this.registerPresentationMaterials(heroRig.root);
      this.fallbackVisualRoot.visible = false;

      this.bodyVisualRoot = heroRig.bodyRoot;
      this.tailVisualPivot = heroRig.tailPivot;
      this.flukeVisualPivot = heroRig.flukePivot;
      this.leftFinPivot = heroRig.leftFinPivot;
      this.rightFinPivot = heroRig.rightFinPivot;
      this.tetherAttachNode = heroRig.tetherAttach;
      this.tailSlapAnchorNode = heroRig.tailSlapAnchor;

      this.bodyVisualRoot.rotation.copy(bodyRotation);
      this.tailVisualPivot.rotation.copy(tailRotation);
      this.flukeVisualPivot.rotation.copy(flukeRotation);
      this.leftFinPivot.rotation.copy(leftFinRotation);
      this.rightFinPivot.rotation.copy(rightFinRotation);
      this.applyVisualPresentation();
    } catch (error) {
      console.warn('Failed to load whale hero asset, keeping procedural fallback.', error);
    }
  }

  private registerPresentationMaterials(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (
          !(material instanceof THREE.MeshToonMaterial) &&
          !(material instanceof THREE.MeshBasicMaterial)
        ) {
          continue;
        }

        if (this.presentationMaterials.has(material)) {
          continue;
        }

        this.presentationMaterials.set(material, {
          material,
          color: material.color.clone(),
          emissive: material instanceof THREE.MeshToonMaterial ? material.emissive.clone() : null,
          emissiveIntensity: material instanceof THREE.MeshToonMaterial ? material.emissiveIntensity : null,
          transparent: material.transparent,
          opacity: material.opacity,
          depthWrite: material.depthWrite,
        });
      }
    });
  }

  private applyVisualPresentation(): void {
    for (const state of this.presentationMaterials.values()) {
      const { material } = state;

      material.color.copy(state.color);
      material.transparent = state.transparent;
      material.opacity = state.opacity;
      material.depthWrite = state.depthWrite;

      if (material instanceof THREE.MeshToonMaterial && state.emissive && state.emissiveIntensity !== null) {
        material.emissive.copy(state.emissive);
        material.emissiveIntensity = state.emissiveIntensity;
      }

      if (this.visualPresentation === 'topside_subsurface') {
        const strength = this.visualPresentationStrength;
        const opacity = THREE.MathUtils.lerp(
          TOPSIDE_SUBSURFACE_OPACITY_MIN,
          TOPSIDE_SUBSURFACE_OPACITY_MAX,
          strength,
        );

        // Keep the whale readable through the water by pushing it toward the
        // same cool fog range as the sea, rather than showing full topside values.
        material.transparent = true;
        material.depthWrite = false;
        material.color.copy(state.color).lerp(TOPSIDE_SUBSURFACE_COLOR, TOPSIDE_SUBSURFACE_TINT);

        if (material instanceof THREE.MeshToonMaterial && state.emissiveIntensity !== null) {
          material.opacity = Math.min(state.opacity, opacity);
          material.emissive.copy(state.emissive ?? TOPSIDE_SUBSURFACE_EMISSIVE).lerp(TOPSIDE_SUBSURFACE_EMISSIVE, 0.9);
          material.emissiveIntensity = Math.min(
            state.emissiveIntensity,
            THREE.MathUtils.lerp(state.emissiveIntensity, TOPSIDE_SUBSURFACE_EMISSIVE_INTENSITY, 0.92),
          );
        } else {
          material.opacity = Math.min(
            state.opacity,
            THREE.MathUtils.lerp(TOPSIDE_SUBSURFACE_OPACITY_MIN * 0.24, TOPSIDE_SUBSURFACE_EYE_OPACITY_MAX, strength),
          );
        }
      }

      material.needsUpdate = true;
    }
  }
}

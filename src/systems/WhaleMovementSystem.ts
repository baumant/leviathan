import * as THREE from 'three';

import { PlayerWhale, WhaleActionState } from '../entities/PlayerWhale';
import { Input } from '../game/Input';
import { WHALE_SPEED_PROFILE } from '../tuning/whaleSpeedProfile';

const SURFACE_SPEED = WHALE_SPEED_PROFILE.surfaceSpeed;
const SUBMERGED_SPEED = WHALE_SPEED_PROFILE.submergedSpeed;
const MAX_TRAVEL_SPEED = WHALE_SPEED_PROFILE.maxTravelSpeed;
const SURFACE_TURN_RATE = WHALE_SPEED_PROFILE.surfaceTurnRate;
const SUBMERGED_TURN_RATE = WHALE_SPEED_PROFILE.submergedTurnRate;
const MAX_DEPTH = -100;
const MAX_BREACH_HEIGHT = 0.9;

const STROKE_BUILD_TIME = 1.8;
const STROKE_DECAY_TIME = 1.1;
const STROKE_INTERVAL = 0.58;
const STROKE_IMPULSE_MIN = WHALE_SPEED_PROFILE.strokeImpulseMin;
const STROKE_IMPULSE_MAX = WHALE_SPEED_PROFILE.strokeImpulseMax;
const TURN_CHARGE_CAP = 0.45;
const BASELINE_SPEED_SURFACE_FACTOR = 0.46;
const BASELINE_SPEED_SUBMERGED_FACTOR = 0.38;
const BASELINE_ACCELERATION = WHALE_SPEED_PROFILE.baselineAcceleration;

const BREACH_DURATION = 1.45;
const BREACH_RECOVERY = 0.24;
const BREACH_PEAK_HEIGHT = 8.4;
const AUTO_BREACH_DEPTH_THRESHOLD = -1.0;
const BREACH_ARM_DEPTH = -4.5;
const BREACH_PRIME_RESET_DEPTH = -1.35;
const BREACH_MIN_VERTICAL_SPEED = 3.0;
const BREACH_INNER_RADIUS = 6;
const BREACH_OUTER_RADIUS = 14;
const BREACH_HANG_EXPONENT = 0.72;
const BREACH_HORIZONTAL_SWAY = 0.8;

const TAIL_SLAP_DURATION = 0.42;
const TAIL_SLAP_TURN_DURATION = 0.16;
const TAIL_SLAP_RECOVERY = 0.18;
const TAIL_SLAP_COOLDOWN = 2.2;
const TAIL_SLAP_DEPTH_LIMIT = -3.5;
const TAIL_SLAP_INNER_RADIUS = 10;
const TAIL_SLAP_OUTER_RADIUS = 18;
const TAIL_SLAP_HALF_ANGLE = THREE.MathUtils.degToRad(78);
const TAIL_SLAP_TRAVEL_SPEED = WHALE_SPEED_PROFILE.tailSlapTravelSpeed;
const TAIL_SLAP_SURFACE_TARGET_DEPTH = -0.18;
const RAM_RESPONSE_DAMPING = 4.8;

export interface WhaleBreachImpactEvent {
  position: THREE.Vector3;
  innerRadius: number;
  outerRadius: number;
}

export interface WhaleTailSlapEvent {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  innerRadius: number;
  outerRadius: number;
  halfAngle: number;
}

export interface WhaleMovementResult {
  actionState: WhaleActionState;
  strokePulseFired: boolean;
  strokePulseStrength: number;
  breachStarted: boolean;
  breachImpact: WhaleBreachImpactEvent | null;
  tailSlap: WhaleTailSlapEvent | null;
}

export class WhaleMovementSystem {
  private readonly forward = new THREE.Vector3();
  private readonly tailSlapOrigin = new THREE.Vector3();
  private readonly currentTravel = new THREE.Vector2();
  private readonly targetTravel = new THREE.Vector2();
  private readonly strokeDirection = new THREE.Vector2();

  update(
    whale: PlayerWhale,
    input: Input,
    deltaSeconds: number,
    oceanHeightAt: (x: number, z: number) => number,
  ): WhaleMovementResult {
    const result: WhaleMovementResult = {
      actionState: whale.actionState,
      strokePulseFired: false,
      strokePulseStrength: 0,
      breachStarted: false,
      breachImpact: null,
      tailSlap: null,
    };

    const tailSlapPressed = input.consumeTailSlapPressed();
    whale.tailSlapCooldown = Math.max(0, whale.tailSlapCooldown - deltaSeconds);
    whale.strokeVisual = THREE.MathUtils.damp(whale.strokeVisual, 0, 5.6, deltaSeconds);

    if (whale.actionState === 'breach' && whale.breachActive) {
      return this.updateBreach(whale, deltaSeconds, oceanHeightAt, result);
    }

    if (whale.actionState === 'tail_slap') {
      return this.updateTailSlap(whale, deltaSeconds, oceanHeightAt, result);
    }

    const moveInput = input.moveAxis;
    const turnInput = input.turnAxis;
    const depthInput = input.depthAxis;
    const propulsionForwardInput = Math.max(0, moveInput);
    const propulsionVerticalInput = depthInput;
    const propulsionActive = propulsionForwardInput > 0 || propulsionVerticalInput !== 0;
    const submergedFactor = THREE.MathUtils.clamp((-whale.depth - 0.5) / 5, 0, 1);
    const recoveryScale = whale.actionState === 'recovery' ? 0.68 : 1;

    if (whale.actionState === 'recovery') {
      whale.recoveryTimer = Math.max(0, whale.recoveryTimer - deltaSeconds);
      if (whale.recoveryTimer === 0) {
        whale.actionState = 'swim';
      }
    }

    const throttleTarget = propulsionActive ? 1 : moveInput < 0 ? 0 : 0.35;
    whale.throttle = THREE.MathUtils.damp(whale.throttle, throttleTarget, moveInput < 0 ? 5.5 : 3.2, deltaSeconds);

    const cruiseSpeed = THREE.MathUtils.lerp(SURFACE_SPEED, SUBMERGED_SPEED, submergedFactor);
    const topTravelSpeed = cruiseSpeed * whale.speedDragMultiplier;

    if (propulsionActive) {
      whale.strokeCharge = Math.min(1, whale.strokeCharge + (deltaSeconds / STROKE_BUILD_TIME) * whale.strokeBuildMultiplier);
    } else {
      whale.strokeCharge = Math.max(0, whale.strokeCharge - deltaSeconds / STROKE_DECAY_TIME);
    }

    const effectiveStrokeCharge =
      Math.abs(turnInput) > 0.5 ? Math.min(whale.strokeCharge, TURN_CHARGE_CAP) : whale.strokeCharge;
    const baselineTargetSpeed =
      topTravelSpeed *
      whale.throttle *
      THREE.MathUtils.lerp(BASELINE_SPEED_SURFACE_FACTOR, BASELINE_SPEED_SUBMERGED_FACTOR, submergedFactor);
    const baselineAcceleration = BASELINE_ACCELERATION * whale.strokeBuildMultiplier * recoveryScale;

    if (propulsionActive) {
      this.targetTravel.set(propulsionForwardInput, propulsionVerticalInput).normalize();
    } else if (moveInput < 0) {
      this.targetTravel.set(0, 0);
    } else {
      this.targetTravel.set(1, 0);
    }
    this.targetTravel.multiplyScalar(baselineTargetSpeed);

    whale.forwardSpeed = THREE.MathUtils.damp(
      whale.forwardSpeed,
      this.targetTravel.x,
      moveInput < 0 ? 5.5 : baselineAcceleration,
      deltaSeconds,
    );
    whale.verticalSpeed = THREE.MathUtils.damp(
      whale.verticalSpeed,
      this.targetTravel.y,
      propulsionActive ? baselineAcceleration : 2.4,
      deltaSeconds,
    );

    if (propulsionActive) {
      whale.strokeTimer = Math.min(whale.strokeTimer, STROKE_INTERVAL);
      whale.strokeTimer -= deltaSeconds;

      if (whale.strokeTimer <= 0) {
        const strokeImpulse =
          THREE.MathUtils.lerp(STROKE_IMPULSE_MIN, STROKE_IMPULSE_MAX, effectiveStrokeCharge) *
          THREE.MathUtils.lerp(1.12, 1, submergedFactor) *
          whale.speedDragMultiplier;

        this.strokeDirection.set(propulsionForwardInput, propulsionVerticalInput).normalize();
        this.currentTravel.set(whale.forwardSpeed, whale.verticalSpeed).addScaledVector(this.strokeDirection, strokeImpulse);

        if (this.currentTravel.lengthSq() > topTravelSpeed * topTravelSpeed) {
          this.currentTravel.setLength(topTravelSpeed);
        }

        whale.forwardSpeed = this.currentTravel.x;
        whale.verticalSpeed = this.currentTravel.y;

        whale.strokeVisual = Math.max(whale.strokeVisual, THREE.MathUtils.lerp(0.46, 1.0, effectiveStrokeCharge));
        whale.strokeTimer += STROKE_INTERVAL;
        result.strokePulseFired = true;
        result.strokePulseStrength = strokeImpulse;
      }
    } else {
      whale.strokeTimer = Math.min(STROKE_INTERVAL, whale.strokeTimer + deltaSeconds * 0.9);
    }

    whale.syncTravelState();

    const turnRate =
      THREE.MathUtils.lerp(SURFACE_TURN_RATE, SUBMERGED_TURN_RATE, submergedFactor) *
      whale.turnDragMultiplier *
      recoveryScale;
    const speedTurnScale = THREE.MathUtils.clamp(0.45 + whale.speed / MAX_TRAVEL_SPEED, 0.45, 1.1);
    whale.yaw -= turnInput * turnRate * speedTurnScale * deltaSeconds;

    if (whale.actionState === 'swim' && tailSlapPressed && whale.depth >= TAIL_SLAP_DEPTH_LIMIT) {
      this.startTailSlap(whale);
      return this.updateTailSlap(whale, deltaSeconds, oceanHeightAt, result);
    }

    whale.depth += whale.verticalSpeed * deltaSeconds;
    whale.depth = THREE.MathUtils.clamp(whale.depth, MAX_DEPTH, MAX_BREACH_HEIGHT);
    whale.submerged = whale.depth < -0.45;

    if (whale.depth <= BREACH_ARM_DEPTH) {
      whale.breachPrimed = true;
    }

    if (whale.depth >= BREACH_PRIME_RESET_DEPTH && whale.verticalSpeed <= 0) {
      whale.breachPrimed = false;
    }

    if (
      whale.actionState === 'swim' &&
      whale.breachPrimed &&
      whale.verticalSpeed > 0 &&
      whale.verticalSpeed >= BREACH_MIN_VERTICAL_SPEED &&
      whale.depth >= AUTO_BREACH_DEPTH_THRESHOLD
    ) {
      this.startBreach(whale);
      result.breachStarted = true;
      return this.updateBreach(whale, deltaSeconds, oceanHeightAt, result);
    }

    const pitchTarget = -THREE.MathUtils.clamp(whale.verticalSpeed * 0.075, -0.42, 0.38) - whale.strokeVisual * 0.06;
    whale.pitch = THREE.MathUtils.damp(whale.pitch, pitchTarget, 4.2, deltaSeconds);
    whale.roll = THREE.MathUtils.damp(
      whale.roll,
      turnInput * 0.35 * THREE.MathUtils.clamp(whale.speed / Math.max(MAX_TRAVEL_SPEED, 0.001), 0, 1.2),
      4.6,
      deltaSeconds,
    );

    whale.root.rotation.set(whale.pitch, whale.yaw, whale.roll, 'YXZ');
    whale.getForward(this.forward).setY(0);

    if (this.forward.lengthSq() <= 0.000001) {
      this.forward.set(0, 0, 1);
    } else {
      this.forward.normalize();
    }

    whale.position.addScaledVector(this.forward, whale.forwardSpeed * deltaSeconds);
    this.applyRamResponse(whale, deltaSeconds);

    whale.root.rotation.set(whale.pitch, whale.yaw, whale.roll, 'YXZ');
    const surfaceHeight = oceanHeightAt(whale.position.x, whale.position.z);
    whale.position.y = surfaceHeight + whale.depth;
    whale.root.updateMatrixWorld();
    whale.syncTravelState();

    result.actionState = whale.actionState;
    return result;
  }

  private updateBreach(
    whale: PlayerWhale,
    deltaSeconds: number,
    oceanHeightAt: (x: number, z: number) => number,
    result: WhaleMovementResult,
  ): WhaleMovementResult {
    const previousDepth = whale.depth;
    const previousProgress = THREE.MathUtils.clamp(whale.breachTime / BREACH_DURATION, 0, 1);
    const previousHorizontalOffset = Math.sin(previousProgress * Math.PI) * BREACH_HORIZONTAL_SWAY;
    whale.breachTime += deltaSeconds;

    const progress = THREE.MathUtils.clamp(whale.breachTime / BREACH_DURATION, 0, 1);
    const hangArc = Math.pow(Math.sin(progress * Math.PI), BREACH_HANG_EXPONENT);
    const arc = hangArc * BREACH_PEAK_HEIGHT;
    const baseDepth = THREE.MathUtils.lerp(whale.breachStartDepth, -0.85, progress);
    whale.depth = baseDepth + arc;
    whale.depth = Math.min(whale.depth, BREACH_PEAK_HEIGHT);
    whale.verticalSpeed = (whale.depth - previousDepth) / Math.max(deltaSeconds, 0.0001);

    whale.yaw = whale.breachLaunchYaw;
    whale.roll = THREE.MathUtils.damp(whale.roll, 0, 5.4, deltaSeconds);
    whale.pitch = THREE.MathUtils.damp(
      whale.pitch,
      -THREE.MathUtils.clamp(whale.verticalSpeed * 0.11, -1.02, 0.92),
      4.6,
      deltaSeconds,
    );
    whale.root.rotation.set(whale.pitch, whale.yaw, whale.roll, 'YXZ');

    const horizontalOffset = Math.sin(progress * Math.PI) * BREACH_HORIZONTAL_SWAY;
    whale.forwardSpeed = (horizontalOffset - previousHorizontalOffset) / Math.max(deltaSeconds, 0.0001);
    whale.position.copy(whale.breachOrigin).addScaledVector(whale.breachDirection, horizontalOffset);

    const surfaceHeight = oceanHeightAt(whale.position.x, whale.position.z);
    whale.position.y = surfaceHeight + whale.depth;
    whale.submerged = whale.depth < -0.45;
    whale.root.updateMatrixWorld();
    whale.syncTravelState();

    if (whale.breachImpactPending && progress > 0.45 && previousDepth > 0 && whale.depth <= 0) {
      whale.breachImpactPending = false;
      whale.strokeVisual = Math.max(whale.strokeVisual, 1);
      result.breachImpact = {
        position: new THREE.Vector3(whale.position.x, surfaceHeight, whale.position.z),
        innerRadius: BREACH_INNER_RADIUS,
        outerRadius: BREACH_OUTER_RADIUS,
      };
    }

    if (progress >= 1) {
      whale.breachActive = false;
      whale.actionState = 'recovery';
      whale.recoveryTimer = BREACH_RECOVERY;
      whale.forwardSpeed = 0;
      whale.verticalSpeed = 0;
      whale.depth = -0.35;
      whale.syncTravelState();
    }

    result.actionState = whale.actionState;
    return result;
  }

  private updateTailSlap(
    whale: PlayerWhale,
    deltaSeconds: number,
    oceanHeightAt: (x: number, z: number) => number,
    result: WhaleMovementResult,
  ): WhaleMovementResult {
    const previousTime = whale.tailSlapTime;
    whale.tailSlapTime += deltaSeconds;

    const turnAlpha = THREE.MathUtils.clamp(whale.tailSlapTime / TAIL_SLAP_TURN_DURATION, 0, 1);
    const easedTurn = turnAlpha * turnAlpha * (3 - 2 * turnAlpha);

    whale.yaw = whale.tailSlapStartYaw + Math.PI * easedTurn;
    whale.depth = THREE.MathUtils.damp(
      whale.depth,
      Math.max(whale.depth, TAIL_SLAP_SURFACE_TARGET_DEPTH),
      5.6,
      deltaSeconds,
    );
    whale.verticalSpeed = THREE.MathUtils.damp(whale.verticalSpeed, 0, 6.2, deltaSeconds);
    whale.pitch = THREE.MathUtils.damp(whale.pitch, -0.08, 5.4, deltaSeconds);
    whale.roll = THREE.MathUtils.damp(whale.roll, Math.sin(turnAlpha * Math.PI) * 0.4, 6.2, deltaSeconds);
    whale.forwardSpeed = THREE.MathUtils.damp(whale.forwardSpeed, TAIL_SLAP_TRAVEL_SPEED, 6.8, deltaSeconds);
    whale.root.rotation.set(whale.pitch, whale.yaw, whale.roll, 'YXZ');

    whale.getForward(this.forward).setY(0);

    if (this.forward.lengthSq() <= 0.000001) {
      this.forward.set(0, 0, 1);
    } else {
      this.forward.normalize();
    }

    whale.position.addScaledVector(this.forward, whale.forwardSpeed * deltaSeconds);

    const surfaceHeight = oceanHeightAt(whale.position.x, whale.position.z);
    whale.position.y = surfaceHeight + whale.depth;
    whale.submerged = whale.depth < -0.45;
    whale.root.updateMatrixWorld();
    whale.syncTravelState();

    if (!whale.tailSlapResolved && previousTime < TAIL_SLAP_TURN_DURATION && whale.tailSlapTime >= TAIL_SLAP_TURN_DURATION) {
      whale.tailSlapResolved = true;
      whale.strokeVisual = Math.max(whale.strokeVisual, 0.9);
      result.tailSlap = {
        origin: whale.getTailSlapAnchor(this.tailSlapOrigin).clone(),
        direction: whale.getForward(new THREE.Vector3()).setY(0).normalize(),
        innerRadius: TAIL_SLAP_INNER_RADIUS,
        outerRadius: TAIL_SLAP_OUTER_RADIUS,
        halfAngle: TAIL_SLAP_HALF_ANGLE,
      };
    }

    if (whale.tailSlapTime >= TAIL_SLAP_DURATION) {
      whale.actionState = 'recovery';
      whale.recoveryTimer = TAIL_SLAP_RECOVERY;
      whale.forwardSpeed = Math.max(whale.forwardSpeed * 0.92, WHALE_SPEED_PROFILE.postTailSlapRecoverySpeedFloor);
      whale.syncTravelState();
      whale.tailSlapTime = 0;
    }

    result.actionState = whale.actionState;
    return result;
  }

  private startBreach(whale: PlayerWhale): void {
    whale.actionState = 'breach';
    whale.breachActive = true;
    whale.breachTime = 0;
    whale.breachImpactPending = true;
    whale.breachStartDepth = whale.depth;
    whale.breachLaunchYaw = whale.yaw;
    whale.breachSpeed = whale.speed * 0.92;
    whale.breachPrimed = false;
    whale.tailSlapTime = 0;
    whale.recoveryTimer = 0;
    whale.breachOrigin.copy(whale.position);
    whale.getForward(whale.breachDirection).setY(0).normalize();
    whale.strokeVisual = Math.max(whale.strokeVisual, 1);
  }

  private startTailSlap(whale: PlayerWhale): void {
    whale.actionState = 'tail_slap';
    whale.tailSlapCooldown = TAIL_SLAP_COOLDOWN;
    whale.tailSlapTime = 0;
    whale.tailSlapResolved = false;
    whale.tailSlapStartYaw = whale.yaw;
    whale.breachActive = false;
    whale.recoveryTimer = 0;
    whale.strokeVisual = Math.max(whale.strokeVisual, 0.62);
  }

  private applyRamResponse(whale: PlayerWhale, deltaSeconds: number): void {
    if (whale.ramDriftVelocity.lengthSq() > 0.000001) {
      whale.position.addScaledVector(whale.ramDriftVelocity, deltaSeconds);
      whale.ramDriftVelocity.x = THREE.MathUtils.damp(whale.ramDriftVelocity.x, 0, RAM_RESPONSE_DAMPING, deltaSeconds);
      whale.ramDriftVelocity.z = THREE.MathUtils.damp(whale.ramDriftVelocity.z, 0, RAM_RESPONSE_DAMPING, deltaSeconds);
      whale.ramDriftVelocity.y = 0;
    }

    if (Math.abs(whale.ramYawVelocity) > 0.0001) {
      whale.yaw += whale.ramYawVelocity * deltaSeconds;
      whale.ramYawVelocity = THREE.MathUtils.damp(whale.ramYawVelocity, 0, RAM_RESPONSE_DAMPING, deltaSeconds);
    }
  }
}

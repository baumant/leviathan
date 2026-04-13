import * as THREE from 'three';

import { PlayerWhale, WhaleActionState } from '../entities/PlayerWhale';
import { Input } from '../game/Input';

const SURFACE_SPEED = 26;
const SUBMERGED_SPEED = 27;
const BURST_SPEED = 38;
const SURFACE_TURN_RATE = 1.3;
const SUBMERGED_TURN_RATE = 1.95;
const MAX_DEPTH = -100;
const MAX_BREACH_HEIGHT = 0.9;

const STROKE_BUILD_TIME = 1.8;
const STROKE_DECAY_TIME = 1.1;
const STROKE_INTERVAL = 0.58;
const STROKE_IMPULSE_MIN = 1.4;
const STROKE_IMPULSE_MAX = 7.2;
const TURN_CHARGE_CAP = 0.45;
const BASELINE_SPEED_SURFACE_FACTOR = 0.46;
const BASELINE_SPEED_SUBMERGED_FACTOR = 0.38;
const BASELINE_ACCELERATION = 0.76;
const BASELINE_BOOST_ACCELERATION = 1.14;

const BREACH_DURATION = 1.45;
const BREACH_RECOVERY = 0.24;
const BREACH_PEAK_HEIGHT = 8.4;
const AUTO_BREACH_DEPTH_THRESHOLD = -1.0;
const BREACH_ARM_DEPTH = -4.5;
const BREACH_PRIME_RESET_DEPTH = -1.35;
const BREACH_MIN_SPEED = 15;
const BREACH_MIN_VERTICAL_SPEED = 3.0;
const BREACH_INNER_RADIUS = 6;
const BREACH_OUTER_RADIUS = 14;
const BREACH_HANG_EXPONENT = 0.72;
const BREACH_HORIZONTAL_SWAY = 0.8;

const TAIL_SLAP_DURATION = 0.42;
const TAIL_SLAP_TURN_DURATION = 0.16;
const TAIL_SLAP_RECOVERY = 0.18;
const TAIL_SLAP_COOLDOWN = 2.2;
const TAIL_SLAP_DEPTH_LIMIT = -2.5;
const TAIL_SLAP_INNER_RADIUS = 9;
const TAIL_SLAP_OUTER_RADIUS = 16;
const TAIL_SLAP_HALF_ANGLE = THREE.MathUtils.degToRad(65);
const RAM_RESPONSE_DAMPING = 4.8;

export interface WhaleBreachImpactEvent {
  position: THREE.Vector3;
  innerRadius: number;
  outerRadius: number;
}

export interface WhaleTailSlapEvent {
  origin: THREE.Vector3;
  forward: THREE.Vector3;
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
    const submergedFactor = THREE.MathUtils.clamp((-whale.depth - 0.5) / 5, 0, 1);
    const recoveryScale = whale.actionState === 'recovery' ? 0.68 : 1;

    if (whale.actionState === 'recovery') {
      whale.recoveryTimer = Math.max(0, whale.recoveryTimer - deltaSeconds);
      if (whale.recoveryTimer === 0) {
        whale.actionState = 'swim';
      }
    }

    const throttleTarget = moveInput > 0 ? 1 : moveInput < 0 ? 0 : 0.35;
    whale.throttle = THREE.MathUtils.damp(whale.throttle, throttleTarget, moveInput < 0 ? 5.5 : 3.2, deltaSeconds);

    const boostActive = input.boostHeld && whale.depth < -1.8 && whale.actionState !== 'recovery';
    whale.boostActive = boostActive;

    const cruiseSpeed = THREE.MathUtils.lerp(SURFACE_SPEED, SUBMERGED_SPEED, submergedFactor);
    const topSpeed = (boostActive ? BURST_SPEED : cruiseSpeed) * whale.speedDragMultiplier;

    if (moveInput > 0) {
      whale.strokeCharge = Math.min(1, whale.strokeCharge + (deltaSeconds / STROKE_BUILD_TIME) * whale.strokeBuildMultiplier);
    } else {
      whale.strokeCharge = Math.max(0, whale.strokeCharge - deltaSeconds / STROKE_DECAY_TIME);
    }

    const effectiveStrokeCharge =
      Math.abs(turnInput) > 0.5 ? Math.min(whale.strokeCharge, TURN_CHARGE_CAP) : whale.strokeCharge;
    const baselineTargetSpeed =
      topSpeed *
      whale.throttle *
      THREE.MathUtils.lerp(BASELINE_SPEED_SURFACE_FACTOR, BASELINE_SPEED_SUBMERGED_FACTOR, submergedFactor);
    const baselineAcceleration =
      (boostActive ? BASELINE_BOOST_ACCELERATION : BASELINE_ACCELERATION) *
      whale.strokeBuildMultiplier *
      recoveryScale;

    whale.speed = THREE.MathUtils.damp(whale.speed, baselineTargetSpeed, baselineAcceleration, deltaSeconds);

    if (moveInput < 0) {
      whale.speed = THREE.MathUtils.damp(whale.speed, 0, 6.2, deltaSeconds);
    }

    if (moveInput > 0) {
      whale.strokeTimer = Math.min(whale.strokeTimer, STROKE_INTERVAL);
      whale.strokeTimer -= deltaSeconds;

      if (whale.strokeTimer <= 0) {
        const strokeImpulse =
          THREE.MathUtils.lerp(STROKE_IMPULSE_MIN, STROKE_IMPULSE_MAX, effectiveStrokeCharge) *
          THREE.MathUtils.lerp(1.12, 1, submergedFactor) *
          whale.speedDragMultiplier;
        whale.speed = Math.min(topSpeed, whale.speed + strokeImpulse);
        whale.strokeVisual = Math.max(whale.strokeVisual, THREE.MathUtils.lerp(0.46, 1.0, effectiveStrokeCharge));
        whale.strokeTimer += STROKE_INTERVAL;
        result.strokePulseFired = true;
        result.strokePulseStrength = strokeImpulse;
      }
    } else {
      whale.strokeTimer = Math.min(STROKE_INTERVAL, whale.strokeTimer + deltaSeconds * 0.9);
    }

    const turnRate =
      THREE.MathUtils.lerp(SURFACE_TURN_RATE, SUBMERGED_TURN_RATE, submergedFactor) *
      whale.turnDragMultiplier *
      recoveryScale;
    const speedTurnScale = THREE.MathUtils.clamp(0.45 + whale.speed / BURST_SPEED, 0.45, 1.1);
    whale.yaw -= turnInput * turnRate * speedTurnScale * deltaSeconds;

    const targetVerticalSpeed = depthInput * THREE.MathUtils.lerp(4.2, 9.5, submergedFactor) * recoveryScale;
    whale.verticalSpeed = THREE.MathUtils.damp(
      whale.verticalSpeed,
      targetVerticalSpeed,
      depthInput === 0 ? 2.4 : 4.4,
      deltaSeconds,
    );

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
      whale.speed >= BREACH_MIN_SPEED &&
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
      turnInput * 0.35 * THREE.MathUtils.clamp(whale.speed / Math.max(cruiseSpeed, 0.001), 0, 1.2),
      4.6,
      deltaSeconds,
    );

    whale.root.rotation.set(whale.pitch, whale.yaw, whale.roll, 'YXZ');
    whale.getForward(this.forward);
    whale.position.addScaledVector(this.forward, whale.speed * deltaSeconds);
    this.applyRamResponse(whale, deltaSeconds);

    whale.root.rotation.set(whale.pitch, whale.yaw, whale.roll, 'YXZ');
    const surfaceHeight = oceanHeightAt(whale.position.x, whale.position.z);
    whale.position.y = surfaceHeight + whale.depth;
    whale.root.updateMatrixWorld();

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
    whale.speed = THREE.MathUtils.damp(whale.speed, whale.breachSpeed * 0.55, 1.6, deltaSeconds);
    whale.root.rotation.set(whale.pitch, whale.yaw, whale.roll, 'YXZ');

    const horizontalOffset = Math.sin(progress * Math.PI) * BREACH_HORIZONTAL_SWAY;
    whale.position.copy(whale.breachOrigin).addScaledVector(whale.breachDirection, horizontalOffset);

    const surfaceHeight = oceanHeightAt(whale.position.x, whale.position.z);
    whale.position.y = surfaceHeight + whale.depth;
    whale.submerged = whale.depth < -0.45;
    whale.root.updateMatrixWorld();

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
      whale.speed = Math.max(13, whale.speed * 0.88);
      whale.depth = Math.min(whale.depth, -0.35);
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
    whale.depth = THREE.MathUtils.damp(whale.depth, Math.max(whale.depth, -0.35), 5.6, deltaSeconds);
    whale.verticalSpeed = THREE.MathUtils.damp(whale.verticalSpeed, 0, 6.2, deltaSeconds);
    whale.pitch = THREE.MathUtils.damp(whale.pitch, -0.08, 5.4, deltaSeconds);
    whale.roll = THREE.MathUtils.damp(whale.roll, Math.sin(turnAlpha * Math.PI) * 0.34, 6.2, deltaSeconds);
    whale.root.rotation.set(whale.pitch, whale.yaw, whale.roll, 'YXZ');

    if (!whale.tailSlapResolved && previousTime < TAIL_SLAP_TURN_DURATION && whale.tailSlapTime >= TAIL_SLAP_TURN_DURATION) {
      whale.tailSlapResolved = true;
      whale.strokeVisual = Math.max(whale.strokeVisual, 0.9);
      result.tailSlap = {
        origin: whale.position.clone(),
        forward: new THREE.Vector3(Math.sin(whale.tailSlapStartYaw), 0, Math.cos(whale.tailSlapStartYaw)),
        innerRadius: TAIL_SLAP_INNER_RADIUS,
        outerRadius: TAIL_SLAP_OUTER_RADIUS,
        halfAngle: TAIL_SLAP_HALF_ANGLE,
      };
    }

    whale.getForward(this.forward);
    whale.position.addScaledVector(this.forward, whale.speed * deltaSeconds);

    const surfaceHeight = oceanHeightAt(whale.position.x, whale.position.z);
    whale.position.y = surfaceHeight + whale.depth;
    whale.submerged = whale.depth < -0.45;
    whale.root.updateMatrixWorld();

    if (whale.tailSlapTime >= TAIL_SLAP_DURATION) {
      whale.actionState = 'recovery';
      whale.recoveryTimer = TAIL_SLAP_RECOVERY;
      whale.speed = Math.max(whale.speed * 0.7, 9);
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
    whale.breachSpeed = Math.max(whale.speed, BREACH_MIN_SPEED) * 0.92;
    whale.boostActive = false;
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
    whale.boostActive = false;
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

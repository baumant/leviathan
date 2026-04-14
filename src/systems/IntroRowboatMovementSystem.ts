import * as THREE from 'three';

import { Ship } from '../entities/Ship';
import { Input } from '../game/Input';

const MAX_SPEED = 11.2;
const TURN_RATE = 1.08;
const STROKE_INTERVAL = 0.82;
const STROKE_BUILD_TIME = 2.2;
const STROKE_DECAY_TIME = 1.4;
const STROKE_IMPULSE_MIN = 0.72;
const STROKE_IMPULSE_MAX = 2.08;
const BASELINE_SPEED_FACTOR = 0.28;
const BASELINE_ACCELERATION = 1.36;

export interface IntroRowboatMovementResult {
  strokePulseFired: boolean;
  strokePulseStrength: number;
}

export class IntroRowboatMovementSystem {
  private readonly forward = new THREE.Vector3();
  private throttle = 0.3;
  private strokeCharge = 0;
  private strokeTimer = STROKE_INTERVAL * 0.6;

  reset(): void {
    this.throttle = 0.3;
    this.strokeCharge = 0;
    this.strokeTimer = STROKE_INTERVAL * 0.6;
  }

  update(ship: Ship, input: Input, deltaSeconds: number): IntroRowboatMovementResult {
    const result: IntroRowboatMovementResult = {
      strokePulseFired: false,
      strokePulseStrength: 0,
    };

    const moveInput = input.moveAxis;
    const turnInput = input.turnAxis;
    const throttleTarget = moveInput > 0 ? 1 : moveInput < 0 ? 0 : 0.24;
    this.throttle = THREE.MathUtils.damp(this.throttle, throttleTarget, moveInput < 0 ? 4.8 : 2.6, deltaSeconds);

    if (moveInput > 0) {
      this.strokeCharge = Math.min(1, this.strokeCharge + deltaSeconds / STROKE_BUILD_TIME);
    } else {
      this.strokeCharge = Math.max(0, this.strokeCharge - deltaSeconds / STROKE_DECAY_TIME);
    }

    const baselineTargetSpeed = MAX_SPEED * this.throttle * BASELINE_SPEED_FACTOR;
    ship.travelSpeed = THREE.MathUtils.damp(ship.travelSpeed, baselineTargetSpeed, BASELINE_ACCELERATION, deltaSeconds);

    if (moveInput < 0) {
      ship.travelSpeed = THREE.MathUtils.damp(ship.travelSpeed, 0, 5.6, deltaSeconds);
    }

    if (moveInput > 0) {
      this.strokeTimer = Math.min(this.strokeTimer, STROKE_INTERVAL);
      this.strokeTimer -= deltaSeconds;

      if (this.strokeTimer <= 0) {
        const strokeImpulse = THREE.MathUtils.lerp(STROKE_IMPULSE_MIN, STROKE_IMPULSE_MAX, this.strokeCharge);
        ship.travelSpeed = Math.min(MAX_SPEED, ship.travelSpeed + strokeImpulse);
        this.strokeTimer += STROKE_INTERVAL;
        result.strokePulseFired = true;
        result.strokePulseStrength = strokeImpulse;
      }
    } else {
      this.strokeTimer = Math.min(STROKE_INTERVAL, this.strokeTimer + deltaSeconds * 0.8);
    }

    const turnScale = THREE.MathUtils.clamp(0.34 + ship.travelSpeed / MAX_SPEED, 0.34, 1);
    ship.heading -= turnInput * TURN_RATE * turnScale * deltaSeconds;

    this.forward.set(Math.sin(ship.heading), 0, Math.cos(ship.heading));
    ship.root.position.addScaledVector(this.forward, ship.travelSpeed * deltaSeconds);

    return result;
  }
}

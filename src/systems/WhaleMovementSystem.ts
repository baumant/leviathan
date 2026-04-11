import * as THREE from 'three';

import { PlayerWhale } from '../entities/PlayerWhale';
import { Input } from '../game/Input';

const SURFACE_SPEED = 14;
const SUBMERGED_SPEED = 21;
const BURST_SPEED = 28;
const SURFACE_TURN_RATE = 1.3;
const SUBMERGED_TURN_RATE = 1.95;
const MAX_DEPTH = -14;
const MAX_BREACH_HEIGHT = 1.6;

export class WhaleMovementSystem {
  update(
    whale: PlayerWhale,
    input: Input,
    deltaSeconds: number,
    oceanHeightAt: (x: number, z: number) => number,
  ): void {
    const moveInput = input.moveAxis;
    const turnInput = input.turnAxis;
    const depthInput = input.depthAxis;
    const submergedFactor = THREE.MathUtils.clamp((-whale.depth - 0.5) / 5, 0, 1);

    const throttleTarget = moveInput > 0 ? 1 : moveInput < 0 ? 0 : 0.35;
    whale.throttle = THREE.MathUtils.damp(whale.throttle, throttleTarget, moveInput < 0 ? 5.5 : 3.2, deltaSeconds);

    const boostActive = input.boostHeld && whale.depth < -1.8;
    whale.boostActive = boostActive;

    // Tuning note: the whale always keeps some momentum, but submerged burst should
    // feel like a heavy body suddenly committing to a line rather than twitching.
    const cruiseSpeed = THREE.MathUtils.lerp(SURFACE_SPEED, SUBMERGED_SPEED, submergedFactor);
    const topSpeed = boostActive ? BURST_SPEED : cruiseSpeed;
    const acceleration = boostActive ? 3.9 : 2.6;

    whale.speed = THREE.MathUtils.damp(whale.speed, topSpeed * whale.throttle, acceleration, deltaSeconds);

    if (moveInput < 0) {
      whale.speed = THREE.MathUtils.damp(whale.speed, 0, 6.2, deltaSeconds);
    }

    const turnRate = THREE.MathUtils.lerp(SURFACE_TURN_RATE, SUBMERGED_TURN_RATE, submergedFactor);
    const speedTurnScale = THREE.MathUtils.clamp(0.45 + whale.speed / BURST_SPEED, 0.45, 1.1);
    whale.yaw -= turnInput * turnRate * speedTurnScale * deltaSeconds;

    const targetVerticalSpeed = depthInput * THREE.MathUtils.lerp(4.2, 9.5, submergedFactor);
    whale.verticalSpeed = THREE.MathUtils.damp(
      whale.verticalSpeed,
      targetVerticalSpeed,
      depthInput === 0 ? 2.4 : 4.4,
      deltaSeconds,
    );

    whale.depth += whale.verticalSpeed * deltaSeconds;
    whale.depth = THREE.MathUtils.clamp(whale.depth, MAX_DEPTH, MAX_BREACH_HEIGHT);

    if (depthInput === 0) {
      whale.depth = THREE.MathUtils.damp(whale.depth, -0.95, 0.65, deltaSeconds);
    }

    whale.submerged = whale.depth < -0.45;

    const pitchTarget = THREE.MathUtils.clamp(whale.verticalSpeed * 0.075, -0.42, 0.38);
    whale.pitch = THREE.MathUtils.damp(whale.pitch, -pitchTarget, 4.2, deltaSeconds);
    whale.roll = THREE.MathUtils.damp(
      whale.roll,
      turnInput * 0.35 * THREE.MathUtils.clamp(whale.speed / cruiseSpeed, 0, 1.2),
      4.6,
      deltaSeconds,
    );

    whale.root.rotation.set(whale.pitch, whale.yaw, whale.roll, 'YXZ');

    const forward = whale.getForward();
    whale.position.addScaledVector(forward, whale.speed * deltaSeconds);

    const surfaceHeight = oceanHeightAt(whale.position.x, whale.position.z);
    whale.position.y = surfaceHeight + whale.depth;
    whale.root.updateMatrixWorld();
  }
}

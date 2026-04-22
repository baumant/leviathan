import * as THREE from 'three';

import { BroadsideSide, Ship } from '../entities/Ship';

export interface ShipAIContext {
  arenaRadius: number;
  deltaSeconds: number;
  fleetAlerted: boolean;
  otherShips: readonly Ship[];
  rowboatsRemaining: number;
  shipHasActiveHarpoon: boolean;
  shipHasTether: boolean;
  whalePosition: THREE.Vector3;
}

export interface ShipAIResult {
  wantsHarpoonThrow: boolean;
  broadsideTelegraphSide: BroadsideSide | null;
}

export class ShipAISystem {
  private readonly toWhale = new THREE.Vector3();
  private readonly awayFromWhale = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly patrolOffset = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly localWhale = new THREE.Vector3();
  private readonly separationOffset = new THREE.Vector3();
  private readonly neighborOffset = new THREE.Vector3();
  private readonly shipCollisionHalfExtents = new THREE.Vector2();
  private readonly otherCollisionHalfExtents = new THREE.Vector2();

  update(ship: Ship, context: ShipAIContext): ShipAIResult {
    ship.fireCooldown = Math.max(0, ship.fireCooldown - context.deltaSeconds);

    if (ship.sinking || ship.sunk) {
      ship.aiState = 'sinking';
      ship.travelSpeed = THREE.MathUtils.damp(ship.travelSpeed, 0, 4.2, context.deltaSeconds);
      return { wantsHarpoonThrow: false, broadsideTelegraphSide: null };
    }

    this.toWhale.copy(context.whalePosition).sub(ship.root.position);
    this.toWhale.y = 0;

    const distanceToWhale = Math.max(0.001, this.toWhale.length());
    this.awayFromWhale.copy(this.toWhale).multiplyScalar(-1 / distanceToWhale);
    this.tangent.set(-this.awayFromWhale.z, 0, this.awayFromWhale.x).multiplyScalar(ship.orbitDirection);

    if (ship.role === 'rowboat') {
      return this.updateRowboat(ship, context, distanceToWhale);
    }

    return this.updateCapitalShip(ship, context, distanceToWhale);
  }

  private updateRowboat(ship: Ship, context: ShipAIContext, distanceToWhale: number): ShipAIResult {
    let wantsHarpoonThrow = false;

    if (context.shipHasTether) {
      ship.aiState = 'tethered';
      this.desiredPosition
        .copy(context.whalePosition)
        .addScaledVector(this.awayFromWhale, ship.holdRangeMin * 0.9)
        .addScaledVector(this.tangent, ship.orbitOffset * 0.45);
      this.desiredPosition.add(this.computeSeparationOffset(ship, context));
      this.steerShip(ship, this.desiredPosition, ship.moveSpeed * 0.92, context);
      return { wantsHarpoonThrow: false, broadsideTelegraphSide: null };
    }

    if (context.fleetAlerted || distanceToWhale <= 72) {
      ship.aiState = 'close';
      const desiredRange = (ship.holdRangeMin + ship.holdRangeMax) * 0.5;
      this.desiredPosition
        .copy(context.whalePosition)
        .addScaledVector(this.awayFromWhale, desiredRange)
        .addScaledVector(this.tangent, ship.orbitOffset);
      this.desiredPosition.add(this.computeSeparationOffset(ship, context));

      let speedScale = 0.95;
      if (distanceToWhale < ship.holdRangeMin) {
        speedScale = 0.8;
      } else if (distanceToWhale > ship.holdRangeMax) {
        speedScale = 1;
      }

      const shouldThrow =
        !context.shipHasActiveHarpoon &&
        ship.fireCooldown <= 0 &&
        distanceToWhale >= ship.holdRangeMin - 1 &&
        distanceToWhale <= ship.holdRangeMax + 1.5 &&
        this.isForwardAligned(ship, context.whalePosition, 0.68);

      if (shouldThrow) {
        ship.aiState = 'throw';
        wantsHarpoonThrow = true;
      }

      this.steerShip(ship, this.desiredPosition, ship.moveSpeed * speedScale, context);
      return { wantsHarpoonThrow, broadsideTelegraphSide: null };
    }

    ship.aiState = 'patrol';
    ship.patrolAngle += context.deltaSeconds * 0.4;
    this.desiredPosition
      .copy(ship.anchor)
      .add(
        this.patrolOffset.set(
          Math.cos(ship.patrolAngle) * ship.patrolRadius,
          0,
          Math.sin(ship.patrolAngle) * ship.patrolRadius,
        ),
      );
    this.steerShip(ship, this.desiredPosition, ship.moveSpeed * 0.72, context);

    return { wantsHarpoonThrow: false, broadsideTelegraphSide: null };
  }

  private updateCapitalShip(ship: Ship, context: ShipAIContext, distanceToWhale: number): ShipAIResult {
    ship.aiState = context.rowboatsRemaining <= 0 && ship.capitalFleesWhenRowboatsGone ? 'flee' : 'engage';

    if (ship.aiState === 'flee') {
      this.desiredPosition
        .copy(ship.root.position)
        .sub(context.whalePosition)
        .normalize()
        .multiplyScalar(context.arenaRadius * 0.92)
        .addScaledVector(this.tangent, ship.orbitOffset * 0.35);
      this.desiredPosition.add(this.computeSeparationOffset(ship, context));
      this.steerShip(ship, this.desiredPosition, ship.fleeSpeed, context);
    } else {
      const desiredRange = (ship.holdRangeMin + ship.holdRangeMax) * 0.5;
      this.desiredPosition
        .copy(context.whalePosition)
        .addScaledVector(this.awayFromWhale, desiredRange)
        .addScaledVector(this.tangent, ship.orbitOffset);
      this.desiredPosition.add(this.computeSeparationOffset(ship, context));
      this.steerShip(ship, this.desiredPosition, ship.moveSpeed * 0.96, context);
    }

    const broadsideTelegraphSide = this.chooseBroadsideSide(ship, context.whalePosition, distanceToWhale);
    return { wantsHarpoonThrow: false, broadsideTelegraphSide };
  }

  private chooseBroadsideSide(
    ship: Ship,
    whalePosition: THREE.Vector3,
    distanceToWhale: number,
  ): BroadsideSide | null {
    if (
      ship.fireCooldown > 0 ||
      ship.isBroadsideTelegraphing ||
      distanceToWhale < ship.broadsideRangeMin ||
      distanceToWhale > ship.broadsideRangeMax
    ) {
      return null;
    }

    ship.worldToLocalPoint(whalePosition, this.localWhale);

    if (
      Math.abs(this.localWhale.z) > ship.broadsideLocalForwardLimit ||
      Math.abs(this.localWhale.x) < ship.broadsideLocalSideMin
    ) {
      return null;
    }

    return this.localWhale.x < 0 ? 'port' : 'starboard';
  }

  private isForwardAligned(ship: Ship, targetPosition: THREE.Vector3, minDot: number): boolean {
    this.forward.copy(targetPosition).sub(ship.root.position).setY(0).normalize();
    const shipForward = ship.getForward(new THREE.Vector3()).setY(0).normalize();
    return shipForward.dot(this.forward) >= minDot;
  }

  private computeSeparationOffset(ship: Ship, context: ShipAIContext): THREE.Vector3 {
    this.separationOffset.set(0, 0, 0);
    const shipRadius = this.getSeparationRadius(ship, this.shipCollisionHalfExtents);

    for (const other of context.otherShips) {
      if (other === ship || other.sinking || other.sunk) {
        continue;
      }

      const profile = this.getSeparationProfile(ship, other);

      if (!profile) {
        continue;
      }

      this.neighborOffset.copy(ship.root.position).sub(other.root.position).setY(0);
      let distance = this.neighborOffset.length();
      const otherRadius = this.getSeparationRadius(other, this.otherCollisionHalfExtents);
      const desiredDistance = shipRadius + otherRadius + profile.margin;

      if (distance >= desiredDistance) {
        continue;
      }

      if (distance <= 0.0001) {
        this.neighborOffset.set(Math.cos(ship.heading), 0, -Math.sin(ship.heading));
        distance = 1;
      } else {
        this.neighborOffset.multiplyScalar(1 / distance);
      }

      const separationAlpha = THREE.MathUtils.clamp(desiredDistance / Math.max(distance, 0.001) - 1, 0, 2.4);
      this.separationOffset.addScaledVector(
        this.neighborOffset,
        profile.weight * separationAlpha * profile.margin,
      );
    }

    const maxOffset = ship.role === 'rowboat' ? 12 : 18;

    if (this.separationOffset.lengthSq() > maxOffset * maxOffset) {
      this.separationOffset.setLength(maxOffset);
    }

    return this.separationOffset;
  }

  private getSeparationProfile(ship: Ship, other: Ship): { margin: number; weight: number } | null {
    if (ship.role === 'rowboat') {
      return other.role === 'rowboat'
        ? { margin: 6, weight: 1 }
        : { margin: 2, weight: 0.25 };
    }

    return other.isCapitalShip
      ? { margin: 14, weight: 0.85 }
      : { margin: 2, weight: 0.15 };
  }

  private getSeparationRadius(ship: Ship, target: THREE.Vector2): number {
    ship.getCollisionHalfExtentsXZ(target);
    return Math.max(target.x, target.y);
  }

  private steerShip(
    ship: Ship,
    desiredPosition: THREE.Vector3,
    desiredSpeed: number,
    context: ShipAIContext,
  ): void {
    this.forward.copy(desiredPosition).sub(ship.root.position);
    this.forward.y = 0;

    const hasTarget = this.forward.lengthSq() > 1;
    const desiredHeading = hasTarget ? Math.atan2(this.forward.x, this.forward.z) : ship.heading;
    const headingDelta = THREE.MathUtils.euclideanModulo(desiredHeading - ship.heading + Math.PI, Math.PI * 2) - Math.PI;
    const turnStep = ship.turnRate * context.deltaSeconds;

    ship.heading += THREE.MathUtils.clamp(headingDelta, -turnStep, turnStep);
    ship.travelSpeed = THREE.MathUtils.damp(ship.travelSpeed, desiredSpeed, 2.7, context.deltaSeconds);

    const forwardX = Math.sin(ship.heading);
    const forwardZ = Math.cos(ship.heading);

    ship.root.position.x += forwardX * ship.travelSpeed * context.deltaSeconds;
    ship.root.position.z += forwardZ * ship.travelSpeed * context.deltaSeconds;

    const radius = Math.hypot(ship.root.position.x, ship.root.position.z);
    const maxRadius = context.arenaRadius * 0.95;

    if (radius > maxRadius) {
      const clampScale = maxRadius / radius;
      ship.root.position.x *= clampScale;
      ship.root.position.z *= clampScale;
      ship.heading = Math.atan2(-ship.root.position.x, -ship.root.position.z);
    }
  }
}

import * as THREE from 'three';

import { PlayerWhale } from '../entities/PlayerWhale';
import { Ship } from '../entities/Ship';
import { normalizeWhaleCombatSpeed, WHALE_SPEED_PROFILE } from '../tuning/whaleSpeedProfile';

const MIN_RAM_SPEED_BY_ROLE = {
  rowboat: WHALE_SPEED_PROFILE.rowboatRamSpeed,
  flagship: WHALE_SPEED_PROFILE.flagshipRamSpeed,
  corporate_whaler: WHALE_SPEED_PROFILE.corporateWhalerRamSpeed,
} as const;

export interface RamResult {
  damage: number;
  intensity: number;
}

export interface DamageHitResult {
  damage: number;
  intensity: number;
}

interface CapitalInteractionResult {
  damage: number;
  intensity: number;
  kind: 'body_contact' | 'ram_hit';
}

export class DamageSystem {
  private readonly lastRamAt = new WeakMap<Ship, number>();
  private readonly capitalRamLatched = new WeakMap<Ship, boolean>();
  private readonly dragUnderTimers = new WeakMap<Ship, number>();
  private readonly tempWhaleForward = new THREE.Vector3();
  private readonly tempShipForward = new THREE.Vector3();
  private readonly tempShipRight = new THREE.Vector3();
  private readonly tempGlideDirection = new THREE.Vector3();
  private readonly tempLocalPoint = new THREE.Vector3();
  private readonly tempToShip = new THREE.Vector3();
  private readonly tempRearForward = new THREE.Vector3();
  private readonly tempCapitalContactMin = new THREE.Vector3();
  private readonly tempCapitalContactMax = new THREE.Vector3();
  private readonly tempContactAxis = new THREE.Vector3();
  private readonly tempContactDrive = new THREE.Vector3();

  private getCapitalRamCooldown(ship: Ship): number {
    return ship.role === 'corporate_whaler' ? 1.1 : 0.95;
  }

  private getCapitalContactReleasePad(ship: Ship): number {
    return ship.role === 'corporate_whaler' ? 0.16 : 0.22;
  }

  private getCapitalContactBounds(
    ship: Ship,
    whale: PlayerWhale,
    targetMin: THREE.Vector3,
    targetMax: THREE.Vector3,
    releasePad = 0,
  ): void {
    ship.getCapitalContactBounds(targetMin, targetMax);

    const sidePad = whale.radius * (ship.role === 'corporate_whaler' ? 0.62 : 0.8) + releasePad;
    const bowPad = whale.radius * (ship.role === 'corporate_whaler' ? 0.58 : 0.72) + releasePad;
    const sternPad = whale.radius * (ship.role === 'corporate_whaler' ? 0.48 : 0.6) + releasePad;
    const topPad = whale.radius * 0.18 + releasePad * 0.5;
    const bottomPad = whale.radius * 0.72 + releasePad;

    targetMin.x -= sidePad;
    targetMax.x += sidePad;
    targetMin.y -= bottomPad;
    targetMax.y += topPad;
    targetMin.z -= sternPad;
    targetMax.z += bowPad;
  }

  private intersectsCapitalContactHull(
    ship: Ship,
    whale: PlayerWhale,
    localWhalePosition: THREE.Vector3,
    releasePad = 0,
  ): boolean {
    this.getCapitalContactBounds(ship, whale, this.tempCapitalContactMin, this.tempCapitalContactMax, releasePad);

    return (
      localWhalePosition.x >= this.tempCapitalContactMin.x &&
      localWhalePosition.x <= this.tempCapitalContactMax.x &&
      localWhalePosition.y >= this.tempCapitalContactMin.y &&
      localWhalePosition.y <= this.tempCapitalContactMax.y &&
      localWhalePosition.z >= this.tempCapitalContactMin.z &&
      localWhalePosition.z <= this.tempCapitalContactMax.z
    );
  }

  resolveCapitalInteraction(whale: PlayerWhale, ship: Ship, elapsedSeconds: number): CapitalInteractionResult | null {
    if (!ship.isCapitalShip || ship.sinking || ship.sunk || (whale.actionState === 'breach' && whale.depth > 0.45)) {
      return null;
    }

    const localWhalePosition = ship.worldToLocalPoint(whale.position, this.tempLocalPoint);
    const lastHitAt = this.lastRamAt.get(ship) ?? -Infinity;
    const cooldownElapsed = elapsedSeconds - lastHitAt >= this.getCapitalRamCooldown(ship);

    if (this.capitalRamLatched.get(ship) ?? false) {
      const separated = !this.intersectsCapitalContactHull(
        ship,
        whale,
        localWhalePosition,
        this.getCapitalContactReleasePad(ship),
      );

      if (separated && cooldownElapsed) {
        this.capitalRamLatched.delete(ship);
      }
    }

    if (!this.intersectsCapitalContactHull(ship, whale, localWhalePosition)) {
      return null;
    }

    if (
      whale.actionState === 'swim' &&
      !(this.capitalRamLatched.get(ship) ?? false) &&
      whale.speed >= MIN_RAM_SPEED_BY_ROLE[ship.role]
    ) {
      const ramHit = this.resolveCapitalRamHit(whale, ship, localWhalePosition, elapsedSeconds);

      if (ramHit) {
        return ramHit;
      }
    }

    return this.resolveCapitalBodyContact(whale, ship, localWhalePosition);
  }

  resolveBodyContact(whale: PlayerWhale, ship: Ship): boolean {
    if (ship.role !== 'rowboat' || ship.sinking || ship.sunk || (whale.actionState === 'breach' && whale.depth > 0.45)) {
      return false;
    }

    const localWhalePosition = ship.worldToLocalPoint(whale.position, this.tempLocalPoint);
    const limitX = ship.halfExtents.x + whale.radius * 0.82 + 0.18;
    const limitZ = ship.halfExtents.z + whale.radius * 0.58 + 0.28;
    const verticalTop = ship.halfExtents.y + whale.radius * 0.42;
    const verticalBottom = -ship.halfExtents.y - whale.radius * 0.7;

    if (
      Math.abs(localWhalePosition.x) > limitX ||
      Math.abs(localWhalePosition.z) > limitZ ||
      localWhalePosition.y > verticalTop ||
      localWhalePosition.y < verticalBottom
    ) {
      return false;
    }

    const penetrationX = limitX - Math.abs(localWhalePosition.x);
    const penetrationZ = limitZ - Math.abs(localWhalePosition.z);
    const penetration = Math.min(penetrationX, penetrationZ);

    if (penetration <= 0.0001) {
      return false;
    }

    let shipYawStrength = 0;

    if (penetrationX <= penetrationZ) {
      this.tempContactAxis.set(localWhalePosition.x < 0 ? -1 : 1, 0, 0);
      shipYawStrength = localWhalePosition.x < 0 ? -1 : 1;
    } else {
      this.tempContactAxis.set(0, 0, localWhalePosition.z < 0 ? -1 : 1);
      shipYawStrength = 0;
    }

    this.tempContactAxis.applyQuaternion(ship.root.quaternion).setY(0);

    if (this.tempContactAxis.lengthSq() <= 0.0001) {
      this.tempContactAxis.copy(whale.position).sub(ship.root.position).setY(0);
    }

    if (this.tempContactAxis.lengthSq() <= 0.0001) {
      ship.getForward(this.tempContactAxis).setY(0);
    }

    this.tempContactAxis.normalize();

    this.tempContactDrive.copy(whale.travelVelocity).setY(0);
    if (this.tempContactDrive.lengthSq() <= 0.0001) {
      whale.getForward(this.tempContactDrive).setY(0);
    }

    if (this.tempContactDrive.lengthSq() <= 0.0001) {
      this.tempContactDrive.copy(this.tempContactAxis);
    } else {
      this.tempContactDrive.normalize();
    }

    const correctedPenetration = penetration + 0.03;
    whale.position.addScaledVector(this.tempContactAxis, correctedPenetration * 0.2);
    ship.root.position.addScaledVector(this.tempContactAxis, -correctedPenetration * 0.8);

    const speedAlpha = THREE.MathUtils.clamp(whale.speed / Math.max(WHALE_SPEED_PROFILE.maxTravelSpeed, 0.001), 0, 1);
    const contactAlpha = THREE.MathUtils.clamp((correctedPenetration - 0.04) / 0.7, 0, 1);
    whale.scaleTravelMotion(0.96);
    whale.ramDriftVelocity.addScaledVector(
      this.tempContactAxis,
      correctedPenetration * THREE.MathUtils.lerp(0.4, 1.1, contactAlpha),
    );

    if (shipYawStrength !== 0) {
      whale.ramYawVelocity += shipYawStrength * THREE.MathUtils.lerp(0.015, 0.04, contactAlpha);
    }

    const shipMotionStrength = THREE.MathUtils.lerp(1.2, 7.8, speedAlpha) * THREE.MathUtils.lerp(0.2, 1, contactAlpha);
    if (shipMotionStrength > 0.01) {
      ship.applyKnockback(
        this.tempContactDrive,
        shipMotionStrength,
        shipYawStrength * THREE.MathUtils.lerp(0.08, 0.78, speedAlpha) * THREE.MathUtils.lerp(0.2, 1, contactAlpha),
      );
    }

    whale.root.updateMatrixWorld();
    ship.root.updateMatrixWorld();
    whale.syncTravelState();
    return true;
  }

  private resolveCapitalRamHit(
    whale: PlayerWhale,
    ship: Ship,
    localWhalePosition: THREE.Vector3,
    elapsedSeconds: number,
  ): CapitalInteractionResult | null {
    const whaleForward = this.tempWhaleForward.copy(whale.travelVelocity).setY(0);

    if (whaleForward.lengthSq() <= 0.0001) {
      whale.getForward(whaleForward).setY(0);
    }

    whaleForward.normalize();
    const shipForward = ship.getForward(this.tempShipForward);
    const alignment = Math.abs(whaleForward.dot(shipForward));
    const sideBonus = 1.18 - alignment * 0.35;
    const underHullBonus = whale.position.y < ship.root.position.y - 0.9 ? 1.28 : 1;
    const normalizedCombatSpeed = normalizeWhaleCombatSpeed(whale.speed);
    const damage = Math.round((normalizedCombatSpeed - 5.5) * 10 * sideBonus * underHullBonus);

    if (damage <= 0) {
      return null;
    }

    ship.getCapitalContactBounds(this.tempCapitalContactMin, this.tempCapitalContactMax);
    const contactHalfWidth = Math.max(
      Math.abs(this.tempCapitalContactMin.x),
      Math.abs(this.tempCapitalContactMax.x),
      0.001,
    );
    const lateralContactAlpha = THREE.MathUtils.clamp(Math.abs(localWhalePosition.x) / contactHalfWidth, 0, 1);
    const obliqueAlpha = THREE.MathUtils.clamp(1 - alignment, 0, 1);
    const deflectionAlpha = THREE.MathUtils.clamp(lateralContactAlpha * 0.72 + obliqueAlpha * 0.48, 0, 1);
    const impactSide = localWhalePosition.x < -0.001 ? -1 : localWhalePosition.x > 0.001 ? 1 : 0;
    const isCorporate = ship.role === 'corporate_whaler';

    ship.applyDamage(damage, 'capital_ram');

    this.tempToShip.copy(ship.root.position).sub(whale.position).setY(0);
    this.tempGlideDirection.copy(this.tempToShip);

    if (this.tempGlideDirection.lengthSq() <= 0.0001) {
      this.tempGlideDirection.copy(shipForward).setY(0);
    }

    this.tempGlideDirection.normalize();

    if (impactSide !== 0 && deflectionAlpha >= 0.12) {
      this.tempShipRight.set(1, 0, 0).applyQuaternion(ship.root.quaternion).setY(0).normalize();
      this.tempGlideDirection.multiplyScalar(0.65).addScaledVector(this.tempShipRight, impactSide * 0.35).normalize();
    }

    whale.position.addScaledVector(
      this.tempGlideDirection,
      -THREE.MathUtils.lerp(
        isCorporate ? 1.85 : 1.0,
        isCorporate ? 2.55 : 1.6,
        deflectionAlpha,
      ),
    );
    ship.root.position.addScaledVector(
      this.tempGlideDirection,
      THREE.MathUtils.lerp(
        isCorporate ? 0.68 : 1.15,
        isCorporate ? 1.02 : 1.82,
        deflectionAlpha,
      ),
    );
    whale.root.updateMatrixWorld();
    ship.root.updateMatrixWorld();

    whale.scaleTravelMotion(isCorporate ? 0.76 : 0.88);
    whale.ramDriftVelocity.addScaledVector(
      this.tempGlideDirection,
      -THREE.MathUtils.lerp(
        isCorporate ? 3.0 : 1.8,
        isCorporate ? 6.0 : 4.0,
        deflectionAlpha,
      ),
    );
    ship.applyWaterShove(
      this.tempGlideDirection,
      THREE.MathUtils.lerp(
        isCorporate ? 1.5 : 2.5,
        isCorporate ? 3.4 : 6.0,
        deflectionAlpha,
      ),
      -impactSide *
        THREE.MathUtils.lerp(
          isCorporate ? 0.012 : 0.02,
          isCorporate ? 0.045 : 0.075,
          deflectionAlpha,
        ),
    );

    if (impactSide !== 0 && deflectionAlpha >= 0.12) {
      whale.ramYawVelocity += impactSide * THREE.MathUtils.lerp(isCorporate ? 0.04 : 0.025, isCorporate ? 0.16 : 0.11, deflectionAlpha);
    }

    whale.syncTravelState();
    this.lastRamAt.set(ship, elapsedSeconds);
    this.capitalRamLatched.set(ship, true);

    return {
      damage,
      intensity: THREE.MathUtils.clamp(damage / 95 + deflectionAlpha * 0.05, 0.18, 0.74),
      kind: 'ram_hit',
    };
  }

  private resolveCapitalBodyContact(
    whale: PlayerWhale,
    ship: Ship,
    localWhalePosition: THREE.Vector3,
  ): CapitalInteractionResult | null {
    this.getCapitalContactBounds(ship, whale, this.tempCapitalContactMin, this.tempCapitalContactMax);

    const penetrationLeft = localWhalePosition.x - this.tempCapitalContactMin.x;
    const penetrationRight = this.tempCapitalContactMax.x - localWhalePosition.x;
    const penetrationAft = localWhalePosition.z - this.tempCapitalContactMin.z;
    const penetrationFore = this.tempCapitalContactMax.z - localWhalePosition.z;
    const penetrationX = Math.min(penetrationLeft, penetrationRight);
    const penetrationZ = Math.min(penetrationAft, penetrationFore);
    const penetration = Math.min(penetrationX, penetrationZ);

    if (penetration <= 0.0001) {
      return null;
    }

    let shipYawStrength = 0;

    if (penetrationX <= penetrationZ) {
      this.tempContactAxis.set(penetrationLeft < penetrationRight ? -1 : 1, 0, 0);
      shipYawStrength = this.tempContactAxis.x;
    } else {
      this.tempContactAxis.set(0, 0, penetrationAft < penetrationFore ? -1 : 1);
    }

    this.tempContactAxis.applyQuaternion(ship.root.quaternion).setY(0);

    if (this.tempContactAxis.lengthSq() <= 0.0001) {
      this.tempContactAxis.copy(whale.position).sub(ship.root.position).setY(0);
    }

    if (this.tempContactAxis.lengthSq() <= 0.0001) {
      ship.getForward(this.tempContactAxis).setY(0);
    }

    this.tempContactAxis.normalize();

    this.tempContactDrive.copy(whale.travelVelocity).setY(0);
    if (this.tempContactDrive.lengthSq() <= 0.0001) {
      whale.getForward(this.tempContactDrive).setY(0);
    }

    if (this.tempContactDrive.lengthSq() <= 0.0001) {
      this.tempContactDrive.copy(this.tempContactAxis);
    } else {
      this.tempContactDrive.normalize();
    }

    const speedAlpha = THREE.MathUtils.clamp(whale.speed / Math.max(WHALE_SPEED_PROFILE.maxTravelSpeed, 0.001), 0, 1);
    const contactAlpha = THREE.MathUtils.clamp((penetration - 0.03) / 0.65, 0, 1);
    const isCorporate = ship.role === 'corporate_whaler';
    const correctedPenetration = penetration + 0.02;

    whale.position.addScaledVector(this.tempContactAxis, correctedPenetration * (isCorporate ? 0.42 : 0.22));
    ship.root.position.addScaledVector(this.tempContactAxis, -correctedPenetration * (isCorporate ? 0.58 : 0.78));

    whale.scaleTravelMotion(isCorporate ? 0.86 : 0.94);
    whale.ramDriftVelocity.addScaledVector(
      this.tempContactAxis,
      correctedPenetration * THREE.MathUtils.lerp(isCorporate ? 0.55 : 0.34, isCorporate ? 1.8 : 1.2, contactAlpha),
    );

    if (shipYawStrength !== 0) {
      whale.ramYawVelocity +=
        shipYawStrength *
        THREE.MathUtils.lerp(isCorporate ? 0.016 : 0.012, isCorporate ? 0.06 : 0.04, contactAlpha);
    }

    ship.applyWaterShove(
      this.tempContactDrive,
      THREE.MathUtils.lerp(isCorporate ? 0.4 : 1.0, isCorporate ? 1.8 : 3.2, speedAlpha) *
        THREE.MathUtils.lerp(0.35, 1, contactAlpha),
      -shipYawStrength *
        THREE.MathUtils.lerp(isCorporate ? 0.01 : 0.015, isCorporate ? 0.045 : 0.08, contactAlpha),
    );

    whale.root.updateMatrixWorld();
    ship.root.updateMatrixWorld();
    whale.syncTravelState();

    return {
      damage: 0,
      intensity: 0,
      kind: 'body_contact',
    };
  }

  resolveBreachLaunch(whale: PlayerWhale, ship: Ship): DamageHitResult | null {
    if (ship.sinking || ship.sunk) {
      return null;
    }

    const localWhalePosition = ship.worldToLocalPoint(whale.position, this.tempLocalPoint);
    const capitalMassScale = ship.role === 'corporate_whaler' ? 0.72 : 1;
    const capitalRockScale = ship.role === 'corporate_whaler' ? 1.08 : 1;

    if (ship.role === 'rowboat') {
      const intersects =
        Math.abs(localWhalePosition.x) <= ship.halfExtents.x + whale.radius * 0.9 &&
        Math.abs(localWhalePosition.z) <= ship.halfExtents.z + whale.radius * 0.7 &&
        localWhalePosition.y <= ship.halfExtents.y + whale.radius * 0.35 &&
        localWhalePosition.y >= -ship.halfExtents.y - whale.radius * 1.45;

      if (!intersects) {
        return null;
      }

      this.tempToShip.copy(ship.root.position).sub(whale.position).setY(0);

      if (this.tempToShip.lengthSq() <= 0.0001) {
        whale.getForward(this.tempToShip).setY(0);
      }

      this.tempToShip.normalize();
      ship.applyDamage(ship.maxHealth);
      ship.launchIntoAir(this.tempToShip, 15.5, 9.5, 2.2);

      return {
        damage: ship.maxHealth,
        intensity: 0.58,
      };
    }

    const underHullOverlap =
      Math.abs(localWhalePosition.x) <= ship.halfExtents.x * 0.78 + whale.radius * 0.2 &&
      Math.abs(localWhalePosition.z) <= ship.halfExtents.z * 0.84 &&
      localWhalePosition.y <= -ship.halfExtents.y * 0.12 &&
      localWhalePosition.y >= -ship.halfExtents.y - whale.radius * 1.35;

    if (!underHullOverlap) {
      return null;
    }

    this.tempToShip.copy(ship.root.position).sub(whale.position).setY(0);

    if (this.tempToShip.lengthSq() <= 0.0001) {
      ship.getForward(this.tempToShip).setY(0);
    }

    this.tempToShip.normalize();

    const lateralAlpha = THREE.MathUtils.clamp(
      Math.abs(localWhalePosition.x) / Math.max(ship.halfExtents.x, 0.001),
      0,
      1,
    );
    const impactSide = localWhalePosition.x < -0.001 ? -1 : localWhalePosition.x > 0.001 ? 1 : 0;
    const damage = 40;

    ship.applyDamage(damage, 'capital_breach');
    ship.applyBlastRock(
      this.tempToShip,
      THREE.MathUtils.lerp(1.2, 1.8, lateralAlpha) * capitalMassScale,
      impactSide * THREE.MathUtils.lerp(0.04, 0.08, lateralAlpha) * capitalMassScale,
      THREE.MathUtils.lerp(0.18, 0.28, 1 - lateralAlpha * 0.4) * capitalRockScale,
      THREE.MathUtils.lerp(0.1, 0.16, 1 - lateralAlpha * 0.3) * capitalRockScale,
    );

    return {
      damage,
      intensity: THREE.MathUtils.lerp(0.22, 0.34, 1 - lateralAlpha * 0.5),
    };
  }

  resolveRam(whale: PlayerWhale, ship: Ship, elapsedSeconds: number): RamResult | null {
    if (ship.role !== 'rowboat' || ship.sinking || ship.sunk) {
      return null;
    }

    const localWhalePosition = ship.worldToLocalPoint(whale.position, this.tempLocalPoint);
    const lastHitAt = this.lastRamAt.get(ship) ?? -Infinity;
    if (elapsedSeconds - lastHitAt < 0.7) {
      return null;
    }

    const intersects =
      Math.abs(localWhalePosition.x) <= ship.halfExtents.x + whale.radius &&
      Math.abs(localWhalePosition.y) <= ship.halfExtents.y + whale.radius &&
      Math.abs(localWhalePosition.z) <= ship.halfExtents.z + whale.radius;

    if (!intersects || whale.speed < MIN_RAM_SPEED_BY_ROLE.rowboat) {
      return null;
    }

    const whaleForward = this.tempWhaleForward.copy(whale.travelVelocity).setY(0);

    if (whaleForward.lengthSq() <= 0.0001) {
      whale.getForward(whaleForward).setY(0);
    }

    whaleForward.normalize();
    const shipForward = ship.getForward(this.tempShipForward);
    const alignment = Math.abs(whaleForward.dot(shipForward));
    const sideBonus = 1.18 - alignment * 0.35;
    const underHullBonus = whale.position.y < ship.root.position.y - 0.9 ? 1.28 : 1;
    const normalizedCombatSpeed = normalizeWhaleCombatSpeed(whale.speed);
    const damage = Math.round((normalizedCombatSpeed - 5.5) * 10 * sideBonus * underHullBonus);

    if (damage <= 0) {
      return null;
    }

    this.tempToShip.copy(ship.root.position).sub(whale.position).setY(0);
    ship.applyDamage(damage);
    whale.scaleTravelMotion(0.76);

    this.lastRamAt.set(ship, elapsedSeconds);

    return {
      damage,
      intensity: THREE.MathUtils.clamp(damage / 95, 0.16, 0.7),
    };
  }

  resolveBreachSlam(
    ship: Ship,
    impactPoint: THREE.Vector3,
    innerRadius: number,
    outerRadius: number,
  ): DamageHitResult | null {
    if (ship.sinking || ship.sunk) {
      return null;
    }

    this.tempToShip.copy(ship.root.position).sub(impactPoint).setY(0);
    const distance = this.tempToShip.length();

    if (distance > outerRadius) {
      return null;
    }

    const falloff =
      distance <= innerRadius ? 1 : 1 - THREE.MathUtils.clamp((distance - innerRadius) / (outerRadius - innerRadius), 0, 1);
    if (ship.role === 'rowboat') {
      const damage = distance <= innerRadius ? ship.maxHealth : 90;
      const knockbackStrength = THREE.MathUtils.lerp(8, 16, falloff);
      const yawStrength = THREE.MathUtils.lerp(0.6, 2, falloff);

      ship.applyDamage(damage);
      ship.applyKnockback(this.tempToShip, knockbackStrength, yawStrength);

      return {
        damage,
        intensity: THREE.MathUtils.lerp(0.22, 0.52, falloff),
      };
    }

    if (this.tempToShip.lengthSq() <= 0.0001) {
      ship.getForward(this.tempToShip).setY(0);
    } else {
      this.tempToShip.normalize();
    }

    const localImpactPoint = ship.worldToLocalPoint(impactPoint, this.tempLocalPoint);
    const capitalMassScale = ship.role === 'corporate_whaler' ? 0.72 : 1;
    const capitalRockScale = ship.role === 'corporate_whaler' ? 1.08 : 1;
    const impactSide = localImpactPoint.x < -0.001 ? 1 : localImpactPoint.x > 0.001 ? -1 : 0;
    const damage = 55;

    ship.applyDamage(damage, 'capital_breach');
    ship.applyBlastRock(
      this.tempToShip,
      THREE.MathUtils.lerp(1.6, 2.4, falloff) * capitalMassScale,
      impactSide * THREE.MathUtils.lerp(0.06, 0.12, falloff) * capitalMassScale,
      THREE.MathUtils.lerp(0.16, 0.24, falloff) * capitalRockScale,
      THREE.MathUtils.lerp(0.1, 0.18, falloff) * capitalRockScale,
    );

    return {
      damage,
      intensity: THREE.MathUtils.lerp(0.18, 0.3, falloff),
    };
  }

  resolveTailSlap(
    ship: Ship,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    innerRadius: number,
    outerRadius: number,
    halfAngle: number,
  ): DamageHitResult | null {
    if (ship.sinking || ship.sunk) {
      return null;
    }

    this.tempToShip.copy(ship.root.position).sub(origin).setY(0);
    const distance = this.tempToShip.length();

    if (distance > outerRadius || distance <= 0.001) {
      return null;
    }

    this.tempToShip.normalize();
    this.tempRearForward.copy(direction).setY(0).normalize();

    if (this.tempRearForward.dot(this.tempToShip) < Math.cos(halfAngle)) {
      return null;
    }

    const distanceFalloff =
      distance <= innerRadius ? 1 : 1 - THREE.MathUtils.clamp((distance - innerRadius) / (outerRadius - innerRadius), 0, 1);
    const damage = ship.role === 'rowboat' ? (distance <= innerRadius ? ship.maxHealth : 20) : 35;
    const knockbackStrength =
      ship.role === 'rowboat'
        ? distance <= innerRadius
          ? 18
          : THREE.MathUtils.lerp(11, 16, distanceFalloff)
        : THREE.MathUtils.lerp(5, 7.5, distanceFalloff);
    const yawStrength = ship.role === 'rowboat' ? THREE.MathUtils.lerp(1.2, 2.6, distanceFalloff) : THREE.MathUtils.lerp(0.2, 0.6, distanceFalloff);

    ship.applyDamage(damage);
    ship.applyKnockback(this.tempToShip, knockbackStrength, yawStrength);

    return {
      damage,
      intensity: ship.role === 'rowboat' ? THREE.MathUtils.lerp(0.2, 0.48, distanceFalloff) : THREE.MathUtils.lerp(0.16, 0.3, distanceFalloff),
    };
  }

  updateDragUnder(
    whale: PlayerWhale,
    ship: Ship,
    tethered: boolean,
    deltaSeconds: number,
    tensionAlpha: number,
  ): boolean {
    if (!tethered || ship.sinking || ship.sunk) {
      this.dragUnderTimers.delete(ship);
      return false;
    }

    const deepEnough = whale.depth <= -4.5;
    const strongPull = tensionAlpha >= 0.18 || whale.speed >= WHALE_SPEED_PROFILE.dragUnderStrongPullSpeed;
    const timer = this.dragUnderTimers.get(ship) ?? 0;

    if (!deepEnough || !strongPull) {
      this.dragUnderTimers.set(ship, Math.max(0, timer - deltaSeconds * 1.5));
      return false;
    }

    const nextTimer = timer + deltaSeconds;
    this.dragUnderTimers.set(ship, nextTimer);

    if (nextTimer < 0.4) {
      return false;
    }

    ship.applyDamage(ship.maxHealth);
    this.dragUnderTimers.delete(ship);
    return true;
  }

  resolveCannonSplash(
    whale: PlayerWhale,
    impactPoint: THREE.Vector3,
    splashRadius: number,
    damage: number,
  ): DamageHitResult | null {
    const distance = whale.position.distanceTo(impactPoint);
    const range = splashRadius + whale.radius;

    if (distance > range) {
      return null;
    }

    const normalized = 1 - THREE.MathUtils.clamp(distance / range, 0, 1);
    const appliedDamage = Math.max(4, Math.round(damage * THREE.MathUtils.lerp(0.45, 1, normalized)));
    whale.applyDamage(appliedDamage);
    whale.scaleTravelMotion(0.92);

    return {
      damage: appliedDamage,
      intensity: THREE.MathUtils.lerp(0.14, 0.34, normalized),
    };
  }
}

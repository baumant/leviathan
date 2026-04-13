import * as THREE from 'three';

import { PlayerWhale } from '../entities/PlayerWhale';
import { Ship } from '../entities/Ship';

const MIN_RAM_SPEED_BY_ROLE = {
  rowboat: 9.5,
  flagship: 11.5,
} as const;

export interface RamResult {
  damage: number;
  intensity: number;
}

export interface DamageHitResult {
  damage: number;
  intensity: number;
}

export class DamageSystem {
  private readonly lastRamAt = new WeakMap<Ship, number>();
  private readonly dragUnderTimers = new WeakMap<Ship, number>();
  private readonly tempWhaleForward = new THREE.Vector3();
  private readonly tempShipForward = new THREE.Vector3();
  private readonly tempShipRight = new THREE.Vector3();
  private readonly tempGlideDirection = new THREE.Vector3();
  private readonly tempLocalPoint = new THREE.Vector3();
  private readonly tempToShip = new THREE.Vector3();
  private readonly tempRearForward = new THREE.Vector3();

  resolveBreachLaunch(whale: PlayerWhale, ship: Ship): DamageHitResult | null {
    if (ship.sinking || ship.sunk) {
      return null;
    }

    const localWhalePosition = ship.worldToLocalPoint(whale.position, this.tempLocalPoint);

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

    ship.applyDamage(damage, 'flagship_breach');
    ship.applyBlastRock(
      this.tempToShip,
      THREE.MathUtils.lerp(1.2, 1.8, lateralAlpha),
      impactSide * THREE.MathUtils.lerp(0.04, 0.08, lateralAlpha),
      THREE.MathUtils.lerp(0.18, 0.28, 1 - lateralAlpha * 0.4),
      THREE.MathUtils.lerp(0.1, 0.16, 1 - lateralAlpha * 0.3),
    );

    return {
      damage,
      intensity: THREE.MathUtils.lerp(0.22, 0.34, 1 - lateralAlpha * 0.5),
    };
  }

  resolveRam(whale: PlayerWhale, ship: Ship, elapsedSeconds: number): RamResult | null {
    if (ship.sinking || ship.sunk) {
      return null;
    }

    const lastHitAt = this.lastRamAt.get(ship) ?? -Infinity;
    if (elapsedSeconds - lastHitAt < 0.7) {
      return null;
    }

    const localWhalePosition = ship.worldToLocalPoint(whale.position, this.tempLocalPoint);
    const intersects =
      Math.abs(localWhalePosition.x) <= ship.halfExtents.x + whale.radius &&
      Math.abs(localWhalePosition.y) <= ship.halfExtents.y + whale.radius &&
      Math.abs(localWhalePosition.z) <= ship.halfExtents.z + whale.radius;

    const minimumRamSpeed = MIN_RAM_SPEED_BY_ROLE[ship.role];

    if (!intersects || whale.speed < minimumRamSpeed) {
      return null;
    }

    const whaleForward = whale.getForward(this.tempWhaleForward);
    const shipForward = ship.getForward(this.tempShipForward);
    const alignment = Math.abs(whaleForward.dot(shipForward));
    const sideBonus = 1.18 - alignment * 0.35;
    const underHullBonus = whale.position.y < ship.root.position.y - 0.9 ? 1.28 : 1;
    const damage = Math.round((whale.speed - 5.5) * 10 * sideBonus * underHullBonus);

    if (damage <= 0) {
      return null;
    }

    this.tempToShip.copy(ship.root.position).sub(whale.position).setY(0);
    let intensity = THREE.MathUtils.clamp(damage / 95, 0.16, 0.7);

    if (ship.role === 'flagship') {
      const lateralContactAlpha = THREE.MathUtils.clamp(
        Math.abs(localWhalePosition.x) / Math.max(ship.halfExtents.x + whale.radius, 0.001),
        0,
        1,
      );
      const obliqueAlpha = THREE.MathUtils.clamp(1 - alignment, 0, 1);
      const deflectionAlpha = THREE.MathUtils.clamp(lateralContactAlpha * 0.7 + obliqueAlpha * 0.5, 0, 1);
      const impactSide = localWhalePosition.x < -0.001 ? -1 : localWhalePosition.x > 0.001 ? 1 : 0;

      ship.applyDamage(damage, 'flagship_ram');

      this.tempGlideDirection.copy(this.tempToShip);
      if (this.tempGlideDirection.lengthSq() <= 0.0001) {
        this.tempGlideDirection.copy(shipForward).setY(0);
      }
      this.tempGlideDirection.normalize();

      if (impactSide !== 0 && deflectionAlpha >= 0.12) {
        this.tempShipRight.set(1, 0, 0).applyQuaternion(ship.root.quaternion).setY(0).normalize();
        this.tempGlideDirection.multiplyScalar(0.65).addScaledVector(this.tempShipRight, impactSide * 0.35).normalize();
      }

      whale.position.addScaledVector(this.tempGlideDirection, -THREE.MathUtils.lerp(1.6, 2.2, deflectionAlpha));
      ship.root.position.addScaledVector(this.tempGlideDirection, THREE.MathUtils.lerp(0.8, 1.1, deflectionAlpha));
      whale.root.updateMatrixWorld();
      ship.root.updateMatrixWorld();

      whale.speed *= 0.78;
      whale.ramDriftVelocity.addScaledVector(
        this.tempGlideDirection,
        -THREE.MathUtils.lerp(3.0, 6.2, deflectionAlpha),
      );
      ship.applyWaterShove(
        this.tempGlideDirection,
        THREE.MathUtils.lerp(1.8, 4.2, deflectionAlpha),
        -impactSide * THREE.MathUtils.lerp(0.01, 0.05, deflectionAlpha),
      );

      if (impactSide !== 0 && deflectionAlpha >= 0.12) {
        whale.ramYawVelocity += impactSide * THREE.MathUtils.lerp(0.04, 0.18, deflectionAlpha);
      }

      intensity = THREE.MathUtils.clamp(intensity + deflectionAlpha * 0.05, 0.18, 0.74);
    } else {
      ship.applyDamage(damage);
      whale.speed *= 0.76;
    }

    this.lastRamAt.set(ship, elapsedSeconds);

    return {
      damage,
      intensity,
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
    const impactSide = localImpactPoint.x < -0.001 ? 1 : localImpactPoint.x > 0.001 ? -1 : 0;
    const damage = 55;

    ship.applyDamage(damage, 'flagship_breach');
    ship.applyBlastRock(
      this.tempToShip,
      THREE.MathUtils.lerp(1.6, 2.4, falloff),
      impactSide * THREE.MathUtils.lerp(0.06, 0.12, falloff),
      THREE.MathUtils.lerp(0.16, 0.24, falloff),
      THREE.MathUtils.lerp(0.1, 0.18, falloff),
    );

    return {
      damage,
      intensity: THREE.MathUtils.lerp(0.18, 0.3, falloff),
    };
  }

  resolveTailSlap(
    ship: Ship,
    origin: THREE.Vector3,
    preFacing: THREE.Vector3,
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
    this.tempRearForward.copy(preFacing).setY(0).normalize().multiplyScalar(-1);

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
    const strongPull = tensionAlpha >= 0.18 || whale.speed >= 10;
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
    whale.speed *= 0.92;

    return {
      damage: appliedDamage,
      intensity: THREE.MathUtils.lerp(0.14, 0.34, normalized),
    };
  }
}

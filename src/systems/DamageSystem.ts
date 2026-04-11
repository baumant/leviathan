import * as THREE from 'three';

import { PlayerWhale } from '../entities/PlayerWhale';
import { Ship } from '../entities/Ship';

export interface RamResult {
  damage: number;
  intensity: number;
}

export class DamageSystem {
  private readonly lastRamAt = new WeakMap<Ship, number>();
  private readonly tempWhaleForward = new THREE.Vector3();
  private readonly tempShipForward = new THREE.Vector3();
  private readonly tempLocalPoint = new THREE.Vector3();

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

    if (!intersects || whale.speed < 7.5) {
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

    ship.applyDamage(damage);
    whale.speed *= 0.76;
    this.lastRamAt.set(ship, elapsedSeconds);

    return {
      damage,
      intensity: THREE.MathUtils.clamp(damage / 95, 0.16, 0.7),
    };
  }
}

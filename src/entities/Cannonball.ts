import * as THREE from 'three';

import { createCelMaterial } from '../fx/createCelMaterial';

export class Cannonball {
  readonly root: THREE.Group;
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();
  readonly radius = 0.7;

  damage = 0;
  splashRadius = 0;
  ageSeconds = 0;
  active = false;

  constructor() {
    const coreMaterial = createCelMaterial({
      color: '#222935',
      emissive: '#ff9452',
      emissiveIntensity: 0.18,
    });
    const bandMaterial = createCelMaterial({
      color: '#4c5662',
      emissive: '#111820',
      emissiveIntensity: 0.02,
    });

    const core = new THREE.Mesh(new THREE.SphereGeometry(this.radius, 10, 8), coreMaterial);
    const band = new THREE.Mesh(new THREE.TorusGeometry(this.radius * 0.62, 0.08, 5, 10), bandMaterial);
    band.rotation.x = Math.PI / 2;

    this.root = new THREE.Group();
    this.root.add(core, band);
    this.root.visible = false;
    this.position = this.root.position;
  }

  launch(origin: THREE.Vector3, velocity: THREE.Vector3, damage: number, splashRadius: number): void {
    this.active = true;
    this.damage = damage;
    this.splashRadius = splashRadius;
    this.ageSeconds = 0;
    this.position.copy(origin);
    this.velocity.copy(velocity);
    this.root.visible = true;
    this.root.updateMatrixWorld();
  }

  update(deltaSeconds: number): void {
    if (!this.active) {
      return;
    }

    this.ageSeconds += deltaSeconds;
    this.velocity.y -= 10.5 * deltaSeconds;
    this.position.addScaledVector(this.velocity, deltaSeconds);
    this.root.rotation.x += deltaSeconds * 6.4;
    this.root.rotation.z += deltaSeconds * 4.7;
    this.root.updateMatrixWorld();
  }

  deactivate(): void {
    this.active = false;
    this.root.visible = false;
    this.root.removeFromParent();
  }
}

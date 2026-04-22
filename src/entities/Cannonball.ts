import * as THREE from 'three';

import {
  INACTIVE_WATERLINE_PASSTHROUGH_STATE,
  WaterlinePassthroughState,
} from '../fx/calculateWhaleTopsideRevealState';
import {
  cloneUniqueObjectRoot,
  createWaterlineOverlay,
  WaterlineOverlayController,
} from '../fx/createWaterlineOverlay';
import { createCelMaterial } from '../fx/createCelMaterial';

const CANNONBALL_WATERLINE_COLOR = new THREE.Color('#8ea6b1');
const CANNONBALL_WATERLINE_OPACITY_MIN = 0.08;
const CANNONBALL_WATERLINE_OPACITY_MAX = 0.28;

export class Cannonball {
  readonly root: THREE.Group;
  readonly waterlinePassthroughKind = 'object' as const;
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();
  readonly radius = 0.7;

  damage = 0;
  splashRadius = 0;
  ageSeconds = 0;
  active = false;

  private readonly solidRoot = new THREE.Group();
  private readonly waterlineOverlayController: WaterlineOverlayController;

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
    this.solidRoot.add(core, band);
    this.waterlineOverlayController = createWaterlineOverlay(cloneUniqueObjectRoot(this.solidRoot), {
      color: CANNONBALL_WATERLINE_COLOR,
      opacityMin: CANNONBALL_WATERLINE_OPACITY_MIN,
      opacityMax: CANNONBALL_WATERLINE_OPACITY_MAX,
    });
    this.root.add(this.solidRoot, this.waterlineOverlayController.root);
    this.root.visible = false;
    this.position = this.root.position;
  }

  getWaterlinePassthroughAnchor(target = new THREE.Vector3()): THREE.Vector3 {
    return this.root.getWorldPosition(target);
  }

  getWaterlinePassthroughBounds(target: THREE.Box3): THREE.Box3 {
    return target.makeEmpty().expandByObject(this.solidRoot, true);
  }

  setWaterlinePassthrough(state: WaterlinePassthroughState): void {
    this.waterlineOverlayController.setState(state);
  }

  launch(origin: THREE.Vector3, velocity: THREE.Vector3, damage: number, splashRadius: number): void {
    this.active = true;
    this.damage = damage;
    this.splashRadius = splashRadius;
    this.ageSeconds = 0;
    this.position.copy(origin);
    this.velocity.copy(velocity);
    this.setWaterlinePassthrough(INACTIVE_WATERLINE_PASSTHROUGH_STATE);
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
    this.setWaterlinePassthrough(INACTIVE_WATERLINE_PASSTHROUGH_STATE);
    this.root.visible = false;
    this.root.removeFromParent();
  }
}

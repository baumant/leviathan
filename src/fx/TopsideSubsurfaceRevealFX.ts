import * as THREE from 'three';

import { createCelMaterial } from './createCelMaterial';

const MAX_SHIP_REVEALS = 7;
const MAX_UNDERWATER_RATIO = 0.18;

export interface TopsideSubsurfaceRevealTarget {
  kind: 'whale' | 'ship';
  position: THREE.Vector3;
  yaw: number;
  depthBelowSurface: number;
  halfWidth: number;
  halfLength: number;
  strength: number;
}

interface RevealSlot {
  root: THREE.Group;
  material: THREE.MeshToonMaterial;
}

interface TopsideSubsurfaceRevealUpdateParams {
  underwaterRatio: number;
  targets: readonly TopsideSubsurfaceRevealTarget[];
}

const WHALE_PROXY_BOUNDS = {
  halfWidth: 1.28,
  halfLength: 2.18,
};

const SHIP_PROXY_BOUNDS = {
  halfWidth: 0.84,
  halfLength: 1.48,
};

export class TopsideSubsurfaceRevealFX {
  private readonly root = new THREE.Group();
  private readonly whaleSlot: RevealSlot;
  private readonly shipSlots: RevealSlot[] = [];

  constructor(scene: THREE.Scene) {
    this.root.renderOrder = 10;
    this.whaleSlot = this.createWhaleSlot();
    this.root.add(this.whaleSlot.root);

    for (let index = 0; index < MAX_SHIP_REVEALS; index += 1) {
      const slot = this.createShipSlot();
      this.shipSlots.push(slot);
      this.root.add(slot.root);
    }

    scene.add(this.root);
    this.reset();
  }

  update(params: TopsideSubsurfaceRevealUpdateParams): void {
    const visibility = 1 - THREE.MathUtils.smoothstep(params.underwaterRatio, 0.04, MAX_UNDERWATER_RATIO);
    const whaleTarget = params.targets.find((target) => target.kind === 'whale');
    const shipTargets = params.targets.filter((target) => target.kind === 'ship');

    this.updateSlot(this.whaleSlot, whaleTarget, visibility, WHALE_PROXY_BOUNDS);

    for (let index = 0; index < this.shipSlots.length; index += 1) {
      this.updateSlot(this.shipSlots[index], shipTargets[index], visibility, SHIP_PROXY_BOUNDS);
    }
  }

  reset(): void {
    this.hideSlot(this.whaleSlot);

    for (const slot of this.shipSlots) {
      this.hideSlot(slot);
    }
  }

  dispose(): void {
    this.root.parent?.remove(this.root);

    const slots = [this.whaleSlot, ...this.shipSlots];
    for (const slot of slots) {
      slot.root.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        }
      });
      slot.material.dispose();
    }
  }

  private updateSlot(
    slot: RevealSlot,
    target: TopsideSubsurfaceRevealTarget | undefined,
    visibility: number,
    baseBounds: { halfWidth: number; halfLength: number },
  ): void {
    if (!target || visibility <= 0.01 || target.strength <= 0.01) {
      this.hideSlot(slot);
      return;
    }

    slot.root.visible = true;
    slot.material.opacity = THREE.MathUtils.clamp(target.strength * visibility * 0.72, 0.08, 0.68);
    slot.root.position.copy(target.position);
    slot.root.rotation.set(0, target.yaw, 0, 'YXZ');
    slot.root.scale.set(
      target.halfWidth / baseBounds.halfWidth,
      target.halfWidth * 0.34,
      target.halfLength / baseBounds.halfLength,
    );
    slot.root.updateMatrixWorld();
  }

  private hideSlot(slot: RevealSlot): void {
    slot.root.visible = false;
    slot.material.opacity = 0;
  }

  private createWhaleSlot(): RevealSlot {
    const material = createCelMaterial({
      color: '#607983',
      emissive: '#21313a',
      emissiveIntensity: 0.08,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const root = new THREE.Group();
    root.renderOrder = 10;

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.25, 5, 10), material);
    body.rotation.x = Math.PI / 2;
    body.scale.set(1.12, 0.68, 1.36);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.72, 12, 10), material);
    head.position.set(0, -0.03, 1.15);
    head.scale.set(1.06, 0.82, 0.98);

    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.52, 10, 8), material);
    brow.position.set(0, 0.18, 0.62);
    brow.scale.set(1.22, 0.54, 0.82);

    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.44, 0.82, 6), material);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, 0.02, -1.3);

    const flukeBase = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.28), material);
    flukeBase.position.set(0, 0, -1.72);

    const leftFluke = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.26), material);
    leftFluke.position.set(-0.46, 0, -1.88);
    leftFluke.rotation.z = -0.2;

    const rightFluke = leftFluke.clone();
    rightFluke.position.x *= -1;
    rightFluke.rotation.z *= -1;

    const leftFin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.34), material);
    leftFin.position.set(-0.82, -0.08, 0.16);
    leftFin.rotation.z = 0.36;
    leftFin.rotation.x = -0.28;

    const rightFin = leftFin.clone();
    rightFin.position.x *= -1;
    rightFin.rotation.z *= -1;

    root.add(body, head, brow, tail, flukeBase, leftFluke, rightFluke, leftFin, rightFin);

    return { root, material };
  }

  private createShipSlot(): RevealSlot {
    const material = createCelMaterial({
      color: '#364851',
      emissive: '#131c21',
      emissiveIntensity: 0.04,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const root = new THREE.Group();
    root.renderOrder = 10;

    const hull = new THREE.Mesh(new THREE.SphereGeometry(0.78, 10, 8), material);
    hull.scale.set(1.04, 0.42, 1.72);

    const stern = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.24, 0.46), material);
    stern.position.set(0, 0.18, -0.72);
    stern.scale.set(0.92, 1, 1);

    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.72, 6), material);
    bow.rotation.x = Math.PI / 2;
    bow.position.set(0, 0.02, 1.05);
    bow.scale.set(1.18, 1, 0.9);

    root.add(hull, stern, bow);

    return { root, material };
  }
}

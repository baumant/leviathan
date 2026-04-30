import * as THREE from 'three';

import {
  INACTIVE_WATERLINE_PASSTHROUGH_STATE,
  WaterlinePassthroughState,
} from '../fx/calculateWhaleTopsideRevealState';
import { createCelMaterial } from '../fx/createCelMaterial';
import {
  cloneUniqueObjectRoot,
  createWaterlineOverlay,
  disposeObject3DResources,
  WaterlineOverlayController,
} from '../fx/createWaterlineOverlay';

export type HarpoonMode = 'flying' | 'tethered' | 'lodged';

const TETHER_AXIS = new THREE.Vector3(0, 1, 0);
const PROJECTILE_AXIS = new THREE.Vector3(0, 0, 1);
const HARPOON_WATERLINE_COLOR = new THREE.Color('#94adba');
const HARPOON_WATERLINE_OPACITY_MIN = 0.08;
const HARPOON_WATERLINE_OPACITY_MAX = 0.32;
const HARPOON_TIP_LOCAL_Z = 1.72;
const HARPOON_EMBED_DEPTH = 0.24;
const HARPOON_CENTER_FROM_ANCHOR_DISTANCE = HARPOON_TIP_LOCAL_Z - HARPOON_EMBED_DEPTH;
const ROPE_SLACK_COLOR = new THREE.Color('#5a3c27');
const ROPE_TENSION_COLOR = new THREE.Color('#765135');

export class Harpoon {
  readonly root = new THREE.Group();
  readonly ownerShipId: string;
  readonly waterlinePassthroughKind = 'object' as const;
  readonly radius = 0.7;
  readonly maxTetherLength = 24;
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();

  ageSeconds = 0;
  active = false;
  mode: HarpoonMode = 'flying';

  private readonly direction = new THREE.Vector3();
  private readonly tipAnchor = new THREE.Vector3();
  private readonly embeddedTipLocal = new THREE.Vector3();
  private readonly embeddedProjectileLocalQuaternion = new THREE.Quaternion();
  private readonly tempWhaleQuaternion = new THREE.Quaternion();
  private readonly projectile: THREE.Group;
  private readonly impactMarker: THREE.Group;
  private readonly tetherRope: THREE.Mesh;
  private readonly tetherRopeMaterial: THREE.MeshToonMaterial;
  private readonly tetherMidpoint = new THREE.Vector3();
  private readonly waterlineOverlayController: WaterlineOverlayController;
  private readonly overlayProjectile: THREE.Group;
  private readonly overlayImpactMarker: THREE.Group;
  private readonly overlayTetherRope: THREE.Mesh;
  private embeddedWhaleRoot: THREE.Object3D | null = null;

  constructor(ownerShipId: string) {
    this.ownerShipId = ownerShipId;

    const shaftMaterial = createCelMaterial({
      color: '#6f5a46',
      emissive: '#161b23',
      emissiveIntensity: 0.02,
    });

    const tipMaterial = createCelMaterial({
      color: '#9faab0',
      emissive: '#171a1d',
      emissiveIntensity: 0.01,
    });

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), shaftMaterial);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.08;

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.36, 5), shaftMaterial);
    grip.rotation.x = Math.PI / 2;
    grip.position.z = -0.82;

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.7, 5), tipMaterial);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = 1.45;

    const barbGeometry = new THREE.BoxGeometry(0.08, 0.02, 0.34);
    const leftBarb = new THREE.Mesh(barbGeometry, tipMaterial);
    leftBarb.position.set(-0.14, 0, 1.04);
    leftBarb.rotation.y = Math.PI / 5;
    leftBarb.rotation.z = -0.3;

    const rightBarb = leftBarb.clone();
    rightBarb.position.x *= -1;
    rightBarb.rotation.y *= -1;
    rightBarb.rotation.z *= -1;

    this.projectile = new THREE.Group();
    this.projectile.name = 'projectile';
    this.projectile.add(shaft, grip, tip, leftBarb, rightBarb);
    this.position = this.projectile.position;

    const impactCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.14, 0),
      createCelMaterial({
        color: '#2d2119',
        emissive: '#080706',
        emissiveIntensity: 0,
      }),
    );
    const impactFin = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.16, 0.3),
      createCelMaterial({
        color: '#51545a',
        emissive: '#0f1113',
        emissiveIntensity: 0,
      }),
    );
    const impactFinCross = impactFin.clone();
    impactFinCross.rotation.z = Math.PI / 2;

    this.impactMarker = new THREE.Group();
    this.impactMarker.name = 'impact_marker';
    this.impactMarker.add(impactCore, impactFin, impactFinCross);
    this.impactMarker.visible = false;

    const tetherGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1, 6);
    this.tetherRopeMaterial = createCelMaterial({
      color: ROPE_SLACK_COLOR,
      emissive: '#120b06',
      emissiveIntensity: 0.01,
    });
    this.tetherRopeMaterial.fog = true;

    this.tetherRope = new THREE.Mesh(tetherGeometry, this.tetherRopeMaterial);
    this.tetherRope.name = 'tether_rope';
    this.tetherRope.visible = false;

    const overlaySource = new THREE.Group();
    overlaySource.add(
      cloneUniqueObjectRoot(this.projectile),
      cloneUniqueObjectRoot(this.impactMarker),
      cloneUniqueObjectRoot(new THREE.Group().add(this.tetherRope.clone())),
    );
    this.waterlineOverlayController = createWaterlineOverlay(overlaySource, {
      color: HARPOON_WATERLINE_COLOR,
      opacityMin: HARPOON_WATERLINE_OPACITY_MIN,
      opacityMax: HARPOON_WATERLINE_OPACITY_MAX,
    });
    this.overlayProjectile = this.waterlineOverlayController.root.getObjectByName('projectile') as THREE.Group;
    this.overlayImpactMarker = this.waterlineOverlayController.root.getObjectByName('impact_marker') as THREE.Group;
    this.overlayTetherRope = this.waterlineOverlayController.root.getObjectByName('tether_rope') as THREE.Mesh;

    this.root.add(this.projectile, this.impactMarker, this.tetherRope, this.waterlineOverlayController.root);
    this.root.visible = false;
  }

  getWaterlinePassthroughAnchor(target = new THREE.Vector3()): THREE.Vector3 {
    return this.projectile.getWorldPosition(target);
  }

  getWaterlinePassthroughBounds(target: THREE.Box3): THREE.Box3 {
    target.makeEmpty();

    if (this.projectile.visible) {
      target.expandByObject(this.projectile, true);
    }

    if (this.impactMarker.visible) {
      target.expandByObject(this.impactMarker, true);
    }

    if (this.tetherRope.visible) {
      target.expandByObject(this.tetherRope, true);
    }

    return target;
  }

  setWaterlinePassthrough(state: WaterlinePassthroughState): void {
    this.waterlineOverlayController.setState(state);
  }

  getStrikePoint(target = new THREE.Vector3()): THREE.Vector3 {
    target.set(0, 0, HARPOON_CENTER_FROM_ANCHOR_DISTANCE);
    return this.projectile.localToWorld(target);
  }

  launch(origin: THREE.Vector3, direction: THREE.Vector3, speed: number): void {
    this.active = true;
    this.mode = 'flying';
    this.ageSeconds = 0;
    this.embeddedWhaleRoot = null;
    this.position.copy(origin);
    this.velocity.copy(direction).normalize().multiplyScalar(speed);
    this.projectile.visible = true;
    this.impactMarker.visible = false;
    this.tetherRope.visible = false;
    this.tetherRopeMaterial.color.copy(ROPE_SLACK_COLOR);
    this.setWaterlinePassthrough(INACTIVE_WATERLINE_PASSTHROUGH_STATE);
    this.root.visible = true;
    this.alignToVelocity();
    this.syncWaterlineOverlayTransforms();
    this.root.updateMatrixWorld();
  }

  attach(attachPoint: THREE.Vector3, whaleRoot: THREE.Object3D): void {
    this.mode = 'tethered';
    this.velocity.setScalar(0);
    this.tipAnchor.copy(attachPoint);
    this.embeddedWhaleRoot = whaleRoot;
    whaleRoot.updateMatrixWorld(true);
    this.embeddedTipLocal.copy(attachPoint);
    whaleRoot.worldToLocal(this.embeddedTipLocal);
    whaleRoot.getWorldQuaternion(this.tempWhaleQuaternion).invert();
    this.embeddedProjectileLocalQuaternion.copy(this.tempWhaleQuaternion).multiply(this.projectile.quaternion);
    this.positionFromTipAnchor();
    this.projectile.visible = true;
    this.impactMarker.visible = true;
    this.tetherRope.visible = true;
    this.tetherRopeMaterial.color.copy(ROPE_SLACK_COLOR);
    this.root.visible = true;
    this.impactMarker.position.copy(this.tipAnchor);
    this.syncWaterlineOverlayTransforms();
    this.root.updateMatrixWorld();
  }

  update(deltaSeconds: number): void {
    if (!this.active) {
      return;
    }

    this.ageSeconds += deltaSeconds;

    if (this.mode === 'flying') {
      this.position.addScaledVector(this.velocity, deltaSeconds);
      this.alignToVelocity();
    }

    this.syncWaterlineOverlayTransforms();
    this.root.updateMatrixWorld();
  }

  updateTether(shipOrigin: THREE.Vector3, attachPoint: THREE.Vector3, tensionAlpha: number): void {
    if (!this.active || this.mode !== 'tethered') {
      return;
    }

    this.syncEmbeddedTransform(attachPoint);
    this.impactMarker.position.copy(this.tipAnchor);
    this.direction.copy(this.tipAnchor).sub(shipOrigin);
    const tetherLength = Math.max(0.001, this.direction.length());
    this.direction.multiplyScalar(1 / tetherLength);
    this.tetherMidpoint.copy(shipOrigin).lerp(this.tipAnchor, 0.5);

    this.tetherRope.position.copy(this.tetherMidpoint);
    this.tetherRope.quaternion.setFromUnitVectors(TETHER_AXIS, this.direction);
    this.tetherRope.scale.set(1, tetherLength, 1);
    this.tetherRopeMaterial.color.copy(ROPE_SLACK_COLOR).lerp(ROPE_TENSION_COLOR, tensionAlpha);

    this.syncWaterlineOverlayTransforms();
    this.root.updateMatrixWorld();
  }

  getTetherLength(shipOrigin: THREE.Vector3, attachPoint: THREE.Vector3): number {
    this.syncEmbeddedTransform(attachPoint);
    return shipOrigin.distanceTo(this.tipAnchor);
  }

  lodgeInWhale(whaleRoot: THREE.Object3D): void {
    if (this.mode === 'lodged') {
      return;
    }

    this.active = false;
    this.mode = 'lodged';
    this.velocity.setScalar(0);
    this.syncEmbeddedTransform(this.tipAnchor);
    this.tetherRope.visible = false;
    this.projectile.visible = true;
    this.impactMarker.visible = true;
    this.root.visible = true;
    this.setWaterlinePassthrough(INACTIVE_WATERLINE_PASSTHROUGH_STATE);
    this.syncWaterlineOverlayTransforms();
    this.root.updateMatrixWorld(true);
    whaleRoot.updateMatrixWorld(true);
    whaleRoot.attach(this.root);
    this.root.updateMatrixWorld(true);
  }

  deactivate(): void {
    this.active = false;
    this.mode = 'flying';
    this.embeddedWhaleRoot = null;
    this.setWaterlinePassthrough(INACTIVE_WATERLINE_PASSTHROUGH_STATE);
    this.root.visible = false;
    this.projectile.visible = false;
    this.impactMarker.visible = false;
    this.tetherRope.visible = false;
    this.root.removeFromParent();
  }

  dispose(): void {
    this.deactivate();
    disposeObject3DResources(this.root, new Set([this.waterlineOverlayController.material]));
    this.waterlineOverlayController.material.dispose();
  }

  private alignToVelocity(): void {
    this.direction.copy(this.velocity).normalize();
    this.projectile.quaternion.setFromUnitVectors(PROJECTILE_AXIS, this.direction);
  }

  private positionFromTipAnchor(): void {
    this.direction.set(0, 0, 1).applyQuaternion(this.projectile.quaternion).normalize();
    this.position.copy(this.tipAnchor).addScaledVector(this.direction, -HARPOON_CENTER_FROM_ANCHOR_DISTANCE);
  }

  private syncEmbeddedTransform(fallbackAttachPoint: THREE.Vector3): void {
    if (this.embeddedWhaleRoot) {
      this.embeddedWhaleRoot.updateMatrixWorld(true);
      this.tipAnchor.copy(this.embeddedTipLocal).applyMatrix4(this.embeddedWhaleRoot.matrixWorld);
      this.embeddedWhaleRoot.getWorldQuaternion(this.tempWhaleQuaternion);
      this.projectile.quaternion.copy(this.tempWhaleQuaternion).multiply(this.embeddedProjectileLocalQuaternion);
    } else {
      this.tipAnchor.copy(fallbackAttachPoint);
    }

    this.positionFromTipAnchor();
    this.impactMarker.position.copy(this.tipAnchor);
    this.impactMarker.quaternion.copy(this.projectile.quaternion);
  }

  private syncWaterlineOverlayTransforms(): void {
    this.overlayProjectile.position.copy(this.projectile.position);
    this.overlayProjectile.quaternion.copy(this.projectile.quaternion);
    this.overlayProjectile.scale.copy(this.projectile.scale);
    this.overlayProjectile.visible = this.projectile.visible;

    this.overlayImpactMarker.position.copy(this.impactMarker.position);
    this.overlayImpactMarker.quaternion.copy(this.impactMarker.quaternion);
    this.overlayImpactMarker.scale.copy(this.impactMarker.scale);
    this.overlayImpactMarker.visible = this.impactMarker.visible;

    this.overlayTetherRope.position.copy(this.tetherRope.position);
    this.overlayTetherRope.quaternion.copy(this.tetherRope.quaternion);
    this.overlayTetherRope.scale.copy(this.tetherRope.scale);
    this.overlayTetherRope.visible = this.tetherRope.visible;
  }
}

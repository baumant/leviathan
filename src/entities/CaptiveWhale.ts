import * as THREE from 'three';

import { createCelMaterial } from '../fx/createCelMaterial';
import { WHALE_SPEED_PROFILE } from '../tuning/whaleSpeedProfile';
import { createWhaleHeroRig } from './WhaleHeroAsset';
import { applyWhaleVisualPose, resetWhaleVisualPose, sampleWhaleSwimPose } from './WhaleVisualMotion';
import { createSpermWhaleVisual } from './createSpermWhaleVisual';

export type CaptiveWhaleState = 'inactive' | 'towed' | 'escaping' | 'captured' | 'gone';

interface CaptiveWhaleTowUpdate {
  deltaSeconds: number;
  elapsedSeconds: number;
  towOrigins: readonly THREE.Vector3[];
  towDirection: THREE.Vector3;
  sampleSurfaceHeight: (x: number, z: number) => number;
}

const MAX_TOW_LINES = 3;
const TOW_LINE_AXIS = new THREE.Vector3(0, 1, 0);
const TOWED_TRAIL_DISTANCE = 13.8;
const TOWED_DEPTH_OFFSET = 0.46;
const ESCAPE_DURATION = 4.4;
const ESCAPE_INITIAL_SPEED = 15.5;
const ESCAPE_FINAL_SPEED = 7.2;
const ESCAPE_MAX_DEPTH = 7.4;
const CAPTURE_DURATION = 1.5;
const CAPTURE_TARGET_DEPTH = 0.9;

export class CaptiveWhale {
  readonly root = new THREE.Group();
  readonly visualRoot = new THREE.Group();
  readonly position = this.visualRoot.position;

  state: CaptiveWhaleState = 'inactive';

  private readonly fallbackVisualRoot: THREE.Group;
  private readonly towAttachLocals = [
    new THREE.Vector3(-1.18, 0.18, 1.9),
    new THREE.Vector3(0, 0.26, 2.34),
    new THREE.Vector3(1.18, 0.18, 1.9),
  ] as const;
  private readonly towMidpoint = new THREE.Vector3();
  private readonly towTarget = new THREE.Vector3();
  private readonly towDirection = new THREE.Vector3();
  private readonly towLateral = new THREE.Vector3();
  private readonly escapeDirection = new THREE.Vector3(0, 0, -1);
  private readonly escapeStep = new THREE.Vector3();
  private readonly captureTarget = new THREE.Vector3();
  private readonly captureDirection = new THREE.Vector3();
  private readonly tempAttach = new THREE.Vector3();
  private readonly lineDirection = new THREE.Vector3();
  private readonly lineMidpoint = new THREE.Vector3();
  private readonly lineQuaternion = new THREE.Quaternion();
  private readonly towLineGeometry = new THREE.CylinderGeometry(0.08, 0.08, 1, 6);
  private readonly towLineCoreMaterial = createCelMaterial({
    color: '#c4d5e1',
    emissive: '#7ba5bd',
    emissiveIntensity: 0.14,
  });
  private readonly towLineGlowMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#9fdaf7'),
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private readonly towLines: Array<{
    core: THREE.Mesh<THREE.CylinderGeometry, THREE.Material>;
    glow: THREE.Mesh<THREE.CylinderGeometry, THREE.Material>;
  }> = [];

  private escapeAge = 0;
  private captureAge = 0;
  private escapeDepth = 0;
  private towInitialized = false;
  private yaw = 0;
  private bodyVisualRoot: THREE.Object3D;
  private tailVisualPivot: THREE.Object3D;
  private flukeVisualPivot: THREE.Object3D;
  private leftFinPivot: THREE.Object3D;
  private rightFinPivot: THREE.Object3D;
  private towAttachNodes: readonly THREE.Object3D[] = [];
  private readonly previousVisualPosition = new THREE.Vector3();
  private swimPhase = 0;
  private swimAmplitude = 0;

  constructor() {
    const harpoonMaterial = createCelMaterial({
      color: '#9eafbf',
      emissive: '#5e7d95',
      emissiveIntensity: 0.1,
    });
    const fallbackRig = createSpermWhaleVisual({
      palette: {
        bodyColor: '#6d7f8b',
        bodyEmissive: '#334551',
        bodyEmissiveIntensity: 0.05,
        bellyColor: '#8da0ad',
        bellyEmissive: '#425560',
        bellyEmissiveIntensity: 0.04,
      },
      lengthScale: 0.94,
      girthScale: 0.9,
      finScale: 0.88,
    });

    // Keep the captive whale broad and restrained so it reads through fog and
    // supports the mythic scale of the encounter without overtaking the player whale.
    this.fallbackVisualRoot = fallbackRig.root;
    this.bodyVisualRoot = fallbackRig.bodyRoot;
    this.tailVisualPivot = fallbackRig.tailPivot;
    this.flukeVisualPivot = fallbackRig.flukePivot;
    this.leftFinPivot = fallbackRig.leftFinPivot;
    this.rightFinPivot = fallbackRig.rightFinPivot;

    for (const attachLocal of this.towAttachLocals) {
      const harpoon = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 5), harpoonMaterial);
      harpoon.position.copy(attachLocal).add(new THREE.Vector3(0, 0.1, -0.18));
      harpoon.rotation.x = Math.PI / 2 - 0.12;
      harpoon.rotation.z = attachLocal.x === 0 ? 0 : attachLocal.x < 0 ? -0.18 : 0.18;
      this.visualRoot.add(harpoon);
    }

    this.visualRoot.add(this.fallbackVisualRoot);
    this.visualRoot.scale.setScalar(1.02);
    this.visualRoot.rotation.order = 'YXZ';

    for (let index = 0; index < MAX_TOW_LINES; index += 1) {
      const core = new THREE.Mesh(this.towLineGeometry, this.towLineCoreMaterial);
      const glow = new THREE.Mesh(this.towLineGeometry, this.towLineGlowMaterial);
      glow.scale.set(2.4, 1, 2.4);
      glow.renderOrder = 3;
      this.root.add(core, glow);
      this.towLines.push({ core, glow });
    }

    this.root.add(this.visualRoot);
    this.root.visible = false;
    this.hideTowLines();
    resetWhaleVisualPose(
      this.bodyVisualRoot,
      this.tailVisualPivot,
      this.flukeVisualPivot,
      this.leftFinPivot,
      this.rightFinPivot,
    );

    void this.loadHeroVisual();
  }

  get active(): boolean {
    return this.state === 'towed' || this.state === 'escaping' || this.state === 'captured';
  }

  reset(): void {
    this.state = 'inactive';
    this.escapeAge = 0;
    this.captureAge = 0;
    this.escapeDepth = 0;
    this.towInitialized = false;
    this.yaw = 0;
    this.swimPhase = 0;
    this.swimAmplitude = 0;
    this.position.set(0, 0, 0);
    this.visualRoot.rotation.set(0, 0, 0, 'YXZ');
    this.root.visible = false;
    this.hideTowLines();
    resetWhaleVisualPose(
      this.bodyVisualRoot,
      this.tailVisualPivot,
      this.flukeVisualPivot,
      this.leftFinPivot,
      this.rightFinPivot,
    );
    this.root.updateMatrixWorld(true);
  }

  beginTow(): void {
    this.state = 'towed';
    this.escapeAge = 0;
    this.captureAge = 0;
    this.escapeDepth = 0;
    this.towInitialized = false;
    this.root.visible = true;
  }

  updateTow(params: CaptiveWhaleTowUpdate): void {
    const towOriginCount = Math.min(params.towOrigins.length, MAX_TOW_LINES);

    if (towOriginCount <= 0) {
      return;
    }

    if (this.state !== 'towed') {
      this.beginTow();
    }

    this.towMidpoint.setScalar(0);
    for (let index = 0; index < towOriginCount; index += 1) {
      this.towMidpoint.add(params.towOrigins[index]);
    }
    this.towMidpoint.multiplyScalar(1 / towOriginCount);

    this.towDirection.copy(params.towDirection).setY(0);

    if (this.towDirection.lengthSq() <= 0.0001) {
      this.towDirection.set(0, 0, -1);
    } else {
      this.towDirection.normalize();
    }

    this.towTarget.copy(this.towMidpoint).addScaledVector(this.towDirection, -TOWED_TRAIL_DISTANCE);
    this.towLateral.set(-this.towDirection.z, 0, this.towDirection.x);
    this.towTarget.addScaledVector(this.towLateral, Math.sin(params.elapsedSeconds * 1.35) * 0.58);
    this.previousVisualPosition.copy(this.position);

    const surfaceHeight = params.sampleSurfaceHeight(this.towTarget.x, this.towTarget.z);
    this.towTarget.y = surfaceHeight - TOWED_DEPTH_OFFSET + Math.sin(params.elapsedSeconds * 1.7) * 0.1;

    if (!this.towInitialized) {
      this.position.copy(this.towTarget);
      this.yaw = Math.atan2(this.towDirection.x, this.towDirection.z);
      this.towInitialized = true;
    } else {
      const followAlpha = 1 - Math.exp(-params.deltaSeconds * 2.8);
      this.position.lerp(this.towTarget, followAlpha);
    }

    this.yaw = THREE.MathUtils.damp(
      this.yaw,
      Math.atan2(this.towDirection.x, this.towDirection.z),
      3.1,
      params.deltaSeconds,
    );

    const pitch = THREE.MathUtils.damp(
      this.visualRoot.rotation.x,
      -0.16 + Math.sin(params.elapsedSeconds * 1.2) * 0.03,
      3.2,
      params.deltaSeconds,
    );
    const roll = THREE.MathUtils.damp(
      this.visualRoot.rotation.z,
      Math.sin(params.elapsedSeconds * 1.45) * 0.1,
      2.9,
      params.deltaSeconds,
    );
    const towTravelSpeed =
      this.position.distanceTo(this.previousVisualPosition) / Math.max(params.deltaSeconds, 0.0001);
    const towSpeedRatio = THREE.MathUtils.clamp(towTravelSpeed / WHALE_SPEED_PROFILE.maxTravelSpeed, 0, 1.2);
    this.visualRoot.rotation.set(pitch, this.yaw, roll, 'YXZ');
    this.updateSwimVisual(
      params.deltaSeconds,
      THREE.MathUtils.lerp(0.08, 0.18, towSpeedRatio),
      towTravelSpeed,
    );

    this.root.visible = true;
    this.showTowLines(towOriginCount);
    this.root.updateMatrixWorld(true);

    const attachIndices =
      towOriginCount === 1 ? [1] : towOriginCount === 2 ? [0, 2] : [0, 1, 2];

    for (let index = 0; index < towOriginCount; index += 1) {
      const attach = this.towAttachNodes[attachIndices[index]] ?? this.towAttachLocals[attachIndices[index]];
      this.updateTowLine(this.towLines[index], params.towOrigins[index], attach);
    }
  }

  release(direction: THREE.Vector3): void {
    if (this.state !== 'towed') {
      return;
    }

    this.state = 'escaping';
    this.escapeAge = 0;
    this.captureAge = 0;
    this.escapeDepth = 0.18;
    this.escapeDirection.copy(direction).setY(0);

    if (this.escapeDirection.lengthSq() <= 0.0001) {
      this.escapeDirection.set(0, 0, -1);
    } else {
      this.escapeDirection.normalize();
    }

    this.hideTowLines();
    this.root.visible = true;
  }

  capture(target: THREE.Vector3): void {
    if (this.state !== 'towed') {
      return;
    }

    this.state = 'captured';
    this.captureAge = 0;
    this.captureTarget.copy(target);
    this.hideTowLines();
    this.root.visible = true;
  }

  update(deltaSeconds: number, elapsedSeconds: number, sampleSurfaceHeight: (x: number, z: number) => number): void {
    if (this.state === 'escaping') {
      this.previousVisualPosition.copy(this.position);
      this.escapeAge += deltaSeconds;
      const escapeAlpha = THREE.MathUtils.clamp(this.escapeAge / ESCAPE_DURATION, 0, 1);
      const speed = THREE.MathUtils.lerp(ESCAPE_INITIAL_SPEED, ESCAPE_FINAL_SPEED, escapeAlpha);
      this.escapeStep.copy(this.escapeDirection).multiplyScalar(speed * deltaSeconds);
      this.position.add(this.escapeStep);

      this.escapeDepth = THREE.MathUtils.lerp(0.18, ESCAPE_MAX_DEPTH, THREE.MathUtils.smoothstep(escapeAlpha, 0.16, 1));
      const surfaceHeight = sampleSurfaceHeight(this.position.x, this.position.z);
      this.position.y = surfaceHeight - this.escapeDepth + Math.sin(elapsedSeconds * 1.1) * 0.04;

      const yawTarget = Math.atan2(this.escapeDirection.x, this.escapeDirection.z);
      this.yaw = THREE.MathUtils.damp(this.yaw, yawTarget, 2.4, deltaSeconds);
      const pitchTarget = THREE.MathUtils.lerp(-0.18, 0.36, escapeAlpha);
      const rollTarget = Math.sin(elapsedSeconds * 0.9) * THREE.MathUtils.lerp(0.08, 0.02, escapeAlpha);
      this.visualRoot.rotation.set(
        THREE.MathUtils.damp(this.visualRoot.rotation.x, pitchTarget, 2.8, deltaSeconds),
        this.yaw,
        THREE.MathUtils.damp(this.visualRoot.rotation.z, rollTarget, 2.2, deltaSeconds),
        'YXZ',
      );
      this.updateSwimVisual(deltaSeconds, THREE.MathUtils.lerp(0.22, 0.4, escapeAlpha), speed);

      this.root.updateMatrixWorld(true);

      if (this.escapeAge >= ESCAPE_DURATION || this.escapeDepth >= ESCAPE_MAX_DEPTH - 0.02) {
        this.state = 'gone';
        this.root.visible = false;
      }
      return;
    }

    if (this.state !== 'captured') {
      return;
    }

    this.previousVisualPosition.copy(this.position);
    this.captureAge += deltaSeconds;
    this.captureDirection.copy(this.captureTarget).sub(this.position).setY(0);

    if (this.captureDirection.lengthSq() <= 0.0001) {
      this.captureDirection.set(0, 0, -1);
    } else {
      this.captureDirection.normalize();
    }

    const captureAlpha = THREE.MathUtils.clamp(this.captureAge / CAPTURE_DURATION, 0, 1);
    const captureSurface = sampleSurfaceHeight(this.captureTarget.x, this.captureTarget.z);
    this.captureTarget.y = captureSurface - CAPTURE_TARGET_DEPTH;
    this.position.lerp(this.captureTarget, 1 - Math.exp(-deltaSeconds * 5.2));

    const yawTarget = Math.atan2(this.captureDirection.x, this.captureDirection.z);
    this.yaw = THREE.MathUtils.damp(this.yaw, yawTarget, 4.4, deltaSeconds);
    this.visualRoot.rotation.set(
      THREE.MathUtils.damp(this.visualRoot.rotation.x, 0.08 + captureAlpha * 0.2, 4.2, deltaSeconds),
      this.yaw,
      THREE.MathUtils.damp(this.visualRoot.rotation.z, 0, 4, deltaSeconds),
      'YXZ',
    );
    this.updateSwimVisual(
      deltaSeconds,
      THREE.MathUtils.lerp(0.06, 0.03, captureAlpha),
      this.position.distanceTo(this.previousVisualPosition) / Math.max(deltaSeconds, 0.0001),
    );

    this.root.updateMatrixWorld(true);

    if (this.captureAge >= CAPTURE_DURATION || this.position.distanceToSquared(this.captureTarget) <= 2.4) {
      this.state = 'gone';
      this.root.visible = false;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.towLineGeometry.dispose();
    this.towLineCoreMaterial.dispose();
    this.towLineGlowMaterial.dispose();

    this.visualRoot.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      child.geometry.dispose();

      if (Array.isArray(child.material)) {
        for (const material of child.material) {
          material.dispose();
        }
        return;
      }

      child.material.dispose();
    });
  }

  private updateTowLine(
    slot: { core: THREE.Mesh<THREE.CylinderGeometry, THREE.Material>; glow: THREE.Mesh<THREE.CylinderGeometry, THREE.Material> },
    towOrigin: THREE.Vector3,
    attach: THREE.Vector3 | THREE.Object3D,
  ): void {
    const attachPoint =
      attach instanceof THREE.Object3D
        ? attach.getWorldPosition(this.tempAttach)
        : this.visualRoot.localToWorld(this.tempAttach.copy(attach));
    this.lineDirection.copy(attachPoint).sub(towOrigin);
    const length = Math.max(0.001, this.lineDirection.length());
    this.lineDirection.multiplyScalar(1 / length);
    this.lineMidpoint.copy(towOrigin).lerp(attachPoint, 0.5);
    this.lineQuaternion.setFromUnitVectors(TOW_LINE_AXIS, this.lineDirection);

    slot.core.position.copy(this.lineMidpoint);
    slot.core.quaternion.copy(this.lineQuaternion);
    slot.core.scale.set(1, length, 1);

    slot.glow.position.copy(this.lineMidpoint);
    slot.glow.quaternion.copy(this.lineQuaternion);
    slot.glow.scale.set(2.4, length, 2.4);
  }

  private hideTowLines(): void {
    for (const slot of this.towLines) {
      slot.core.visible = false;
      slot.glow.visible = false;
    }
  }

  private showTowLines(count: number): void {
    for (let index = 0; index < this.towLines.length; index += 1) {
      const visible = index < count;
      this.towLines[index].core.visible = visible;
      this.towLines[index].glow.visible = visible;
    }
  }

  private updateSwimVisual(deltaSeconds: number, targetAmplitude: number, travelSpeed: number): void {
    const speedRatio = THREE.MathUtils.clamp(
      travelSpeed / Math.max(WHALE_SPEED_PROFILE.maxTravelSpeed, 0.001),
      0,
      1.2,
    );
    const frequency = THREE.MathUtils.lerp(1.02, 1.76, speedRatio);

    this.swimAmplitude = THREE.MathUtils.damp(
      this.swimAmplitude,
      targetAmplitude,
      targetAmplitude > this.swimAmplitude ? 4.6 : 3.3,
      deltaSeconds,
    );

    if (this.swimAmplitude > 0.001 || targetAmplitude > 0.001) {
      this.swimPhase += deltaSeconds * frequency * Math.PI * 2;
      if (this.swimPhase > Math.PI * 2) {
        this.swimPhase %= Math.PI * 2;
      }
    }

    applyWhaleVisualPose(
      this.bodyVisualRoot,
      this.tailVisualPivot,
      this.flukeVisualPivot,
      this.leftFinPivot,
      this.rightFinPivot,
      sampleWhaleSwimPose(this.swimPhase, this.swimAmplitude),
    );
  }

  private async loadHeroVisual(): Promise<void> {
    try {
      const bodyRotation = this.bodyVisualRoot.rotation.clone();
      const tailRotation = this.tailVisualPivot.rotation.clone();
      const flukeRotation = this.flukeVisualPivot.rotation.clone();
      const leftFinRotation = this.leftFinPivot.rotation.clone();
      const rightFinRotation = this.rightFinPivot.rotation.clone();
      const heroRig = await createWhaleHeroRig('captive');
      this.visualRoot.add(heroRig.root);
      this.fallbackVisualRoot.visible = false;
      this.bodyVisualRoot = heroRig.bodyRoot;
      this.tailVisualPivot = heroRig.tailPivot;
      this.flukeVisualPivot = heroRig.flukePivot;
      this.leftFinPivot = heroRig.leftFinPivot;
      this.rightFinPivot = heroRig.rightFinPivot;
      this.bodyVisualRoot.rotation.copy(bodyRotation);
      this.tailVisualPivot.rotation.copy(tailRotation);
      this.flukeVisualPivot.rotation.copy(flukeRotation);
      this.leftFinPivot.rotation.copy(leftFinRotation);
      this.rightFinPivot.rotation.copy(rightFinRotation);
      this.towAttachNodes = heroRig.towAttach;
    } catch (error) {
      console.warn('Failed to load captive whale hero asset, keeping procedural fallback.', error);
    }
  }
}

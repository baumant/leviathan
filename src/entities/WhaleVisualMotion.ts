import * as THREE from 'three';

export interface WhaleVisualRig {
  readonly root: THREE.Group;
  readonly spineRoot: THREE.Object3D;
  readonly bodyRoot: THREE.Object3D;
  readonly tailPivot: THREE.Object3D;
  readonly flukePivot: THREE.Object3D;
  readonly leftFinPivot: THREE.Object3D;
  readonly rightFinPivot: THREE.Object3D;
}

export interface WhaleSwimPose {
  bodyPitch: number;
  tailPitch: number;
  flukePitch: number;
  finPitch: number;
  finRoll: number;
}

export interface WhaleActionVisualPose {
  tailYaw?: number;
  flukeRoll?: number;
  finPitch?: number;
  finRoll?: number;
}

export interface WhaleDirectionalPose {
  spinePitch: number;
  spineYaw: number;
  spineRoll: number;
  tailPitch: number;
  tailYaw: number;
  flukeRoll: number;
  leftFinPitch: number;
  leftFinYaw: number;
  leftFinRoll: number;
  rightFinPitch: number;
  rightFinYaw: number;
  rightFinRoll: number;
}

const MAX_BODY_PITCH = THREE.MathUtils.degToRad(2.2);
const MAX_TAIL_PITCH = THREE.MathUtils.degToRad(10.5);
const MAX_FLUKE_PITCH = THREE.MathUtils.degToRad(14);
const MAX_FIN_PITCH = THREE.MathUtils.degToRad(4.8);
const MAX_FIN_ROLL = THREE.MathUtils.degToRad(3.8);
const MAX_DIRECTIONAL_SPINE_PITCH = THREE.MathUtils.degToRad(3.5);
const MAX_DIRECTIONAL_SPINE_YAW = THREE.MathUtils.degToRad(4);
const MAX_DIRECTIONAL_SPINE_ROLL = THREE.MathUtils.degToRad(5.5);
const MAX_DIRECTIONAL_TAIL_YAW = THREE.MathUtils.degToRad(7);
const MAX_DIRECTIONAL_TAIL_PITCH = THREE.MathUtils.degToRad(2.5);
const MAX_DIRECTIONAL_FLUKE_ROLL = THREE.MathUtils.degToRad(5);
const MAX_DIRECTIONAL_TURN_FIN_PITCH = THREE.MathUtils.degToRad(7);
const MAX_DIRECTIONAL_TURN_FIN_YAW = THREE.MathUtils.degToRad(5);
const MAX_DIRECTIONAL_TURN_FIN_ROLL = THREE.MathUtils.degToRad(9);
const MAX_DIRECTIONAL_CLIMB_FIN_PITCH = THREE.MathUtils.degToRad(4.5);

export const WHALE_FIN_NEUTRAL_PITCH = THREE.MathUtils.degToRad(-16);
export const WHALE_FIN_NEUTRAL_YAW = THREE.MathUtils.degToRad(4.5);
export const WHALE_FIN_NEUTRAL_ROLL = THREE.MathUtils.degToRad(24);

export function sampleWhaleSwimPose(phase: number, amplitude: number): WhaleSwimPose {
  const clampedAmplitude = THREE.MathUtils.clamp(amplitude, 0, 1);

  if (clampedAmplitude <= 0.0001) {
    return {
      bodyPitch: 0,
      tailPitch: 0,
      flukePitch: 0,
      finPitch: 0,
      finRoll: 0,
    };
  }

  const tailWave = -Math.sin(phase);
  const flukeWave = -Math.sin(phase - 0.26);
  const bodyWave = Math.sin(phase - 0.18);
  const finWave = Math.sin(phase - 0.08);

  return {
    bodyPitch: bodyWave * MAX_BODY_PITCH * clampedAmplitude,
    tailPitch: tailWave * MAX_TAIL_PITCH * clampedAmplitude,
    flukePitch: flukeWave * MAX_FLUKE_PITCH * clampedAmplitude,
    finPitch: finWave * MAX_FIN_PITCH * clampedAmplitude,
    finRoll: -finWave * MAX_FIN_ROLL * clampedAmplitude,
  };
}

export function sampleWhaleDirectionalPose(
  turnInput: number,
  climbInput: number,
  speedWeight: number,
): WhaleDirectionalPose {
  const clampedWeight = THREE.MathUtils.clamp(speedWeight, 0, 1);

  if (clampedWeight <= 0.0001) {
    return {
      spinePitch: 0,
      spineYaw: 0,
      spineRoll: 0,
      tailPitch: 0,
      tailYaw: 0,
      flukeRoll: 0,
      leftFinPitch: 0,
      leftFinYaw: 0,
      leftFinRoll: 0,
      rightFinPitch: 0,
      rightFinYaw: 0,
      rightFinRoll: 0,
    };
  }

  const turn = THREE.MathUtils.clamp(turnInput, -1, 1) * clampedWeight;
  const climb = THREE.MathUtils.clamp(climbInput, -1, 1) * clampedWeight;
  const finYaw = -turn * MAX_DIRECTIONAL_TURN_FIN_YAW;
  const finRoll = -turn * MAX_DIRECTIONAL_TURN_FIN_ROLL;
  const climbFinPitch = climb * MAX_DIRECTIONAL_CLIMB_FIN_PITCH;

  return {
    spinePitch: -climb * MAX_DIRECTIONAL_SPINE_PITCH,
    spineYaw: turn * MAX_DIRECTIONAL_SPINE_YAW,
    spineRoll: turn * MAX_DIRECTIONAL_SPINE_ROLL,
    tailPitch: -climb * MAX_DIRECTIONAL_TAIL_PITCH,
    tailYaw: -turn * MAX_DIRECTIONAL_TAIL_YAW,
    flukeRoll: -turn * MAX_DIRECTIONAL_FLUKE_ROLL,
    leftFinPitch: climbFinPitch + turn * MAX_DIRECTIONAL_TURN_FIN_PITCH,
    leftFinYaw: finYaw,
    leftFinRoll: finRoll,
    rightFinPitch: climbFinPitch - turn * MAX_DIRECTIONAL_TURN_FIN_PITCH,
    rightFinYaw: finYaw,
    rightFinRoll: finRoll,
  };
}

export function applyWhaleVisualPose(
  spineRoot: THREE.Object3D,
  bodyRoot: THREE.Object3D,
  tailPivot: THREE.Object3D,
  flukePivot: THREE.Object3D,
  leftFinPivot: THREE.Object3D,
  rightFinPivot: THREE.Object3D,
  swimPose: WhaleSwimPose,
  directionalPose: WhaleDirectionalPose,
  actionPose: WhaleActionVisualPose = {},
): void {
  // Defensive guard: visual rigs can transiently swap during fallback/hero
  // transitions, and we should never let a missing node crash gameplay.
  if (!spineRoot || !bodyRoot || !tailPivot || !flukePivot || !leftFinPivot || !rightFinPivot) {
    return;
  }

  const tailYaw = directionalPose.tailYaw + (actionPose.tailYaw ?? 0);
  const flukeRoll = directionalPose.flukeRoll + (actionPose.flukeRoll ?? 0);
  const actionFinPitch = actionPose.finPitch ?? 0;
  const actionFinRoll = actionPose.finRoll ?? 0;
  const leftFinPitch = WHALE_FIN_NEUTRAL_PITCH + swimPose.finPitch + actionFinPitch + directionalPose.leftFinPitch;
  const rightFinPitch = WHALE_FIN_NEUTRAL_PITCH + swimPose.finPitch + actionFinPitch + directionalPose.rightFinPitch;
  const leftFinYaw = WHALE_FIN_NEUTRAL_YAW + directionalPose.leftFinYaw;
  const rightFinYaw = -WHALE_FIN_NEUTRAL_YAW + directionalPose.rightFinYaw;
  const leftFinRoll = WHALE_FIN_NEUTRAL_ROLL + swimPose.finRoll + actionFinRoll + directionalPose.leftFinRoll;
  const rightFinRoll = -WHALE_FIN_NEUTRAL_ROLL - swimPose.finRoll - actionFinRoll + directionalPose.rightFinRoll;

  spineRoot.rotation.set(
    directionalPose.spinePitch,
    directionalPose.spineYaw,
    directionalPose.spineRoll,
  );
  bodyRoot.rotation.set(swimPose.bodyPitch, 0, 0);
  tailPivot.rotation.set(swimPose.tailPitch + directionalPose.tailPitch, tailYaw, 0);
  flukePivot.rotation.set(swimPose.flukePitch, 0, flukeRoll);
  leftFinPivot.rotation.set(leftFinPitch, leftFinYaw, leftFinRoll);
  rightFinPivot.rotation.set(rightFinPitch, rightFinYaw, rightFinRoll);
}

export function resetWhaleVisualPose(
  spineRoot: THREE.Object3D,
  bodyRoot: THREE.Object3D,
  tailPivot: THREE.Object3D,
  flukePivot: THREE.Object3D,
  leftFinPivot: THREE.Object3D,
  rightFinPivot: THREE.Object3D,
): void {
  applyWhaleVisualPose(
    spineRoot,
    bodyRoot,
    tailPivot,
    flukePivot,
    leftFinPivot,
    rightFinPivot,
    {
      bodyPitch: 0,
      tailPitch: 0,
      flukePitch: 0,
      finPitch: 0,
      finRoll: 0,
    },
    sampleWhaleDirectionalPose(0, 0, 0),
  );
}

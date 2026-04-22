import * as THREE from 'three';

export interface WhaleVisualRig {
  readonly root: THREE.Group;
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

const MAX_BODY_PITCH = THREE.MathUtils.degToRad(2.2);
const MAX_TAIL_PITCH = THREE.MathUtils.degToRad(10.5);
const MAX_FLUKE_PITCH = THREE.MathUtils.degToRad(14);
const MAX_FIN_PITCH = THREE.MathUtils.degToRad(4.8);
const MAX_FIN_ROLL = THREE.MathUtils.degToRad(3.8);

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

export function applyWhaleVisualPose(
  bodyRoot: THREE.Object3D,
  tailPivot: THREE.Object3D,
  flukePivot: THREE.Object3D,
  leftFinPivot: THREE.Object3D,
  rightFinPivot: THREE.Object3D,
  swimPose: WhaleSwimPose,
  actionPose: WhaleActionVisualPose = {},
): void {
  const tailYaw = actionPose.tailYaw ?? 0;
  const flukeRoll = actionPose.flukeRoll ?? 0;
  const finPitch = WHALE_FIN_NEUTRAL_PITCH + swimPose.finPitch + (actionPose.finPitch ?? 0);
  const finRoll = WHALE_FIN_NEUTRAL_ROLL + swimPose.finRoll + (actionPose.finRoll ?? 0);

  bodyRoot.rotation.set(swimPose.bodyPitch, 0, 0);
  tailPivot.rotation.set(swimPose.tailPitch, tailYaw, 0);
  flukePivot.rotation.set(swimPose.flukePitch, 0, flukeRoll);
  leftFinPivot.rotation.set(finPitch, WHALE_FIN_NEUTRAL_YAW, finRoll);
  rightFinPivot.rotation.set(finPitch, -WHALE_FIN_NEUTRAL_YAW, -finRoll);
}

export function resetWhaleVisualPose(
  bodyRoot: THREE.Object3D,
  tailPivot: THREE.Object3D,
  flukePivot: THREE.Object3D,
  leftFinPivot: THREE.Object3D,
  rightFinPivot: THREE.Object3D,
): void {
  applyWhaleVisualPose(
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
  );
}

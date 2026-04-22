import * as THREE from 'three';

import { OCEAN_SUBSURFACE_REVEAL_TUNING } from './createPainterlyOceanMaterial';

const MIN_SUBMERGED_DEPTH = 0.45;
const CAMERA_ABOVE_WATER_ALLOWANCE = 0.18;

export interface WhaleTopsideRevealState {
  strength: number;
  depthBelowSurface: number;
  cameraAboveWater: boolean;
  whaleSubmerged: boolean;
}

interface WhaleTopsideRevealParams {
  cameraPosition: THREE.Vector3;
  whalePosition: THREE.Vector3;
  sampleSurfaceHeight: (x: number, z: number) => number;
}

export function calculateWhaleTopsideRevealState(
  params: WhaleTopsideRevealParams,
): WhaleTopsideRevealState {
  const whaleSurfaceHeight = params.sampleSurfaceHeight(params.whalePosition.x, params.whalePosition.z);
  const depthBelowSurface = whaleSurfaceHeight - params.whalePosition.y;
  const whaleSubmerged = depthBelowSurface > MIN_SUBMERGED_DEPTH;

  const cameraSurfaceHeight = params.sampleSurfaceHeight(params.cameraPosition.x, params.cameraPosition.z);
  const cameraAboveWater = params.cameraPosition.y >= cameraSurfaceHeight - CAMERA_ABOVE_WATER_ALLOWANCE;

  const tuning = OCEAN_SUBSURFACE_REVEAL_TUNING.whale;
  const depthFadeIn = THREE.MathUtils.smoothstep(depthBelowSurface, tuning.minDepth, tuning.strongStart);
  const depthFadeOut = 1 - THREE.MathUtils.smoothstep(depthBelowSurface, tuning.strongEnd, tuning.maxDepth);
  const distanceFade =
    1 -
    THREE.MathUtils.smoothstep(
      params.cameraPosition.distanceTo(params.whalePosition),
      tuning.fadeDistanceStart,
      tuning.fadeDistanceEnd,
    );

  const rawStrength = THREE.MathUtils.clamp(depthFadeIn * depthFadeOut * distanceFade * tuning.maxStrength, 0, 1);

  return {
    strength: cameraAboveWater && whaleSubmerged ? rawStrength : 0,
    depthBelowSurface,
    cameraAboveWater,
    whaleSubmerged,
  };
}

import * as THREE from 'three';

import { OCEAN_SUBSURFACE_REVEAL_TUNING } from './createPainterlyOceanMaterial';

const CAMERA_ABOVE_WATER_ALLOWANCE = 0.18;

export type TopsideRevealKind = keyof typeof OCEAN_SUBSURFACE_REVEAL_TUNING;

export interface ActorTopsideRevealState {
  strength: number;
  waterlineY: number;
  topY: number;
  bottomY: number;
  depthBelowSurface: number;
  submergedFraction: number;
  cameraAboveWater: boolean;
  actorSubmerged: boolean;
}

export type WaterlinePassthroughState = ActorTopsideRevealState;

export interface WaterlinePassthroughSubject {
  readonly waterlinePassthroughKind: TopsideRevealKind;
  getWaterlinePassthroughAnchor: (target?: THREE.Vector3) => THREE.Vector3;
  getWaterlinePassthroughBounds: (target: THREE.Box3) => THREE.Box3;
  setWaterlinePassthrough: (state: WaterlinePassthroughState) => void;
}

export const INACTIVE_WATERLINE_PASSTHROUGH_STATE: WaterlinePassthroughState = {
  strength: 0,
  waterlineY: 0,
  topY: 0,
  bottomY: 0,
  depthBelowSurface: 0,
  submergedFraction: 0,
  cameraAboveWater: false,
  actorSubmerged: false,
};

interface ActorTopsideRevealParams {
  kind: TopsideRevealKind;
  cameraPosition: THREE.Vector3;
  actorPosition: THREE.Vector3;
  actorBounds: THREE.Box3;
  sampleSurfaceHeight: (x: number, z: number) => number;
}

export function calculateActorTopsideRevealState(
  params: ActorTopsideRevealParams,
): ActorTopsideRevealState {
  const tuning = OCEAN_SUBSURFACE_REVEAL_TUNING[params.kind];
  const waterlineY = params.sampleSurfaceHeight(params.actorPosition.x, params.actorPosition.z);

  if (params.actorBounds.isEmpty()) {
    return {
      ...INACTIVE_WATERLINE_PASSTHROUGH_STATE,
      waterlineY,
      cameraAboveWater:
        params.cameraPosition.y >=
        params.sampleSurfaceHeight(params.cameraPosition.x, params.cameraPosition.z) - CAMERA_ABOVE_WATER_ALLOWANCE,
    };
  }

  const depthBelowSurface = waterlineY - params.actorPosition.y;
  const topY = params.actorBounds.max.y;
  const bottomY = params.actorBounds.min.y;
  const spanHeight = Math.max(topY - bottomY, 0.001);
  const submergedHeight = THREE.MathUtils.clamp(waterlineY - bottomY, 0, spanHeight);
  const submergedFraction = submergedHeight / spanHeight;
  const actorSubmerged =
    submergedHeight > Math.max(0.05, tuning.minDepth * 0.25) && submergedFraction > 0.02;

  const cameraSurfaceHeight = params.sampleSurfaceHeight(params.cameraPosition.x, params.cameraPosition.z);
  const cameraAboveWater = params.cameraPosition.y >= cameraSurfaceHeight - CAMERA_ABOVE_WATER_ALLOWANCE;

  const depthFadeIn = THREE.MathUtils.smoothstep(submergedHeight, tuning.minDepth, tuning.strongStart);
  const depthFadeOut = 1 - THREE.MathUtils.smoothstep(submergedHeight, tuning.strongEnd, tuning.maxDepth);
  const fractionFadeIn = THREE.MathUtils.smoothstep(submergedFraction, 0.02, 0.22);
  const distanceFade =
    1 -
    THREE.MathUtils.smoothstep(
      params.cameraPosition.distanceTo(params.actorPosition),
      tuning.fadeDistanceStart,
      tuning.fadeDistanceEnd,
    );

  const rawStrength = THREE.MathUtils.clamp(
    depthFadeIn * depthFadeOut * fractionFadeIn * distanceFade * tuning.maxStrength,
    0,
    1,
  );

  return {
    strength: cameraAboveWater && actorSubmerged ? rawStrength : 0,
    waterlineY,
    topY,
    bottomY,
    depthBelowSurface,
    submergedFraction,
    cameraAboveWater,
    actorSubmerged,
  };
}

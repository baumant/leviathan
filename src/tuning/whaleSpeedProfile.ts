export const LEGACY_WHALE_MAX_SPEED = 42;

export const WHALE_SPEED_PROFILE = {
  surfaceSpeed: 54,
  submergedSpeed: 56,
  maxTravelSpeed: 56,
  surfaceTurnRate: 1.6,
  submergedTurnRate: 2.35,
  strokeImpulseMin: 2.6,
  strokeImpulseMax: 13.2,
  baselineAcceleration: 1.2,
  tailSlapTravelSpeed: 15.8,
  postTailSlapRecoverySpeedFloor: 13.4,
  rowboatRamSpeed: 18,
  flagshipRamSpeed: 24,
  corporateWhalerRamSpeed: 27,
  tetherSnapSpeed: 33,
  dragUnderStrongPullSpeed: 18,
  harpoonLeadClamp: 7.2,
  cannonLeadClamp: 11.5,
  topsideCameraDistance: 22,
  underwaterCameraDistance: 19.2,
  topsideLookDistance: 9.8,
  underwaterLookDistance: 15.8,
  cameraFollowRateSurface: 5.28,
  cameraFollowRateUnderwater: 3.72,
  speedFovBoostMax: 5,
  surfaceDisturbanceAccelerationRange: 32,
} as const;

export function normalizeWhaleCombatSpeed(speed: number): number {
  return speed * (LEGACY_WHALE_MAX_SPEED / WHALE_SPEED_PROFILE.maxTravelSpeed);
}

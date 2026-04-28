import * as THREE from 'three';

const TAU = Math.PI * 2;
const ROCK_PIECE_BOUNDS_RADIUS = 1.22;
const ROCK_CLUSTER_PADDING = 1.8;

const DECORATIVE_ROCK_ANGLE_DEGREES = [28, 64, 104, 142, 208, 248, 292, 332] as const;
const CLOSE_DECORATIVE_ROCK_ANGLE_DEGREES = [8, 88, 154, 226, 276, 330] as const;
const BLOCKER_ROCK_ANGLE_DEGREES = [18, 86, 146, 206, 266, 326] as const;
const NEAR_KELP_ANGLE_DEGREES = [14, 44, 82, 122, 164, 202, 238, 278, 316, 346] as const;
const CLOSE_KELP_ANGLE_DEGREES = [38, 196, 268, 324] as const;
const OUTER_KELP_ANGLE_DEGREES = [2, 48, 94, 138, 182, 228, 274, 318] as const;
const FISH_SCHOOL_ANGLE_DEGREES = [58, 184, 302] as const;

export interface UnderwaterRockCollider {
  readonly center: THREE.Vector2;
  readonly radius: number;
  readonly floorHeight: number;
  readonly topHeight: number;
}

export interface UnderwaterRockPieceLayout {
  readonly geometryIndex: number;
  readonly position: THREE.Vector3;
  readonly rotation: THREE.Euler;
  readonly scale: THREE.Vector3;
}

export interface UnderwaterRockClusterLayout {
  readonly position: THREE.Vector3;
  readonly rotationY: number;
  readonly pieces: readonly UnderwaterRockPieceLayout[];
}

export interface UnderwaterBlockerRockClusterLayout extends UnderwaterRockClusterLayout {
  readonly collider: UnderwaterRockCollider;
}

export interface UnderwaterKelpClusterLayout {
  readonly position: THREE.Vector3;
  readonly rotationY: number;
  readonly strandCount: number;
  readonly spread: number;
  readonly minLength: number;
  readonly maxLength: number;
  readonly maxWidth: number;
  readonly swayScale: number;
}

export interface UnderwaterFishSchoolAnchor {
  readonly position: THREE.Vector3;
  readonly rotationY: number;
  readonly fishCount: number;
  readonly spread: number;
  readonly verticalSpan: number;
  readonly scale: number;
  readonly swimSpeed: number;
}

export interface UnderwaterShaftAnchor {
  readonly position: THREE.Vector3;
  readonly width: number;
  readonly length: number;
  readonly opacity: number;
  readonly drift: number;
}

export interface UnderwaterEnvironmentLayout {
  readonly decorativeRockAnchors: readonly UnderwaterRockClusterLayout[];
  readonly blockerRockAnchors: readonly UnderwaterBlockerRockClusterLayout[];
  readonly nearKelpAnchors: readonly UnderwaterKelpClusterLayout[];
  readonly outerKelpCurtains: readonly UnderwaterKelpClusterLayout[];
  readonly fishSchoolAnchors: readonly UnderwaterFishSchoolAnchor[];
  readonly shaftAnchors: readonly UnderwaterShaftAnchor[];
}

export const createUnderwaterEnvironmentLayout = (
  sampleFloorHeight: (x: number, z: number) => number,
): UnderwaterEnvironmentLayout => {
  const closeDecorativeRockAnchors = CLOSE_DECORATIVE_ROCK_ANGLE_DEGREES.map((angleDegrees, index) =>
    createRockCluster({
      angleDegrees,
      index: index + 80,
      sampleFloorHeight,
      minimumRadius: 14,
      maximumRadius: 30,
      scaleMultiplier: 1.7,
      heightMultiplier: 1.85,
      colliding: false,
    }),
  );

  const decorativeRockAnchors = [
    ...closeDecorativeRockAnchors,
    ...DECORATIVE_ROCK_ANGLE_DEGREES.map((angleDegrees, index) =>
      createRockCluster({
        angleDegrees,
        index,
        sampleFloorHeight,
        minimumRadius: 24,
        maximumRadius: 66,
        colliding: false,
      }),
    ),
  ];

  const blockerRockAnchors = BLOCKER_ROCK_ANGLE_DEGREES.map((angleDegrees, index) =>
    createRockCluster({
      angleDegrees,
      index,
      sampleFloorHeight,
      minimumRadius: 76,
      maximumRadius: 124,
      colliding: true,
    }),
  ) as UnderwaterBlockerRockClusterLayout[];

  const closeKelpAnchors = CLOSE_KELP_ANGLE_DEGREES.map((angleDegrees, index) =>
    createKelpCluster({
      angleDegrees,
      index: index + 90,
      sampleFloorHeight,
      minimumRadius: 18,
      maximumRadius: 36,
      minimumLength: 26,
      maximumLength: 42,
      spread: 4.9,
      maxWidth: 1.42,
      swayScale: 1.05,
      strandCountRange: new THREE.Vector2(5, 8),
    }),
  );

  const nearKelpAnchors = [
    ...closeKelpAnchors,
    ...NEAR_KELP_ANGLE_DEGREES.map((angleDegrees, index) =>
      createKelpCluster({
        angleDegrees,
        index,
        sampleFloorHeight,
        minimumRadius: 32,
        maximumRadius: 74,
        minimumLength: 12,
        maximumLength: 24,
        spread: 5.4,
        maxWidth: 1.22,
        swayScale: 0.92,
        strandCountRange: new THREE.Vector2(3, 5),
      }),
    ),
  ];

  const outerKelpCurtains = OUTER_KELP_ANGLE_DEGREES.map((angleDegrees, index) =>
    createKelpCluster({
      angleDegrees,
      index,
      sampleFloorHeight,
      minimumRadius: 82,
      maximumRadius: 132,
      minimumLength: 22,
      maximumLength: 40,
      spread: 8.1,
      maxWidth: 1.48,
      swayScale: 1.24,
      strandCountRange: new THREE.Vector2(5, 8),
    }),
  );

  const fishSchoolAnchors = FISH_SCHOOL_ANGLE_DEGREES.map((angleDegrees, index) => {
    const angle = degreesToRadians(angleDegrees + seedSigned(index + 401) * 8);
    const radius = THREE.MathUtils.lerp(54, 98, seed01(index + 411));
    const point = pointOnRing(angle, radius);
    const floorHeight = sampleFloorHeight(point.x, point.y);

    return {
      position: new THREE.Vector3(
        point.x,
        floorHeight + THREE.MathUtils.lerp(15, 24, seed01(index + 421)),
        point.y,
      ),
      rotationY: angle + seedSigned(index + 431) * 0.32,
      fishCount: 11 + Math.floor(seed01(index + 441) * 5),
      spread: THREE.MathUtils.lerp(8, 14, seed01(index + 451)),
      verticalSpan: THREE.MathUtils.lerp(4, 7, seed01(index + 461)),
      scale: THREE.MathUtils.lerp(0.9, 1.35, seed01(index + 471)),
      swimSpeed: THREE.MathUtils.lerp(0.34, 0.62, seed01(index + 481)),
    };
  });

  const shaftSourceAnchors = [
    decorativeRockAnchors[1],
    nearKelpAnchors[2],
    decorativeRockAnchors[5],
    nearKelpAnchors[7],
  ] as const;
  const shaftAnchors = shaftSourceAnchors.map((anchor, index) => ({
    position: new THREE.Vector3(anchor.position.x, 0.35, anchor.position.z),
    width: THREE.MathUtils.lerp(22, 34, seed01(index + 511)),
    length: THREE.MathUtils.lerp(64, 82, seed01(index + 521)),
    opacity: THREE.MathUtils.lerp(0.15, 0.24, seed01(index + 531)),
    drift: seed01(index + 541) * TAU,
  }));

  return {
    decorativeRockAnchors,
    blockerRockAnchors,
    nearKelpAnchors,
    outerKelpCurtains,
    fishSchoolAnchors,
    shaftAnchors,
  };
};

export const createUnderwaterRockColliders = (
  layout: UnderwaterEnvironmentLayout,
): readonly UnderwaterRockCollider[] => layout.blockerRockAnchors.map((cluster) => cluster.collider);

interface RockClusterSeed {
  readonly angleDegrees: number;
  readonly index: number;
  readonly sampleFloorHeight: (x: number, z: number) => number;
  readonly minimumRadius: number;
  readonly maximumRadius: number;
  readonly scaleMultiplier?: number;
  readonly heightMultiplier?: number;
  readonly colliding: boolean;
}

interface KelpClusterSeed {
  readonly angleDegrees: number;
  readonly index: number;
  readonly sampleFloorHeight: (x: number, z: number) => number;
  readonly minimumRadius: number;
  readonly maximumRadius: number;
  readonly minimumLength: number;
  readonly maximumLength: number;
  readonly spread: number;
  readonly maxWidth: number;
  readonly swayScale: number;
  readonly strandCountRange: THREE.Vector2;
}

const createRockCluster = (seed: RockClusterSeed): UnderwaterRockClusterLayout | UnderwaterBlockerRockClusterLayout => {
  const angle = degreesToRadians(seed.angleDegrees + seedSigned(seed.index + 1) * (seed.colliding ? 8 : 10));
  const radius = THREE.MathUtils.lerp(seed.minimumRadius, seed.maximumRadius, seed01(seed.index + 21));
  const point = pointOnRing(angle, radius);
  const floorHeight = seed.sampleFloorHeight(point.x, point.y);
  const position = new THREE.Vector3(point.x, floorHeight, point.y);
  const rotationY = angle + seedSigned(seed.index + 41) * (seed.colliding ? 0.36 : 0.28);
  const pieces: UnderwaterRockPieceLayout[] = [];
  let colliderRadius = 0;
  let colliderTop = floorHeight;

  const pieceCount =
    (seed.colliding ? 4 : 3) + Math.floor(seed01(seed.index + 51) * (seed.colliding ? 3 : 2));

  for (let pieceIndex = 0; pieceIndex < pieceCount; pieceIndex += 1) {
    const pieceSeed = seed.index * 17 + pieceIndex * 11 + 1;
    const baseScale = seed.colliding
      ? THREE.MathUtils.lerp(4.2, 8.2, seed01(pieceSeed + 3))
      : THREE.MathUtils.lerp(1.8, 4.1, seed01(pieceSeed + 3));
    const scaleMultiplier = seed.scaleMultiplier ?? 1;
    const heightMultiplier = seed.heightMultiplier ?? 1;
    const silhouetteBoost = pieceIndex === 0 ? (seed.colliding ? 1.18 : 1.44) : 1;
    const heightBoost = pieceIndex === 0 ? (seed.colliding ? 1.18 : 1.38) : 1;
    const scale = baseScale * silhouetteBoost * scaleMultiplier;
    const pieceScale = new THREE.Vector3(
      scale * THREE.MathUtils.lerp(0.74, 1.16, seed01(pieceSeed + 23)),
      scale *
        THREE.MathUtils.lerp(seed.colliding ? 0.66 : 0.46, seed.colliding ? 1.08 : 0.82, seed01(pieceSeed + 29)) *
        heightBoost *
        heightMultiplier,
      scale * THREE.MathUtils.lerp(0.86, 1.22, seed01(pieceSeed + 31)),
    );
    const lateralSpread = seed.colliding ? 5.2 : 3.4;
    const pieceSpread = pieceIndex === 0 ? lateralSpread * 0.38 : lateralSpread;
    const piecePosition = new THREE.Vector3(
      seedSigned(pieceSeed + 5) * pieceSpread,
      pieceIndex === 0 ? scale * (seed.colliding ? -0.08 : -0.14) : scale * (seed.colliding ? -0.2 : -0.34),
      seedSigned(pieceSeed + 9) * pieceSpread * (seed.colliding ? 0.92 : 0.84),
    );
    const pieceRotation = new THREE.Euler(
      seedSigned(pieceSeed + 13) * 0.34,
      seed01(pieceSeed + 17) * TAU,
      seedSigned(pieceSeed + 19) * 0.22,
    );

    pieces.push({
      geometryIndex: (seed.index + pieceIndex) % 2,
      position: piecePosition,
      rotation: pieceRotation,
      scale: pieceScale,
    });

    colliderRadius = Math.max(
      colliderRadius,
      Math.hypot(piecePosition.x, piecePosition.z) + Math.max(pieceScale.x, pieceScale.z) * ROCK_PIECE_BOUNDS_RADIUS,
    );
    colliderTop = Math.max(
      colliderTop,
      floorHeight + piecePosition.y + pieceScale.y * ROCK_PIECE_BOUNDS_RADIUS,
    );
  }

  if (!seed.colliding) {
    return { position, rotationY, pieces };
  }

  return {
    position,
    rotationY,
    pieces,
    collider: {
      center: new THREE.Vector2(point.x, point.y),
      radius: colliderRadius + ROCK_CLUSTER_PADDING,
      floorHeight,
      topHeight: colliderTop + 0.8,
    },
  };
};

const createKelpCluster = (seed: KelpClusterSeed): UnderwaterKelpClusterLayout => {
  const angle = degreesToRadians(seed.angleDegrees + seedSigned(seed.index + 101) * 9);
  const radius = THREE.MathUtils.lerp(seed.minimumRadius, seed.maximumRadius, seed01(seed.index + 111));
  const point = pointOnRing(angle, radius);
  const floorHeight = seed.sampleFloorHeight(point.x, point.y);

  return {
    position: new THREE.Vector3(point.x, floorHeight + 0.2, point.y),
    rotationY: angle + seedSigned(seed.index + 121) * 0.24,
    strandCount:
      Math.floor(
        THREE.MathUtils.lerp(seed.strandCountRange.x, seed.strandCountRange.y + 0.999, seed01(seed.index + 131)),
      ),
    spread: seed.spread * THREE.MathUtils.lerp(0.86, 1.18, seed01(seed.index + 141)),
    minLength: seed.minimumLength * THREE.MathUtils.lerp(0.92, 1.08, seed01(seed.index + 151)),
    maxLength: seed.maximumLength * THREE.MathUtils.lerp(0.94, 1.12, seed01(seed.index + 161)),
    maxWidth: seed.maxWidth * THREE.MathUtils.lerp(0.88, 1.12, seed01(seed.index + 171)),
    swayScale: seed.swayScale * THREE.MathUtils.lerp(0.92, 1.12, seed01(seed.index + 181)),
  };
};

const pointOnRing = (angle: number, radius: number): THREE.Vector2 =>
  new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius);

const degreesToRadians = (degrees: number): number => degrees * (Math.PI / 180);

const seed01 = (seed: number): number => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
};

const seedSigned = (seed: number): number => seed01(seed) * 2 - 1;

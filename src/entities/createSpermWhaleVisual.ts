import * as THREE from 'three';

import { createCelMaterial } from '../fx/createCelMaterial';

export interface SpermWhaleVisualPalette {
  bodyColor: THREE.ColorRepresentation;
  bodyEmissive: THREE.ColorRepresentation;
  bodyEmissiveIntensity: number;
  bellyColor: THREE.ColorRepresentation;
  bellyEmissive: THREE.ColorRepresentation;
  bellyEmissiveIntensity: number;
}

export interface SpermWhaleVisualOptions {
  palette: SpermWhaleVisualPalette;
  lengthScale?: number;
  girthScale?: number;
  finScale?: number;
}

export interface SpermWhaleVisualRig {
  readonly root: THREE.Group;
  readonly tailPivot: THREE.Group;
  readonly flukePivot: THREE.Group;
}

function createSpermWhaleBodyGeometry(): THREE.LatheGeometry {
  const profile = [
    new THREE.Vector2(0.08, -5.4),
    new THREE.Vector2(0.24, -5.05),
    new THREE.Vector2(0.46, -4.42),
    new THREE.Vector2(0.74, -3.48),
    new THREE.Vector2(1.04, -2.16),
    new THREE.Vector2(1.36, -0.38),
    new THREE.Vector2(1.72, 1.72),
    new THREE.Vector2(1.96, 3.28),
    new THREE.Vector2(2.08, 4.36),
    new THREE.Vector2(1.92, 5.14),
    new THREE.Vector2(1.22, 5.92),
    new THREE.Vector2(0.36, 6.38),
    new THREE.Vector2(0.12, 6.52),
  ];

  const geometry = new THREE.LatheGeometry(profile, 24);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function createSpermWhaleSilhouetteGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();

  shape.moveTo(0.86, 4.08);
  shape.bezierCurveTo(1.14, 3.78, 1.24, 3.1, 1.18, 2.18);
  shape.bezierCurveTo(1.08, 0.78, 0.92, -0.52, 0.72, -1.72);
  shape.bezierCurveTo(0.52, -2.84, 0.36, -3.7, 0.28, -4.34);
  shape.lineTo(0.22, -5.02);
  shape.lineTo(0.92, -5.94);
  shape.lineTo(0.62, -6.26);
  shape.lineTo(0.12, -5.72);
  shape.lineTo(0.04, -6.62);
  shape.lineTo(-0.04, -6.62);
  shape.lineTo(-0.12, -5.72);
  shape.lineTo(-0.62, -6.26);
  shape.lineTo(-0.92, -5.94);
  shape.lineTo(-0.22, -5.02);
  shape.lineTo(-0.28, -4.34);
  shape.bezierCurveTo(-0.36, -3.7, -0.52, -2.84, -0.72, -1.72);
  shape.bezierCurveTo(-0.92, -0.52, -1.08, 0.78, -1.18, 2.18);
  shape.bezierCurveTo(-1.24, 3.1, -1.14, 3.78, -0.86, 4.08);

  const geometry = new THREE.ShapeGeometry(shape, 36);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function createSpermWhaleVisual(options: SpermWhaleVisualOptions): SpermWhaleVisualRig {
  const lengthScale = options.lengthScale ?? 1;
  const girthScale = options.girthScale ?? 1;
  const finScale = options.finScale ?? 1;

  const root = new THREE.Group();
  const tailPivot = new THREE.Group();
  const flukePivot = new THREE.Group();

  const bodyMaterial = createCelMaterial({
    color: options.palette.bodyColor,
    emissive: options.palette.bodyEmissive,
    emissiveIntensity: options.palette.bodyEmissiveIntensity,
  });
  const bellyMaterial = createCelMaterial({
    color: options.palette.bellyColor,
    emissive: options.palette.bellyEmissive,
    emissiveIntensity: options.palette.bellyEmissiveIntensity,
  });

  const body = new THREE.Mesh(createSpermWhaleBodyGeometry(), bodyMaterial);
  body.scale.set(1.06 * girthScale, 0.78 * girthScale, 1.04 * lengthScale);
  body.position.set(0, 0.02 * girthScale, 0.18 * lengthScale);

  const headMass = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), bodyMaterial);
  headMass.scale.set(2.3 * girthScale, 1.18 * girthScale, 1.82 * lengthScale);
  headMass.position.set(0, 0.18 * girthScale, 3.78 * lengthScale);

  const foreheadShelf = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), bodyMaterial);
  foreheadShelf.scale.set(2.18 * girthScale, 0.7 * girthScale, 1.08 * lengthScale);
  foreheadShelf.position.set(0, 0.8 * girthScale, 3.92 * lengthScale);

  const snoutCap = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), bodyMaterial);
  snoutCap.scale.set(1.38 * girthScale, 0.84 * girthScale, 0.64 * lengthScale);
  snoutCap.position.set(0, 0.18 * girthScale, 5.3 * lengthScale);

  const lowerJaw = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.9, 4, 10), bellyMaterial);
  lowerJaw.rotation.x = Math.PI / 2;
  lowerJaw.scale.set(1.02 * girthScale, 0.34 * girthScale, 1.64 * lengthScale);
  lowerJaw.position.set(0, -0.66 * girthScale, 3.72 * lengthScale);

  const throat = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), bellyMaterial);
  throat.scale.set(1.14 * girthScale, 0.34 * girthScale, 0.98 * lengthScale);
  throat.position.set(0, -0.56 * girthScale, 2.52 * lengthScale);

  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(1.02, 2.6, 4, 10), bellyMaterial);
  belly.rotation.x = Math.PI / 2;
  belly.scale.set(1.08 * girthScale, 0.38 * girthScale, 1.48 * lengthScale);
  belly.position.set(0, -0.92 * girthScale, 0.94 * lengthScale);

  const hump = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), bodyMaterial);
  hump.scale.set(0.72 * girthScale, 0.34 * girthScale, 0.58 * lengthScale);
  hump.position.set(0, 1.02 * girthScale, -0.62 * lengthScale);

  const knuckleA = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), bodyMaterial);
  knuckleA.scale.set(0.48 * girthScale, 0.24 * girthScale, 0.42 * lengthScale);
  knuckleA.position.set(0, 0.88 * girthScale, -1.7 * lengthScale);

  const knuckleB = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), bodyMaterial);
  knuckleB.scale.set(0.34 * girthScale, 0.18 * girthScale, 0.3 * lengthScale);
  knuckleB.position.set(0, 0.74 * girthScale, -2.66 * lengthScale);

  const finGeometry = new THREE.SphereGeometry(1, 12, 8);
  const leftFin = new THREE.Mesh(finGeometry, bodyMaterial);
  leftFin.scale.set(1.02 * girthScale * finScale, 0.08 * girthScale, 0.42 * lengthScale * finScale);
  leftFin.position.set(-1.88 * girthScale, -0.54 * girthScale, 0.84 * lengthScale);
  leftFin.rotation.set(-0.7, 0.12, 0.52);

  const rightFin = leftFin.clone();
  rightFin.position.x *= -1;
  rightFin.rotation.y *= -1;
  rightFin.rotation.z *= -1;

  const tailStem = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 2.44, 4, 10), bodyMaterial);
  tailStem.rotation.x = Math.PI / 2;
  tailStem.scale.set(0.54 * girthScale, 0.24 * girthScale, 1.74 * lengthScale);
  tailStem.position.set(0, -0.02 * girthScale, -1.28 * lengthScale);

  const flukeKnuckle = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), bodyMaterial);
  flukeKnuckle.scale.set(0.56 * girthScale, 0.14 * girthScale, 0.42 * lengthScale);
  flukeKnuckle.position.set(0, -0.02 * girthScale, -2.78 * lengthScale);

  const flukeGeometry = new THREE.SphereGeometry(1, 14, 10);
  const leftFluke = new THREE.Mesh(flukeGeometry, bodyMaterial);
  leftFluke.scale.set(1.3 * girthScale * finScale, 0.08 * girthScale, 0.54 * lengthScale * finScale);
  leftFluke.position.set(-1.42 * girthScale, 0.02 * girthScale, -3.08 * lengthScale);
  leftFluke.rotation.set(0.06, 0.08, -0.14);

  const rightFluke = leftFluke.clone();
  rightFluke.position.x *= -1;
  rightFluke.rotation.y *= -1;
  rightFluke.rotation.z *= -1;

  // Keep the whale as a few broad, smooth masses so silhouette and fog value do
  // more of the work than surface detail.
  flukePivot.add(flukeKnuckle, leftFluke, rightFluke);
  tailPivot.position.set(0, 0.06 * girthScale, -4.16 * lengthScale);
  tailPivot.add(tailStem, flukePivot);

  root.add(
    body,
    headMass,
    foreheadShelf,
    snoutCap,
    lowerJaw,
    throat,
    belly,
    hump,
    knuckleA,
    knuckleB,
    leftFin,
    rightFin,
    tailPivot,
  );

  return {
    root,
    tailPivot,
    flukePivot,
  };
}

import * as THREE from 'three';

import { WaterlinePassthroughState } from './calculateWhaleTopsideRevealState';

const WATERLINE_CLIP_NORMAL = new THREE.Vector3(0, -1, 0);
const DEFAULT_RENDER_ORDER = 24;

export interface WaterlineOverlayConfig {
  color: THREE.ColorRepresentation;
  opacityMin: number;
  opacityMax: number;
  renderOrder?: number;
  includeMesh?: (mesh: THREE.Mesh, materials: readonly THREE.Material[]) => boolean;
}

export interface WaterlineOverlayController {
  readonly root: THREE.Group;
  readonly material: THREE.MeshBasicMaterial;
  readonly plane: THREE.Plane;
  setState: (state: WaterlinePassthroughState) => void;
}

function disposeMaterials(materials: readonly THREE.Material[], disposed: Set<THREE.Material>): void {
  for (const material of materials) {
    if (disposed.has(material)) {
      continue;
    }

    material.dispose();
    disposed.add(material);
  }
}

function disposeNodeResources(object: THREE.Object3D, disposedMaterials: Set<THREE.Material>): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    child.geometry.dispose();
    disposeMaterials(Array.isArray(child.material) ? child.material : [child.material], disposedMaterials);
  });
}

export function cloneUniqueObjectRoot(root: THREE.Group): THREE.Group {
  const clone = root.clone(true) as THREE.Group;

  clone.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    object.geometry = object.geometry.clone();

    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => material.clone());
      return;
    }

    object.material = object.material.clone();
  });

  return clone;
}

export function createWaterlineOverlay(
  root: THREE.Group,
  config: WaterlineOverlayConfig,
): WaterlineOverlayController {
  const plane = new THREE.Plane(WATERLINE_CLIP_NORMAL.clone(), 0);
  const material = new THREE.MeshBasicMaterial({
    color: config.color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    clippingPlanes: [plane],
  });
  const renderOrder = config.renderOrder ?? DEFAULT_RENDER_ORDER;
  const removals: THREE.Object3D[] = [];
  const disposedMaterials = new Set<THREE.Material>();

  material.fog = true;
  material.toneMapped = false;

  root.traverse((object) => {
    object.renderOrder = renderOrder;

    if (object instanceof THREE.Light) {
      removals.push(object);
      return;
    }

    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const includeMesh = config.includeMesh?.(object, materials) ?? true;

    if (!includeMesh) {
      removals.push(object);
      return;
    }

    disposeMaterials(materials, disposedMaterials);
    object.material = material;
    object.castShadow = false;
    object.receiveShadow = false;
    object.frustumCulled = false;
  });

  for (const object of removals) {
    disposeNodeResources(object, disposedMaterials);
    object.removeFromParent();
  }

  root.visible = false;

  return {
    root,
    material,
    plane,
    setState: (state) => {
      const visible = state.cameraAboveWater && state.actorSubmerged && state.submergedFraction > 0.01 && state.strength > 0.01;
      root.visible = visible;
      plane.constant = state.waterlineY;
      material.opacity = visible
        ? THREE.MathUtils.lerp(config.opacityMin, config.opacityMax, THREE.MathUtils.clamp(state.strength, 0, 1))
        : 0;
    },
  };
}

export function disposeObject3DResources(
  root: THREE.Object3D,
  skipMaterials: ReadonlySet<THREE.Material> = new Set(),
): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    object.geometry.dispose();

    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (skipMaterials.has(material)) {
        continue;
      }

      material.dispose();
    }
  });
}

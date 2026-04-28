import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { createCelMaterial } from '../fx/createCelMaterial';

export interface RowboatVisualAsset {
  readonly root: THREE.Group;
  readonly wakeOrigin: THREE.Object3D | null;
  readonly harpoonOrigin: THREE.Object3D | null;
  readonly lanternOrigins: readonly THREE.Object3D[];
}

type RowboatMaterialKind = 'hull' | 'trim';

const loader = new GLTFLoader();
let rowboatTemplatePromise: Promise<THREE.Group> | null = null;

const MATERIAL_PALETTES: Record<
  RowboatMaterialKind,
  {
    color: THREE.ColorRepresentation;
    emissive: THREE.ColorRepresentation;
    emissiveIntensity: number;
  }
> = {
  hull: {
    color: '#4c3829',
    emissive: '#101620',
    emissiveIntensity: 0.04,
  },
  trim: {
    color: '#7a6147',
    emissive: '#0d1318',
    emissiveIntensity: 0.02,
  },
};

function loadTemplate(): Promise<THREE.Group> {
  if (!rowboatTemplatePromise) {
    rowboatTemplatePromise = loader.loadAsync('/models/rowboat.glb').then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      return gltf.scene;
    });
  }

  return rowboatTemplatePromise;
}

export function preloadRowboatAsset(): Promise<void> {
  return loadTemplate().then(() => undefined);
}

function cloneTemplate(root: THREE.Group): THREE.Group {
  const clone = root.clone(true) as THREE.Group;

  clone.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    object.geometry = object.geometry.clone();
    object.geometry.computeVertexNormals();

    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => material.clone());
      return;
    }

    object.material = object.material.clone();
  });

  return clone;
}

function classifyMaterialKind(name: string): RowboatMaterialKind {
  const normalized = name.toLowerCase();
  return normalized.includes('trim') || normalized.includes('wood') ? 'trim' : 'hull';
}

function applyMaterials(root: THREE.Group): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    if (object.name.startsWith('MarkerProxy_')) {
      object.visible = false;
      return;
    }

    const oldMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of oldMaterials) {
      material.dispose();
    }

    const palette = MATERIAL_PALETTES[classifyMaterialKind(object.name)];
    object.material = createCelMaterial({
      color: palette.color,
      emissive: palette.emissive,
      emissiveIntensity: palette.emissiveIntensity,
    });
    object.castShadow = false;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
}

function getOptionalNode(root: THREE.Group, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? null;
}

function getLanternOrigins(root: THREE.Group): readonly THREE.Object3D[] {
  const lanterns: THREE.Object3D[] = [];

  root.traverse((object) => {
    if (!object.name.startsWith('markerlantern_')) {
      return;
    }

    lanterns.push(object);
  });

  return lanterns.sort((left, right) => left.name.localeCompare(right.name));
}

export async function createRowboatVisualAsset(): Promise<RowboatVisualAsset> {
  const template = await loadTemplate();
  const root = cloneTemplate(template);
  root.name = 'rowboat_visual_asset';

  // Keep the runtime read broad and muted so the whale still owns the brightest,
  // cleanest silhouette while the boats stay legible through fog.
  applyMaterials(root);
  root.updateMatrixWorld(true);

  return {
    root,
    wakeOrigin: getOptionalNode(root, 'markerwake_origin'),
    harpoonOrigin: getOptionalNode(root, 'markerharpoon_origin'),
    lanternOrigins: getLanternOrigins(root),
  };
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { createCelMaterial } from '../fx/createCelMaterial';

export type CapitalShipVisualRole = 'flagship' | 'corporate_whaler';

export interface CapitalShipVisualAsset {
  readonly root: THREE.Group;
  readonly wakeOrigin: THREE.Object3D | null;
  readonly harpoonOrigin: THREE.Object3D | null;
  readonly towPortOrigin: THREE.Object3D | null;
  readonly towStarboardOrigin: THREE.Object3D | null;
  readonly healthBarAnchor: THREE.Object3D | null;
  readonly lanternOrigins: readonly THREE.Object3D[];
  readonly portCannonOrigins: readonly THREE.Object3D[];
  readonly starboardCannonOrigins: readonly THREE.Object3D[];
  readonly reinforcementLaunchOrigins: readonly THREE.Object3D[];
}

type CapitalShipMaterialKind = 'hull' | 'trim' | 'sail';

const loader = new GLTFLoader();
const templatePromises: Partial<Record<CapitalShipVisualRole, Promise<THREE.Group>>> = {};

const MODEL_PATHS: Record<CapitalShipVisualRole, string> = {
  flagship: '/models/flagship.glb',
  corporate_whaler: '/models/corporate-whaler.glb',
};

const MATERIAL_PALETTES: Record<
  CapitalShipVisualRole,
  Record<
    CapitalShipMaterialKind,
    {
      color: THREE.ColorRepresentation;
      emissive: THREE.ColorRepresentation;
      emissiveIntensity: number;
    }
  >
> = {
  flagship: {
    hull: {
      color: '#5a4130',
      emissive: '#101620',
      emissiveIntensity: 0.04,
    },
    trim: {
      color: '#8d6a52',
      emissive: '#0d1318',
      emissiveIntensity: 0.02,
    },
    sail: {
      color: '#c8b28d',
      emissive: '#161922',
      emissiveIntensity: 0.01,
    },
  },
  corporate_whaler: {
    hull: {
      color: '#4a372b',
      emissive: '#101620',
      emissiveIntensity: 0.04,
    },
    trim: {
      color: '#6f5c4c',
      emissive: '#0d1318',
      emissiveIntensity: 0.02,
    },
    sail: {
      color: '#8f816c',
      emissive: '#161922',
      emissiveIntensity: 0.01,
    },
  },
};

function loadTemplate(role: CapitalShipVisualRole): Promise<THREE.Group> {
  templatePromises[role] ??= loader.loadAsync(MODEL_PATHS[role]).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    return gltf.scene;
  });

  return templatePromises[role];
}

export function preloadCapitalShipAsset(role: CapitalShipVisualRole): Promise<void> {
  return loadTemplate(role).then(() => undefined);
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

function classifyMaterialKind(name: string): CapitalShipMaterialKind {
  const normalized = name.toLowerCase();

  if (normalized.includes('sail') || normalized.includes('canvas') || normalized.includes('flag')) {
    return 'sail';
  }

  if (
    normalized.includes('mast') ||
    normalized.includes('trim') ||
    normalized.includes('gantry') ||
    normalized.includes('boom') ||
    normalized.includes('crossbar') ||
    normalized.includes('brace') ||
    normalized.includes('deck') ||
    normalized.includes('cabin') ||
    normalized.includes('funnel') ||
    normalized.includes('stack')
  ) {
    return 'trim';
  }

  return 'hull';
}

function applyMaterials(root: THREE.Group, role: CapitalShipVisualRole): void {
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

    const palette = MATERIAL_PALETTES[role][classifyMaterialKind(object.name)];
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

function getMarkerIndex(name: string): number {
  const match = name.match(/_(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function getNodesByPrefix(root: THREE.Group, prefix: string): readonly THREE.Object3D[] {
  const nodes: THREE.Object3D[] = [];

  root.traverse((object) => {
    if (!object.name.startsWith(prefix)) {
      return;
    }

    nodes.push(object);
  });

  return nodes.sort((left, right) => getMarkerIndex(left.name) - getMarkerIndex(right.name));
}

export async function createCapitalShipVisualAsset(role: CapitalShipVisualRole): Promise<CapitalShipVisualAsset> {
  const template = await loadTemplate(role);
  const root = cloneTemplate(template);
  root.name = `${role}_visual_asset`;

  // Imported ships are deliberately flattened into broad cel bands so fog and
  // lantern silhouettes carry the read instead of texture detail.
  applyMaterials(root, role);
  root.updateMatrixWorld(true);

  return {
    root,
    wakeOrigin: getOptionalNode(root, 'markerwake_origin'),
    harpoonOrigin: getOptionalNode(root, 'markerharpoon_origin'),
    towPortOrigin: getOptionalNode(root, 'markertow_port_origin'),
    towStarboardOrigin: getOptionalNode(root, 'markertow_starboard_origin'),
    healthBarAnchor: getOptionalNode(root, 'markerhealth_bar_anchor'),
    lanternOrigins: getNodesByPrefix(root, 'markerlantern_'),
    portCannonOrigins: getNodesByPrefix(root, 'markerport_'),
    starboardCannonOrigins: getNodesByPrefix(root, 'markerstarboard_'),
    reinforcementLaunchOrigins: getNodesByPrefix(root, 'markerreinforcement_launch_'),
  };
}

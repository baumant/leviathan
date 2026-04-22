import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { createCelMaterial } from '../fx/createCelMaterial';
import { WhaleVisualRig } from './WhaleVisualMotion';

export type WhaleHeroVariant = 'player' | 'captive';

interface WhaleVariantPalette {
  bodyColor: THREE.ColorRepresentation;
  bodyEmissive: THREE.ColorRepresentation;
  bodyEmissiveIntensity: number;
  bellyColor: THREE.ColorRepresentation;
  bellyEmissive: THREE.ColorRepresentation;
  bellyEmissiveIntensity: number;
  detailColor: THREE.ColorRepresentation;
  detailEmissive: THREE.ColorRepresentation;
  detailEmissiveIntensity: number;
  eyeColor: THREE.ColorRepresentation;
}

export interface WhaleHeroRig extends WhaleVisualRig {
  readonly tetherAttach: THREE.Object3D | null;
  readonly tailSlapAnchor: THREE.Object3D | null;
  readonly towAttach: readonly THREE.Object3D[];
}

const loader = new GLTFLoader();
let heroTemplatePromise: Promise<THREE.Group> | null = null;

const VARIANT_PALETTES: Record<WhaleHeroVariant, WhaleVariantPalette> = {
  player: {
    bodyColor: '#edf3ff',
    bodyEmissive: '#587093',
    bodyEmissiveIntensity: 0.12,
    bellyColor: '#d8e2f1',
    bellyEmissive: '#4d627f',
    bellyEmissiveIntensity: 0.08,
    detailColor: '#9aaabe',
    detailEmissive: '#50667e',
    detailEmissiveIntensity: 0.06,
    eyeColor: '#1a2230',
  },
  captive: {
    bodyColor: '#6d7f8b',
    bodyEmissive: '#334551',
    bodyEmissiveIntensity: 0.05,
    bellyColor: '#8da0ad',
    bellyEmissive: '#425560',
    bellyEmissiveIntensity: 0.04,
    detailColor: '#50616e',
    detailEmissive: '#2d3e4a',
    detailEmissiveIntensity: 0.03,
    eyeColor: '#151b22',
  },
};

function loadHeroTemplate(): Promise<THREE.Group> {
  if (!heroTemplatePromise) {
    heroTemplatePromise = loader.loadAsync('/models/whale-hero.glb').then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      return gltf.scene;
    });
  }

  return heroTemplatePromise;
}

export function preloadWhaleHeroAsset(): Promise<void> {
  return loadHeroTemplate().then(() => undefined);
}

function cloneTemplate(root: THREE.Group): THREE.Group {
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

function makeToonMaterial(
  color: THREE.ColorRepresentation,
  emissive: THREE.ColorRepresentation,
  emissiveIntensity: number,
): THREE.MeshToonMaterial {
  return createCelMaterial({
    color,
    emissive,
    emissiveIntensity,
  });
}

function applyVariantMaterials(root: THREE.Group, variant: WhaleHeroVariant): void {
  const palette = VARIANT_PALETTES[variant];

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const oldMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of oldMaterials) {
      material.dispose();
    }

    const isBelly = object.name === 'belly' || object.name === 'jaw';
    const isDetail =
      object.name.startsWith('scar_') ||
      object.name.startsWith('knuckle_') ||
      object.name === 'blowhole' ||
      object.name === 'hump';
    const isEye = object.name.startsWith('eye_');

    let material: THREE.Material;

    if (isEye) {
      material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(palette.eyeColor),
      });
      material.toneMapped = false;
    } else if (isBelly) {
      material = makeToonMaterial(
        palette.bellyColor,
        palette.bellyEmissive,
        palette.bellyEmissiveIntensity,
      );
    } else if (isDetail) {
      material = makeToonMaterial(
        palette.detailColor,
        palette.detailEmissive,
        palette.detailEmissiveIntensity,
      );
    } else {
      material = makeToonMaterial(
        palette.bodyColor,
        palette.bodyEmissive,
        palette.bodyEmissiveIntensity,
      );
    }

    object.material = material;
    object.castShadow = false;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
}

function getRequiredNode(root: THREE.Group, name: string): THREE.Object3D {
  const node = root.getObjectByName(name);

  if (!node) {
    throw new Error(`Missing whale hero node: ${name}`);
  }

  return node;
}

function getOptionalNode(root: THREE.Group, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? null;
}

export async function createWhaleHeroRig(variant: WhaleHeroVariant): Promise<WhaleHeroRig> {
  const template = await loadHeroTemplate();
  const root = cloneTemplate(template);
  root.name = `whale_hero_${variant}`;
  applyVariantMaterials(root, variant);

  return {
    root,
    bodyRoot: getRequiredNode(root, 'body_root'),
    tailPivot: getRequiredNode(root, 'tail_pivot'),
    flukePivot: getRequiredNode(root, 'fluke_pivot'),
    leftFinPivot: getRequiredNode(root, 'left_fin_pivot'),
    rightFinPivot: getRequiredNode(root, 'right_fin_pivot'),
    tetherAttach: getOptionalNode(root, 'tether_attach'),
    tailSlapAnchor: getOptionalNode(root, 'tail_slap_anchor'),
    towAttach: ['tow_attach_left', 'tow_attach_center', 'tow_attach_right']
      .map((name) => getOptionalNode(root, name))
      .filter((node): node is THREE.Object3D => node !== null),
  };
}

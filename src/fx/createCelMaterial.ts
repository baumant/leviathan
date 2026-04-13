import * as THREE from 'three';

const CEL_BAND_VALUES = new Uint8Array([24, 84, 152, 224, 255]);

let sharedGradientMap: THREE.DataTexture | null = null;

function getSharedGradientMap(): THREE.DataTexture {
  if (sharedGradientMap) {
    return sharedGradientMap;
  }

  const gradientMap = new THREE.DataTexture(CEL_BAND_VALUES, CEL_BAND_VALUES.length, 1, THREE.RedFormat);
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  gradientMap.colorSpace = THREE.NoColorSpace;
  sharedGradientMap = gradientMap;
  return gradientMap;
}

export interface CelMaterialOptions {
  color: THREE.ColorRepresentation;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  depthWrite?: boolean;
  blending?: THREE.Blending;
}

export function createCelMaterial(options: CelMaterialOptions): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({
    color: options.color,
    emissive: options.emissive ?? '#000000',
    emissiveIntensity: options.emissiveIntensity ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    side: options.side,
    depthWrite: options.depthWrite,
    blending: options.blending,
    gradientMap: getSharedGradientMap(),
  });

  material.toneMapped = true;
  return material;
}

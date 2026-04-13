import * as THREE from 'three';

const OCEAN_SURFACE_PROGRAM_KEY = 'leviathan-painterly-ocean-v1';
type PainterlyShaderHandle = {
  uniforms: {
    uTime: { value: number };
  };
};

export function createPainterlyOceanMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#0b2430'),
    roughness: 0.78,
    metalness: 0.05,
    flatShading: true,
    side: THREE.FrontSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uDeepWaterColor = { value: new THREE.Color('#071a24') };
    shader.uniforms.uMidWaterColor = { value: new THREE.Color('#0b2e38') };
    shader.uniforms.uFoamColor = { value: new THREE.Color('#f2f8ef') };

    shader.vertexShader =
      `
varying vec3 vWorldPosition;
` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
vWorldPosition = worldPosition.xyz;`,
    );

    shader.fragmentShader =
      `
uniform float uTime;
uniform vec3 uDeepWaterColor;
uniform vec3 uMidWaterColor;
uniform vec3 uFoamColor;

varying vec3 vWorldPosition;

float painterlyWave(vec2 point, float time) {
  float longSwell = sin(point.x * 0.017 + time * 0.11) * 0.5 + 0.5;
  float crossSwell = cos(point.y * 0.022 - time * 0.09) * 0.5 + 0.5;
  float breakup = sin((point.x + point.y) * 0.043 + time * 0.16) * 0.5 + 0.5;
  return clamp(longSwell * 0.42 + crossSwell * 0.34 + breakup * 0.24, 0.0, 1.0);
}
` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      `vec4 diffuseColor = vec4( diffuse, opacity );
vec2 painterlyUv = vWorldPosition.xz;
float tonal = painterlyWave(painterlyUv, uTime);
float secondary = painterlyWave(painterlyUv.yx * vec2(1.22, 0.86), uTime * 1.18 + 12.0);
float crest = smoothstep(-0.08, 0.74, vWorldPosition.y);
float foamBands = abs(sin(painterlyUv.x * 0.075 + painterlyUv.y * 0.038 + uTime * 0.21));
float foamCross = abs(cos(painterlyUv.x * 0.028 - painterlyUv.y * 0.064 - uTime * 0.16));
float painterlyBreak = smoothstep(0.68, 0.96, foamBands * 0.62 + foamCross * 0.3 + tonal * 0.24);
float crestFoam = smoothstep(0.46, 0.9, tonal + crest * 0.3) * 0.24;
float foamMask = clamp(painterlyBreak * (0.34 + crest * 0.66) + crestFoam, 0.0, 1.0);
vec3 baseWater = mix(uDeepWaterColor, uMidWaterColor, tonal * 0.72 + secondary * 0.18);
baseWater *= 0.9 + secondary * 0.18;
diffuseColor.rgb = mix(baseWater, uFoamColor, foamMask * 0.72);
diffuseColor.rgb += uFoamColor * foamMask * 0.08;`,
    );

    material.userData.surfaceShader = shader;
  };

  material.customProgramCacheKey = () => OCEAN_SURFACE_PROGRAM_KEY;
  return material;
}

export function updatePainterlyOceanMaterial(
  material: THREE.MeshStandardMaterial,
  elapsedSeconds: number,
): void {
  const shader = material.userData.surfaceShader as PainterlyShaderHandle | undefined;
  if (!shader) {
    return;
  }

  shader.uniforms.uTime.value = elapsedSeconds;
}

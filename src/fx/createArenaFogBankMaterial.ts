import * as THREE from 'three';

const FOG_BANK_VERTEX_SHADER = `
varying vec3 vLocalPosition;

void main() {
  vLocalPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FOG_BANK_BASE_TARGET = new THREE.Color('#111a21');
const FOG_BANK_HIGHLIGHT_TARGET = new THREE.Color('#61717c');
const UNDERWATER_FOG_BANK_BASE_TARGET = new THREE.Color('#041a3d');
const UNDERWATER_FOG_BANK_HIGHLIGHT_TARGET = new THREE.Color('#0c3c68');
const underwaterBaseColor = new THREE.Color();
const underwaterHighlightColor = new THREE.Color();

const FOG_BANK_FRAGMENT_SHADER = `
uniform vec3 uBaseColor;
uniform vec3 uHighlightColor;
uniform float uOpacity;
uniform float uTime;
uniform float uUnderwaterRatio;
uniform float uWaterlineHeight;

varying vec3 vLocalPosition;

float layeredBreakup(vec2 point) {
  float wide = sin(point.x * 1.7 + point.y * 0.72 + uTime * 0.025) * 0.5 + 0.5;
  float mid = cos(point.x * 3.9 - point.y * 1.44 - uTime * 0.018) * 0.5 + 0.5;
  float fine = sin((point.x - point.y) * 6.1 + uTime * 0.032) * 0.5 + 0.5;
  float streak = cos(point.x * 9.4 + point.y * 0.38 + uTime * 0.012) * 0.5 + 0.5;
  return wide * 0.38 + mid * 0.3 + fine * 0.18 + streak * 0.14;
}

void main() {
  float height01 = clamp(vLocalPosition.y + 0.5, 0.0, 1.0);
  float angle = atan(vLocalPosition.z, vLocalPosition.x);
  float breakup = layeredBreakup(vec2(angle * 1.5, height01 * 3.4));
  float verticalBreakup = layeredBreakup(vec2(angle * 2.35 + height01 * 0.72, height01 * 5.2));
  float veilGap = smoothstep(0.18, 0.9, verticalBreakup + sin(angle * 7.2 + uTime * 0.015) * 0.14);
  float waterlineBreakup = layeredBreakup(vec2(angle * 3.1 + 1.7, height01 * 2.6));

  float waterlineBand =
    (1.0 - smoothstep(0.02, 0.18, abs(height01 - 0.08) * 2.8)) *
    mix(0.26, 0.72, waterlineBreakup);
  float bodyMass = smoothstep(0.0, 0.16, height01) * (1.0 - smoothstep(0.54, 0.96, height01));
  float lowerMass = 1.0 - smoothstep(0.12, 0.72, height01);
  float topFade = 1.0 - smoothstep(0.78, 0.99, height01);
  float belowWater = uWaterlineHeight > 0.001
    ? 1.0 - smoothstep(uWaterlineHeight - 0.018, uWaterlineHeight + 0.034, height01)
    : 0.0;
  float waterlineDistance = abs(height01 - uWaterlineHeight);
  float surfaceShelf = belowWater * (1.0 - smoothstep(0.0, 0.13, waterlineDistance)) * mix(0.34, 0.82, waterlineBreakup);
  float deepVolume = belowWater * smoothstep(0.02, 0.34, uWaterlineHeight - height01);
  float density =
    (bodyMass * mix(0.78, 1.22, breakup) + waterlineBand * 0.48 + lowerMass * 0.18) * topFade;
  density *= mix(0.38, 1.14, veilGap);
  float submergedBlend = smoothstep(0.06, 0.72, uUnderwaterRatio);
  float oceanVolume = belowWater * (0.18 + deepVolume * 0.32 + breakup * 0.16);
  density = mix(density, oceanVolume + surfaceShelf * 0.12, submergedBlend * belowWater);
  float underwaterFade = mix(1.0, 0.58 + deepVolume * 0.18, submergedBlend * belowWater);
  float alpha = uOpacity * density * underwaterFade;

  if (alpha <= 0.001) {
    discard;
  }

  vec3 color = mix(uBaseColor, uHighlightColor, clamp(height01 * 0.58 + breakup * 0.16, 0.0, 1.0));
  vec3 oceanBlue = mix(vec3(0.012, 0.084, 0.19), vec3(0.036, 0.18, 0.34), clamp(deepVolume + breakup * 0.18, 0.0, 1.0));
  vec3 surfaceShadow = vec3(0.002, 0.012, 0.038);
  color = mix(color, oceanBlue, submergedBlend * belowWater * 0.96);
  color = mix(color, surfaceShadow, submergedBlend * surfaceShelf * 0.64);
  gl_FragColor = vec4(color, alpha);
}
`;

export interface ArenaFogBankMaterialSnapshot {
  atmosphereColor: THREE.Color;
  elapsedSeconds: number;
  underwaterRatio: number;
}

type ArenaFogBankShaderMaterial = THREE.ShaderMaterial & {
  uniforms: {
    uBaseColor: { value: THREE.Color };
    uHighlightColor: { value: THREE.Color };
    uOpacity: { value: number };
    uTime: { value: number };
    uUnderwaterRatio: { value: number };
    uWaterlineHeight: { value: number };
  };
};

export function createArenaFogBankMaterial(opacity: number, waterlineHeight = 0): ArenaFogBankShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: new THREE.Color('#18232d') },
      uHighlightColor: { value: new THREE.Color('#5d6a74') },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
      uUnderwaterRatio: { value: 0 },
      uWaterlineHeight: { value: waterlineHeight },
    },
    vertexShader: FOG_BANK_VERTEX_SHADER,
    fragmentShader: FOG_BANK_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    fog: false,
  }) as ArenaFogBankShaderMaterial;

  material.userData.baseOpacity = opacity;
  material.toneMapped = false;
  return material;
}

export function updateArenaFogBankMaterial(
  material: THREE.ShaderMaterial,
  snapshot: ArenaFogBankMaterialSnapshot,
): void {
  const fogBankMaterial = material as ArenaFogBankShaderMaterial;
  const baseColor = fogBankMaterial.uniforms.uBaseColor.value;
  const highlightColor = fogBankMaterial.uniforms.uHighlightColor.value;
  const underwaterBlend = THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.06, 0.7);
  const underwaterVisibility = THREE.MathUtils.lerp(
    1,
    1.08,
    THREE.MathUtils.smoothstep(snapshot.underwaterRatio, 0.18, 0.9),
  );

  underwaterBaseColor
    .copy(UNDERWATER_FOG_BANK_BASE_TARGET)
    .lerp(snapshot.atmosphereColor, 0.12);
  underwaterHighlightColor
    .copy(UNDERWATER_FOG_BANK_HIGHLIGHT_TARGET)
    .lerp(snapshot.atmosphereColor, 0.14);

  baseColor
    .copy(snapshot.atmosphereColor)
    .lerp(FOG_BANK_BASE_TARGET, 0.42 * (1 - underwaterBlend))
    .lerp(underwaterBaseColor, underwaterBlend * 0.92);
  highlightColor
    .copy(snapshot.atmosphereColor)
    .lerp(FOG_BANK_HIGHLIGHT_TARGET, 0.52 * (1 - underwaterBlend))
    .lerp(underwaterHighlightColor, underwaterBlend * 0.82);
  fogBankMaterial.uniforms.uOpacity.value = (fogBankMaterial.userData.baseOpacity as number) * underwaterVisibility;
  fogBankMaterial.uniforms.uTime.value = snapshot.elapsedSeconds;
  fogBankMaterial.uniforms.uUnderwaterRatio.value = snapshot.underwaterRatio;
}

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

const FOG_BANK_FRAGMENT_SHADER = `
uniform vec3 uBaseColor;
uniform vec3 uHighlightColor;
uniform float uOpacity;
uniform float uTime;
uniform float uUnderwaterRatio;

varying vec3 vLocalPosition;

float layeredBreakup(vec2 point) {
  float wide = sin(point.x * 2.0 + point.y * 0.9 + uTime * 0.03) * 0.5 + 0.5;
  float mid = cos(point.x * 4.4 - point.y * 1.7 - uTime * 0.02) * 0.5 + 0.5;
  float fine = sin((point.x - point.y) * 3.1 + uTime * 0.04) * 0.5 + 0.5;
  return wide * 0.48 + mid * 0.34 + fine * 0.18;
}

void main() {
  float height01 = clamp(vLocalPosition.y + 0.5, 0.0, 1.0);
  float angle = atan(vLocalPosition.z, vLocalPosition.x);
  float breakup = layeredBreakup(vec2(angle * 1.5, height01 * 3.4));

  float waterlineBand = 1.0 - smoothstep(0.02, 0.18, abs(height01 - 0.08) * 2.8);
  float bodyMass = smoothstep(0.0, 0.16, height01) * (1.0 - smoothstep(0.54, 0.96, height01));
  float topFade = 1.0 - smoothstep(0.72, 0.98, height01);
  float density = (bodyMass * mix(0.76, 1.18, breakup) + waterlineBand * 0.52) * topFade;
  float underwaterFade = 1.0 - smoothstep(0.04, 0.46, uUnderwaterRatio);
  float alpha = uOpacity * density * underwaterFade;

  if (alpha <= 0.001) {
    discard;
  }

  vec3 color = mix(uBaseColor, uHighlightColor, clamp(height01 * 0.7 + breakup * 0.22, 0.0, 1.0));
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
  };
};

export function createArenaFogBankMaterial(opacity: number): ArenaFogBankShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: new THREE.Color('#18232d') },
      uHighlightColor: { value: new THREE.Color('#5d6a74') },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
      uUnderwaterRatio: { value: 0 },
    },
    vertexShader: FOG_BANK_VERTEX_SHADER,
    fragmentShader: FOG_BANK_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    fog: false,
  }) as ArenaFogBankShaderMaterial;

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

  baseColor.copy(snapshot.atmosphereColor).lerp(FOG_BANK_BASE_TARGET, 0.42);
  highlightColor.copy(snapshot.atmosphereColor).lerp(FOG_BANK_HIGHLIGHT_TARGET, 0.52);
  fogBankMaterial.uniforms.uTime.value = snapshot.elapsedSeconds;
  fogBankMaterial.uniforms.uUnderwaterRatio.value = snapshot.underwaterRatio;
}

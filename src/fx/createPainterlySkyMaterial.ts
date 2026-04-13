import * as THREE from 'three';

const SKY_VERTEX_SHADER = `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const SKY_FRAGMENT_SHADER = `
uniform vec3 uZenithColor;
uniform vec3 uUpperSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uHorizonGlowColor;
uniform vec3 uCloudColor;

varying vec3 vWorldPosition;

float painterlyCloud(vec2 point) {
  float sweep = sin(point.x * 3.2 + point.y * 1.3) * 0.5 + 0.5;
  float breakup = cos(point.x * 5.8 - point.y * 2.1) * 0.5 + 0.5;
  float drift = sin((point.x + point.y) * 2.6) * 0.5 + 0.5;
  return sweep * 0.42 + breakup * 0.36 + drift * 0.22;
}

void main() {
  vec3 dir = normalize(vWorldPosition);
  float upperMix = smoothstep(-0.06, 0.34, dir.y);
  float zenithMix = smoothstep(0.24, 0.9, dir.y);
  float horizonBand = 1.0 - smoothstep(0.02, 0.18, abs(dir.y + 0.02));

  vec3 color = mix(uHorizonColor, uUpperSkyColor, upperMix);
  color = mix(color, uZenithColor, zenithMix);
  color = mix(color, uHorizonGlowColor, horizonBand * 0.34);

  float skyAngle = atan(dir.z, dir.x);
  vec2 cloudUv = vec2(skyAngle * 1.05, dir.y * 3.8);
  float cloudLayer = painterlyCloud(cloudUv);
  float cloudMask = smoothstep(0.66, 0.86, cloudLayer) * smoothstep(0.04, 0.32, dir.y);
  color = mix(color, uCloudColor, cloudMask * 0.42);

  gl_FragColor = vec4(color, 1.0);
}
`;

export function createPainterlySkyMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenithColor: { value: new THREE.Color('#202833') },
      uUpperSkyColor: { value: new THREE.Color('#52545f') },
      uHorizonColor: { value: new THREE.Color('#8e8d92') },
      uHorizonGlowColor: { value: new THREE.Color('#b4b0ac') },
      uCloudColor: { value: new THREE.Color('#d2d4d2') },
    },
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  material.toneMapped = false;
  return material;
}

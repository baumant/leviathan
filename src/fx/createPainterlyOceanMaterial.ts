import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

const MAX_LANTERN_INFLUENCES = 4;
const MAX_SUBSURFACE_REVEAL_WINDOWS = 8;
const NORMAL_TEXTURE_SIZE = 256;
const FAR_LANTERN_POSITION = new THREE.Vector3(9999, 0, 9999);

const OCEAN_SURFACE_TUNING = {
  lighting: {
    moonColor: new THREE.Color('#b8c9e6'),
    timeScale: 0.2,
  },
  fresnel: {
    surface: {
      power: 4.5,
      normalStrength: 0.8,
      fadeStart: 90,
      fadePower: 0.9,
    },
    underwater: {
      waterAbsorption: 0.82,
      refractionIOR: 1.12,
      refractionStrength: 0.24,
      reflectionStrength: 0.38,
    },
  },
  body: {
    shallowColor: new THREE.Color('#0d2230'),
    midColor: new THREE.Color('#091723'),
    deepColor: new THREE.Color('#031018'),
    transmissionColor: new THREE.Color('#1a3040'),
    depthFalloff: 36,
    minimumDensity: 0.38,
    troughDarkening: 0.12,
  },
  waveMotion: {
    primaryDirection: new THREE.Vector2(0.96, 0.28).normalize(),
    secondaryDirection: new THREE.Vector2(-0.34, 0.94).normalize(),
    primaryScale: 0.028,
    secondaryScale: 0.047,
    primarySpeed: 0.62,
    secondarySpeed: -0.48,
    bandStrength: 0.08,
    sheenStrength: 0.045,
  },
  reflection: {
    textureSize: 1024,
    textureScale: 1.15,
    distortionScale: 2.45,
    reflectionStrength: 0,
    specularStrength: 0.18,
  },
  lantern: {
    color: new THREE.Color('#9f7441'),
    radius: 24,
    intensityScale: 0.1,
    warmBlend: 0.038,
  },
  subsurfaceReveal: {
    clarityStrength: 0.32,
    densityReduction: 0.2,
    transmissionBoost: 0.08,
    minAlpha: 0.74,
  },
} as const;

export const OCEAN_SUBSURFACE_REVEAL_TUNING = {
  whale: {
    minDepth: 0.4,
    strongStart: 1.0,
    strongEnd: 3.0,
    maxDepth: 6.0,
    fadeDistanceStart: 10,
    fadeDistanceEnd: 54,
    maxStrength: 0.94,
  },
  ship: {
    minDepth: 0.25,
    strongStart: 0.5,
    strongEnd: 1.2,
    maxDepth: 2.0,
    fadeDistanceStart: 8,
    fadeDistanceEnd: 36,
    maxStrength: 0.44,
  },
  capital_ship: {
    minDepth: 0.35,
    strongStart: 0.9,
    strongEnd: 4.5,
    maxDepth: 9.0,
    fadeDistanceStart: 12,
    fadeDistanceEnd: 56,
    maxStrength: 0.56,
  },
  object: {
    minDepth: 0.05,
    strongStart: 0.18,
    strongEnd: 0.82,
    maxDepth: 1.8,
    fadeDistanceStart: 6,
    fadeDistanceEnd: 26,
    maxStrength: 0.36,
  },
} as const;

export interface PainterlyOceanLanternInfluence {
  position: THREE.Vector3;
  intensity: number;
}

export interface PainterlyOceanSubsurfaceRevealWindow {
  positionXZ: THREE.Vector2;
  halfWidth: number;
  halfLength: number;
  strength: number;
}

export interface PainterlyOceanMaterialSnapshot {
  elapsedSeconds: number;
  cameraPosition: THREE.Vector3;
  fogColor: THREE.Color;
  fogDensity: number;
  moonDirection: THREE.Vector3;
  approxWaterDepth: number;
  underwaterRatio: number;
  lanternInfluences: readonly PainterlyOceanLanternInfluence[];
  subsurfaceRevealWindows: readonly PainterlyOceanSubsurfaceRevealWindow[];
}

type OceanWaterShader = THREE.ShaderMaterial & {
  uniforms: Record<string, { value: unknown }>;
};

export function createPainterlyOceanMaterial(geometry: THREE.PlaneGeometry, arenaRadius: number): Water {
  const water = new Water(geometry, {
    textureWidth: OCEAN_SURFACE_TUNING.reflection.textureSize,
    textureHeight: OCEAN_SURFACE_TUNING.reflection.textureSize,
    clipBias: 0.003,
    alpha: 1,
    time: 0,
    waterNormals: createWaterNormalTexture(),
    sunDirection: new THREE.Vector3(0.3, 0.94, -0.14).normalize(),
    sunColor: OCEAN_SURFACE_TUNING.lighting.moonColor,
    waterColor: OCEAN_SURFACE_TUNING.body.deepColor,
    distortionScale: OCEAN_SURFACE_TUNING.reflection.distortionScale,
    fog: true,
    side: THREE.FrontSide,
  });

  water.onBeforeRender = () => {};
  water.renderOrder = 20;

  const material = water.material as OceanWaterShader;
  material.transparent = true;
  material.depthWrite = false;
  material.toneMapped = true;
  material.uniforms.size.value = OCEAN_SURFACE_TUNING.reflection.textureScale;
  material.uniforms.uLanternPositions = {
    value: Array.from({ length: MAX_LANTERN_INFLUENCES }, () => FAR_LANTERN_POSITION.clone()),
  };
  material.uniforms.uLanternIntensities = {
    value: Array.from({ length: MAX_LANTERN_INFLUENCES }, () => 0),
  };
  material.uniforms.uLanternColor = { value: OCEAN_SURFACE_TUNING.lantern.color.clone() };
  material.uniforms.uShallowColor = { value: OCEAN_SURFACE_TUNING.body.shallowColor.clone() };
  material.uniforms.uMidColor = { value: OCEAN_SURFACE_TUNING.body.midColor.clone() };
  material.uniforms.uDeepColor = { value: OCEAN_SURFACE_TUNING.body.deepColor.clone() };
  material.uniforms.uTransmissionColor = { value: OCEAN_SURFACE_TUNING.body.transmissionColor.clone() };
  material.uniforms.uDepthFalloff = { value: OCEAN_SURFACE_TUNING.body.depthFalloff };
  material.uniforms.uMinimumDensity = { value: OCEAN_SURFACE_TUNING.body.minimumDensity };
  material.uniforms.uTroughDarkening = { value: OCEAN_SURFACE_TUNING.body.troughDarkening };
  material.uniforms.uWavePrimaryDirection = { value: OCEAN_SURFACE_TUNING.waveMotion.primaryDirection.clone() };
  material.uniforms.uWaveSecondaryDirection = { value: OCEAN_SURFACE_TUNING.waveMotion.secondaryDirection.clone() };
  material.uniforms.uWavePrimaryScale = { value: OCEAN_SURFACE_TUNING.waveMotion.primaryScale };
  material.uniforms.uWaveSecondaryScale = { value: OCEAN_SURFACE_TUNING.waveMotion.secondaryScale };
  material.uniforms.uWavePrimarySpeed = { value: OCEAN_SURFACE_TUNING.waveMotion.primarySpeed };
  material.uniforms.uWaveSecondarySpeed = { value: OCEAN_SURFACE_TUNING.waveMotion.secondarySpeed };
  material.uniforms.uWaveBandStrength = { value: OCEAN_SURFACE_TUNING.waveMotion.bandStrength };
  material.uniforms.uWaveSheenStrength = { value: OCEAN_SURFACE_TUNING.waveMotion.sheenStrength };
  material.uniforms.uSurfaceFresnelPower = { value: OCEAN_SURFACE_TUNING.fresnel.surface.power };
  material.uniforms.uSurfaceFresnelNormalStrength = {
    value: OCEAN_SURFACE_TUNING.fresnel.surface.normalStrength,
  };
  material.uniforms.uSurfaceFresnelFadeStart = { value: OCEAN_SURFACE_TUNING.fresnel.surface.fadeStart };
  material.uniforms.uSurfaceFresnelFadePower = { value: OCEAN_SURFACE_TUNING.fresnel.surface.fadePower };
  material.uniforms.uWaterAbsorption = { value: OCEAN_SURFACE_TUNING.fresnel.underwater.waterAbsorption };
  material.uniforms.uRefractionIOR = { value: OCEAN_SURFACE_TUNING.fresnel.underwater.refractionIOR };
  material.uniforms.uRefractionStrength = { value: OCEAN_SURFACE_TUNING.fresnel.underwater.refractionStrength };
  material.uniforms.uReflectionStrength = { value: OCEAN_SURFACE_TUNING.reflection.reflectionStrength };
  material.uniforms.uSpecularStrength = { value: OCEAN_SURFACE_TUNING.reflection.specularStrength };
  material.uniforms.uLanternRadius = { value: OCEAN_SURFACE_TUNING.lantern.radius };
  material.uniforms.uLanternIntensityScale = { value: OCEAN_SURFACE_TUNING.lantern.intensityScale };
  material.uniforms.uLanternWarmBlend = { value: OCEAN_SURFACE_TUNING.lantern.warmBlend };
  material.uniforms.uRevealWindows = {
    value: Array.from({ length: MAX_SUBSURFACE_REVEAL_WINDOWS }, () => new THREE.Vector4()),
  };
  material.uniforms.uRevealWindowStrengths = {
    value: Array.from({ length: MAX_SUBSURFACE_REVEAL_WINDOWS }, () => 0),
  };
  material.uniforms.uRevealClarityStrength = { value: OCEAN_SURFACE_TUNING.subsurfaceReveal.clarityStrength };
  material.uniforms.uRevealDensityReduction = { value: OCEAN_SURFACE_TUNING.subsurfaceReveal.densityReduction };
  material.uniforms.uRevealTransmissionBoost = { value: OCEAN_SURFACE_TUNING.subsurfaceReveal.transmissionBoost };
  material.uniforms.uRevealMinAlpha = { value: OCEAN_SURFACE_TUNING.subsurfaceReveal.minAlpha };
  material.uniforms.uApproxWaterDepth = { value: 95 };
  material.uniforms.uUnderwaterRatio = { value: 0 };
  material.uniforms.uArenaRadius = { value: arenaRadius };
  material.uniforms.uArenaFadeStart = { value: arenaRadius * 0.9 };

  material.fragmentShader = material.fragmentShader.replace(
    'varying vec4 worldPosition;',
    `varying vec4 worldPosition;

uniform vec3 uLanternPositions[${MAX_LANTERN_INFLUENCES}];
uniform float uLanternIntensities[${MAX_LANTERN_INFLUENCES}];
uniform vec3 uLanternColor;
uniform vec3 uShallowColor;
uniform vec3 uMidColor;
uniform vec3 uDeepColor;
uniform vec3 uTransmissionColor;
uniform float uDepthFalloff;
uniform float uMinimumDensity;
uniform float uTroughDarkening;
uniform vec2 uWavePrimaryDirection;
uniform vec2 uWaveSecondaryDirection;
uniform float uWavePrimaryScale;
uniform float uWaveSecondaryScale;
uniform float uWavePrimarySpeed;
uniform float uWaveSecondarySpeed;
uniform float uWaveBandStrength;
uniform float uWaveSheenStrength;
uniform float uSurfaceFresnelPower;
uniform float uSurfaceFresnelNormalStrength;
uniform float uSurfaceFresnelFadeStart;
uniform float uSurfaceFresnelFadePower;
uniform float uWaterAbsorption;
uniform float uRefractionIOR;
uniform float uRefractionStrength;
uniform float uReflectionStrength;
uniform float uSpecularStrength;
uniform float uLanternRadius;
uniform float uLanternIntensityScale;
uniform float uLanternWarmBlend;
uniform vec4 uRevealWindows[${MAX_SUBSURFACE_REVEAL_WINDOWS}];
uniform float uRevealWindowStrengths[${MAX_SUBSURFACE_REVEAL_WINDOWS}];
uniform float uRevealClarityStrength;
uniform float uRevealDensityReduction;
uniform float uRevealTransmissionBoost;
uniform float uRevealMinAlpha;
uniform float uApproxWaterDepth;
uniform float uUnderwaterRatio;
uniform float uArenaRadius;
uniform float uArenaFadeStart;

float lanternInfluence( vec2 point ) {
  float accumulated = 0.0;

  for ( int index = 0; index < ${MAX_LANTERN_INFLUENCES}; index ++ ) {
    vec2 delta = point - uLanternPositions[ index ].xz;
    float distanceToLantern = length( delta );
    float glow = 1.0 - smoothstep( 4.0, uLanternRadius, distanceToLantern );
    accumulated += glow * clamp( uLanternIntensities[ index ] * uLanternIntensityScale, 0.0, 1.0 );
  }

  return clamp( accumulated, 0.0, 1.0 );
}

float revealWindowMask( vec2 point, vec2 halfSize ) {
  vec2 safeHalfSize = max( halfSize, vec2( 0.001 ) );
  vec2 scaled = point / safeHalfSize;
  float radial = dot( scaled, scaled );
  return 1.0 - smoothstep( 0.58, 1.28, radial );
}

float subsurfaceRevealWindow( vec2 waterPoint ) {
  float windowStrength = 0.0;

  for ( int index = 0; index < ${MAX_SUBSURFACE_REVEAL_WINDOWS}; index ++ ) {
    vec4 bounds = uRevealWindows[ index ];
    float strength = uRevealWindowStrengths[ index ];

    if ( strength <= 0.001 || bounds.z <= 0.0 || bounds.w <= 0.0 ) {
      continue;
    }

    vec2 delta = waterPoint - bounds.xy;
    float mask = revealWindowMask( delta, bounds.zw );
    windowStrength = max( windowStrength, mask * strength );
  }

  return clamp( windowStrength, 0.0, 1.0 );
}`,
  );

  material.fragmentShader = material.fragmentShader.replace(
    'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
    `vec3 surfaceNormal = normalize(
  noise.xzy * vec3(
    1.1 + uSurfaceFresnelNormalStrength * 0.75,
    1.0,
    1.1 + uSurfaceFresnelNormalStrength * 0.75
  )
);`,
  );

  material.fragmentShader = material.fragmentShader.replace(
    'float rf0 = 0.3;',
    'float rf0 = 0.16;',
  );

  material.fragmentShader = material.fragmentShader.replace(
    'float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );',
    `float fresnelTerm = pow( 1.0 - theta, uSurfaceFresnelPower );
float reflectance = rf0 + ( 1.0 - rf0 ) * fresnelTerm;`,
  );

  material.fragmentShader = material.fragmentShader.replace(
    'vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );',
    'vec3 reflectionSample = vec3( 0.0 );',
  );

  material.fragmentShader = material.fragmentShader.replace(
    'vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;',
    `float facing = max( 0.0, dot( surfaceNormal, eyeDirection ) );
float viewGrazing = 1.0 - facing;
float crestBias = smoothstep( -0.45, 1.25, worldPosition.y );
float troughBias = 1.0 - crestBias;
float distanceDensity = 1.0 - exp( -distance / max( 1.0, uDepthFalloff ) );
float waterDepthFactor = clamp( uApproxWaterDepth / ( uApproxWaterDepth + 28.0 ), 0.0, 1.0 );
float bodyDensity = clamp(
  0.16 +
    distanceDensity * ( 0.34 + uWaterAbsorption * 0.22 ) +
    troughBias * uTroughDarkening +
    viewGrazing * 0.18 +
    waterDepthFactor * 0.12,
  uMinimumDensity,
  1.0
);
float primaryWave = sin( dot( worldPosition.xz, uWavePrimaryDirection ) * uWavePrimaryScale + time * uWavePrimarySpeed );
float secondaryWave = cos( dot( worldPosition.xz, uWaveSecondaryDirection ) * uWaveSecondaryScale + time * uWaveSecondarySpeed );
float waveMotion = primaryWave * 0.58 + secondaryWave * 0.42;
float waveLift = waveMotion * 0.5 + 0.5;
bodyDensity = clamp( bodyDensity + ( waveLift - 0.5 ) * uWaveBandStrength, uMinimumDensity, 1.0 );
float aboveWaterReveal = 1.0 - smoothstep( 0.05, 0.34, uUnderwaterRatio );
float translucencyWindow = subsurfaceRevealWindow( worldPosition.xz ) * aboveWaterReveal;
float revealClarity = translucencyWindow * ( 1.0 - smoothstep( 0.72, 1.0, viewGrazing ) * 0.32 );
bodyDensity = mix( bodyDensity, max( uMinimumDensity * 0.82, bodyDensity * ( 1.0 - uRevealDensityReduction ) ), revealClarity );
vec3 bodyColor = mix( uShallowColor, uMidColor, clamp( distanceDensity * 0.72 + viewGrazing * 0.18, 0.0, 1.0 ) );
bodyColor = mix( bodyColor, uDeepColor, clamp( bodyDensity * 0.88 + troughBias * 0.18, 0.0, 1.0 ) );
bodyColor = mix( bodyColor, uShallowColor, waveLift * uWaveBandStrength * 0.6 );
vec3 scatter = bodyColor * bodyDensity;`,
  );

  material.fragmentShader = material.fragmentShader.replace(
    'vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(), ( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight ), reflectance);',
    `float arenaDistance = length( worldPosition.xz );
float arenaMask = 1.0 - smoothstep( uArenaFadeStart, uArenaRadius, arenaDistance );
if ( arenaMask <= 0.001 ) discard;
float lanternGlow = lanternInfluence( worldPosition.xz );
float fogAssist = clamp( fogDensity * 120.0, 0.2, 1.0 );
float horizonFade = pow(
  smoothstep( uSurfaceFresnelFadeStart, uSurfaceFresnelFadeStart + 170.0 / fogAssist, distance ),
  uSurfaceFresnelFadePower
);
float reflectionFade = 1.0 - horizonFade * 0.42;
float nearDistanceFade = 1.0 - smoothstep( 14.0, uDepthFalloff * 1.8, distance );
float refractionBias = clamp( ( uRefractionIOR - 1.0 ) * 0.85, 0.0, 0.3 );
float revealWindowClarity = revealClarity * uRevealClarityStrength * ( 1.0 - horizonFade * 0.38 );
float transmissionStrength =
  nearDistanceFade *
  facing *
  uRefractionStrength *
  ( 1.0 - bodyDensity ) *
  ( 1.08 - refractionBias ) *
  ( 1.0 - horizonFade ) *
  ( 1.0 - uUnderwaterRatio * 0.35 );
vec3 transmission = uTransmissionColor * ( transmissionStrength + revealWindowClarity * uRevealTransmissionBoost );
vec3 shadowedScatter = ( scatter + sunColor * diffuseLight * 0.05 ) * getShadowMask();
float moonSheenMask = reflectance * reflectionFade * ( 0.36 + viewGrazing * 0.64 );
vec3 moonSheen =
  sunColor * ( 0.02 + diffuseLight * 0.04 ) +
  specularLight * sunColor * uSpecularStrength * moonSheenMask;
moonSheen += sunColor * waveLift * uWaveSheenStrength * moonSheenMask;
vec3 albedo = shadowedScatter + transmission + moonSheen;
albedo += uLanternColor * lanternGlow * uLanternWarmBlend;
albedo = mix( albedo, fogColor, horizonFade * clamp( 0.34 + fogDensity * 10.0, 0.0, 0.74 ) );
albedo = max( albedo, uDeepColor * uMinimumDensity * 0.68 );
albedo = mix( fogColor, albedo, arenaMask );
float localAlpha = mix( alpha, max( uRevealMinAlpha, alpha * ( 1.0 - translucencyWindow * 0.28 ) ), revealWindowClarity );`,
  );

  material.fragmentShader = material.fragmentShader.replace(
    'gl_FragColor = vec4( outgoingLight, alpha );',
    'gl_FragColor = vec4( outgoingLight, localAlpha );',
  );

  material.needsUpdate = true;
  return water;
}

export function updatePainterlyOceanMaterial(
  water: Water,
  snapshot: PainterlyOceanMaterialSnapshot,
): void {
  const material = water.material as OceanWaterShader;

  (material.uniforms.time.value as number) = snapshot.elapsedSeconds * OCEAN_SURFACE_TUNING.lighting.timeScale;
  (material.uniforms.sunDirection.value as THREE.Vector3).copy(snapshot.moonDirection).negate().normalize();
  (material.uniforms.sunColor.value as THREE.Color).copy(OCEAN_SURFACE_TUNING.lighting.moonColor);
  (material.uniforms.waterColor.value as THREE.Color)
    .copy(OCEAN_SURFACE_TUNING.body.deepColor)
    .lerp(OCEAN_SURFACE_TUNING.body.midColor, 0.08);
  (material.uniforms.eye.value as THREE.Vector3).copy(snapshot.cameraPosition);
  (material.uniforms.fogColor.value as THREE.Color).copy(snapshot.fogColor);
  (material.uniforms.fogDensity.value as number) = snapshot.fogDensity;
  (material.uniforms.uApproxWaterDepth.value as number) = snapshot.approxWaterDepth;
  (material.uniforms.uUnderwaterRatio.value as number) = snapshot.underwaterRatio;

  const lanternPositions = material.uniforms.uLanternPositions.value as THREE.Vector3[];
  const lanternIntensities = material.uniforms.uLanternIntensities.value as number[];
  const revealWindows = material.uniforms.uRevealWindows.value as THREE.Vector4[];
  const revealStrengths = material.uniforms.uRevealWindowStrengths.value as number[];

  for (let index = 0; index < MAX_LANTERN_INFLUENCES; index += 1) {
    const influence = snapshot.lanternInfluences[index];

    if (influence) {
      lanternPositions[index].copy(influence.position);
      lanternIntensities[index] = influence.intensity;
      continue;
    }

    lanternPositions[index].copy(FAR_LANTERN_POSITION);
    lanternIntensities[index] = 0;
  }

  for (let index = 0; index < MAX_SUBSURFACE_REVEAL_WINDOWS; index += 1) {
    const window = snapshot.subsurfaceRevealWindows[index];

    if (window) {
      revealWindows[index].set(
        window.positionXZ.x,
        window.positionXZ.y,
        window.halfWidth,
        window.halfLength,
      );
      revealStrengths[index] = window.strength;
      continue;
    }

    revealWindows[index].set(0, 0, 0, 0);
    revealStrengths[index] = 0;
  }
}

function createWaterNormalTexture(): THREE.DataTexture {
  const data = new Uint8Array(NORMAL_TEXTURE_SIZE * NORMAL_TEXTURE_SIZE * 4);

  for (let y = 0; y < NORMAL_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < NORMAL_TEXTURE_SIZE; x += 1) {
      const u = (x / NORMAL_TEXTURE_SIZE) * Math.PI * 2;
      const v = (y / NORMAL_TEXTURE_SIZE) * Math.PI * 2;
      const nx =
        Math.sin(u * 3.0) * 0.45 +
        Math.cos(v * 4.0) * 0.35 +
        Math.sin((u + v) * 2.0) * 0.2;
      const ny =
        Math.cos(v * 2.0) * 0.42 +
        Math.sin(u * 5.0) * 0.28 +
        Math.cos((u - v) * 3.0) * 0.24;
      const normal = new THREE.Vector3(nx, ny, 1).normalize();
      const offset = (y * NORMAL_TEXTURE_SIZE + x) * 4;

      data[offset] = Math.round((normal.x * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, NORMAL_TEXTURE_SIZE, NORMAL_TEXTURE_SIZE, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

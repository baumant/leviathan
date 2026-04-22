import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

import { PlayerWhale } from '../entities/PlayerWhale';
import { preloadWhaleHeroAsset } from '../entities/WhaleHeroAsset';
import { Ship, ShipLanternInfluence, ShipSpawnConfig } from '../entities/Ship';
import { createArenaFogBankMaterial, updateArenaFogBankMaterial } from '../fx/createArenaFogBankMaterial';
import { BreachSplashFX } from '../fx/BreachSplashFX';
import { calculateWhaleTopsideRevealState, WhaleTopsideRevealState } from '../fx/calculateWhaleTopsideRevealState';
import {
  createPainterlyOceanMaterial,
  OCEAN_SUBSURFACE_REVEAL_TUNING,
  PainterlyOceanSubsurfaceRevealWindow,
  updatePainterlyOceanMaterial,
} from '../fx/createPainterlyOceanMaterial';
import { createPainterlySkyMaterial } from '../fx/createPainterlySkyMaterial';
import { ShipWakeFX } from '../fx/ShipWakeFX';
import { TopsideSubsurfaceRevealFX, TopsideSubsurfaceRevealTarget } from '../fx/TopsideSubsurfaceRevealFX';
import { Input } from '../game/Input';
import { UISystem } from '../systems/UISystem';
import { IntroRowboatMovementSystem } from '../systems/IntroRowboatMovementSystem';

const SURFACE_FOG = new THREE.Color('#15202b');
const SURFACE_FOG_DENSITY = 0.021;
const APPROX_OCEAN_DEPTH = 95;
const MOON_LIGHT_COLOR = new THREE.Color('#c6d6f5');
const MOON_LIGHT_INTENSITY = 2.2;
const MOON_LIGHT_POSITION = new THREE.Vector3(-28, 54, -34);
const HEMISPHERE_SKY_COLOR = new THREE.Color('#243543');
const HEMISPHERE_GROUND_COLOR = new THREE.Color('#02070b');
const HEMISPHERE_INTENSITY = 0.28;
const MOON_COLOR = new THREE.Color('#e6eefc');
const MOON_HALO_COLOR = new THREE.Color('#87a1c4');
const DISTANT_SILHOUETTE_COLOR = new THREE.Color('#081018');
const OCEAN_SIZE = 420;
const ARENA_RADIUS = 112;
const FOG_BANK_INNER_RADIUS = ARENA_RADIUS * 1.04;
const FOG_BANK_OUTER_RADIUS = ARENA_RADIUS * 1.12;
const FOG_BANK_INNER_HEIGHT = 58;
const FOG_BANK_OUTER_HEIGHT = 92;
const MAX_OCEAN_LANTERN_INFLUENCES = 4;

const FLAGSHIP_START = new THREE.Vector3(0, 0.62, 54);
const INTRO_HEADING = Math.PI;
const INTRO_LAUNCH_OFFSET_RIGHT = 2.4;
const INTRO_LAUNCH_OFFSET_BACK = 1.2;
const CORRIDOR_WIDTH = 10;
const CORRIDOR_RETURN = 1.4;
const ROWING_TRIGGER_MIN_TIME = 3.6;
const ROWING_TRIGGER_DISTANCE = 12;
const ROWING_TRIGGER_FAILSAFE = 8;
const UNDERPASS_VISIBLE_DURATION = 0.9;
const UNDERPASS_ATTACK_DELAY = 1.25;
const BREACH_CUT_IMPACT_TIME = 0.82;
const BREACH_CUT_DURATION = 1.2;
const FADE_DURATION = 0.6;
const BLACK_HOLD_DURATION = 0.2;

interface OceanSwellLayer {
  direction: THREE.Vector2;
  frequency: number;
  speed: number;
  amplitude: number;
  phase: number;
  waveform: 'sin' | 'cos';
}

const createSwellDirection = (x: number, z: number): THREE.Vector2 => new THREE.Vector2(x, z).normalize();

const OCEAN_SWELL_LAYERS: readonly OceanSwellLayer[] = [
  {
    direction: createSwellDirection(1, 0.22),
    frequency: 0.014,
    speed: 0.24,
    amplitude: 1.18,
    phase: 0.45,
    waveform: 'sin',
  },
  {
    direction: createSwellDirection(-0.28, 1),
    frequency: 0.011,
    speed: -0.16,
    amplitude: 0.9,
    phase: 1.8,
    waveform: 'cos',
  },
  {
    direction: createSwellDirection(0.84, 0.54),
    frequency: 0.022,
    speed: 0.32,
    amplitude: 0.4,
    phase: 2.6,
    waveform: 'sin',
  },
  {
    direction: createSwellDirection(-0.92, 0.38),
    frequency: 0.038,
    speed: 0.48,
    amplitude: 0.14,
    phase: 0.94,
    waveform: 'cos',
  },
] as const;

const createSpawn = (id: string, role: ShipSpawnConfig['role'], position: THREE.Vector3): ShipSpawnConfig => ({
  id,
  role,
  position,
  initialHeading: INTRO_HEADING,
});

export type IntroScenePhase = 'rowing' | 'underpass' | 'breach_cut' | 'fade_out' | 'complete';
export type IntroSceneResult = 'continue' | 'start_attack' | 'complete';

export class IntroScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 500);

  private readonly rowboat = new Ship(createSpawn('intro-rowboat', 'rowboat', FLAGSHIP_START.clone()));
  private readonly flagship = new Ship(createSpawn('intro-flagship', 'flagship', FLAGSHIP_START.clone()));
  private readonly ships = [this.rowboat, this.flagship] as const;
  private readonly whale = new PlayerWhale();
  private readonly rowboatMovement = new IntroRowboatMovementSystem();
  private readonly oceanGeometry = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 64, 64);
  private readonly arenaFogBankGeometry = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
  private readonly oceanMesh: Water;
  private readonly arenaFogBanks: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>[] = [];
  private readonly baseWaveCoordinates: Float32Array;
  private readonly atmosphereColor = SURFACE_FOG.clone();
  private readonly moonDirection = new THREE.Vector3(0.3, -0.94, 0.14);
  private readonly cameraTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly lookTargetCurrent = new THREE.Vector3();
  private readonly rowboatForward = new THREE.Vector3();
  private readonly rowboatRight = new THREE.Vector3();
  private readonly tempPoint = new THREE.Vector3();
  private readonly tempPointB = new THREE.Vector3();
  private readonly introStartPosition = new THREE.Vector3();
  private readonly tempLanternInfluences: ShipLanternInfluence[] = [];
  private readonly tempRevealPoint = new THREE.Vector3();
  private readonly oceanRevealWindows: PainterlyOceanSubsurfaceRevealWindow[] = [];
  private readonly topsideRevealTargets: TopsideSubsurfaceRevealTarget[] = [];
  private readonly breachSplashFx: BreachSplashFX;
  private readonly shipWakeFx: ShipWakeFX;
  private readonly topsideSubsurfaceRevealFx: TopsideSubsurfaceRevealFX;
  private whaleTopsideRevealState: WhaleTopsideRevealState = {
    strength: 0,
    depthBelowSurface: 0,
    cameraAboveWater: true,
    whaleSubmerged: false,
  };

  private elapsedSeconds = 0;
  private phase: IntroScenePhase = 'rowing';
  private phaseElapsed = 0;
  private fadeAlpha = 0;
  private blackHoldElapsed = 0;
  private cameraInitialized = false;
  private introDistanceTravelled = 0;
  private underpassVisible = false;
  private launchSplashSpawned = false;
  private breachImpactResolved = false;
  private skipStarted = false;

  constructor(
    private readonly input: Input,
    private readonly ui: UISystem,
    width: number,
    height: number,
  ) {
    this.scene.background = this.atmosphereColor;
    this.scene.fog = new THREE.FogExp2(this.atmosphereColor, SURFACE_FOG_DENSITY);

    this.oceanMesh = this.createOcean();
    this.baseWaveCoordinates = this.captureWaveCoordinates();
    this.breachSplashFx = new BreachSplashFX(this.scene);
    this.shipWakeFx = new ShipWakeFX(this.scene, this.ships);
    this.topsideSubsurfaceRevealFx = new TopsideSubsurfaceRevealFX(this.scene);
    void preloadWhaleHeroAsset();

    this.setupLights();
    this.setupSky();
    this.createArenaFogBanks();
    this.scene.add(
      this.oceanMesh,
      ...this.arenaFogBanks,
      this.whale.root,
      this.flagship.root,
      this.rowboat.root,
    );

    this.camera.position.set(5, 5, 30);
    this.resize(width, height);
    this.reset();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  reset(): void {
    this.elapsedSeconds = 0;
    this.phase = 'rowing';
    this.phaseElapsed = 0;
    this.fadeAlpha = 0;
    this.blackHoldElapsed = 0;
    this.cameraInitialized = false;
    this.introDistanceTravelled = 0;
    this.underpassVisible = false;
    this.launchSplashSpawned = false;
    this.breachImpactResolved = false;
    this.skipStarted = false;
    this.rowboatMovement.reset();
    this.rowboat.reset();
    this.flagship.reset();
    this.whale.reset();
    this.whale.setVisualPresentation('surface');
    this.breachSplashFx.reset();
    this.shipWakeFx.reset();
    this.topsideSubsurfaceRevealFx.reset();

    this.rowboat.travelSpeed = 1.56;
    this.flagship.travelSpeed = 0;
    this.flagship.heading = INTRO_HEADING;
    this.flagship.root.rotation.set(0, INTRO_HEADING, 0, 'YXZ');
    this.flagship.root.updateMatrixWorld();

    this.flagship.getWakeOrigin(this.tempPoint);
    this.flagship.getForward(this.rowboatForward);
    this.rowboatRight.set(this.rowboatForward.z, 0, -this.rowboatForward.x).normalize();
    this.tempPoint
      .addScaledVector(this.rowboatRight, INTRO_LAUNCH_OFFSET_RIGHT)
      .addScaledVector(this.rowboatForward, -INTRO_LAUNCH_OFFSET_BACK);
    this.rowboat.root.position.copy(this.tempPoint);
    this.rowboat.root.position.y = this.sampleOceanHeight(this.tempPoint.x, this.tempPoint.z) + 0.18;
    this.rowboatForward
      .copy(this.rowboat.root.position)
      .sub(this.flagship.root.position)
      .setY(0)
      .normalize();
    this.rowboat.heading = Math.atan2(this.rowboatForward.x, this.rowboatForward.z);
    this.rowboat.root.rotation.set(0, this.rowboat.heading, 0, 'YXZ');
    this.introStartPosition.copy(this.rowboat.root.position);

    this.whale.root.visible = false;
    this.whale.position.set(
      this.rowboat.root.position.x,
      this.sampleOceanHeight(this.rowboat.root.position.x, this.rowboat.root.position.z) - 12,
      this.rowboat.root.position.z,
    );
    this.whale.root.updateMatrixWorld();
    this.rowboat.root.updateMatrixWorld();
  }

  update(deltaSeconds: number, elapsedSeconds: number): IntroSceneResult {
    this.elapsedSeconds = elapsedSeconds;
    this.animateOcean();

    if (this.input.consumeSkipRequested() && this.phase !== 'complete' && this.phase !== 'fade_out') {
      this.skipStarted = true;
      this.phase = 'fade_out';
      this.phaseElapsed = 0;
    }

    let result: IntroSceneResult = 'continue';

    switch (this.phase) {
      case 'rowing':
        result = this.updateRowing(deltaSeconds);
        break;
      case 'underpass':
        result = this.updateUnderpass(deltaSeconds);
        break;
      case 'breach_cut':
        this.updateBreachCut(deltaSeconds);
        break;
      case 'fade_out':
        result = this.updateFadeOut(deltaSeconds);
        break;
      case 'complete':
        result = 'complete';
        break;
    }

    this.updateShips(deltaSeconds);
    this.updateCamera(deltaSeconds);
    this.updateWhaleTopsidePresentation();
    this.updateAtmosphere(deltaSeconds);
    this.updateArenaFogBanks();
    this.updateOceanMaterial();
    this.breachSplashFx.update(deltaSeconds, this.sampleOceanHeight);
    this.shipWakeFx.update({
      deltaSeconds,
      underwaterRatio: 0,
      sampleSurfaceHeight: this.sampleOceanHeight,
      ships: this.ships,
    });
    this.topsideSubsurfaceRevealFx.update({
      underwaterRatio: 0,
      targets: this.collectTopsideRevealTargets(),
    });
    this.updateHud();

    return result;
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.breachSplashFx.dispose();
    this.shipWakeFx.dispose();
    this.topsideSubsurfaceRevealFx.dispose();
    this.arenaFogBankGeometry.dispose();

    for (const fogBank of this.arenaFogBanks) {
      fogBank.material.dispose();
    }
  }

  private updateRowing(deltaSeconds: number): IntroSceneResult {
    this.phaseElapsed += deltaSeconds;
    this.whale.root.visible = false;
    this.whale.position.set(
      this.rowboat.root.position.x,
      this.sampleOceanHeight(this.rowboat.root.position.x, this.rowboat.root.position.z) - 12,
      this.rowboat.root.position.z,
    );

    this.rowboatMovement.update(this.rowboat, this.input, deltaSeconds);
    this.applyCorridorClamp(deltaSeconds);
    this.introDistanceTravelled = this.introStartPosition.distanceTo(this.rowboat.root.position);

    if (
      (this.phaseElapsed >= ROWING_TRIGGER_MIN_TIME && this.introDistanceTravelled >= ROWING_TRIGGER_DISTANCE) ||
      this.phaseElapsed >= ROWING_TRIGGER_FAILSAFE
    ) {
      this.phase = 'underpass';
      this.phaseElapsed = 0;
    }

    return 'continue';
  }

  private updateUnderpass(deltaSeconds: number): IntroSceneResult {
    this.phaseElapsed += deltaSeconds;
    this.rowboatMovement.update(this.rowboat, this.input, deltaSeconds);
    this.applyCorridorClamp(deltaSeconds);

    this.underpassVisible = this.phaseElapsed <= UNDERPASS_VISIBLE_DURATION;

    if (this.underpassVisible) {
      this.whale.root.visible = true;
      const progress = THREE.MathUtils.clamp(this.phaseElapsed / UNDERPASS_VISIBLE_DURATION, 0, 1);
      this.rowboat.getForward(this.rowboatForward);
      this.rowboatRight.set(this.rowboatForward.z, 0, -this.rowboatForward.x).normalize();
      const lateralOffset = THREE.MathUtils.lerp(7, -7, progress);
      const forwardOffset = THREE.MathUtils.lerp(-1, 1, progress);
      this.tempPoint
        .copy(this.rowboat.root.position)
        .addScaledVector(this.rowboatRight, lateralOffset)
        .addScaledVector(this.rowboatForward, forwardOffset);
      const surfaceHeight = this.sampleOceanHeight(this.tempPoint.x, this.tempPoint.z);
      const depthBelow = THREE.MathUtils.lerp(2.5, 1.7, Math.sin(progress * Math.PI));
      this.whale.position.set(
        this.tempPoint.x,
        surfaceHeight - depthBelow,
        this.tempPoint.z,
      );
      this.whale.yaw = this.rowboat.heading - Math.PI / 2;
      this.whale.root.rotation.set(0, this.whale.yaw, 0, 'YXZ');
      this.whale.root.updateMatrixWorld();
    } else {
      this.whale.root.visible = false;
      this.whale.position.set(
        this.rowboat.root.position.x,
        this.sampleOceanHeight(this.rowboat.root.position.x, this.rowboat.root.position.z) - 12,
        this.rowboat.root.position.z,
      );
    }

    if (this.phaseElapsed >= UNDERPASS_VISIBLE_DURATION + UNDERPASS_ATTACK_DELAY) {
      this.phase = 'breach_cut';
      this.phaseElapsed = 0;
      this.launchSplashSpawned = false;
      this.breachImpactResolved = false;
      this.whale.root.visible = true;
      this.cameraInitialized = false;
      this.tempPoint.copy(this.rowboat.root.position);
      this.whale.position.set(
        this.tempPoint.x,
        this.sampleOceanHeight(this.tempPoint.x, this.tempPoint.z) - 5.2,
        this.tempPoint.z,
      );
      this.whale.root.rotation.set(-0.34, this.rowboat.heading + 0.08, -0.08, 'YXZ');
      this.whale.root.updateMatrixWorld();
      return 'start_attack';
    }

    return 'continue';
  }

  private updateBreachCut(deltaSeconds: number): void {
    this.phaseElapsed += deltaSeconds;
    this.rowboat.travelSpeed = THREE.MathUtils.damp(this.rowboat.travelSpeed, 0.8, 1.2, deltaSeconds);
    this.rowboatForward.set(Math.sin(this.rowboat.heading), 0, Math.cos(this.rowboat.heading));
    this.rowboat.root.position.addScaledVector(this.rowboatForward, this.rowboat.travelSpeed * deltaSeconds);
    this.applyCorridorClamp(deltaSeconds);
    this.updateWhaleBreachMotion();
  }

  private updateFadeOut(deltaSeconds: number): IntroSceneResult {
    this.phaseElapsed += deltaSeconds;

    if (!this.skipStarted) {
      this.updateWhaleBreachMotion();
    } else {
      this.whale.root.visible = false;
      this.whale.position.set(
        this.rowboat.root.position.x,
        this.sampleOceanHeight(this.rowboat.root.position.x, this.rowboat.root.position.z) - 12,
        this.rowboat.root.position.z,
      );
    }

    this.fadeAlpha = Math.min(1, this.fadeAlpha + deltaSeconds / FADE_DURATION);

    if (this.fadeAlpha >= 1) {
      this.blackHoldElapsed += deltaSeconds;

      if (this.blackHoldElapsed >= BLACK_HOLD_DURATION) {
        this.phase = 'complete';
        return 'complete';
      }
    }

    return 'continue';
  }

  private updateWhaleBreachMotion(): void {
    const rowboatPosition = this.rowboat.root.position;
    const surfaceHeight = this.sampleOceanHeight(rowboatPosition.x, rowboatPosition.z);
    const approachProgress = THREE.MathUtils.clamp(this.phaseElapsed / BREACH_CUT_IMPACT_TIME, 0, 1);
    const fullProgress = THREE.MathUtils.clamp(this.phaseElapsed / BREACH_CUT_DURATION, 0, 1);

    if (!this.launchSplashSpawned && this.phaseElapsed >= 0.12) {
      this.tempPoint.set(rowboatPosition.x, surfaceHeight, rowboatPosition.z);
      this.breachSplashFx.spawnLaunch(this.tempPoint, 1);
      this.launchSplashSpawned = true;
    }

    const lateralOffset = THREE.MathUtils.lerp(0.8, 0, THREE.MathUtils.smoothstep(approachProgress, 0, 1));
    const forwardOffset = THREE.MathUtils.lerp(2.4, -0.4, THREE.MathUtils.smoothstep(approachProgress, 0, 1));
    this.rowboatRight.set(Math.cos(this.rowboat.heading), 0, -Math.sin(this.rowboat.heading)).normalize();
    this.rowboatForward.set(Math.sin(this.rowboat.heading), 0, Math.cos(this.rowboat.heading));
    this.tempPoint
      .copy(rowboatPosition)
      .addScaledVector(this.rowboatRight, lateralOffset)
      .addScaledVector(this.rowboatForward, forwardOffset);

    const riseCurve = Math.sin(approachProgress * Math.PI * 0.92);
    const depth = THREE.MathUtils.lerp(-5.2, 4.8, riseCurve);
    this.whale.position.set(this.tempPoint.x, surfaceHeight + depth, this.tempPoint.z);
    this.whale.yaw = this.rowboat.heading + 0.08;
    this.whale.pitch = THREE.MathUtils.lerp(-0.34, 0.92, approachProgress);
    this.whale.roll = THREE.MathUtils.lerp(-0.08, 0.12, approachProgress);
    this.whale.root.rotation.set(this.whale.pitch, this.whale.yaw, this.whale.roll, 'YXZ');
    this.whale.root.updateMatrixWorld();

    if (!this.breachImpactResolved && this.phaseElapsed >= BREACH_CUT_IMPACT_TIME) {
      this.breachImpactResolved = true;
      this.rowboat.applyDamage(this.rowboat.maxHealth);
      this.rowboat.launchIntoAir(this.rowboatForward, 8.4, 4.2, 0.42);
      this.phase = 'fade_out';
      this.phaseElapsed = BREACH_CUT_IMPACT_TIME;
      this.fadeAlpha = 0;
      this.blackHoldElapsed = 0;
      this.skipStarted = false;
    }

    if (fullProgress >= 1) {
      this.whale.root.visible = false;
    }
  }

  private updateShips(deltaSeconds: number): void {
    this.rowboat.update(deltaSeconds, this.elapsedSeconds, this.sampleOceanHeight);
    this.flagship.travelSpeed = 0;
    this.flagship.update(deltaSeconds, this.elapsedSeconds, this.sampleOceanHeight);
  }

  private applyCorridorClamp(deltaSeconds: number): void {
    const lateral = this.rowboat.root.position.x;
    const clamped = THREE.MathUtils.clamp(lateral, -CORRIDOR_WIDTH, CORRIDOR_WIDTH);
    this.rowboat.root.position.x = THREE.MathUtils.damp(clamped, 0, CORRIDOR_RETURN, deltaSeconds);
  }

  private updateCamera(deltaSeconds: number): void {
    this.rowboat.getForward(this.rowboatForward);
    this.rowboatRight.set(this.rowboatForward.z, 0, -this.rowboatForward.x).normalize();

    if (this.phase === 'breach_cut' || this.phase === 'fade_out') {
      const cinematicAlpha = THREE.MathUtils.clamp(this.phaseElapsed / 0.08, 0, 1);
      this.cameraTarget
        .copy(this.rowboat.root.position)
        .addScaledVector(this.rowboatForward, 8.4)
        .addScaledVector(this.rowboatRight, 10.2);
      this.cameraTarget.y = this.sampleOceanHeight(this.cameraTarget.x, this.cameraTarget.z) + 6.2;

      this.lookTarget.copy(this.rowboat.root.position);
      this.lookTarget.y = this.sampleOceanHeight(this.lookTarget.x, this.lookTarget.z) + 1.2;
      this.lookTarget.lerp(this.whale.position, 0.32);

      if (!this.cameraInitialized || cinematicAlpha >= 0.94) {
        this.camera.position.copy(this.cameraTarget);
        this.lookTargetCurrent.copy(this.lookTarget);
        this.cameraInitialized = true;
      } else {
        this.camera.position.lerp(this.cameraTarget, 1 - Math.exp(-deltaSeconds * 8.6));
        this.lookTargetCurrent.lerp(this.lookTarget, 1 - Math.exp(-deltaSeconds * 9.2));
      }
    } else {
      const distanceFromFlagship = this.flagship.root.position.distanceTo(this.rowboat.root.position);
      const launchBias = this.phase === 'rowing' ? 1 - THREE.MathUtils.smoothstep(this.phaseElapsed, 0.2, 1.2) : 0;
      const flagshipPresence = Math.max(launchBias, 1 - THREE.MathUtils.smoothstep(distanceFromFlagship, 28, 58));
      const chaseDistance = THREE.MathUtils.lerp(11.2, 14.4, flagshipPresence);
      const chaseHeight = THREE.MathUtils.lerp(4.6, 5.4, flagshipPresence);
      const lateral = THREE.MathUtils.lerp(2.2, 6.4, flagshipPresence);

      this.cameraTarget
        .copy(this.rowboat.root.position)
        .addScaledVector(this.rowboatForward, -chaseDistance)
        .addScaledVector(this.rowboatRight, lateral);
      this.cameraTarget.y = this.sampleOceanHeight(this.cameraTarget.x, this.cameraTarget.z) + chaseHeight;

      this.lookTarget.copy(this.rowboat.root.position).addScaledVector(this.rowboatForward, 6.4);
      this.lookTarget.y = this.sampleOceanHeight(this.lookTarget.x, this.lookTarget.z) + 1;
      this.tempPointB.copy(this.flagship.root.position);
      this.tempPointB.y = this.sampleOceanHeight(this.tempPointB.x, this.tempPointB.z) + 1.8;
      this.lookTarget.lerp(this.tempPointB, flagshipPresence * 0.2);

      if (!this.cameraInitialized) {
        this.camera.position.copy(this.cameraTarget);
        this.lookTargetCurrent.copy(this.lookTarget);
        this.cameraInitialized = true;
      } else {
        this.camera.position.lerp(this.cameraTarget, 1 - Math.exp(-deltaSeconds * 4.2));
        this.lookTargetCurrent.lerp(this.lookTarget, 1 - Math.exp(-deltaSeconds * 5.4));
      }
    }

    this.camera.lookAt(this.lookTargetCurrent);
    const targetFov = this.phase === 'breach_cut' || this.phase === 'fade_out' ? 67 : 61;
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 4.2, deltaSeconds);
    this.camera.updateProjectionMatrix();
  }

  private updateHud(): void {
    this.ui.update({
      capitalShipBars: [],
      objective: 'Row for open water. The fog is wrong.',
      whaleHealth: 1,
      whaleAir: 1,
      shipStatus: '',
      speed: this.rowboat.travelSpeed,
      depth: 0,
      submerged: false,
      score: 0,
      fleetRemaining: 0,
      activeTethers: 0,
      presentation: 'intro',
      eyebrowText: this.phase === 'breach_cut' || this.phase === 'fade_out' ? 'Ambush' : 'Prologue',
      fadeAlpha: this.fadeAlpha,
    });
  }

  private updateAtmosphere(deltaSeconds: number): void {
    const fog = this.scene.fog as THREE.FogExp2;
    this.atmosphereColor.lerp(SURFACE_FOG, 1 - Math.exp(-deltaSeconds * 2));
    fog.color.copy(this.atmosphereColor);
    fog.density = THREE.MathUtils.damp(fog.density, SURFACE_FOG_DENSITY, 2.6, deltaSeconds);
  }

  private updateArenaFogBanks(): void {
    for (const fogBank of this.arenaFogBanks) {
      updateArenaFogBankMaterial(fogBank.material, {
        atmosphereColor: this.atmosphereColor,
        elapsedSeconds: this.elapsedSeconds,
        underwaterRatio: 0,
      });
    }
  }

  private updateOceanMaterial(): void {
    updatePainterlyOceanMaterial(this.oceanMesh, {
      elapsedSeconds: this.elapsedSeconds,
      cameraPosition: this.camera.position,
      fogColor: this.atmosphereColor,
      fogDensity: (this.scene.fog as THREE.FogExp2).density,
      moonDirection: this.moonDirection,
      approxWaterDepth: APPROX_OCEAN_DEPTH,
      underwaterRatio: 0,
      lanternInfluences: this.collectOceanLanternInfluences(),
      subsurfaceRevealWindows: this.collectOceanSubsurfaceRevealWindows(),
    });
  }

  private collectTopsideRevealTargets(): readonly TopsideSubsurfaceRevealTarget[] {
    this.topsideRevealTargets.length = 0;
    this.appendWhaleRevealTarget();

    for (const ship of this.ships) {
      this.appendShipRevealTarget(ship);
    }

    return this.topsideRevealTargets;
  }

  private updateWhaleTopsidePresentation(): void {
    this.whaleTopsideRevealState = calculateWhaleTopsideRevealState({
      cameraPosition: this.camera.position,
      whalePosition: this.whale.position,
      sampleSurfaceHeight: this.sampleOceanHeight,
    });

    if (this.phase === 'underpass' && this.underpassVisible && this.whaleTopsideRevealState.strength > 0.001) {
      this.whale.setVisualPresentation('topside_subsurface', this.whaleTopsideRevealState.strength);
      return;
    }

    this.whale.setVisualPresentation('surface');
  }

  private collectOceanSubsurfaceRevealWindows(): readonly PainterlyOceanSubsurfaceRevealWindow[] {
    this.oceanRevealWindows.length = 0;

    for (const target of this.collectTopsideRevealTargets()) {
      this.oceanRevealWindows.push({
        positionXZ: new THREE.Vector2(target.position.x, target.position.z),
        halfWidth: target.halfWidth * (target.kind === 'whale' ? 1.36 : 1.18),
        halfLength: target.halfLength * (target.kind === 'whale' ? 1.08 : 1.02),
        strength: target.strength,
      });
    }

    return this.oceanRevealWindows;
  }

  private appendWhaleRevealTarget(): void {
    const { depthBelowSurface, strength } = this.whaleTopsideRevealState;

    if (strength <= 0.01) {
      return;
    }

    this.topsideRevealTargets.push({
      kind: 'whale',
      position: this.whale.position.clone(),
      yaw: this.whale.yaw,
      depthBelowSurface,
      halfWidth: this.whale.subsurfaceRevealHalfExtents.x,
      halfLength: this.whale.subsurfaceRevealHalfExtents.y,
      strength,
      drawProxy: false,
    });
  }

  private appendShipRevealTarget(ship: Ship): void {
    ship.getSubsurfaceRevealPoint(this.tempRevealPoint);
    const surfaceHeight = this.sampleOceanHeight(this.tempRevealPoint.x, this.tempRevealPoint.z);
    const depthBelowSurface = surfaceHeight - this.tempRevealPoint.y;
    const tuning = OCEAN_SUBSURFACE_REVEAL_TUNING.ship;
    const depthFadeIn = THREE.MathUtils.smoothstep(depthBelowSurface, tuning.minDepth, tuning.strongStart);
    const depthFadeOut = 1 - THREE.MathUtils.smoothstep(depthBelowSurface, tuning.strongEnd, tuning.maxDepth);
    const distanceFade =
      1 -
      THREE.MathUtils.smoothstep(
        this.camera.position.distanceTo(this.tempRevealPoint),
        tuning.fadeDistanceStart,
        tuning.fadeDistanceEnd,
      );
    const strength = THREE.MathUtils.clamp(depthFadeIn * depthFadeOut * distanceFade * tuning.maxStrength, 0, 1);

    if (strength <= 0.01) {
      return;
    }

    this.topsideRevealTargets.push({
      kind: 'ship',
      position: this.tempRevealPoint.clone(),
      yaw: ship.heading,
      depthBelowSurface,
      halfWidth: ship.subsurfaceRevealHalfExtents.x,
      halfLength: ship.subsurfaceRevealHalfExtents.y,
      strength,
    });
  }

  private readonly sampleOceanHeight = (x: number, z: number): number => {
    let height = 0;

    for (const layer of OCEAN_SWELL_LAYERS) {
      const waveInput =
        (x * layer.direction.x + z * layer.direction.y) * layer.frequency +
        this.elapsedSeconds * layer.speed +
        layer.phase;
      const wave = layer.waveform === 'sin' ? Math.sin(waveInput) : Math.cos(waveInput);
      height += wave * layer.amplitude;
    }

    return height;
  };

  private createOcean(): Water {
    this.oceanGeometry.rotateX(-Math.PI / 2);
    const ocean = createPainterlyOceanMaterial(this.oceanGeometry, ARENA_RADIUS);
    ocean.receiveShadow = false;
    return ocean;
  }

  private createArenaFogBanks(): void {
    const createFogBankMesh = (
      radius: number,
      height: number,
      opacity: number,
      renderOrder: number,
    ): THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial> => {
      const mesh = new THREE.Mesh(this.arenaFogBankGeometry, createArenaFogBankMaterial(opacity));
      mesh.scale.set(radius, height, radius);
      mesh.position.y = height * 0.5;
      mesh.renderOrder = renderOrder;
      return mesh;
    };

    this.arenaFogBanks.push(
      createFogBankMesh(FOG_BANK_OUTER_RADIUS, FOG_BANK_OUTER_HEIGHT, 0.2, 6),
      createFogBankMesh(FOG_BANK_INNER_RADIUS, FOG_BANK_INNER_HEIGHT, 0.34, 7),
    );
  }

  private setupLights(): void {
    const moonLight = new THREE.DirectionalLight(MOON_LIGHT_COLOR, MOON_LIGHT_INTENSITY);
    moonLight.position.copy(MOON_LIGHT_POSITION);
    this.moonDirection.copy(moonLight.position).negate().normalize();

    const fillLight = new THREE.HemisphereLight(
      HEMISPHERE_SKY_COLOR,
      HEMISPHERE_GROUND_COLOR,
      HEMISPHERE_INTENSITY,
    );

    this.scene.add(moonLight, fillLight);
  }

  private setupSky(): void {
    const moonAnchor = this.moonDirection.clone().multiplyScalar(-220);

    const sky = new THREE.Mesh(new THREE.SphereGeometry(280, 18, 18), createPainterlySkyMaterial());

    const moonHalo = new THREE.Mesh(
      new THREE.CircleGeometry(10, 24),
      new THREE.MeshBasicMaterial({
        color: MOON_HALO_COLOR,
        transparent: true,
        opacity: 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    moonHalo.material.toneMapped = false;
    moonHalo.position.copy(moonAnchor);

    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(6.4, 20),
      new THREE.MeshBasicMaterial({
        color: MOON_COLOR,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      }),
    );
    moon.material.toneMapped = false;
    moon.position.copy(moonAnchor);

    const silhouette = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 1.3, 54, 5),
      new THREE.MeshStandardMaterial({
        color: DISTANT_SILHOUETTE_COLOR,
        roughness: 1,
        metalness: 0,
        flatShading: true,
      }),
    );
    silhouette.position.set(92, 24, 124);
    silhouette.rotation.z = 0.06;

    const silhouette2 = silhouette.clone();
    silhouette2.position.set(-102, 22, 88);
    silhouette2.rotation.z = -0.08;

    sky.rotation.y = Math.PI * 0.15;
    this.scene.add(sky, moonHalo, moon, silhouette, silhouette2);
  }

  private captureWaveCoordinates(): Float32Array {
    const positions = this.oceanGeometry.attributes.position.array as Float32Array;
    const coordinates = new Float32Array((positions.length / 3) * 2);

    for (let index = 0; index < positions.length / 3; index += 1) {
      coordinates[index * 2] = positions[index * 3];
      coordinates[index * 2 + 1] = positions[index * 3 + 2];
    }

    return coordinates;
  }

  private animateOcean(): void {
    const positions = this.oceanGeometry.attributes.position.array as Float32Array;

    for (let index = 0; index < positions.length / 3; index += 1) {
      const x = this.baseWaveCoordinates[index * 2];
      const z = this.baseWaveCoordinates[index * 2 + 1];
      positions[index * 3 + 1] = this.sampleOceanHeight(x, z);
    }

    this.oceanGeometry.attributes.position.needsUpdate = true;
    this.oceanGeometry.computeVertexNormals();
  }

  private collectOceanLanternInfluences(): readonly ShipLanternInfluence[] {
    this.tempLanternInfluences.length = 0;

    for (const ship of this.ships) {
      ship.appendLanternInfluences(this.tempLanternInfluences);
    }

    this.tempLanternInfluences.sort(
      (left, right) =>
        left.position.distanceToSquared(this.camera.position) - right.position.distanceToSquared(this.camera.position),
    );

    if (this.tempLanternInfluences.length > MAX_OCEAN_LANTERN_INFLUENCES) {
      this.tempLanternInfluences.length = MAX_OCEAN_LANTERN_INFLUENCES;
    }

    return this.tempLanternInfluences;
  }
}

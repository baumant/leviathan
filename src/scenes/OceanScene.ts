import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

import { Cannonball } from '../entities/Cannonball';
import { CaptiveWhale } from '../entities/CaptiveWhale';
import { Harpoon } from '../entities/Harpoon';
import { PlayerWhale } from '../entities/PlayerWhale';
import { preloadWhaleHeroAsset } from '../entities/WhaleHeroAsset';
import { Ship, ShipLanternInfluence, ShipSpawnConfig } from '../entities/Ship';
import { createArenaFogBankMaterial, updateArenaFogBankMaterial } from '../fx/createArenaFogBankMaterial';
import { BreachSplashFX } from '../fx/BreachSplashFX';
import {
  ActorTopsideRevealState,
  calculateActorTopsideRevealState,
  INACTIVE_WATERLINE_PASSTHROUGH_STATE,
  WaterlinePassthroughSubject,
} from '../fx/calculateWhaleTopsideRevealState';
import {
  createPainterlyOceanMaterial,
  PainterlyOceanSubsurfaceRevealWindow,
  updatePainterlyOceanMaterial,
} from '../fx/createPainterlyOceanMaterial';
import { createPainterlySkyMaterial } from '../fx/createPainterlySkyMaterial';
import { ShipWakeFX } from '../fx/ShipWakeFX';
import { TailSlapShockwaveFX } from '../fx/TailSlapShockwaveFX';
import { TopsideSubsurfaceRevealFX, TopsideSubsurfaceRevealTarget } from '../fx/TopsideSubsurfaceRevealFX';
import { createOceanUndersideMaterial, UnderwaterReadabilityFX } from '../fx/UnderwaterReadabilityFX';
import { Input } from '../game/Input';
import { DamageSystem } from '../systems/DamageSystem';
import { ShipAIContext, ShipAISystem } from '../systems/ShipAISystem';
import { type HUDShipBarSnapshot, UISystem } from '../systems/UISystem';
import { WhaleMovementResult, WhaleMovementSystem } from '../systems/WhaleMovementSystem';
import { WHALE_SPEED_PROFILE } from '../tuning/whaleSpeedProfile';

const SURFACE_FOG = new THREE.Color('#15202b');
const UNDERWATER_FOG = new THREE.Color('#020d14');
const SURFACE_FOG_DENSITY = 0.0154;
const UNDERWATER_FOG_DENSITY = 0.0188;
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
const ARENA_RADIUS = 182;
const OCEAN_SIZE = 720;
const FOG_BANK_INNER_RADIUS = ARENA_RADIUS * 1.04;
const FOG_BANK_OUTER_RADIUS = ARENA_RADIUS * 1.12;
const FOG_BANK_INNER_HEIGHT = 72;
const FOG_BANK_OUTER_HEIGHT = 104;
const WHALE_BOUNDARY_MARGIN = 4;
const SHIP_BOUNDARY_MARGIN = 3;
const HARPOON_SPEED = 30;
const HARPOON_LIFETIME = 2.4;
const CANNONBALL_SPEED = 28;
const CANNONBALL_LIFETIME = 5.2;
const CANNON_SPLASH_RADIUS = 4;
const TETHER_SNAP_SPEED = WHALE_SPEED_PROFILE.tetherSnapSpeed;
const AIR_DRAIN_PER_SECOND = 0.35;
const AIR_RECOVERY_PER_SECOND = 3.4;
const SUFFOCATION_DAMAGE_PER_SECOND = 6;
const LOW_AIR_THRESHOLD = 0.34;
const MAX_OCEAN_LANTERN_INFLUENCES = 4;
const CORPORATE_ARRIVAL_TIME = 75;
const CORPORATE_PROXIMITY_TRIGGER = 90;
const CORPORATE_SHIP_ID = 'corporate-whaler';
const CORPORATE_ROWBOAT_ID_PREFIX = 'corporate-rowboat';
const RESCUE_TOW_BOAT_ID_PREFIX = 'rescue-towboat';
const RESCUE_TOW_BOAT_COUNT = 3;
const RESCUE_SPAWN_DELTA_SECONDS = 1 / 60;
const RESCUE_TOW_BOAT_START_DISTANCE = 70;
const RESCUE_TOW_BOAT_TARGET_DISTANCE = 8.5;
const RESCUE_CONVOY_CAPTURE_RADIUS = 10.5;
const RESCUE_CORPORATE_CREEP_SPEED = 2.2;
const TAIL_SLAP_CAMERA_BLEND_IN = 0.08;
const TAIL_SLAP_CAMERA_POST_HOLD = 0.18;
const TAIL_SLAP_CAMERA_BLEND_OUT = 0.22;
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

const createSpawn = (id: string, role: ShipSpawnConfig['role'], x: number, z: number): ShipSpawnConfig => ({
  id,
  role,
  position: new THREE.Vector3(x, 0.8, z),
  initialHeading: Math.atan2(-x, -z),
});

const FLEET_SPAWNS: ShipSpawnConfig[] = [
  createSpawn('flagship-west', 'flagship', -72, 138),
  createSpawn('flagship-east', 'flagship', 72, 138),
  createSpawn('rowboat-nw', 'rowboat', -146, 102),
  createSpawn('rowboat-wnw', 'rowboat', -168, 38),
  createSpawn('rowboat-wsw', 'rowboat', -154, -52),
  createSpawn('rowboat-sw', 'rowboat', -118, -126),
  createSpawn('rowboat-ssw', 'rowboat', -46, -168),
  createSpawn('rowboat-sse', 'rowboat', 46, -168),
  createSpawn('rowboat-se', 'rowboat', 118, -126),
  createSpawn('rowboat-ese', 'rowboat', 154, -52),
  createSpawn('rowboat-ene', 'rowboat', 168, 38),
  createSpawn('rowboat-ne', 'rowboat', 146, 102),
];

export type ArenaPhase = 'playing' | 'victory' | 'defeat';
type CorporateArrivalState = 'pending' | 'active' | 'defeated';
type RescueEncounterState = 'inactive' | 'towed' | 'escaping' | 'failed' | 'complete';

export class OceanScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 700);

  private readonly captiveWhale = new CaptiveWhale();
  private readonly whale = new PlayerWhale();
  private readonly ships = FLEET_SPAWNS.map((spawn) => new Ship(spawn));
  private readonly shipById = new Map(this.ships.map((ship) => [ship.id, ship] as const));
  private readonly initialShipIds = new Set(FLEET_SPAWNS.map((spawn) => spawn.id));
  private readonly whaleMovement = new WhaleMovementSystem();
  private readonly damageSystem = new DamageSystem();
  private readonly shipAiSystem = new ShipAISystem();
  private readonly oceanGeometry = new THREE.PlaneGeometry(OCEAN_SIZE, OCEAN_SIZE, 72, 72);
  private readonly arenaFogBankGeometry = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true);
  private readonly oceanMesh: Water;
  private readonly oceanUndersideMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly arenaFogBanks: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>[] = [];
  private readonly baseWaveCoordinates: Float32Array;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly lookTargetCurrent = new THREE.Vector3();
  private readonly whaleForward = new THREE.Vector3();
  private readonly whaleRight = new THREE.Vector3();
  private readonly breachCameraForward = new THREE.Vector3();
  private readonly breachCameraRight = new THREE.Vector3();
  private readonly tailSlapCameraForward = new THREE.Vector3();
  private readonly tailSlapCameraRight = new THREE.Vector3();
  private readonly cameraBasisForward = new THREE.Vector3();
  private readonly cameraBasisRight = new THREE.Vector3();
  private readonly moonDirection = new THREE.Vector3(0.3, -0.94, 0.14);
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly cameraOffset = new THREE.Vector3();
  private readonly atmosphereColor = SURFACE_FOG.clone();
  private readonly breachSplashFx: BreachSplashFX;
  private readonly tailSlapShockwaveFx: TailSlapShockwaveFX;
  private readonly shipWakeFx: ShipWakeFX;
  private readonly topsideSubsurfaceRevealFx: TopsideSubsurfaceRevealFX;
  private readonly readabilityFx: UnderwaterReadabilityFX;
  private readonly shipAiContext: ShipAIContext = {
    arenaRadius: ARENA_RADIUS,
    deltaSeconds: 0,
    fleetAlerted: false,
    otherShips: [],
    rowboatsRemaining: 0,
    shipHasActiveHarpoon: false,
    shipHasTether: false,
    whalePosition: new THREE.Vector3(),
  };
  private readonly harpoons: Harpoon[] = [];
  private readonly activeHarpoonsByShipId = new Map<string, Harpoon>();
  private readonly cannonballs: Cannonball[] = [];
  private readonly tempTargetPoint = new THREE.Vector3();
  private readonly tempHarpoonDirection = new THREE.Vector3();
  private readonly tempShipVector = new THREE.Vector3();
  private readonly tempAttachPoint = new THREE.Vector3();
  private readonly tempShipOrigin = new THREE.Vector3();
  private readonly tempCannonVelocity = new THREE.Vector3();
  private readonly tempShipForward = new THREE.Vector3();
  private readonly tempImpactPoint = new THREE.Vector3();
  private readonly tempTailSlapAnchor = new THREE.Vector3();
  private readonly tempBoundaryVector = new THREE.Vector3();
  private readonly tempRevealPoint = new THREE.Vector3();
  private readonly tempActorAnchor = new THREE.Vector3();
  private readonly tempActorBounds = new THREE.Box3();
  private readonly tempSpawnDirection = new THREE.Vector3();
  private readonly tempLaunchDirection = new THREE.Vector3();
  private readonly tempRescueAnchor = new THREE.Vector3();
  private readonly tempRescueTarget = new THREE.Vector3();
  private readonly tempRescueDirection = new THREE.Vector3();
  private readonly tempRescueLateral = new THREE.Vector3();
  private readonly tempHealthBarAnchor = new THREE.Vector3();
  private readonly tempHealthBarProjection = new THREE.Vector3();
  private readonly tempCameraSpacePoint = new THREE.Vector3();
  private readonly tempCollisionHalfExtentsA = new THREE.Vector2();
  private readonly tempCollisionHalfExtentsB = new THREE.Vector2();
  private readonly tempCollisionAxisA0 = new THREE.Vector2();
  private readonly tempCollisionAxisA1 = new THREE.Vector2();
  private readonly tempCollisionAxisB0 = new THREE.Vector2();
  private readonly tempCollisionAxisB1 = new THREE.Vector2();
  private readonly tempCollisionDelta = new THREE.Vector2();
  private readonly tempCollisionNormal = new THREE.Vector2();
  private readonly rescueTowOrigins = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly breachLaunchShipIds = new Set<string>();
  private readonly capitalBreachedThisArc = new Set<string>();
  private readonly oceanLanternInfluences: ShipLanternInfluence[] = [];
  private readonly oceanRevealWindows: PainterlyOceanSubsurfaceRevealWindow[] = [];
  private readonly topsideRevealTargets: TopsideSubsurfaceRevealTarget[] = [];
  private whaleTopsideRevealState: ActorTopsideRevealState = { ...INACTIVE_WATERLINE_PASSTHROUGH_STATE, cameraAboveWater: true };
  private readonly shipTopsideRevealStates = new Map<string, ActorTopsideRevealState>();

  private elapsedSeconds = 0;
  private impactShake = 0;
  private cameraInitialized = false;
  private shoulderOffset = 0;
  private cameraRoll = 0;
  private breachCameraBlend = 0;
  private breachCameraTransitionActive = false;
  private breachCameraHeading = 0;
  private tailSlapCameraHeading = 0;
  private tailSlapCameraHoldTimer = 0;
  private tailSlapCameraBlend = 0;
  private tailSlapCameraActive = false;
  private tailSlapCameraWasActive = false;
  private tailSlapPresentationActive = false;
  private phase: ArenaPhase = 'playing';
  private score = 0;
  private activeTethers = 0;
  private corporateArrivalState: CorporateArrivalState = 'pending';
  private corporateRowboatsLaunched = false;
  private corporateShip: Ship | null = null;
  private nextCorporateRowboatIndex = 0;
  private rescueEncounterState: RescueEncounterState = 'inactive';
  private rescueTowBoatIds: string[] = [];
  private rescueInitialExtractionDistance = 1;
  private fleetAlerted = false;
  private viewportWidth = 1;
  private viewportHeight = 1;

  constructor(
    private readonly input: Input,
    private readonly ui: UISystem,
    width: number,
    height: number,
  ) {
    this.scene.background = this.atmosphereColor;
    this.scene.fog = new THREE.FogExp2(this.atmosphereColor, SURFACE_FOG_DENSITY);

    this.camera.position.set(0, 6, -14);
    this.camera.lookAt(0, 0, 0);

    this.oceanMesh = this.createOcean();
    this.baseWaveCoordinates = this.captureWaveCoordinates();
    this.oceanUndersideMesh = this.createOceanUnderside();
    this.breachSplashFx = new BreachSplashFX(this.scene);
    this.tailSlapShockwaveFx = new TailSlapShockwaveFX(this.scene);
    this.shipWakeFx = new ShipWakeFX(this.scene, this.ships);
    this.topsideSubsurfaceRevealFx = new TopsideSubsurfaceRevealFX(this.scene);
    this.readabilityFx = new UnderwaterReadabilityFX(this.scene, this.camera);
    void preloadWhaleHeroAsset();

    this.setupLights();
    this.setupSky();
    this.createArenaFogBanks();
    this.scene.add(
      this.oceanMesh,
      this.oceanUndersideMesh,
      ...this.arenaFogBanks,
      this.captiveWhale.root,
      this.whale.root,
      this.camera,
      ...this.ships.map((ship) => ship.root),
    );

    this.reset();
    this.resize(width, height);
  }

  get outcome(): ArenaPhase | null {
    if (this.phase === 'playing') {
      return null;
    }

    return this.phase;
  }

  resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  reset(): void {
    this.phase = 'playing';
    this.score = 0;
    this.elapsedSeconds = 0;
    this.impactShake = 0;
    this.cameraInitialized = false;
    this.shoulderOffset = 0;
    this.cameraRoll = 0;
    this.breachCameraBlend = 0;
    this.breachCameraTransitionActive = false;
    this.breachCameraHeading = 0;
    this.tailSlapCameraHeading = 0;
    this.tailSlapCameraHoldTimer = 0;
    this.tailSlapCameraBlend = 0;
    this.tailSlapCameraActive = false;
    this.tailSlapCameraWasActive = false;
    this.tailSlapPresentationActive = false;
    this.activeTethers = 0;
    this.corporateArrivalState = 'pending';
    this.corporateRowboatsLaunched = false;
    this.corporateShip = null;
    this.nextCorporateRowboatIndex = 0;
    this.rescueEncounterState = 'inactive';
    this.rescueTowBoatIds = [];
    this.rescueInitialExtractionDistance = 1;
    this.fleetAlerted = false;
    this.breachLaunchShipIds.clear();
    this.capitalBreachedThisArc.clear();
    this.shipTopsideRevealStates.clear();

    this.removeDynamicShipsForReset();

    this.captiveWhale.reset();
    this.whale.reset();

    for (const ship of this.ships) {
      ship.reset();
      ship.setSubmergedReadabilityCue(0);
      ship.setTetherPull(0);
    }

    this.clearHarpoons();
    this.clearCannonballs();
    this.breachSplashFx.reset();
    this.tailSlapShockwaveFx.reset();
    this.shipWakeFx.reset();
    this.topsideSubsurfaceRevealFx.reset();
    this.whale.clearTailSlapVisual();
    this.syncTetherDragState();
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    this.elapsedSeconds = elapsedSeconds;
    let movementResult: WhaleMovementResult | null = null;

    this.animateOcean();
    this.whale.getForward(this.whaleForward);
    this.syncTetherDragState();
    this.syncShipTetherPulls();

    if (this.phase === 'playing') {
      movementResult = this.whaleMovement.update(this.whale, this.input, deltaSeconds, this.sampleOceanHeight);
    }

    this.whale.getForward(this.whaleForward);

    if (this.phase === 'playing' && movementResult) {
      this.resolveWhaleActionResult(movementResult);
      this.syncTetherDragState();
      this.syncShipTetherPulls();
    }

    this.updateTailSlapPresentation(deltaSeconds);

    if (this.phase === 'playing') {
      this.maybeSpawnCorporateWhalerByTimer();
      this.updateFleetAlert();
    }

    this.updateShips(deltaSeconds);
    if (this.phase === 'playing') {
      this.resolveWhaleCapitalInteractions();
    }
    this.updateRescueEncounter(deltaSeconds);
    if (this.phase === 'playing') {
      this.maybeLaunchCorporateRowboats();
      this.resolveWhaleRowboatBodyContacts();
      this.resolveShipShipCollisions();
    }
    this.updateHarpoons(deltaSeconds);
    this.updateCannonballs(deltaSeconds);
    this.clampArenaBodies();
    this.syncTetherDragState();
    this.syncShipTetherPulls();

    if (this.phase === 'playing') {
      this.updateWhaleAir(deltaSeconds);
      this.resolveArenaOutcome();
    }

    const underwaterRatio = this.getUnderwaterRatio();

    this.updateCamera(deltaSeconds, underwaterRatio);
    const surfaceHeightAtCamera = this.sampleOceanHeight(this.camera.position.x, this.camera.position.z);
    const cameraUnderwater = this.camera.position.y < surfaceHeightAtCamera - 0.18;
    this.updateTopsidePassthroughPresentation();
    this.updateAtmosphere(deltaSeconds, underwaterRatio);
    this.updateArenaFogBanks(underwaterRatio);
    this.updateOceanMaterial(underwaterRatio);
    this.breachSplashFx.update(deltaSeconds, this.sampleOceanHeight);
    this.tailSlapShockwaveFx.update(deltaSeconds, underwaterRatio, this.sampleOceanHeight);
    this.shipWakeFx.update({
      deltaSeconds,
      underwaterRatio,
      sampleSurfaceHeight: this.sampleOceanHeight,
      ships: this.ships,
    });
    this.topsideSubsurfaceRevealFx.update({
      underwaterRatio,
      targets: this.collectTopsideRevealTargets(),
    });
    this.readabilityFx.update({
      deltaSeconds,
      elapsedSeconds,
      approxWaterDepth: APPROX_OCEAN_DEPTH,
      camera: this.camera,
      cameraUnderwater,
      whalePosition: this.whale.position,
      whaleSpeed: this.whale.speed,
      underwaterRatio,
      submerged: this.whale.submerged,
      surfaceHeightAtCamera,
      sampleSurfaceHeight: this.sampleOceanHeight,
      moonDirection: this.moonDirection,
      oceanUndersideMesh: this.oceanUndersideMesh,
      ships: this.ships,
    });
    this.updateHud();
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.breachSplashFx.dispose();
    this.tailSlapShockwaveFx.dispose();
    this.shipWakeFx.dispose();
    this.topsideSubsurfaceRevealFx.dispose();
    this.readabilityFx.dispose();
    this.captiveWhale.dispose();
    this.arenaFogBankGeometry.dispose();

    for (const fogBank of this.arenaFogBanks) {
      fogBank.material.dispose();
    }

    this.clearHarpoons();
    this.clearCannonballs();
  }

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

  private createOceanUnderside(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const underside = new THREE.Mesh(this.oceanGeometry, createOceanUndersideMaterial(ARENA_RADIUS));
    underside.renderOrder = -2;
    return underside;
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
    const moonAnchor = this.moonDirection.clone().multiplyScalar(-240);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(320, 18, 18),
      createPainterlySkyMaterial(),
    );

    const moonHalo = new THREE.Mesh(
      new THREE.CircleGeometry(14, 24),
      new THREE.MeshBasicMaterial({
        color: MOON_HALO_COLOR,
        transparent: true,
        opacity: 0.045,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    moonHalo.material.toneMapped = false;
    moonHalo.position.copy(moonAnchor);

    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(8, 20),
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
    silhouette.position.set(122, 26, 178);
    silhouette.rotation.z = 0.06;

    const silhouette2 = silhouette.clone();
    silhouette2.position.set(-144, 24, 136);
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

  private updateOceanMaterial(underwaterRatio: number): void {
    const fog = this.scene.fog as THREE.FogExp2;

    updatePainterlyOceanMaterial(this.oceanMesh, {
      elapsedSeconds: this.elapsedSeconds,
      cameraPosition: this.camera.position,
      fogColor: this.atmosphereColor,
      fogDensity: fog.density,
      moonDirection: this.moonDirection,
      approxWaterDepth: APPROX_OCEAN_DEPTH,
      underwaterRatio,
      lanternInfluences: this.collectOceanLanternInfluences(),
      subsurfaceRevealWindows: this.collectOceanSubsurfaceRevealWindows(),
    });
  }

  private updateArenaFogBanks(underwaterRatio: number): void {
    for (const fogBank of this.arenaFogBanks) {
      updateArenaFogBankMaterial(fogBank.material, {
        atmosphereColor: this.atmosphereColor,
        elapsedSeconds: this.elapsedSeconds,
        underwaterRatio,
      });
    }
  }

  private collectOceanLanternInfluences(): readonly ShipLanternInfluence[] {
    this.oceanLanternInfluences.length = 0;

    for (const ship of this.ships) {
      ship.appendLanternInfluences(this.oceanLanternInfluences);
    }

    this.oceanLanternInfluences.sort(
      (left, right) =>
        left.position.distanceToSquared(this.camera.position) - right.position.distanceToSquared(this.camera.position),
    );

    if (this.oceanLanternInfluences.length > MAX_OCEAN_LANTERN_INFLUENCES) {
      this.oceanLanternInfluences.length = MAX_OCEAN_LANTERN_INFLUENCES;
    }

    return this.oceanLanternInfluences;
  }

  private collectTopsideRevealTargets(): readonly TopsideSubsurfaceRevealTarget[] {
    this.topsideRevealTargets.length = 0;
    this.appendWhaleRevealTarget();

    for (const ship of this.ships) {
      this.appendShipRevealTarget(ship);
    }

    return this.topsideRevealTargets;
  }

  private updateTopsidePassthroughPresentation(): void {
    this.whaleTopsideRevealState = this.evaluateWaterlinePassthrough(this.whale);
    this.whale.setWaterlinePassthrough(this.whaleTopsideRevealState);

    for (const ship of this.ships) {
      const revealState = this.evaluateWaterlinePassthrough(ship);
      this.shipTopsideRevealStates.set(ship.id, revealState);
      ship.setWaterlinePassthrough(revealState);
    }

    if (this.captiveWhale.active) {
      this.captiveWhale.setWaterlinePassthrough(this.evaluateWaterlinePassthrough(this.captiveWhale));
    } else {
      this.captiveWhale.setWaterlinePassthrough(INACTIVE_WATERLINE_PASSTHROUGH_STATE);
    }

    for (const harpoon of this.harpoons) {
      harpoon.setWaterlinePassthrough(
        harpoon.active ? this.evaluateWaterlinePassthrough(harpoon) : INACTIVE_WATERLINE_PASSTHROUGH_STATE,
      );
    }

    for (const cannonball of this.cannonballs) {
      cannonball.setWaterlinePassthrough(
        cannonball.active ? this.evaluateWaterlinePassthrough(cannonball) : INACTIVE_WATERLINE_PASSTHROUGH_STATE,
      );
    }
  }

  private evaluateWaterlinePassthrough(subject: WaterlinePassthroughSubject): ActorTopsideRevealState {
    const actorPosition = subject.getWaterlinePassthroughAnchor(this.tempActorAnchor);
    const actorBounds = subject.getWaterlinePassthroughBounds(this.tempActorBounds);

    return calculateActorTopsideRevealState({
      kind: subject.waterlinePassthroughKind,
      cameraPosition: this.camera.position,
      actorPosition,
      actorBounds,
      sampleSurfaceHeight: this.sampleOceanHeight,
    });
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
    const revealState = this.shipTopsideRevealStates.get(ship.id);

    if (!revealState || revealState.strength <= 0.01) {
      return;
    }

    this.topsideRevealTargets.push({
      kind: 'ship',
      position: this.tempRevealPoint.clone(),
      yaw: ship.heading,
      depthBelowSurface: revealState.depthBelowSurface,
      halfWidth: ship.subsurfaceRevealHalfExtents.x,
      halfLength: ship.subsurfaceRevealHalfExtents.y,
      strength: revealState.strength,
      drawProxy: false,
    });
  }

  private updateShips(deltaSeconds: number): void {
    const rowboatsRemaining = this.getRowboatsRemaining();
    const combatShips = this.getCombatShipsForAI();
    const rescueTowActive = this.rescueEncounterState === 'towed';
    this.shipAiContext.deltaSeconds = deltaSeconds;
    this.shipAiContext.fleetAlerted = this.fleetAlerted;
    this.shipAiContext.otherShips = combatShips;
    this.shipAiContext.rowboatsRemaining = rowboatsRemaining;
    this.shipAiContext.whalePosition.copy(this.whale.position);

    for (const ship of this.ships) {
      const activeHarpoon = this.activeHarpoonsByShipId.get(ship.id);
      this.shipAiContext.shipHasActiveHarpoon = Boolean(activeHarpoon?.active);
      this.shipAiContext.shipHasTether = activeHarpoon?.mode === 'tethered';
      const isTowBoat = rescueTowActive && this.isActiveRescueTowBoat(ship);
      const isCorporateAnchor =
        rescueTowActive &&
        this.corporateShip?.id === ship.id &&
        !ship.sinking &&
        !ship.sunk;

      if (this.phase === 'playing') {
        if (isTowBoat) {
          this.updateRescueTowBoat(ship, deltaSeconds);
        } else if (isCorporateAnchor) {
          this.updateRescueCorporateShip(ship, deltaSeconds);
        } else {
          const aiResult = this.shipAiSystem.update(ship, this.shipAiContext);

          if (aiResult.wantsHarpoonThrow && ship.role === 'rowboat' && !activeHarpoon) {
            this.spawnHarpoon(ship);
          }

          if (aiResult.broadsideTelegraphSide) {
            ship.startBroadsideTelegraph(aiResult.broadsideTelegraphSide);
          }
        }
      }

      const pauseWaterShove = ship.isCapitalShip && this.whale.actionState === 'breach';
      ship.update(deltaSeconds, this.elapsedSeconds, this.sampleOceanHeight, pauseWaterShove);

      if (this.phase === 'playing' && this.whale.actionState === 'swim' && ship.role === 'rowboat') {
        const ramResult = this.damageSystem.resolveRam(this.whale, ship, this.elapsedSeconds);

        if (ramResult) {
          this.impactShake = Math.max(this.impactShake, ramResult.intensity);
        }
      }

      if (this.phase === 'playing') {
        const broadsideSide = ship.consumeBroadsideReady();

        if (broadsideSide) {
          this.spawnBroadside(ship, broadsideSide);
        }
      }

      if (ship.sinking && !ship.scoreAwarded) {
        ship.scoreAwarded = true;
        this.score += ship.scoreValue;
      }
    }
  }

  private isRescueTowBoat(ship: Ship): boolean {
    return this.rescueTowBoatIds.includes(ship.id);
  }

  private isActiveRescueTowBoat(ship: Ship): boolean {
    return this.isRescueTowBoat(ship) && !ship.sinking && !ship.sunk;
  }

  private getAliveRescueTowBoats(): Ship[] {
    return this.rescueTowBoatIds
      .map((shipId) => this.shipById.get(shipId) ?? null)
      .filter((ship): ship is Ship => ship !== null && !ship.sinking && !ship.sunk);
  }

  private getRescueTowBoatLateralOffsets(count: number): readonly number[] {
    if (count <= 1) {
      return [0];
    }

    if (count === 2) {
      return [-2.8, 2.8];
    }

    return [-5.4, 0, 5.4];
  }

  private updateRescueCorporateShip(ship: Ship, deltaSeconds: number): void {
    ship.getForward(this.tempRescueDirection).setY(0);

    if (this.tempRescueDirection.lengthSq() <= 0.0001) {
      this.tempRescueDirection.set(Math.sin(ship.heading), 0, Math.cos(ship.heading));
    } else {
      this.tempRescueDirection.normalize();
    }

    ship.aiState = 'engage';
    ship.travelSpeed = THREE.MathUtils.damp(ship.travelSpeed, RESCUE_CORPORATE_CREEP_SPEED, 2.1, deltaSeconds);
    ship.root.position.addScaledVector(this.tempRescueDirection, ship.travelSpeed * deltaSeconds);
  }

  private updateRescueTowBoat(ship: Ship, deltaSeconds: number): void {
    const corporateShip = this.corporateShip;

    if (!corporateShip || corporateShip.sinking || corporateShip.sunk) {
      return;
    }

    const aliveTowBoats = this.getAliveRescueTowBoats();
    const towBoatIndex = aliveTowBoats.findIndex((candidate) => candidate.id === ship.id);

    if (towBoatIndex < 0) {
      return;
    }

    const slotOffsets = this.getRescueTowBoatLateralOffsets(aliveTowBoats.length);
    corporateShip.getExtractionAnchor(this.tempRescueAnchor);
    corporateShip.getForward(this.tempRescueDirection).setY(0).normalize();
    this.tempRescueLateral.set(-this.tempRescueDirection.z, 0, this.tempRescueDirection.x);

    this.tempRescueTarget
      .copy(this.tempRescueAnchor)
      .addScaledVector(this.tempRescueDirection, RESCUE_TOW_BOAT_TARGET_DISTANCE)
      .addScaledVector(this.tempRescueLateral, slotOffsets[towBoatIndex] ?? 0);

    ship.aiState = 'close';
    this.steerShipDirect(ship, this.tempRescueTarget, this.getRescueTowSpeed(aliveTowBoats.length), deltaSeconds);
  }

  private getRescueTowSpeed(aliveTowBoatCount: number): number {
    if (aliveTowBoatCount <= 1) {
      return 2.2;
    }

    if (aliveTowBoatCount === 2) {
      return 3.2;
    }

    return 4.3;
  }

  private steerShipDirect(ship: Ship, targetPosition: THREE.Vector3, desiredSpeed: number, deltaSeconds: number): void {
    this.tempShipVector.copy(targetPosition).sub(ship.root.position).setY(0);
    const hasTarget = this.tempShipVector.lengthSq() > 0.25;
    const desiredHeading = hasTarget ? Math.atan2(this.tempShipVector.x, this.tempShipVector.z) : ship.heading;
    const headingDelta =
      THREE.MathUtils.euclideanModulo(desiredHeading - ship.heading + Math.PI, Math.PI * 2) - Math.PI;
    const turnStep = ship.turnRate * deltaSeconds;
    ship.heading += THREE.MathUtils.clamp(headingDelta, -turnStep, turnStep);
    ship.travelSpeed = THREE.MathUtils.damp(ship.travelSpeed, desiredSpeed, 2.6, deltaSeconds);
    ship.root.position.x += Math.sin(ship.heading) * ship.travelSpeed * deltaSeconds;
    ship.root.position.z += Math.cos(ship.heading) * ship.travelSpeed * deltaSeconds;
  }

  private updateHarpoons(deltaSeconds: number): void {
    for (let index = this.harpoons.length - 1; index >= 0; index -= 1) {
      const harpoon = this.harpoons[index];
      const owner = this.shipById.get(harpoon.ownerShipId);

      if (!owner || owner.sinking || owner.sunk) {
        this.removeHarpoon(index);
        continue;
      }

      harpoon.update(deltaSeconds);

      if (harpoon.mode === 'flying') {
        if (
          !harpoon.active ||
          harpoon.ageSeconds > HARPOON_LIFETIME ||
          Math.hypot(harpoon.position.x, harpoon.position.z) > ARENA_RADIUS * 1.18
        ) {
          this.removeHarpoon(index);
          continue;
        }

        if (
          this.phase === 'playing' &&
          harpoon.position.distanceTo(this.whale.position) <= this.whale.radius + harpoon.radius
        ) {
          this.getWhaleTetherAttachPoint(this.tempAttachPoint);
          harpoon.attach(this.tempAttachPoint);
          this.impactShake = Math.max(this.impactShake, 0.08);
        }

        continue;
      }

      this.getWhaleTetherAttachPoint(this.tempAttachPoint);
      owner.getHarpoonOrigin(this.tempShipOrigin);

      const tensionAlpha = this.getTetherTensionAlpha(harpoon, this.tempShipOrigin, this.tempAttachPoint);
      harpoon.updateTether(this.tempShipOrigin, this.tempAttachPoint, tensionAlpha);
      owner.setTetherPull(this.computeTetherPull(tensionAlpha));

      if (this.phase !== 'playing') {
        continue;
      }

      if (this.damageSystem.updateDragUnder(this.whale, owner, true, deltaSeconds, tensionAlpha)) {
        this.impactShake = Math.max(this.impactShake, 0.36);
        this.removeHarpoon(index);
        continue;
      }

      const tetherLength = harpoon.getTetherLength(this.tempShipOrigin, this.tempAttachPoint);
      const snapped = tetherLength > harpoon.maxTetherLength && this.whale.speed > TETHER_SNAP_SPEED;

      if (snapped) {
        this.impactShake = Math.max(this.impactShake, 0.14);
        this.removeHarpoon(index);
      }
    }
  }

  private updateCannonballs(deltaSeconds: number): void {
    for (let index = this.cannonballs.length - 1; index >= 0; index -= 1) {
      const cannonball = this.cannonballs[index];
      cannonball.update(deltaSeconds);

      if (
        !cannonball.active ||
        cannonball.ageSeconds > CANNONBALL_LIFETIME ||
        Math.hypot(cannonball.position.x, cannonball.position.z) > ARENA_RADIUS * 1.24 ||
        cannonball.position.y < -18
      ) {
        this.removeCannonball(index);
        continue;
      }

      const directHit = cannonball.position.distanceTo(this.whale.position) <= this.whale.radius + cannonball.radius;
      const surfaceHeight = this.sampleOceanHeight(cannonball.position.x, cannonball.position.z);
      const hitsWater = cannonball.position.y <= surfaceHeight + 0.12;

      if (!directHit && !hitsWater) {
        continue;
      }

      if (this.phase === 'playing') {
        if (directHit) {
          this.tempImpactPoint.copy(cannonball.position);
        } else {
          this.tempImpactPoint.set(cannonball.position.x, surfaceHeight, cannonball.position.z);
        }

        const hitResult = this.damageSystem.resolveCannonSplash(
          this.whale,
          this.tempImpactPoint,
          cannonball.splashRadius,
          cannonball.damage,
        );

        if (hitResult) {
          this.impactShake = Math.max(this.impactShake, hitResult.intensity);
        }
      }

      this.removeCannonball(index);
    }
  }

  private resolveWhaleActionResult(result: WhaleMovementResult): void {
    if (result.breachStarted) {
      this.clearTailSlapPresentation();
      this.breachCameraTransitionActive = true;
      this.breachCameraHeading = Math.atan2(this.whaleForward.x, this.whaleForward.z);
      this.impactShake = Math.max(this.impactShake, 0.12);
      this.capitalBreachedThisArc.clear();
      this.breachLaunchShipIds.clear();
      this.tempImpactPoint.set(
        this.whale.breachOrigin.x,
        this.sampleOceanHeight(this.whale.breachOrigin.x, this.whale.breachOrigin.z),
        this.whale.breachOrigin.z,
      );
      this.breachSplashFx.spawnLaunch(this.tempImpactPoint, this.getBreachSplashIntensity());
    }

    if (this.whale.actionState === 'breach' && this.whale.verticalSpeed > 0) {
      this.resolveBreachLaunchHits();
    }

    if (result.breachImpact) {
      this.breachSplashFx.spawnReentry(result.breachImpact.position, this.getBreachSplashIntensity());

      for (const ship of this.ships) {
        if (ship.isCapitalShip && this.capitalBreachedThisArc.has(ship.id)) {
          continue;
        }

        const hitResult = this.damageSystem.resolveBreachSlam(
          ship,
          result.breachImpact.position,
          result.breachImpact.innerRadius,
          result.breachImpact.outerRadius,
        );

        if (!hitResult) {
          continue;
        }

        this.impactShake = Math.max(this.impactShake, hitResult.intensity);

        if (ship.role === 'rowboat') {
          this.removeHarpoonByShipId(ship.id);
        } else {
          this.capitalBreachedThisArc.add(ship.id);
        }
      }

      this.breachLaunchShipIds.clear();
    }

    if (result.tailSlap) {
      this.whale.resolveTailSlapVisual();
      this.tailSlapShockwaveFx.spawnImpact(
        result.tailSlap.origin,
        result.tailSlap.direction,
        result.tailSlap.innerRadius,
        result.tailSlap.outerRadius,
        result.tailSlap.halfAngle,
      );
      this.impactShake = Math.max(this.impactShake, 0.14);

      for (const ship of this.ships) {
        const hitResult = this.damageSystem.resolveTailSlap(
          ship,
          result.tailSlap.origin,
          result.tailSlap.direction,
          result.tailSlap.innerRadius,
          result.tailSlap.outerRadius,
          result.tailSlap.halfAngle,
        );

        if (!hitResult) {
          continue;
        }

        this.impactShake = Math.max(this.impactShake, hitResult.intensity);

        if (ship.role === 'rowboat') {
          this.removeHarpoonByShipId(ship.id);
        }
      }
    }

    if (this.whale.actionState !== 'breach') {
      this.capitalBreachedThisArc.clear();
      this.breachLaunchShipIds.clear();
    }
  }

  private updateTailSlapPresentation(deltaSeconds: number): void {
    if (this.whale.actionState === 'breach') {
      this.clearTailSlapPresentation();
      this.whale.updateVisual(deltaSeconds);
      return;
    }

    const tailSlapActive = this.whale.actionState === 'tail_slap';

    if (tailSlapActive) {
      this.whale.getTailSlapAnchor(this.tempTailSlapAnchor);

      if (!this.tailSlapPresentationActive) {
        this.tailSlapPresentationActive = true;
        this.whale.startTailSlapVisual();
        this.tailSlapShockwaveFx.startTelegraph(this.tempTailSlapAnchor, this.whaleForward);
      } else {
        this.tailSlapShockwaveFx.updateTelegraph(this.tempTailSlapAnchor, this.whaleForward);
      }
    } else if (this.tailSlapPresentationActive) {
      this.tailSlapPresentationActive = false;
      this.tailSlapShockwaveFx.clearTelegraph();
      this.whale.beginTailSlapVisualRecovery();
    }

    this.whale.updateVisual(deltaSeconds);
  }

  private clearTailSlapPresentation(): void {
    if (this.tailSlapPresentationActive) {
      this.tailSlapPresentationActive = false;
      this.tailSlapShockwaveFx.clearTelegraph();
    }

    this.whale.clearTailSlapVisual();
  }

  private getBreachSplashIntensity(): number {
    return THREE.MathUtils.clamp((this.whale.breachSpeed - 13) / 12, 0, 1);
  }

  private resolveBreachLaunchHits(): void {
    for (const ship of this.ships) {
      if (ship.role === 'rowboat' && this.breachLaunchShipIds.has(ship.id)) {
        continue;
      }

      if (ship.isCapitalShip && this.capitalBreachedThisArc.has(ship.id)) {
        continue;
      }

      const hitResult = this.damageSystem.resolveBreachLaunch(this.whale, ship);

      if (!hitResult) {
        continue;
      }

      this.impactShake = Math.max(this.impactShake, hitResult.intensity);

      if (ship.role === 'rowboat') {
        this.breachLaunchShipIds.add(ship.id);
        this.removeHarpoonByShipId(ship.id);
      } else {
        this.capitalBreachedThisArc.add(ship.id);
      }
    }
  }

  private spawnHarpoon(ship: Ship): void {
    const harpoon = new Harpoon(ship.id);
    const origin = ship.getHarpoonOrigin(this.tempTargetPoint);
    const target = this.tempHarpoonDirection.copy(this.whale.position);
    const harpoonLead = THREE.MathUtils.clamp(this.whale.speed * 0.18, 0, WHALE_SPEED_PROFILE.harpoonLeadClamp);

    if (harpoonLead > 0.001 && this.whale.travelVelocity.lengthSq() > 0.0001) {
      this.tempLaunchDirection.copy(this.whale.travelVelocity).normalize();
      target.addScaledVector(this.tempLaunchDirection, harpoonLead);
    }

    target.y += 0.35;
    target.sub(origin);

    harpoon.launch(origin, target.normalize(), HARPOON_SPEED);
    ship.markHarpoonFired();

    this.harpoons.push(harpoon);
    this.activeHarpoonsByShipId.set(ship.id, harpoon);
    this.scene.add(harpoon.root);
  }

  private spawnBroadside(ship: Ship, side: 'port' | 'starboard'): void {
    const origins = ship.getBroadsideOrigins(side);
    ship.getForward(this.tempShipForward);

    for (let index = 0; index < origins.length; index += 1) {
      const origin = origins[index];
      const spread = index - (origins.length - 1) * 0.5;
      const cannonball = new Cannonball();
      const target = this.tempTargetPoint.copy(this.whale.position);
      const cannonLead = THREE.MathUtils.clamp(this.whale.speed * 0.55, 0, WHALE_SPEED_PROFILE.cannonLeadClamp);

      if (cannonLead > 0.001 && this.whale.travelVelocity.lengthSq() > 0.0001) {
        this.tempLaunchDirection.copy(this.whale.travelVelocity).normalize();
        target.addScaledVector(this.tempLaunchDirection, cannonLead);
      }

      target.addScaledVector(this.tempShipForward, spread * 2.2);

      this.tempCannonVelocity.copy(target).sub(origin);
      this.tempCannonVelocity.normalize().multiplyScalar(CANNONBALL_SPEED);
      this.tempCannonVelocity.y += 4.4 + Math.abs(spread) * 0.3;

      cannonball.launch(origin, this.tempCannonVelocity, ship.attackDamage, CANNON_SPLASH_RADIUS);
      this.cannonballs.push(cannonball);
      this.scene.add(cannonball.root);
    }

    this.impactShake = Math.max(this.impactShake, 0.12);
  }

  private removeHarpoon(index: number): void {
    const harpoon = this.harpoons[index];
    this.activeHarpoonsByShipId.delete(harpoon.ownerShipId);
    harpoon.deactivate();
    this.harpoons.splice(index, 1);
  }

  private removeHarpoonByShipId(shipId: string): void {
    const harpoon = this.activeHarpoonsByShipId.get(shipId);

    if (!harpoon) {
      return;
    }

    const index = this.harpoons.indexOf(harpoon);

    if (index >= 0) {
      this.removeHarpoon(index);
      return;
    }

    this.activeHarpoonsByShipId.delete(shipId);
    harpoon.deactivate();
  }

  private clearHarpoons(): void {
    for (const harpoon of this.harpoons) {
      harpoon.deactivate();
    }

    this.harpoons.length = 0;
    this.activeHarpoonsByShipId.clear();
  }

  private removeCannonball(index: number): void {
    const cannonball = this.cannonballs[index];
    cannonball.deactivate();
    this.cannonballs.splice(index, 1);
  }

  private clearCannonballs(): void {
    for (const cannonball of this.cannonballs) {
      cannonball.deactivate();
    }

    this.cannonballs.length = 0;
  }

  private syncTetherDragState(): void {
    this.activeTethers = this.harpoons.filter((harpoon) => harpoon.active && harpoon.mode === 'tethered').length;
    this.whale.setTetherDrag(this.activeTethers);
  }

  private syncShipTetherPulls(): void {
    for (const ship of this.ships) {
      const harpoon = this.activeHarpoonsByShipId.get(ship.id);

      if (!harpoon || !harpoon.active || harpoon.mode !== 'tethered' || ship.sinking || ship.sunk) {
        ship.setTetherPull(0);
        continue;
      }

      this.getWhaleTetherAttachPoint(this.tempAttachPoint);
      ship.getHarpoonOrigin(this.tempShipOrigin);
      ship.setTetherPull(this.computeTetherPull(this.getTetherTensionAlpha(harpoon, this.tempShipOrigin, this.tempAttachPoint)));
    }
  }

  private getWhaleTetherAttachPoint(target: THREE.Vector3): THREE.Vector3 {
    return this.whale.getTetherAttachPoint(target);
  }

  private getTetherTensionAlpha(harpoon: Harpoon, shipOrigin: THREE.Vector3, attachPoint: THREE.Vector3): number {
    const tensionStart = 12;
    return THREE.MathUtils.clamp(
      (harpoon.getTetherLength(shipOrigin, attachPoint) - tensionStart) / (harpoon.maxTetherLength - tensionStart),
      0,
      1,
    );
  }

  private computeTetherPull(tensionAlpha: number): number {
    const depthPull = Math.max(0, -this.whale.depth - 1.2) * 0.12;
    return THREE.MathUtils.clamp(depthPull + tensionAlpha * 1.15, 0, 2.4);
  }

  private resolveWhaleCapitalInteractions(): void {
    for (const ship of this.ships) {
      if (!ship.isCapitalShip) {
        continue;
      }

      const interaction = this.damageSystem.resolveCapitalInteraction(this.whale, ship, this.elapsedSeconds);

      if (interaction?.kind === 'ram_hit') {
        this.impactShake = Math.max(this.impactShake, interaction.intensity);
      }
    }
  }

  private resolveWhaleRowboatBodyContacts(): void {
    for (const ship of this.ships) {
      if (ship.role !== 'rowboat') {
        continue;
      }

      this.damageSystem.resolveBodyContact(this.whale, ship);
    }
  }

  private resolveShipShipCollisions(): void {
    const activeShips = this.ships.filter((ship) => !ship.sinking && !ship.sunk);

    if (activeShips.length <= 1) {
      return;
    }

    for (let iteration = 0; iteration < 2; iteration += 1) {
      for (let index = 0; index < activeShips.length - 1; index += 1) {
        const shipA = activeShips[index];

        for (let otherIndex = index + 1; otherIndex < activeShips.length; otherIndex += 1) {
          this.resolveShipPairCollision(shipA, activeShips[otherIndex]);
        }
      }
    }

    for (const ship of activeShips) {
      ship.root.updateMatrixWorld();
    }
  }

  private resolveShipPairCollision(shipA: Ship, shipB: Ship): void {
    shipA.getCollisionHalfExtentsXZ(this.tempCollisionHalfExtentsA);
    shipB.getCollisionHalfExtentsXZ(this.tempCollisionHalfExtentsB);
    this.setCollisionAxes(shipA, this.tempCollisionAxisA0, this.tempCollisionAxisA1);
    this.setCollisionAxes(shipB, this.tempCollisionAxisB0, this.tempCollisionAxisB1);
    this.tempCollisionDelta.set(
      shipB.root.position.x - shipA.root.position.x,
      shipB.root.position.z - shipA.root.position.z,
    );

    const aHalfWidth = this.tempCollisionHalfExtentsA.x;
    const aHalfLength = this.tempCollisionHalfExtentsA.y;
    const bHalfWidth = this.tempCollisionHalfExtentsB.x;
    const bHalfLength = this.tempCollisionHalfExtentsB.y;
    const epsilon = 0.0001;

    const tA0 = this.tempCollisionDelta.dot(this.tempCollisionAxisA0);
    const tA1 = this.tempCollisionDelta.dot(this.tempCollisionAxisA1);
    const r00 = this.tempCollisionAxisA0.dot(this.tempCollisionAxisB0);
    const r01 = this.tempCollisionAxisA0.dot(this.tempCollisionAxisB1);
    const r10 = this.tempCollisionAxisA1.dot(this.tempCollisionAxisB0);
    const r11 = this.tempCollisionAxisA1.dot(this.tempCollisionAxisB1);
    const absR00 = Math.abs(r00) + epsilon;
    const absR01 = Math.abs(r01) + epsilon;
    const absR10 = Math.abs(r10) + epsilon;
    const absR11 = Math.abs(r11) + epsilon;
    let minOverlap = Number.POSITIVE_INFINITY;

    const testAxis = (axis: THREE.Vector2, distance: number, radiusA: number, radiusB: number): boolean => {
      const overlap = radiusA + radiusB - Math.abs(distance);

      if (overlap <= 0) {
        return false;
      }

      if (overlap < minOverlap) {
        minOverlap = overlap;
        this.tempCollisionNormal.copy(axis).multiplyScalar(distance < 0 ? -1 : 1);
      }

      return true;
    };

    if (
      !testAxis(this.tempCollisionAxisA0, tA0, aHalfWidth, bHalfWidth * absR00 + bHalfLength * absR01) ||
      !testAxis(this.tempCollisionAxisA1, tA1, aHalfLength, bHalfWidth * absR10 + bHalfLength * absR11)
    ) {
      return;
    }

    const tB0 = this.tempCollisionDelta.dot(this.tempCollisionAxisB0);
    const tB1 = this.tempCollisionDelta.dot(this.tempCollisionAxisB1);

    if (
      !testAxis(this.tempCollisionAxisB0, tB0, aHalfWidth * absR00 + aHalfLength * absR10, bHalfWidth) ||
      !testAxis(this.tempCollisionAxisB1, tB1, aHalfWidth * absR01 + aHalfLength * absR11, bHalfLength)
    ) {
      return;
    }

    const correction = minOverlap + 0.02;
    const massA = shipA.getCollisionMass();
    const massB = shipB.getCollisionMass();
    const totalMass = massA + massB;
    const moveA = correction * (massB / totalMass);
    const moveB = correction * (massA / totalMass);

    shipA.root.position.x -= this.tempCollisionNormal.x * moveA;
    shipA.root.position.z -= this.tempCollisionNormal.y * moveA;
    shipB.root.position.x += this.tempCollisionNormal.x * moveB;
    shipB.root.position.z += this.tempCollisionNormal.y * moveB;

    const penetrationAlpha = THREE.MathUtils.clamp(correction / 4.5, 0, 1);
    const baseShove = THREE.MathUtils.lerp(0.24, 1.1, penetrationAlpha);
    this.tempShipVector.set(-this.tempCollisionNormal.x, 0, -this.tempCollisionNormal.y);
    shipA.applyWaterShove(
      this.tempShipVector,
      baseShove * (massB / totalMass),
      this.getCollisionYawStrength(shipA, -this.tempCollisionNormal.x, -this.tempCollisionNormal.y),
    );
    this.tempShipVector.set(this.tempCollisionNormal.x, 0, this.tempCollisionNormal.y);
    shipB.applyWaterShove(
      this.tempShipVector,
      baseShove * (massA / totalMass),
      this.getCollisionYawStrength(shipB, this.tempCollisionNormal.x, this.tempCollisionNormal.y),
    );

    if (this.tempCollisionAxisA1.dot(this.tempCollisionAxisB1) <= -0.6) {
      shipA.travelSpeed *= 0.85;
      shipB.travelSpeed *= 0.85;
    }
  }

  private setCollisionAxes(ship: Ship, rightTarget: THREE.Vector2, forwardTarget: THREE.Vector2): void {
    forwardTarget.set(Math.sin(ship.heading), Math.cos(ship.heading));
    rightTarget.set(forwardTarget.y, -forwardTarget.x);
  }

  private getCollisionYawStrength(ship: Ship, pushX: number, pushZ: number): number {
    const forwardX = Math.sin(ship.heading);
    const forwardZ = Math.cos(ship.heading);
    const rightX = forwardZ;
    const rightZ = -forwardX;
    const lateral = pushX * rightX + pushZ * rightZ;
    const longitudinal = Math.abs(pushX * forwardX + pushZ * forwardZ);
    const lateralAlpha = THREE.MathUtils.clamp(Math.abs(lateral) - longitudinal * 0.35, 0, 1);

    if (lateralAlpha <= 0.05) {
      return 0;
    }

    return Math.sign(lateral) * THREE.MathUtils.lerp(0.006, 0.024, lateralAlpha);
  }

  private clampArenaBodies(): void {
    this.clampWhaleToArena();

    for (const ship of this.ships) {
      this.clampShipToArena(ship);
    }
  }

  private clampWhaleToArena(): void {
    const radius = Math.hypot(this.whale.position.x, this.whale.position.z);
    const maxRadius = ARENA_RADIUS - this.whale.radius - WHALE_BOUNDARY_MARGIN;

    if (radius <= maxRadius || radius <= 0.0001) {
      return;
    }

    const clampScale = maxRadius / radius;
    this.whale.position.x *= clampScale;
    this.whale.position.z *= clampScale;

    this.tempBoundaryVector.set(this.whale.position.x, 0, this.whale.position.z).normalize();
    this.tempShipVector.copy(this.whale.travelVelocity).setY(0);

    if (this.tempShipVector.dot(this.tempBoundaryVector) > 0) {
      this.whale.scaleTravelMotion(0.72);
      const outwardDrift = this.whale.ramDriftVelocity.dot(this.tempBoundaryVector);

      if (outwardDrift > 0) {
        this.whale.ramDriftVelocity.addScaledVector(this.tempBoundaryVector, -outwardDrift);
      }

      this.whale.syncTravelState();
    }

    const surfaceHeight = this.sampleOceanHeight(this.whale.position.x, this.whale.position.z);
    this.whale.position.y = surfaceHeight + this.whale.depth;
  }

  private clampShipToArena(ship: Ship): void {
    const radius = Math.hypot(ship.root.position.x, ship.root.position.z);
    const hullRadius = Math.max(ship.halfExtents.x, ship.halfExtents.z) * 0.42;
    const maxRadius = ARENA_RADIUS - hullRadius - SHIP_BOUNDARY_MARGIN;

    if (radius <= maxRadius || radius <= 0.0001) {
      return;
    }

    const clampScale = maxRadius / radius;
    ship.root.position.x *= clampScale;
    ship.root.position.z *= clampScale;

    this.tempBoundaryVector.set(ship.root.position.x, 0, ship.root.position.z).normalize();
    ship.heading = Math.atan2(-this.tempBoundaryVector.x, -this.tempBoundaryVector.z);
    ship.root.rotation.y = ship.heading;
    ship.travelSpeed *= 0.58;
    ship.root.updateMatrixWorld();
  }

  private addShip(ship: Ship): void {
    this.ships.push(ship);
    this.shipById.set(ship.id, ship);
    ship.setSubmergedReadabilityCue(0);
    ship.setTetherPull(0);
    this.scene.add(ship.root);
  }

  private removeDynamicShipsForReset(): void {
    for (let index = this.ships.length - 1; index >= 0; index -= 1) {
      const ship = this.ships[index];

      if (this.initialShipIds.has(ship.id)) {
        continue;
      }

      this.removeHarpoonByShipId(ship.id);
      ship.root.removeFromParent();
      this.shipById.delete(ship.id);
      this.ships.splice(index, 1);
    }
  }

  private getInitialFleetRemaining(): number {
    return this.ships.filter((ship) => this.initialShipIds.has(ship.id) && !ship.sinking).length;
  }

  private getRowboatsRemaining(): number {
    return this.ships.filter((ship) => ship.role === 'rowboat' && !ship.sinking).length;
  }

  private getCombatShipsForAI(): Ship[] {
    return this.ships.filter((ship) => !this.isRescueTowBoat(ship) && !ship.sinking && !ship.sunk);
  }

  private updateFleetAlert(): void {
    if (this.fleetAlerted) {
      return;
    }

    for (const ship of this.ships) {
      if (ship.sinking || ship.sunk || this.isRescueTowBoat(ship)) {
        continue;
      }

      const alertRadius = Math.max(72, ship.holdRangeMax + 12);

      if (ship.root.position.distanceTo(this.whale.position) <= alertRadius) {
        this.fleetAlerted = true;
        this.shipAiContext.fleetAlerted = true;
        return;
      }
    }
  }

  private maybeSpawnCorporateWhalerByTimer(): void {
    if (this.corporateArrivalState !== 'pending' || this.elapsedSeconds < CORPORATE_ARRIVAL_TIME) {
      return;
    }

    this.spawnCorporateWhaler();
  }

  private spawnCorporateWhaler(): void {
    if (this.corporateArrivalState !== 'pending') {
      return;
    }

    this.tempSpawnDirection.set(this.whale.position.x, 0, this.whale.position.z);

    if (this.tempSpawnDirection.lengthSq() <= 4) {
      this.tempSpawnDirection.set(0, 0, -1);
    } else {
      this.tempSpawnDirection.normalize().multiplyScalar(-1);
    }

    const spawnRadius = ARENA_RADIUS * 0.82;
    const spawnPosition = new THREE.Vector3(
      this.tempSpawnDirection.x * spawnRadius,
      0.8,
      this.tempSpawnDirection.z * spawnRadius,
    );
    const initialHeading = Math.atan2(-spawnPosition.x, -spawnPosition.z);
    const ship = new Ship({
      id: CORPORATE_SHIP_ID,
      role: 'corporate_whaler',
      position: spawnPosition,
      initialHeading,
    });

    this.addShip(ship);
    this.corporateShip = ship;
    this.corporateArrivalState = 'active';
    this.beginRescueEncounter(ship);
  }

  private maybeLaunchCorporateRowboats(): void {
    if (
      this.corporateArrivalState !== 'active' ||
      this.corporateRowboatsLaunched ||
      this.rescueEncounterState === 'towed' ||
      !this.corporateShip ||
      this.corporateShip.sinking ||
      this.corporateShip.sunk
    ) {
      return;
    }

    if (this.corporateShip.root.position.distanceTo(this.whale.position) > CORPORATE_PROXIMITY_TRIGGER) {
      return;
    }

    this.spawnCorporateRowboats(this.corporateShip);
    this.corporateRowboatsLaunched = true;
  }

  private spawnCorporateRowboats(source: Ship): void {
    const launchOrigins = source.getReinforcementLaunchOrigins();

    for (const origin of launchOrigins) {
      const id = `${CORPORATE_ROWBOAT_ID_PREFIX}-${this.nextCorporateRowboatIndex}`;
      this.nextCorporateRowboatIndex += 1;
      this.tempLaunchDirection.copy(origin).sub(source.root.position).setY(0);

      if (this.tempLaunchDirection.lengthSq() <= 0.0001) {
        this.tempLaunchDirection.set(Math.sin(source.heading), 0, Math.cos(source.heading));
      } else {
        this.tempLaunchDirection.normalize();
      }

      const ship = new Ship({
        id,
        role: 'rowboat',
        position: new THREE.Vector3(origin.x, 0.8, origin.z),
        initialHeading: Math.atan2(this.tempLaunchDirection.x, this.tempLaunchDirection.z),
      });

      this.addShip(ship);
    }
  }

  private beginRescueEncounter(corporateShip: Ship): void {
    this.rescueEncounterState = 'towed';
    this.rescueTowBoatIds = [];
    corporateShip.getForward(this.tempRescueDirection).setY(0).normalize();
    this.tempRescueLateral.set(-this.tempRescueDirection.z, 0, this.tempRescueDirection.x);

    const towHeading = Math.atan2(-this.tempRescueDirection.x, -this.tempRescueDirection.z);
    const spawnOffsets = this.getRescueTowBoatLateralOffsets(RESCUE_TOW_BOAT_COUNT);

    for (let index = 0; index < RESCUE_TOW_BOAT_COUNT; index += 1) {
      const shipId = `${RESCUE_TOW_BOAT_ID_PREFIX}-${index}`;
      this.tempRescueTarget
        .copy(corporateShip.root.position)
        .addScaledVector(this.tempRescueDirection, RESCUE_TOW_BOAT_START_DISTANCE)
        .addScaledVector(this.tempRescueLateral, spawnOffsets[index] ?? 0);

      const towBoat = new Ship({
        id: shipId,
        role: 'rowboat',
        position: new THREE.Vector3(this.tempRescueTarget.x, 0.8, this.tempRescueTarget.z),
        initialHeading: towHeading,
      });

      this.addShip(towBoat);
      this.rescueTowBoatIds.push(shipId);
    }

    this.captiveWhale.beginTow();
    this.updateTowedCaptiveWhale(this.getAliveRescueTowBoats(), RESCUE_SPAWN_DELTA_SECONDS);
    corporateShip.getExtractionAnchor(this.tempRescueAnchor);
    this.rescueInitialExtractionDistance = Math.max(
      this.captiveWhale.position.distanceTo(this.tempRescueAnchor),
      0.001,
    );
  }

  private updateRescueEncounter(deltaSeconds: number): void {
    if (this.rescueEncounterState === 'inactive' || this.rescueEncounterState === 'complete') {
      return;
    }

    if (this.rescueEncounterState === 'towed') {
      if (!this.corporateShip || this.corporateShip.sinking || this.corporateShip.sunk) {
        this.startRescueEscape();
        return;
      }

      const aliveTowBoats = this.getAliveRescueTowBoats();

      if (aliveTowBoats.length <= 0) {
        this.startRescueEscape();
        return;
      }

      this.updateTowedCaptiveWhale(aliveTowBoats, deltaSeconds);
      this.corporateShip.getExtractionAnchor(this.tempRescueAnchor);

      if (this.captiveWhale.position.distanceTo(this.tempRescueAnchor) <= RESCUE_CONVOY_CAPTURE_RADIUS) {
        this.failRescueEncounter();
      }
      return;
    }

    this.captiveWhale.update(deltaSeconds, this.elapsedSeconds, this.sampleOceanHeight);

    if (this.captiveWhale.state === 'gone') {
      this.rescueEncounterState = 'complete';
    }
  }

  private updateTowedCaptiveWhale(towBoats: readonly Ship[], deltaSeconds: number): void {
    if (!this.corporateShip || towBoats.length <= 0) {
      return;
    }

    for (let index = 0; index < towBoats.length; index += 1) {
      towBoats[index].getTowAnchorOrigin(this.rescueTowOrigins[index]);
    }

    this.corporateShip.getExtractionAnchor(this.tempRescueAnchor);
    this.tempRescueDirection.copy(this.tempRescueAnchor).sub(this.captiveWhale.position).setY(0);

    if (this.tempRescueDirection.lengthSq() <= 0.0001) {
      this.corporateShip.getForward(this.tempRescueDirection).setY(0).normalize();
      this.tempRescueDirection.multiplyScalar(-1);
    } else {
      this.tempRescueDirection.normalize();
    }

    this.captiveWhale.updateTow({
      deltaSeconds,
      elapsedSeconds: this.elapsedSeconds,
      towOrigins: this.rescueTowOrigins.slice(0, towBoats.length),
      towDirection: this.tempRescueDirection,
      sampleSurfaceHeight: this.sampleOceanHeight,
    });
  }

  private startRescueEscape(): void {
    if (this.rescueEncounterState !== 'towed') {
      return;
    }

    this.rescueEncounterState = 'escaping';
    this.rescueTowBoatIds = [];

    if (!this.corporateShip) {
      this.captiveWhale.release(this.tempRescueDirection.set(0, 0, -1));
      return;
    }

    this.tempRescueDirection.copy(this.captiveWhale.position).sub(this.corporateShip.root.position).setY(0);

    if (this.tempRescueDirection.lengthSq() <= 0.0001) {
      this.corporateShip.getForward(this.tempRescueDirection).setY(0).normalize();
    } else {
      this.tempRescueDirection.normalize();
    }

    this.captiveWhale.release(this.tempRescueDirection);
  }

  private failRescueEncounter(): void {
    if (this.rescueEncounterState !== 'towed') {
      return;
    }

    this.rescueEncounterState = 'failed';

    if (this.corporateShip) {
      this.corporateShip.getExtractionAnchor(this.tempRescueAnchor);
      this.captiveWhale.capture(this.tempRescueAnchor);

      if (!this.corporateRowboatsLaunched && !this.corporateShip.sinking && !this.corporateShip.sunk) {
        this.spawnCorporateRowboats(this.corporateShip);
        this.corporateRowboatsLaunched = true;
      }
    } else {
      this.captiveWhale.capture(this.tempRescueAnchor.set(this.captiveWhale.position.x, this.captiveWhale.position.y, this.captiveWhale.position.z));
    }

    for (const towBoat of this.getAliveRescueTowBoats()) {
      towBoat.anchor.copy(towBoat.root.position);
    }

    this.rescueTowBoatIds = [];
  }

  private resolveArenaOutcome(): void {
    if (this.whale.health <= 0) {
      this.phase = 'defeat';
      return;
    }

    if (this.corporateArrivalState === 'pending' && this.getInitialFleetRemaining() <= 0) {
      this.spawnCorporateWhaler();
      return;
    }

    if (this.corporateShip && this.corporateShip.sinking) {
      this.corporateArrivalState = 'defeated';
    }

    const fleetRemaining = this.ships.filter((ship) => !ship.sinking).length;

    if (fleetRemaining <= 0 && this.corporateArrivalState !== 'pending') {
      this.phase = 'victory';
    }
  }

  private updateWhaleAir(deltaSeconds: number): void {
    if (this.whale.submerged) {
      this.whale.consumeAir(AIR_DRAIN_PER_SECOND * deltaSeconds);

      if (this.whale.air <= 0) {
        this.whale.applyDamage(SUFFOCATION_DAMAGE_PER_SECOND * deltaSeconds);
        this.impactShake = Math.max(this.impactShake, 0.08);
      }
      return;
    }

    this.whale.restoreAir(AIR_RECOVERY_PER_SECOND * deltaSeconds);
  }

  private updateCamera(deltaSeconds: number, underwaterRatio: number): void {
    this.whaleRight.set(1, 0, 0).applyQuaternion(this.whale.root.quaternion).normalize();

    // Tuning note: tethered rowboats need to stay readable in-frame, so the
    // chase camera opens up as lines stack instead of staying tightly hero-shot.
    const tetherZoomAlpha = THREE.MathUtils.clamp(this.activeTethers / 4, 0, 1);
    const breachArcAlpha =
      this.whale.actionState === 'breach'
        ? Math.sin(THREE.MathUtils.clamp(this.whale.breachTime / 1.45, 0, 1) * Math.PI)
        : 0;
    const tailSlapActive = this.whale.actionState === 'tail_slap';

    if (this.whale.actionState === 'breach') {
      this.breachCameraTransitionActive = true;
      this.breachCameraBlend = Math.min(1, this.breachCameraBlend + deltaSeconds / 0.12);
    } else if (this.breachCameraTransitionActive) {
      this.breachCameraBlend = Math.max(0, this.breachCameraBlend - deltaSeconds / 0.18);

      if (this.breachCameraBlend <= 0.0001) {
        this.breachCameraBlend = 0;
        this.breachCameraTransitionActive = false;
      }
    }

    if (this.whale.actionState === 'breach') {
      this.tailSlapCameraHoldTimer = 0;
      this.tailSlapCameraBlend = 0;
      this.tailSlapCameraActive = false;
    } else {
      if (tailSlapActive && !this.tailSlapCameraWasActive) {
        this.captureTailSlapCameraHeading();
        this.tailSlapCameraActive = true;
        this.tailSlapCameraHoldTimer = TAIL_SLAP_CAMERA_POST_HOLD;
      }

      if (this.tailSlapCameraActive) {
        if (tailSlapActive) {
          this.tailSlapCameraHoldTimer = TAIL_SLAP_CAMERA_POST_HOLD;
          this.tailSlapCameraBlend = Math.min(1, this.tailSlapCameraBlend + deltaSeconds / TAIL_SLAP_CAMERA_BLEND_IN);
        } else if (this.tailSlapCameraHoldTimer > 0) {
          this.tailSlapCameraHoldTimer = Math.max(0, this.tailSlapCameraHoldTimer - deltaSeconds);
          this.tailSlapCameraBlend = 1;
        } else {
          this.tailSlapCameraBlend = Math.max(0, this.tailSlapCameraBlend - deltaSeconds / TAIL_SLAP_CAMERA_BLEND_OUT);

          if (this.tailSlapCameraBlend <= 0.0001) {
            this.tailSlapCameraBlend = 0;
            this.tailSlapCameraActive = false;
          }
        }
      }
    }

    this.tailSlapCameraWasActive = tailSlapActive;

    const breachViewAlpha = this.breachCameraBlend;
    const tailSlapViewAlpha = this.tailSlapCameraActive ? this.tailSlapCameraBlend : 0;
    const tailSlapAlpha =
      tailSlapActive
        ? 1 - THREE.MathUtils.clamp(this.whale.tailSlapTime / 0.42, 0, 1)
        : 0;
    const whaleSpeedRatio = THREE.MathUtils.clamp(this.whale.speed / WHALE_SPEED_PROFILE.maxTravelSpeed, 0, 1.2);
    const strokeHeave = this.whale.strokeVisual * (1 - underwaterRatio * 0.3);
    const tetherZoomOut = THREE.MathUtils.lerp(0, 8.5, tetherZoomAlpha);
    const cameraDistance =
      THREE.MathUtils.lerp(WHALE_SPEED_PROFILE.topsideCameraDistance, WHALE_SPEED_PROFILE.underwaterCameraDistance, underwaterRatio) +
      tetherZoomOut +
      tailSlapAlpha * 2.1;
    const cameraHeight =
      THREE.MathUtils.lerp(6.6, 3.3, underwaterRatio) +
      tetherZoomOut * 0.14 +
      strokeHeave * 0.7 +
      tailSlapAlpha * 1.1;
    const lookDistance =
      THREE.MathUtils.lerp(WHALE_SPEED_PROFILE.topsideLookDistance, WHALE_SPEED_PROFILE.underwaterLookDistance, underwaterRatio) +
      tetherZoomOut * 0.22 +
      tailSlapAlpha * 0.9;
    const shoulderTarget = underwaterRatio * THREE.MathUtils.clamp(-this.whale.roll * 8.4, -2.6, 2.6);

    this.shoulderOffset = THREE.MathUtils.damp(this.shoulderOffset, shoulderTarget, 3.2, deltaSeconds);

    this.tailSlapCameraForward.set(0, 0, 1).applyAxisAngle(this.worldUp, this.tailSlapCameraHeading).normalize();
    this.tailSlapCameraRight.crossVectors(this.worldUp, this.tailSlapCameraForward).normalize();
    this.cameraBasisForward.copy(this.whaleForward).lerp(this.tailSlapCameraForward, tailSlapViewAlpha).normalize();
    this.cameraBasisRight.copy(this.whaleRight).lerp(this.tailSlapCameraRight, tailSlapViewAlpha).normalize();

    this.cameraTarget
      .copy(this.whale.position)
      .addScaledVector(this.cameraBasisForward, -cameraDistance)
      .addScaledVector(this.cameraBasisRight, this.shoulderOffset);

    this.cameraOffset.set(0, cameraHeight, 0);
    this.cameraTarget.add(this.cameraOffset);
    this.cameraTarget.y += strokeHeave * 0.24;

    if (breachViewAlpha > 0) {
      this.breachCameraForward.set(0, 0, 1).applyAxisAngle(this.worldUp, this.breachCameraHeading).normalize();
      this.breachCameraRight.crossVectors(this.worldUp, this.breachCameraForward).normalize();

      const breachTrail = 24 + breachArcAlpha * 4;
      const breachHeight = 8.5 + breachArcAlpha * 1.8;
      const breachLateral = this.shoulderOffset * 0.15;
      this.cameraOffset
        .copy(this.whale.position)
        .addScaledVector(this.breachCameraForward, -breachTrail)
        .addScaledVector(this.breachCameraRight, breachLateral);
      this.cameraOffset.y += breachHeight;
      this.cameraOffset.y = Math.max(
        this.cameraOffset.y,
        this.sampleOceanHeight(this.cameraOffset.x, this.cameraOffset.z) + 1.6,
      );
      this.cameraTarget.lerp(this.cameraOffset, breachViewAlpha);
    }

    const shouldClampBreachCamera = this.whale.actionState === 'breach' || breachViewAlpha > 0.2;

    if (shouldClampBreachCamera) {
      this.cameraTarget.y = Math.max(
        this.cameraTarget.y,
        this.sampleOceanHeight(this.cameraTarget.x, this.cameraTarget.z) + 1.25,
      );
    }

    if (this.impactShake > 0.001) {
      this.cameraTarget.x += (Math.random() - 0.5) * this.impactShake;
      this.cameraTarget.y += (Math.random() - 0.5) * this.impactShake * 0.6;
      this.cameraTarget.z += (Math.random() - 0.5) * this.impactShake;
      this.impactShake = THREE.MathUtils.damp(this.impactShake, 0, 8, deltaSeconds);

      if (shouldClampBreachCamera) {
        this.cameraTarget.y = Math.max(
          this.cameraTarget.y,
          this.sampleOceanHeight(this.cameraTarget.x, this.cameraTarget.z) + 1.25,
        );
      }
    }

    const cameraFollowRate =
      THREE.MathUtils.lerp(
        WHALE_SPEED_PROFILE.cameraFollowRateSurface,
        WHALE_SPEED_PROFILE.cameraFollowRateUnderwater,
        underwaterRatio,
      ) +
      breachViewAlpha * 5.6 +
      tailSlapAlpha * 0.8;
    this.camera.position.lerp(this.cameraTarget, 1 - Math.exp(-deltaSeconds * cameraFollowRate));

    if (shouldClampBreachCamera) {
      this.camera.position.y = Math.max(
        this.camera.position.y,
        this.sampleOceanHeight(this.camera.position.x, this.camera.position.z) + 1.25,
      );
    }

    this.lookTarget
      .copy(this.whale.position)
      .addScaledVector(this.cameraBasisForward, lookDistance)
      .addScaledVector(this.cameraBasisRight, this.shoulderOffset * 0.18);
    this.lookTarget.y += THREE.MathUtils.lerp(0.8, 0.15, underwaterRatio) + strokeHeave * 0.16;

    if (breachViewAlpha > 0) {
      this.cameraOffset
        .copy(this.whale.position)
        .addScaledVector(this.breachCameraForward, 9.5)
        .addScaledVector(this.breachCameraRight, this.shoulderOffset * 0.06);
      this.cameraOffset.y += 1.1;
      this.lookTarget.lerp(this.cameraOffset, breachViewAlpha);
    }

    if (!this.cameraInitialized) {
      this.lookTargetCurrent.copy(this.lookTarget);
      this.camera.position.copy(this.cameraTarget);
      this.cameraInitialized = true;
    }

    const lookLagRate = THREE.MathUtils.lerp(5.8, 2.4, underwaterRatio) + breachViewAlpha * 1.1;
    this.lookTargetCurrent.lerp(this.lookTarget, 1 - Math.exp(-deltaSeconds * lookLagRate));
    this.camera.lookAt(this.lookTargetCurrent);

    this.cameraRoll = THREE.MathUtils.damp(
      this.cameraRoll,
      breachViewAlpha > 0.001 ? 0 : THREE.MathUtils.clamp(this.whale.roll * 0.48, -0.14, 0.14) * underwaterRatio,
      breachViewAlpha > 0.001 ? 7.2 : 4.2,
      deltaSeconds,
    );
    this.camera.rotateZ(this.cameraRoll);

    const speedFovBoost = whaleSpeedRatio * WHALE_SPEED_PROFILE.speedFovBoostMax;
    const tetherFovBoost = tetherZoomAlpha * 2.2;
    const targetFov =
      62 +
      underwaterRatio * 3.6 +
      speedFovBoost +
      tetherFovBoost +
      breachArcAlpha * 4.5 +
      breachViewAlpha * 2 +
      tailSlapAlpha * 2.4;
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 4.4, deltaSeconds);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private captureTailSlapCameraHeading(): void {
    this.cameraBasisForward.copy(this.lookTargetCurrent).sub(this.camera.position).setY(0);

    if (this.cameraBasisForward.lengthSq() <= 0.0001) {
      this.cameraBasisForward.copy(this.whaleForward).setY(0);
    }

    this.cameraBasisForward.normalize();
    this.tailSlapCameraHeading = Math.atan2(this.cameraBasisForward.x, this.cameraBasisForward.z);
  }

  private updateAtmosphere(deltaSeconds: number, underwaterRatio: number): void {
    const targetFog = this.whale.submerged ? UNDERWATER_FOG : SURFACE_FOG;
    const fog = this.scene.fog as THREE.FogExp2;

    this.atmosphereColor.lerp(targetFog, 1 - Math.exp(-deltaSeconds * 2.1));
    fog.color.copy(this.atmosphereColor);
    fog.density = THREE.MathUtils.damp(
      fog.density,
      THREE.MathUtils.lerp(SURFACE_FOG_DENSITY, UNDERWATER_FOG_DENSITY, underwaterRatio),
      2.4,
      deltaSeconds,
    );
  }

  private getUnderwaterRatio(): number {
    return THREE.MathUtils.clamp((-this.whale.depth - 0.4) / 5, 0, 1);
  }

  private getActiveRescueTowBoatTarget(): Ship | null {
    if (this.rescueEncounterState !== 'towed') {
      return null;
    }

    return this.getAliveRescueTowBoats().reduce<Ship | null>((nearest, ship) => {
      if (!nearest) {
        return ship;
      }

      const nextDistance = this.tempShipVector.copy(ship.root.position).sub(this.whale.position).lengthSq();
      const currentDistance = this.tempTargetPoint.copy(nearest.root.position).sub(this.whale.position).lengthSq();
      return nextDistance < currentDistance ? ship : nearest;
    }, null);
  }

  private getRescueExtractionProgress(): number {
    if (this.rescueEncounterState !== 'towed' || !this.corporateShip) {
      return 0;
    }

    this.corporateShip.getExtractionAnchor(this.tempRescueAnchor);
    const distanceRemaining = this.captiveWhale.position.distanceTo(this.tempRescueAnchor);
    return THREE.MathUtils.clamp(1 - distanceRemaining / Math.max(this.rescueInitialExtractionDistance, 0.001), 0, 1);
  }

  private collectCapitalShipBars(): HUDShipBarSnapshot[] {
    const visibleBars: HUDShipBarSnapshot[] = [];

    for (const ship of this.ships) {
      if (!ship.isCapitalShip || ship.sinking || ship.sunk || ship.health >= ship.maxHealth) {
        continue;
      }

      ship.getHealthBarAnchor(this.tempHealthBarAnchor);
      this.tempCameraSpacePoint.copy(this.tempHealthBarAnchor).applyMatrix4(this.camera.matrixWorldInverse);

      if (this.tempCameraSpacePoint.z >= -this.camera.near) {
        continue;
      }

      this.tempHealthBarProjection.copy(this.tempHealthBarAnchor).project(this.camera);

      if (
        this.tempHealthBarProjection.z < -1 ||
        this.tempHealthBarProjection.z > 1 ||
        Math.abs(this.tempHealthBarProjection.x) > 1 ||
        Math.abs(this.tempHealthBarProjection.y) > 1
      ) {
        continue;
      }

      const distance = this.camera.position.distanceTo(this.tempHealthBarAnchor);
      const distanceAlpha = 1 - THREE.MathUtils.smoothstep(distance, 40, 240);
      const opacity = THREE.MathUtils.clamp(0.34 + distanceAlpha * 0.5, 0.34, 0.84);
      const width = ship.role === 'corporate_whaler' ? 96 : 78;

      visibleBars.push({
        id: ship.id,
        screenX: (this.tempHealthBarProjection.x * 0.5 + 0.5) * this.viewportWidth,
        screenY: (-this.tempHealthBarProjection.y * 0.5 + 0.5) * this.viewportHeight,
        health: ship.healthPercent,
        width,
        opacity,
      });
    }

    visibleBars.sort((barA, barB) => {
      const shipA = this.shipById.get(barA.id);
      const shipB = this.shipById.get(barB.id);

      if (!shipA || !shipB) {
        return barA.id.localeCompare(barB.id);
      }

      const distanceA = this.camera.position.distanceToSquared(shipA.root.position);
      const distanceB = this.camera.position.distanceToSquared(shipB.root.position);

      if (distanceA !== distanceB) {
        return distanceB - distanceA;
      }

      return barA.id.localeCompare(barB.id);
    });

    return visibleBars;
  }

  private updateHud(): void {
    const livingShips = this.ships.filter((ship) => !ship.sinking);
    const fleetRemaining = livingShips.length;
    const rowboatsRemaining = livingShips.filter((ship) => ship.role === 'rowboat').length;
    const livingCapitals = livingShips.filter((ship) => ship.isCapitalShip);
    const corporateActive = this.corporateArrivalState === 'active' && this.corporateShip && !this.corporateShip.sinking;
    const rescueTowBoatTarget = this.getActiveRescueTowBoatTarget();
    const focusCandidates = rescueTowBoatTarget ? [rescueTowBoatTarget] : rowboatsRemaining > 0 ? livingShips : livingCapitals;
    const focusShip = focusCandidates.reduce<Ship | null>((nearest, ship) => {
      if (!nearest) {
        return ship;
      }

      const nextDistance = this.tempShipVector.copy(ship.root.position).sub(this.whale.position).lengthSq();
      const currentDistance = this.tempTargetPoint.copy(nearest.root.position).sub(this.whale.position).lengthSq();
      return nextDistance < currentDistance ? ship : nearest;
    }, null);

    let objective = 'Break the harpoon crews first. Dive to drown tethered rowboats, then turn on the flagships.';
    let shipStatus = `${rowboatsRemaining} rowboats swarming / ${livingCapitals.length} capital ship${livingCapitals.length === 1 ? '' : 's'} armed`;
    let overlayTitle: string | undefined;
    let overlayCopy: string | undefined;
    const airPercent = this.whale.air / this.whale.maxAir;
    const towBoatsRemaining = this.getAliveRescueTowBoats().length;
    const extractionProgress = Math.round(this.getRescueExtractionProgress() * 100);
    const capitalShipBars = this.collectCapitalShipBars();

    if (corporateActive && !this.corporateRowboatsLaunched) {
      objective = 'A corporate whaler is pushing in from the fog. Close before it opens the full battery and launches more crews.';
      shipStatus = `${rowboatsRemaining} rowboats still screening / corporate batteries sighted`;
    } else if (this.corporateRowboatsLaunched && this.corporateShip && !this.corporateShip.sinking) {
      objective = 'The corporate whaler has launched fresh crews. Cut through the rowboats, then drag both capital ships under.';
      shipStatus = `${rowboatsRemaining} rowboats in the water / ${livingCapitals.length} capital ship${livingCapitals.length === 1 ? '' : 's'} armed`;
    }

    if (rowboatsRemaining <= 0 && livingCapitals.length > 0) {
      if (livingCapitals.length === 1 && focusShip) {
        objective = `The crews are gone. Finish the ${focusShip.displayName.toLowerCase()} before the guns walk you down.`;
        shipStatus =
          focusShip.aiState === 'flee'
            ? `${focusShip.displayName} breaking for open water`
            : `${focusShip.displayName} alone / broadside batteries live`;
      } else {
        objective = 'The rowboats are gone. Only the capital ships remain. Stay moving and break the batteries apart.';
        shipStatus = 'Dual capital pressure / broadside batteries live';
      }
    }

    if (rescueTowBoatTarget) {
      objective = 'Tow boats are hauling a captive whale back to the corporate whaler. Break the convoy before it closes the gap.';
      shipStatus = `${towBoatsRemaining} tow boats hauling / extraction ${extractionProgress}%`;
    } else if (this.rescueEncounterState === 'escaping') {
      objective = 'The captive slips free into the deep. Turn back on the fleet before it regroups.';
      shipStatus = 'Rescue complete / corporate formation breaking';
    } else if (this.rescueEncounterState === 'failed') {
      objective = 'The convoy reached the whaler. The captive is lost and the hunt tightens around you.';
      shipStatus = this.corporateRowboatsLaunched ? 'Rescue failed / fresh crews in the water' : 'Rescue failed / corporate deck crews surging';
    }

    if (
      this.phase === 'playing' &&
      this.activeTethers > 0 &&
      this.rescueEncounterState !== 'towed' &&
      this.rescueEncounterState !== 'escaping' &&
      this.rescueEncounterState !== 'failed'
    ) {
      objective = 'Harpoons buried. Dive deep to drown the crews or tear the lines apart with speed.';
      shipStatus = `${this.activeTethers} tether${this.activeTethers === 1 ? '' : 's'} biting / ${rowboatsRemaining} rowboats left`;
    }

    if (this.phase === 'playing' && this.whale.submerged && airPercent <= LOW_AIR_THRESHOLD) {
      objective =
        this.whale.air > 0
          ? 'Air is running thin. Break the surface before the deep starts tearing at your hull.'
          : 'Out of air. Surface now or bleed out in the deep.';
      shipStatus =
        this.whale.air > 0
          ? `Air running thin / ${this.activeTethers} tether${this.activeTethers === 1 ? '' : 's'} attached`
          : 'Air spent / hull buckling under pressure';
    }

    if (this.phase === 'victory') {
      objective = 'The sea is yours. Press R to call the hunt back up from the deep.';
      shipStatus = 'Fleet destroyed';
      overlayTitle = 'Fleet Broken';
      overlayCopy =
        this.corporateArrivalState === 'pending'
          ? 'The rowboats vanish first. Then the flagships follow them into the black. Press R to hunt again.'
          : 'The escorting crews vanish first. Then the capital ships follow them into the black. Press R to hunt again.';
    } else if (this.phase === 'defeat') {
      objective = 'They bought a moment with iron. Press R to rise again.';
      shipStatus = 'Whale driven off';
      overlayTitle = 'Driven Back';
      overlayCopy = 'The lines held long enough for the guns to land. Press R to return beneath them.';
    }

    this.ui.update({
      capitalShipBars,
      objective,
      whaleHealth: this.whale.health / this.whale.maxHealth,
      whaleAir: airPercent,
      shipStatus,
      speed: this.whale.speed,
      depth: -this.whale.depth,
      submerged: this.whale.submerged,
      score: this.score,
      fleetRemaining,
      activeTethers: this.activeTethers,
      overlayTitle,
      overlayCopy,
      showActionControls: this.phase === 'playing',
    });
  }
}

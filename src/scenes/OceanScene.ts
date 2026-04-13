import * as THREE from 'three';

import { ModelLibrary } from '../assets/ModelLibrary';
import { Cannonball } from '../entities/Cannonball';
import { Harpoon } from '../entities/Harpoon';
import { PlayerWhale } from '../entities/PlayerWhale';
import { Ship, ShipSpawnConfig } from '../entities/Ship';
import { BreachSplashFX } from '../fx/BreachSplashFX';
import { createPainterlyOceanMaterial, updatePainterlyOceanMaterial } from '../fx/createPainterlyOceanMaterial';
import { ShipWakeFX } from '../fx/ShipWakeFX';
import { SurfaceSeafoamFX } from '../fx/SurfaceSeafoamFX';
import { createOceanUndersideMaterial, UnderwaterReadabilityFX } from '../fx/UnderwaterReadabilityFX';
import { Input } from '../game/Input';
import { DamageSystem } from '../systems/DamageSystem';
import { ShipAIContext, ShipAISystem } from '../systems/ShipAISystem';
import { UISystem } from '../systems/UISystem';
import { WhaleMovementResult, WhaleMovementSystem } from '../systems/WhaleMovementSystem';

const SURFACE_FOG = new THREE.Color('#04131a');
const UNDERWATER_FOG = new THREE.Color('#062229');
const ARENA_RADIUS = 124;
const HARPOON_SPEED = 30;
const HARPOON_LIFETIME = 2.4;
const CANNONBALL_SPEED = 28;
const CANNONBALL_LIFETIME = 5.2;
const CANNON_SPLASH_RADIUS = 4;
const TETHER_SNAP_SPEED = 18;
const AIR_DRAIN_PER_SECOND = 1;
const AIR_RECOVERY_PER_SECOND = 3.4;
const SUFFOCATION_DAMAGE_PER_SECOND = 6;
const LOW_AIR_THRESHOLD = 0.34;

const createSpawn = (id: string, role: ShipSpawnConfig['role'], x: number, z: number): ShipSpawnConfig => ({
  id,
  role,
  position: new THREE.Vector3(x, 0.8, z),
  initialHeading: Math.atan2(-x, -z),
});

const FLEET_SPAWNS: ShipSpawnConfig[] = [
  createSpawn('flagship', 'flagship', 0, 106),
  createSpawn('rowboat-nw', 'rowboat', -82, 74),
  createSpawn('rowboat-west', 'rowboat', -108, 18),
  createSpawn('rowboat-sw', 'rowboat', -86, -82),
  createSpawn('rowboat-south', 'rowboat', 0, -112),
  createSpawn('rowboat-se', 'rowboat', 88, -78),
  createSpawn('rowboat-east', 'rowboat', 108, 16),
];

export type ArenaPhase = 'playing' | 'victory' | 'defeat';

export class OceanScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 700);

  private readonly whale = new PlayerWhale();
  private readonly ships = FLEET_SPAWNS.map((spawn) => new Ship(spawn));
  private readonly shipById = new Map(this.ships.map((ship) => [ship.id, ship] as const));
  private readonly modelLibrary = new ModelLibrary();
  private readonly whaleMovement = new WhaleMovementSystem();
  private readonly damageSystem = new DamageSystem();
  private readonly shipAiSystem = new ShipAISystem();
  private readonly oceanGeometry = new THREE.PlaneGeometry(460, 460, 56, 56);
  private readonly oceanMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly oceanUndersideMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly baseWaveCoordinates: Float32Array;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly lookTargetCurrent = new THREE.Vector3();
  private readonly whaleForward = new THREE.Vector3();
  private readonly whaleRight = new THREE.Vector3();
  private readonly breachCameraForward = new THREE.Vector3();
  private readonly breachCameraRight = new THREE.Vector3();
  private readonly moonDirection = new THREE.Vector3(0.3, -0.94, 0.14);
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly cameraOffset = new THREE.Vector3();
  private readonly atmosphereColor = SURFACE_FOG.clone();
  private readonly breachSplashFx: BreachSplashFX;
  private readonly shipWakeFx: ShipWakeFX;
  private readonly surfaceSeafoamFx: SurfaceSeafoamFX;
  private readonly readabilityFx: UnderwaterReadabilityFX;
  private readonly shipAiContext: ShipAIContext = {
    arenaRadius: ARENA_RADIUS,
    deltaSeconds: 0,
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
  private readonly breachLaunchShipIds = new Set<string>();

  private elapsedSeconds = 0;
  private impactShake = 0;
  private cameraInitialized = false;
  private shoulderOffset = 0;
  private cameraRoll = 0;
  private breachCameraBlend = 0;
  private breachCameraTransitionActive = false;
  private breachCameraHeading = 0;
  private flagshipBreachedThisArc = false;
  private phase: ArenaPhase = 'playing';
  private score = 0;
  private activeTethers = 0;
  private disposed = false;

  constructor(
    private readonly input: Input,
    private readonly ui: UISystem,
    width: number,
    height: number,
  ) {
    this.scene.background = this.atmosphereColor;
    this.scene.fog = new THREE.FogExp2(this.atmosphereColor, 0.021);

    this.camera.position.set(0, 6, -14);
    this.camera.lookAt(0, 0, 0);

    this.baseWaveCoordinates = this.captureWaveCoordinates();
    this.oceanMesh = this.createOcean();
    this.oceanUndersideMesh = this.createOceanUnderside();
    this.breachSplashFx = new BreachSplashFX(this.scene);
    this.shipWakeFx = new ShipWakeFX(this.scene, this.ships);
    this.surfaceSeafoamFx = new SurfaceSeafoamFX(this.scene, this.ships);
    this.readabilityFx = new UnderwaterReadabilityFX(this.scene, this.camera);

    this.setupLights();
    this.setupSky();
    this.scene.add(
      this.oceanMesh,
      this.oceanUndersideMesh,
      this.whale.root,
      this.camera,
      ...this.ships.map((ship) => ship.root),
    );

    this.reset();
    void this.initializeVisuals();
    this.resize(width, height);
  }

  get outcome(): ArenaPhase | null {
    if (this.phase === 'playing') {
      return null;
    }

    return this.phase;
  }

  resize(width: number, height: number): void {
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
    this.flagshipBreachedThisArc = false;
    this.activeTethers = 0;
    this.breachLaunchShipIds.clear();

    this.whale.reset();

    for (const ship of this.ships) {
      ship.reset();
      ship.setSubmergedReadabilityCue(0);
      ship.setTetherPull(0);
    }

    this.clearHarpoons();
    this.clearCannonballs();
    this.breachSplashFx.reset();
    this.shipWakeFx.reset();
    this.surfaceSeafoamFx.reset();
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

    this.updateShips(deltaSeconds);
    this.updateHarpoons(deltaSeconds);
    this.updateCannonballs(deltaSeconds);
    this.syncTetherDragState();
    this.syncShipTetherPulls();

    if (this.phase === 'playing') {
      this.updateWhaleAir(deltaSeconds);
      this.resolveArenaOutcome();
    }

    const underwaterRatio = this.getUnderwaterRatio();

    this.updateCamera(deltaSeconds, underwaterRatio);
    this.updateAtmosphere(deltaSeconds, underwaterRatio);
    this.breachSplashFx.update(deltaSeconds, this.sampleOceanHeight);
    this.shipWakeFx.update({
      deltaSeconds,
      underwaterRatio,
      sampleSurfaceHeight: this.sampleOceanHeight,
      ships: this.ships,
    });
    this.surfaceSeafoamFx.update({
      deltaSeconds,
      elapsedSeconds,
      underwaterRatio,
      cameraPosition: this.camera.position,
      sampleSurfaceHeight: this.sampleOceanHeight,
      whale: this.whale,
      ships: this.ships,
    });
    this.readabilityFx.update({
      deltaSeconds,
      elapsedSeconds,
      camera: this.camera,
      whalePosition: this.whale.position,
      whaleSpeed: this.whale.speed,
      whaleBoostActive: this.whale.boostActive,
      underwaterRatio,
      submerged: this.whale.submerged,
      surfaceHeightAtCamera: this.sampleOceanHeight(this.camera.position.x, this.camera.position.z),
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
    this.disposed = true;
    this.breachSplashFx.dispose();
    this.shipWakeFx.dispose();
    this.surfaceSeafoamFx.dispose();
    this.readabilityFx.dispose();
    this.clearHarpoons();
    this.clearCannonballs();
  }

  private createOcean(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
    this.oceanGeometry.rotateX(-Math.PI / 2);
    const material = createPainterlyOceanMaterial();

    const ocean = new THREE.Mesh(this.oceanGeometry, material);
    ocean.receiveShadow = false;
    return ocean;
  }

  private async initializeVisuals(): Promise<void> {
    void this.modelLibrary.getActorModel('whale').then((visual) => {
      if (!this.disposed && visual) {
        this.whale.applyVisualModel(visual.scene, visual.profile);
      }
    });

    for (const ship of this.ships) {
      void this.modelLibrary.getActorModel(ship.role).then((visual) => {
        if (!this.disposed && visual) {
          ship.applyVisualModel(visual.scene, visual.profile);
        }
      });
    }
  }

  private createOceanUnderside(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const underside = new THREE.Mesh(this.oceanGeometry, createOceanUndersideMaterial());
    underside.renderOrder = -2;
    return underside;
  }

  private setupLights(): void {
    const moonLight = new THREE.DirectionalLight('#a8c7ff', 2.5);
    moonLight.position.set(-20, 40, -10);
    this.moonDirection.copy(moonLight.position).negate().normalize();

    const fillLight = new THREE.HemisphereLight('#3b5678', '#03121d', 0.65);
    const lowRim = new THREE.DirectionalLight('#7db7ff', 0.38);
    lowRim.position.set(12, 8, 18);

    this.scene.add(moonLight, fillLight, lowRim);
  }

  private setupSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(320, 18, 18),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#040913'),
        side: THREE.BackSide,
      }),
    );

    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(8, 20),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#dfe8ff'),
        transparent: true,
        opacity: 0.88,
      }),
    );
    moon.position.set(-120, 96, -180);

    const silhouette = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 1.3, 54, 5),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#101820'),
        roughness: 1,
        metalness: 0,
        flatShading: true,
      }),
    );
    silhouette.position.set(78, 24, 124);
    silhouette.rotation.z = 0.06;

    const silhouette2 = silhouette.clone();
    silhouette2.position.set(-96, 22, 88);
    silhouette2.rotation.z = -0.08;

    this.scene.add(sky, moon, silhouette, silhouette2);
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
    updatePainterlyOceanMaterial(this.oceanMesh.material, this.elapsedSeconds);
  }

  private readonly sampleOceanHeight = (x: number, z: number): number => {
    const time = this.elapsedSeconds;
    const longSwell = Math.sin(x * 0.03 + time * 0.72) * 0.85;
    const crossSwell = Math.cos(z * 0.037 - time * 0.94) * 0.55;
    const chop = Math.sin((x + z) * 0.09 + time * 1.8) * 0.18;
    return longSwell + crossSwell + chop;
  };

  private updateShips(deltaSeconds: number): void {
    const rowboatsRemaining = this.getRowboatsRemaining();
    this.shipAiContext.deltaSeconds = deltaSeconds;
    this.shipAiContext.rowboatsRemaining = rowboatsRemaining;
    this.shipAiContext.whalePosition.copy(this.whale.position);

    for (const ship of this.ships) {
      const activeHarpoon = this.activeHarpoonsByShipId.get(ship.id);
      this.shipAiContext.shipHasActiveHarpoon = Boolean(activeHarpoon?.active);
      this.shipAiContext.shipHasTether = activeHarpoon?.mode === 'tethered';

      if (this.phase === 'playing') {
        const aiResult = this.shipAiSystem.update(ship, this.shipAiContext);

        if (aiResult.wantsHarpoonThrow && ship.role === 'rowboat' && !activeHarpoon) {
          this.spawnHarpoon(ship);
        }

        if (aiResult.broadsideTelegraphSide) {
          ship.startBroadsideTelegraph(aiResult.broadsideTelegraphSide);
        }
      }

      const pauseWaterShove = ship.role === 'flagship' && this.whale.actionState === 'breach';
      ship.update(deltaSeconds, this.elapsedSeconds, this.sampleOceanHeight, pauseWaterShove);

      if (this.phase === 'playing' && this.whale.actionState === 'swim') {
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
      const snapped = tetherLength > harpoon.maxTetherLength && (this.whale.speed > TETHER_SNAP_SPEED || this.whale.boostActive);

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
      this.breachCameraTransitionActive = true;
      this.breachCameraHeading = Math.atan2(this.whaleForward.x, this.whaleForward.z);
      this.impactShake = Math.max(this.impactShake, 0.12);
      this.flagshipBreachedThisArc = false;
      this.breachLaunchShipIds.clear();
      this.tempImpactPoint.set(
        this.whale.breachOrigin.x,
        this.sampleOceanHeight(this.whale.breachOrigin.x, this.whale.breachOrigin.z),
        this.whale.breachOrigin.z,
      );
      this.breachSplashFx.spawnLaunch(this.tempImpactPoint, this.getBreachSplashIntensity());
      this.surfaceSeafoamFx.spawnLaunch(this.tempImpactPoint, this.getBreachSplashIntensity());
    }

    if (this.whale.actionState === 'breach' && this.whale.verticalSpeed > 0) {
      this.resolveBreachLaunchHits();
    }

    if (result.breachImpact) {
      this.breachSplashFx.spawnReentry(result.breachImpact.position, this.getBreachSplashIntensity());
      this.surfaceSeafoamFx.spawnReentry(result.breachImpact.position, this.getBreachSplashIntensity());

      for (const ship of this.ships) {
        if (ship.role === 'flagship' && this.flagshipBreachedThisArc) {
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
          this.flagshipBreachedThisArc = true;
        }
      }

      this.breachLaunchShipIds.clear();
    }

    if (result.tailSlap) {
      for (const ship of this.ships) {
        const hitResult = this.damageSystem.resolveTailSlap(
          ship,
          result.tailSlap.origin,
          result.tailSlap.forward,
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
      this.flagshipBreachedThisArc = false;
      this.breachLaunchShipIds.clear();
    }
  }

  private getBreachSplashIntensity(): number {
    return THREE.MathUtils.clamp((this.whale.breachSpeed - 13) / 12, 0, 1);
  }

  private resolveBreachLaunchHits(): void {
    for (const ship of this.ships) {
      if (ship.role === 'rowboat' && this.breachLaunchShipIds.has(ship.id)) {
        continue;
      }

      if (ship.role === 'flagship' && this.flagshipBreachedThisArc) {
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
        this.flagshipBreachedThisArc = true;
      }
    }
  }

  private spawnHarpoon(ship: Ship): void {
    const harpoon = new Harpoon(ship.id);
    const origin = ship.getHarpoonOrigin(this.tempTargetPoint);
    const target = this.tempHarpoonDirection
      .copy(this.whale.position)
      .addScaledVector(this.whaleForward, THREE.MathUtils.clamp(this.whale.speed * 0.18, 0, 3.6));

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
      const target = this.tempTargetPoint
        .copy(this.whale.position)
        .addScaledVector(this.whaleForward, THREE.MathUtils.clamp(this.whale.speed * 0.55, 0, 6))
        .addScaledVector(this.tempShipForward, spread * 2.2);

      this.tempCannonVelocity.copy(target).sub(origin).setY(0);
      this.tempCannonVelocity.normalize().multiplyScalar(CANNONBALL_SPEED);
      this.tempCannonVelocity.y = 4.4 + Math.abs(spread) * 0.3;

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

  private getRowboatsRemaining(): number {
    return this.ships.filter((ship) => ship.role === 'rowboat' && !ship.sinking).length;
  }

  private resolveArenaOutcome(): void {
    if (this.whale.health <= 0) {
      this.phase = 'defeat';
      return;
    }

    const fleetRemaining = this.ships.filter((ship) => !ship.sinking).length;

    if (fleetRemaining <= 0) {
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

    const breachViewAlpha = this.breachCameraBlend;
    const tailSlapAlpha =
      this.whale.actionState === 'tail_slap'
        ? 1 - THREE.MathUtils.clamp(this.whale.tailSlapTime / 0.42, 0, 1)
        : 0;
    const strokeHeave = this.whale.strokeVisual * (1 - underwaterRatio * 0.3);
    const tetherZoomOut = THREE.MathUtils.lerp(0, 8.5, tetherZoomAlpha);
    const cameraDistance = THREE.MathUtils.lerp(19.1, 17.2, underwaterRatio) + tetherZoomOut + tailSlapAlpha * 2.1;
    const cameraHeight =
      THREE.MathUtils.lerp(6.6, 3.3, underwaterRatio) +
      tetherZoomOut * 0.14 +
      strokeHeave * 0.7 +
      tailSlapAlpha * 1.1;
    const lookDistance = THREE.MathUtils.lerp(8.1, 13.4, underwaterRatio) + tetherZoomOut * 0.22 + tailSlapAlpha * 0.9;
    const shoulderTarget = underwaterRatio * THREE.MathUtils.clamp(-this.whale.roll * 8.4, -2.6, 2.6);

    this.shoulderOffset = THREE.MathUtils.damp(this.shoulderOffset, shoulderTarget, 3.2, deltaSeconds);

    this.cameraTarget
      .copy(this.whale.position)
      .addScaledVector(this.whaleForward, -cameraDistance)
      .addScaledVector(this.whaleRight, this.shoulderOffset);

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
      THREE.MathUtils.lerp(4.4, 3.1, underwaterRatio) + breachViewAlpha * 5.6 + tailSlapAlpha * 0.8;
    this.camera.position.lerp(this.cameraTarget, 1 - Math.exp(-deltaSeconds * cameraFollowRate));

    if (shouldClampBreachCamera) {
      this.camera.position.y = Math.max(
        this.camera.position.y,
        this.sampleOceanHeight(this.camera.position.x, this.camera.position.z) + 1.25,
      );
    }

    this.lookTarget
      .copy(this.whale.position)
      .addScaledVector(this.whaleForward, lookDistance)
      .addScaledVector(this.whaleRight, this.shoulderOffset * 0.18);
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

    const speedFovBoost = THREE.MathUtils.clamp((this.whale.speed - 10) * 0.22, 0, 3.4);
    const tetherFovBoost = tetherZoomAlpha * 2.2;
    const targetFov =
      62 +
      underwaterRatio * 3.6 +
      speedFovBoost +
      tetherFovBoost +
      breachArcAlpha * 4.5 +
      breachViewAlpha * 2 +
      tailSlapAlpha * 2.4 +
      (this.whale.boostActive ? 4.8 : 0);
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 4.4, deltaSeconds);
    this.camera.updateProjectionMatrix();
  }

  private updateAtmosphere(deltaSeconds: number, underwaterRatio: number): void {
    const targetFog = this.whale.submerged ? UNDERWATER_FOG : SURFACE_FOG;
    const fog = this.scene.fog as THREE.FogExp2;

    this.atmosphereColor.lerp(targetFog, 1 - Math.exp(-deltaSeconds * 2.4));
    fog.color.copy(this.atmosphereColor);
    fog.density = THREE.MathUtils.damp(
      fog.density,
      THREE.MathUtils.lerp(0.021, 0.013, underwaterRatio),
      2.4,
      deltaSeconds,
    );
  }

  private getUnderwaterRatio(): number {
    return THREE.MathUtils.clamp((-this.whale.depth - 0.4) / 5, 0, 1);
  }

  private updateHud(): void {
    const livingShips = this.ships.filter((ship) => !ship.sinking);
    const fleetRemaining = livingShips.length;
    const rowboatsRemaining = livingShips.filter((ship) => ship.role === 'rowboat').length;
    const flagship = this.ships.find((ship) => ship.role === 'flagship' && !ship.sinking) ?? null;
    const focusShip =
      (rowboatsRemaining <= 0 && flagship) ||
      livingShips.reduce<Ship | null>((nearest, ship) => {
        if (!nearest) {
          return ship;
        }

        const nextDistance = this.tempShipVector.copy(ship.root.position).sub(this.whale.position).lengthSq();
        const currentDistance = this.tempTargetPoint.copy(nearest.root.position).sub(this.whale.position).lengthSq();
        return nextDistance < currentDistance ? ship : nearest;
      }, null);

    let objective = 'Break the harpoon crews first. Dive to drown tethered rowboats, then turn on the flagship.';
    let shipStatus = `${rowboatsRemaining} rowboats swarming / flagship armed`;
    let overlayTitle: string | undefined;
    let overlayCopy: string | undefined;
    const airPercent = this.whale.air / this.whale.maxAir;

    if (rowboatsRemaining <= 0 && flagship) {
      objective = 'The rowboats are gone. Finish the flagship before the guns walk you down.';
      shipStatus = flagship.aiState === 'flee' ? 'Flagship breaking for open water' : 'Flagship alone / broadside batteries live';
    }

    if (this.phase === 'playing' && this.activeTethers > 0) {
      objective = 'Harpoons buried. Dive deep to drown the crews or burst hard enough to snap the lines.';
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
      overlayCopy = 'The rowboats vanish first. Then the flagship follows them into the black. Press R to hunt again.';
    } else if (this.phase === 'defeat') {
      objective = 'They bought a moment with iron. Press R to rise again.';
      shipStatus = 'Whale driven off';
      overlayTitle = 'Driven Back';
      overlayCopy = 'The lines held long enough for the guns to land. Press R to return beneath them.';
    }

    this.ui.update({
      objective,
      whaleHealth: this.whale.health / this.whale.maxHealth,
      whaleAir: airPercent,
      targetHealth: focusShip?.healthPercent ?? 0,
      targetLabel: focusShip ? focusShip.displayName : 'No target',
      shipStatus,
      speed: this.whale.speed,
      depth: -this.whale.depth,
      submerged: this.whale.submerged,
      burstActive: this.whale.boostActive,
      score: this.score,
      fleetRemaining,
      activeTethers: this.activeTethers,
      overlayTitle,
      overlayCopy,
    });
  }
}

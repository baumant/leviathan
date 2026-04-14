import * as THREE from 'three';

import { createCelMaterial } from '../fx/createCelMaterial';

export type ShipRole = 'rowboat' | 'flagship' | 'corporate_whaler';
export type ShipAIState = 'patrol' | 'close' | 'throw' | 'tethered' | 'engage' | 'flee' | 'sinking';
export type BroadsideSide = 'port' | 'starboard';

export interface ShipSpawnConfig {
  id: string;
  role: ShipRole;
  position: THREE.Vector3;
  initialHeading: number;
}

export interface ShipLanternInfluence {
  position: THREE.Vector3;
  intensity: number;
}

interface ShipRoleConfig {
  maxHealth: number;
  scoreValue: number;
  fireInterval: number;
  attackDamage: number;
  moveSpeed: number;
  fleeSpeed: number;
  turnRate: number;
  patrolRadius: number;
  holdRangeMin: number;
  holdRangeMax: number;
  orbitOffset: number;
  scale: number;
  lanternIntensity: number;
  floatHeight: number;
  visualDraftOffset: number;
  subsurfaceRevealOffsetY: number;
  sinkDepth: number;
  halfExtents: THREE.Vector3;
  surfaceShadowScale: THREE.Vector2;
  subsurfaceRevealHalfExtents: THREE.Vector2;
  isCapitalShip: boolean;
  fleeWhenRowboatsGone: boolean;
  broadsideRangeMin: number;
  broadsideRangeMax: number;
  broadsideLocalForwardLimit: number;
  broadsideLocalSideMin: number;
  broadsideTelegraphDuration: number;
}

const AIRBORNE_GRAVITY = 26;
const WATER_SHOVE_DAMPING = 0.95;
const WATER_SHOVE_YAW_DAMPING = 1.3;
const WATER_SLIDE_ROLL_DAMPING = 2.4;
const WATER_SLIDE_ROLL_LIMIT = 0.06;

type ShipDamageReactionProfile = 'default' | 'capital_ram' | 'capital_breach';

const SHIP_ROLE_CONFIGS: Record<ShipRole, ShipRoleConfig> = {
  rowboat: {
    maxHealth: 45,
    scoreValue: 100,
    fireInterval: 2.6,
    attackDamage: 0,
    moveSpeed: 9.4,
    fleeSpeed: 9.8,
    turnRate: 1.62,
    patrolRadius: 12,
    holdRangeMin: 8,
    holdRangeMax: 14,
    orbitOffset: 4,
    scale: 0.72,
    lanternIntensity: 1.1,
    floatHeight: 0.18,
    visualDraftOffset: -0.42,
    subsurfaceRevealOffsetY: -0.62,
    sinkDepth: 4.8,
    halfExtents: new THREE.Vector3(1.24, 0.78, 2.9),
    surfaceShadowScale: new THREE.Vector2(3.6, 8.6),
    subsurfaceRevealHalfExtents: new THREE.Vector2(1.2, 3.2),
    isCapitalShip: false,
    fleeWhenRowboatsGone: false,
    broadsideRangeMin: 0,
    broadsideRangeMax: 0,
    broadsideLocalForwardLimit: 0,
    broadsideLocalSideMin: 0,
    broadsideTelegraphDuration: 0,
  },
  flagship: {
    maxHealth: 450,
    scoreValue: 500,
    fireInterval: 5.2,
    attackDamage: 10,
    moveSpeed: 6.4,
    fleeSpeed: 7.8,
    turnRate: 0.68,
    patrolRadius: 18,
    holdRangeMin: 34,
    holdRangeMax: 46,
    orbitOffset: 24,
    scale: 1.45,
    lanternIntensity: 3,
    floatHeight: 0.62,
    visualDraftOffset: -0.88,
    subsurfaceRevealOffsetY: -0.72,
    sinkDepth: 9.8,
    halfExtents: new THREE.Vector3(7.8, 4.1, 18.8),
    surfaceShadowScale: new THREE.Vector2(24, 58),
    subsurfaceRevealHalfExtents: new THREE.Vector2(5.8, 14.8),
    isCapitalShip: true,
    fleeWhenRowboatsGone: true,
    broadsideRangeMin: 20,
    broadsideRangeMax: 72,
    broadsideLocalForwardLimit: 18,
    broadsideLocalSideMin: 8,
    broadsideTelegraphDuration: 0.6,
  },
  corporate_whaler: {
    maxHealth: 1200,
    scoreValue: 1500,
    fireInterval: 6.8,
    attackDamage: 9,
    moveSpeed: 5.2,
    fleeSpeed: 6.0,
    turnRate: 0.42,
    patrolRadius: 26,
    holdRangeMin: 48,
    holdRangeMax: 66,
    orbitOffset: 38,
    scale: 2.9,
    lanternIntensity: 3.8,
    floatHeight: 1.12,
    visualDraftOffset: -1.55,
    subsurfaceRevealOffsetY: -1.18,
    sinkDepth: 13.5,
    halfExtents: new THREE.Vector3(15.6, 7.8, 37.6),
    surfaceShadowScale: new THREE.Vector2(48, 116),
    subsurfaceRevealHalfExtents: new THREE.Vector2(11.8, 29.6),
    isCapitalShip: true,
    fleeWhenRowboatsGone: false,
    broadsideRangeMin: 28,
    broadsideRangeMax: 96,
    broadsideLocalForwardLimit: 30,
    broadsideLocalSideMin: 12,
    broadsideTelegraphDuration: 0.72,
  },
};

export class Ship {
  readonly id: string;
  readonly role: ShipRole;
  readonly root = new THREE.Group();
  readonly visualRoot = new THREE.Group();
  readonly halfExtents = new THREE.Vector3();
  readonly anchor = new THREE.Vector3();
  readonly maxHealth: number;
  readonly scoreValue: number;
  readonly fireInterval: number;
  readonly attackDamage: number;
  readonly moveSpeed: number;
  readonly fleeSpeed: number;
  readonly turnRate: number;
  readonly patrolRadius: number;
  readonly holdRangeMin: number;
  readonly holdRangeMax: number;
  readonly orbitOffset: number;

  health: number;
  aiState: ShipAIState = 'patrol';
  heading: number;
  travelSpeed = 0;
  patrolAngle = Math.random() * Math.PI * 2;
  orbitDirection = Math.random() > 0.5 ? 1 : -1;
  fireCooldown = 0;
  scoreAwarded = false;

  private sinkProgress = 0;
  private readonly initialHeading: number;
  private readonly hullMaterial: THREE.MeshToonMaterial;
  private readonly mastMaterial: THREE.MeshToonMaterial;
  private readonly sailMaterial: THREE.MeshToonMaterial;
  private readonly fallbackVisualRoot = new THREE.Group();
  private readonly hullTintMaterials: THREE.MeshToonMaterial[] = [];
  private readonly mastTintMaterials: THREE.MeshToonMaterial[] = [];
  private readonly sailTintMaterials: THREE.MeshToonMaterial[] = [];
  private readonly lanternMaterials: THREE.MeshToonMaterial[] = [];
  private readonly lanternMeshes: THREE.Mesh[] = [];
  private readonly lanternHalos: THREE.Mesh[] = [];
  private readonly lanternHaloMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly lanternLights: THREE.PointLight[] = [];
  private readonly portCannons: THREE.Mesh[] = [];
  private readonly starboardCannons: THREE.Mesh[] = [];
  private readonly cannonPortMaterials: THREE.MeshToonMaterial[] = [];
  private readonly cannonStarboardMaterials: THREE.MeshToonMaterial[] = [];
  private readonly portCannonOffsets: THREE.Vector3[] = [];
  private readonly starboardCannonOffsets: THREE.Vector3[] = [];
  private readonly wakeOriginLocal = new THREE.Vector3();
  private readonly harpoonOriginLocal = new THREE.Vector3();
  private readonly towPortOriginLocal = new THREE.Vector3();
  private readonly towStarboardOriginLocal = new THREE.Vector3();
  private readonly reinforcementLaunchOffsets: THREE.Vector3[] = [];
  private readonly subsurfaceRevealLocal = new THREE.Vector3();
  private readonly visualSurfaceShadowScale = new THREE.Vector2();
  private readonly visualSubsurfaceRevealHalfExtents = new THREE.Vector2();
  private readonly roleConfig: ShipRoleConfig;
  private readonly bobOffset = Math.random() * Math.PI * 2;
  private readonly knockbackVelocity = new THREE.Vector3();
  private readonly knockbackDirection = new THREE.Vector3();
  private readonly waterShoveVelocity = new THREE.Vector3();
  private readonly waterShoveDirection = new THREE.Vector3();
  private impactRoll = 0;
  private impactPitch = 0;
  private waterSlideRoll = 0;
  private readabilityCue = 0;
  private broadsideTelegraphRemaining = 0;
  private broadsideTelegraphSide: BroadsideSide | null = null;
  private broadsideReadySide: BroadsideSide | null = null;
  private broadsideFlash = 0;
  private broadsideFlashSide: BroadsideSide | null = null;
  private tetherPull = 0;
  private tetherPullTarget = 0;
  private yawVelocity = 0;
  private waterShoveYawVelocity = 0;
  private airborneHeight = 0;
  private airborneVelocity = 0;

  constructor(config: ShipSpawnConfig) {
    this.id = config.id;
    this.role = config.role;
    this.roleConfig = SHIP_ROLE_CONFIGS[config.role];
    this.maxHealth = this.roleConfig.maxHealth;
    this.health = this.maxHealth;
    this.scoreValue = this.roleConfig.scoreValue;
    this.fireInterval = this.roleConfig.fireInterval;
    this.attackDamage = this.roleConfig.attackDamage;
    this.moveSpeed = this.roleConfig.moveSpeed;
    this.fleeSpeed = this.roleConfig.fleeSpeed;
    this.turnRate = this.roleConfig.turnRate;
    this.patrolRadius = this.roleConfig.patrolRadius;
    this.holdRangeMin = this.roleConfig.holdRangeMin;
    this.holdRangeMax = this.roleConfig.holdRangeMax;
    this.orbitOffset = this.roleConfig.orbitOffset;
    this.initialHeading = config.initialHeading;
    this.heading = config.initialHeading;
    this.anchor.copy(config.position);
    this.halfExtents.copy(this.roleConfig.halfExtents);
    this.visualSurfaceShadowScale.copy(this.roleConfig.surfaceShadowScale);
    this.visualSubsurfaceRevealHalfExtents.copy(this.roleConfig.subsurfaceRevealHalfExtents);
    this.subsurfaceRevealLocal.set(0, this.roleConfig.subsurfaceRevealOffsetY, 0);

    this.hullMaterial = createCelMaterial({
      color:
        this.role === 'corporate_whaler'
          ? '#4a372b'
          : this.role === 'flagship'
            ? '#5a4130'
            : '#4d3a2c',
      emissive: '#101620',
      emissiveIntensity: 0.04,
    });

    this.mastMaterial = createCelMaterial({
      color:
        this.role === 'corporate_whaler'
          ? '#6f5c4c'
          : this.role === 'flagship'
            ? '#8d6a52'
            : '#82624d',
      emissive: '#0d1318',
      emissiveIntensity: 0.02,
    });

    this.sailMaterial = createCelMaterial({
      color:
        this.role === 'corporate_whaler'
          ? '#8f816c'
          : this.role === 'flagship'
            ? '#c8b28d'
            : '#9f8a6b',
      emissive: '#161922',
      emissiveIntensity: 0.01,
    });
    this.hullTintMaterials.push(this.hullMaterial);
    this.mastTintMaterials.push(this.mastMaterial);
    this.sailTintMaterials.push(this.sailMaterial);

    if (this.role === 'corporate_whaler') {
      this.buildCorporateWhaler();
    } else if (this.role === 'flagship') {
      this.buildFlagship();
    } else {
      this.buildRowboat();
    }

    this.visualRoot.add(this.fallbackVisualRoot);
    this.root.add(this.visualRoot);
    this.root.scale.setScalar(this.roleConfig.scale);
    this.visualRoot.position.y = this.roleConfig.visualDraftOffset;
    this.root.position.copy(config.position);
    this.root.position.y = this.roleConfig.floatHeight;
    this.root.rotation.order = 'YXZ';
    this.root.updateMatrixWorld();

    this.reset();
  }

  get sinking(): boolean {
    return this.health <= 0;
  }

  get sunk(): boolean {
    return this.sinkProgress >= 1;
  }

  get healthPercent(): number {
    return THREE.MathUtils.clamp(this.health / this.maxHealth, 0, 1);
  }

  get displayName(): string {
    if (this.role === 'corporate_whaler') {
      return 'Corporate Whaler';
    }

    return this.role === 'flagship' ? 'Flagship' : 'Rowboat';
  }

  get surfaceShadowScale(): THREE.Vector2 {
    return this.visualSurfaceShadowScale;
  }

  get subsurfaceRevealHalfExtents(): THREE.Vector2 {
    return this.visualSubsurfaceRevealHalfExtents;
  }

  get isCapitalShip(): boolean {
    return this.roleConfig.isCapitalShip;
  }

  get capitalFleesWhenRowboatsGone(): boolean {
    return this.roleConfig.fleeWhenRowboatsGone;
  }

  get broadsideRangeMin(): number {
    return this.roleConfig.broadsideRangeMin;
  }

  get broadsideRangeMax(): number {
    return this.roleConfig.broadsideRangeMax;
  }

  get broadsideLocalForwardLimit(): number {
    return this.roleConfig.broadsideLocalForwardLimit;
  }

  get broadsideLocalSideMin(): number {
    return this.roleConfig.broadsideLocalSideMin;
  }

  get isBroadsideTelegraphing(): boolean {
    return this.broadsideTelegraphSide !== null;
  }

  reset(): void {
    this.health = this.maxHealth;
    this.aiState = 'patrol';
    this.heading = this.initialHeading;
    this.travelSpeed = 0;
    this.patrolAngle = Math.random() * Math.PI * 2;
    this.orbitDirection = Math.random() > 0.5 ? 1 : -1;
    this.fireCooldown = Math.random() * this.fireInterval;
    this.scoreAwarded = false;
    this.sinkProgress = 0;
    this.impactRoll = 0;
    this.impactPitch = 0;
    this.waterSlideRoll = 0;
    this.readabilityCue = 0;
    this.broadsideTelegraphRemaining = 0;
    this.broadsideTelegraphSide = null;
    this.broadsideReadySide = null;
    this.broadsideFlash = 0;
    this.broadsideFlashSide = null;
    this.tetherPull = 0;
    this.tetherPullTarget = 0;
    this.knockbackVelocity.setScalar(0);
    this.waterShoveVelocity.setScalar(0);
    this.yawVelocity = 0;
    this.waterShoveYawVelocity = 0;
    this.airborneHeight = 0;
    this.airborneVelocity = 0;
    this.root.position.copy(this.anchor);
    this.root.position.y = this.roleConfig.floatHeight;
    this.root.rotation.set(0, this.heading, 0, 'YXZ');
    this.updateDamageLook();
    this.root.updateMatrixWorld();
  }

  applyDamage(amount: number, reactionProfile: ShipDamageReactionProfile = 'default'): void {
    if (this.sinking || this.sunk) {
      return;
    }

    this.health = Math.max(0, this.health - amount);

    if (reactionProfile === 'capital_ram') {
      this.impactRoll += THREE.MathUtils.clamp(amount / 520, 0.008, 0.04);
    } else if (reactionProfile === 'capital_breach') {
      this.impactRoll += THREE.MathUtils.clamp(amount / 1400, 0.004, 0.014);
    } else {
      this.impactRoll += THREE.MathUtils.clamp(amount / 180, 0.02, 0.28);
      this.impactPitch -= THREE.MathUtils.clamp(amount / 260, 0.01, 0.12);
    }

    this.updateDamageLook();
  }

  applyKnockback(direction: THREE.Vector3, strength: number, yawStrength = 0): void {
    if (this.sinking || this.sunk || strength <= 0) {
      return;
    }

    this.knockbackDirection.copy(direction).setY(0);

    if (this.knockbackDirection.lengthSq() <= 0.0001) {
      this.knockbackDirection.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    } else {
      this.knockbackDirection.normalize();
    }

    this.knockbackVelocity.addScaledVector(this.knockbackDirection, strength);
    this.yawVelocity += yawStrength;
    this.impactRoll += THREE.MathUtils.clamp(strength * 0.018, 0.04, 0.22);
    this.impactPitch -= THREE.MathUtils.clamp(strength * 0.008, 0.01, 0.08);
  }

  applyWaterShove(direction: THREE.Vector3, strength: number, yawStrength = 0): void {
    if (this.sinking || this.sunk || strength <= 0) {
      return;
    }

    this.waterShoveDirection.copy(direction).setY(0);

    if (this.waterShoveDirection.lengthSq() <= 0.0001) {
      this.waterShoveDirection.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    } else {
      this.waterShoveDirection.normalize();
    }

    this.waterShoveVelocity.addScaledVector(this.waterShoveDirection, strength);
    this.waterShoveYawVelocity += yawStrength;
  }

  applyBlastRock(
    direction: THREE.Vector3,
    waterStrength: number,
    yawStrength: number,
    rollStrength: number,
    pitchStrength: number,
  ): void {
    if (this.sinking || this.sunk) {
      return;
    }

    if (waterStrength > 0) {
      this.applyWaterShove(direction, waterStrength, yawStrength);
    }

    this.impactRoll += rollStrength;
    this.impactPitch -= pitchStrength;
  }

  launchIntoAir(direction: THREE.Vector3, upwardVelocity: number, horizontalStrength: number, yawStrength = 0): void {
    if (this.sunk || upwardVelocity <= 0) {
      return;
    }

    if (horizontalStrength > 0) {
      this.applyKnockback(direction, horizontalStrength, yawStrength);
    }

    this.airborneHeight = Math.max(this.airborneHeight, 0.08);
    this.airborneVelocity = Math.max(this.airborneVelocity, upwardVelocity);
    this.travelSpeed *= 0.28;
    this.impactRoll += THREE.MathUtils.clamp(upwardVelocity * 0.018, 0.1, 0.34);
    this.impactPitch -= THREE.MathUtils.clamp(upwardVelocity * 0.014, 0.08, 0.26);
  }

  update(
    deltaSeconds: number,
    elapsedSeconds: number,
    oceanHeightAt: (x: number, z: number) => number,
    pauseWaterShove = false,
  ): void {
    const isCapital = this.isCapitalShip;
    const isCorporate = this.role === 'corporate_whaler';
    const damageRatio = 1 - this.healthPercent;
    const bobAmplitude = isCorporate ? 0.26 : isCapital ? 0.22 : 0.14;
    const bob = Math.sin(elapsedSeconds * 1.1 + this.bobOffset) * bobAmplitude;
    const pitchWave = Math.cos(elapsedSeconds * 0.9 + this.bobOffset * 0.7) * (isCorporate ? 0.035 : isCapital ? 0.03 : 0.02);
    const rollWave = Math.sin(elapsedSeconds * 1.2 + this.bobOffset) * (isCorporate ? 0.05 : isCapital ? 0.04 : 0.05);
    const speedRatio = THREE.MathUtils.clamp(this.travelSpeed / this.fleeSpeed, 0, 1);
    const cue = this.sinking ? 0 : this.readabilityCue;
    const telegraphAlpha =
      this.broadsideTelegraphRemaining > 0
        ? 1 -
          this.broadsideTelegraphRemaining /
            Math.max(this.roleConfig.broadsideTelegraphDuration, 0.0001)
        : 0;

    this.impactRoll = THREE.MathUtils.damp(this.impactRoll, damageRatio * 0.11, 2.8, deltaSeconds);
    this.impactPitch = THREE.MathUtils.damp(this.impactPitch, damageRatio * 0.05, 2.4, deltaSeconds);
    this.tetherPull = THREE.MathUtils.damp(this.tetherPull, this.tetherPullTarget, 5.2, deltaSeconds);
    this.knockbackVelocity.x = THREE.MathUtils.damp(this.knockbackVelocity.x, 0, 2.8, deltaSeconds);
    this.knockbackVelocity.z = THREE.MathUtils.damp(this.knockbackVelocity.z, 0, 2.8, deltaSeconds);
    this.yawVelocity = THREE.MathUtils.damp(this.yawVelocity, 0, 3.1, deltaSeconds);

    if (!pauseWaterShove) {
      this.waterShoveVelocity.x = THREE.MathUtils.damp(this.waterShoveVelocity.x, 0, WATER_SHOVE_DAMPING, deltaSeconds);
      this.waterShoveVelocity.z = THREE.MathUtils.damp(this.waterShoveVelocity.z, 0, WATER_SHOVE_DAMPING, deltaSeconds);
      this.waterShoveYawVelocity = THREE.MathUtils.damp(this.waterShoveYawVelocity, 0, WATER_SHOVE_YAW_DAMPING, deltaSeconds);

      if (isCapital) {
        this.waterShoveDirection.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
        const lateralSlideSpeed = this.waterShoveVelocity.dot(this.waterShoveDirection);
        const slideRollScale = isCorporate ? 0.014 : 0.02;
        const slideRollTarget = THREE.MathUtils.clamp(-lateralSlideSpeed * slideRollScale, -WATER_SLIDE_ROLL_LIMIT, WATER_SLIDE_ROLL_LIMIT);
        this.waterSlideRoll = THREE.MathUtils.damp(this.waterSlideRoll, slideRollTarget, WATER_SLIDE_ROLL_DAMPING, deltaSeconds);
      } else {
        this.waterSlideRoll = THREE.MathUtils.damp(this.waterSlideRoll, 0, WATER_SLIDE_ROLL_DAMPING, deltaSeconds);
      }
    }

    const wasAirborne = this.airborneHeight > 0.001 || this.airborneVelocity > 0.001;
    if (wasAirborne) {
      this.airborneVelocity -= AIRBORNE_GRAVITY * deltaSeconds;
      this.airborneHeight = Math.max(0, this.airborneHeight + this.airborneVelocity * deltaSeconds);

      if (this.airborneHeight === 0 && this.airborneVelocity < 0) {
        this.airborneVelocity = 0;
        this.impactRoll += 0.08;
        this.impactPitch += 0.04;
      }
    }

    if (this.sinking) {
      this.sinkProgress = Math.min(1, this.sinkProgress + deltaSeconds * (isCorporate ? 0.12 : isCapital ? 0.18 : 0.42));
      this.aiState = 'sinking';
      this.travelSpeed = THREE.MathUtils.damp(this.travelSpeed, 0, 4.2, deltaSeconds);
    }

    if (this.broadsideTelegraphRemaining > 0) {
      this.broadsideTelegraphRemaining = Math.max(0, this.broadsideTelegraphRemaining - deltaSeconds);

      if (this.broadsideTelegraphRemaining === 0 && this.broadsideTelegraphSide) {
        this.broadsideReadySide = this.broadsideTelegraphSide;
        this.broadsideFlash = 1;
        this.broadsideFlashSide = this.broadsideTelegraphSide;
        this.broadsideTelegraphSide = null;
      }
    }

    this.broadsideFlash = THREE.MathUtils.damp(this.broadsideFlash, 0, 8.5, deltaSeconds);

    const waterShoveX = pauseWaterShove ? 0 : this.waterShoveVelocity.x;
    const waterShoveZ = pauseWaterShove ? 0 : this.waterShoveVelocity.z;
    const waterShoveYaw = pauseWaterShove ? 0 : this.waterShoveYawVelocity;
    this.root.position.x += (this.knockbackVelocity.x + waterShoveX) * deltaSeconds;
    this.root.position.z += (this.knockbackVelocity.z + waterShoveZ) * deltaSeconds;
    this.heading += (this.yawVelocity + waterShoveYaw) * deltaSeconds;

    const seaLevel = oceanHeightAt(this.root.position.x, this.root.position.z);
    this.root.position.y =
      seaLevel + this.roleConfig.floatHeight + bob + this.airborneHeight - this.sinkProgress * this.roleConfig.sinkDepth - this.tetherPull;
    this.root.rotation.set(
      pitchWave + this.impactPitch - this.sinkProgress * 0.28 - this.tetherPull * 0.12,
      this.heading,
      rollWave + this.impactRoll + this.waterSlideRoll + this.sinkProgress * 1.28 + speedRatio * 0.04 * this.orbitDirection,
      'YXZ',
    );

    const lanternPulse = 0.85 + Math.sin(elapsedSeconds * 4.2 + this.bobOffset * 2) * 0.15;
    const haloBaseScale = 1.05 + lanternPulse * 0.18 + damageRatio * 0.22;
    const haloBaseOpacity = Math.max(0, (0.14 + lanternPulse * 0.06) * (1 - this.sinkProgress * 0.92));

    for (const material of this.hullTintMaterials) {
      material.emissive.set('#8fb7df');
      material.emissiveIntensity = cue * (isCorporate ? 0.024 : isCapital ? 0.028 : 0.036);
    }

    for (const material of this.mastTintMaterials) {
      material.emissive.set('#86a5c8');
      material.emissiveIntensity = cue * 0.026;
    }

    for (const material of this.sailTintMaterials) {
      material.emissive.set('#98b6d6');
      material.emissiveIntensity = cue * 0.012;
    }

    for (let index = 0; index < this.lanternLights.length; index += 1) {
      const lanternStrength = index === 0 ? 1 : 0.76;
      const light = this.lanternLights[index];
      const halo = this.lanternHalos[index];
      const haloMaterial = this.lanternHaloMaterials[index];
      const lanternMaterial = this.lanternMaterials[index];
      const baseIntensity = Math.max(
        0,
        (this.roleConfig.lanternIntensity - damageRatio - this.sinkProgress * 1.6) * lanternPulse * lanternStrength,
      );

      light.intensity = baseIntensity * (1 + cue * 0.24);
      light.distance = THREE.MathUtils.lerp(18, 28, cue) * this.roleConfig.scale;

      lanternMaterial.emissiveIntensity = Math.max(0, 0.9 - this.sinkProgress * 0.72) + cue * 0.18;
      haloMaterial.opacity = Math.min(0.62, haloBaseOpacity + cue * 0.08);
      halo.scale.setScalar(haloBaseScale * lanternStrength * (1 + cue * 0.08));
    }

    this.updateCannonTelegraphVisuals(telegraphAlpha);
    this.root.updateMatrixWorld();
  }

  setSubmergedReadabilityCue(amount: number): void {
    this.readabilityCue = THREE.MathUtils.clamp(amount, 0, 1);
  }

  setTetherPull(amount: number): void {
    this.tetherPullTarget = THREE.MathUtils.clamp(amount, 0, 2.6);
  }

  markHarpoonFired(): void {
    this.fireCooldown = this.fireInterval;
  }

  startBroadsideTelegraph(side: BroadsideSide): void {
    if (!this.isCapitalShip || this.broadsideTelegraphSide !== null || this.sinking) {
      return;
    }

    this.broadsideTelegraphSide = side;
    this.broadsideTelegraphRemaining = this.roleConfig.broadsideTelegraphDuration;
    this.fireCooldown = this.fireInterval;
  }

  consumeBroadsideReady(): BroadsideSide | null {
    const side = this.broadsideReadySide;
    this.broadsideReadySide = null;
    return side;
  }

  getHarpoonOrigin(target = new THREE.Vector3()): THREE.Vector3 {
    return this.root.localToWorld(target.copy(this.harpoonOriginLocal));
  }

  getBroadsideOrigins(side: BroadsideSide): THREE.Vector3[] {
    const offsets = side === 'port' ? this.portCannonOffsets : this.starboardCannonOffsets;
    return offsets.map((offset) => this.root.localToWorld(offset.clone()));
  }

  getReinforcementLaunchOrigins(): THREE.Vector3[] {
    return this.reinforcementLaunchOffsets.map((offset) => this.root.localToWorld(offset.clone()));
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 0, 1).applyQuaternion(this.root.quaternion).normalize();
  }

  getWakeOrigin(target = new THREE.Vector3()): THREE.Vector3 {
    return this.root.localToWorld(target.copy(this.wakeOriginLocal));
  }

  getTowAnchorOrigin(target = new THREE.Vector3()): THREE.Vector3 {
    target.copy(this.towPortOriginLocal).lerp(this.towStarboardOriginLocal, 0.5);
    return this.root.localToWorld(target);
  }

  getTowOrigin(side: BroadsideSide, target = new THREE.Vector3()): THREE.Vector3 {
    return this.root.localToWorld(target.copy(side === 'port' ? this.towPortOriginLocal : this.towStarboardOriginLocal));
  }

  getExtractionAnchor(target = new THREE.Vector3()): THREE.Vector3 {
    return this.root.localToWorld(target.copy(this.harpoonOriginLocal));
  }

  getSubsurfaceRevealPoint(target = new THREE.Vector3()): THREE.Vector3 {
    return this.root.localToWorld(target.copy(this.subsurfaceRevealLocal));
  }

  appendLanternInfluences(target: ShipLanternInfluence[]): void {
    if (this.sinking || this.sunk) {
      return;
    }

    for (const light of this.lanternLights) {
      if (light.intensity <= 0.05) {
        continue;
      }

      target.push({
        position: light.getWorldPosition(new THREE.Vector3()),
        intensity: light.intensity,
      });
    }
  }

  worldToLocalPoint(point: THREE.Vector3, target = new THREE.Vector3()): THREE.Vector3 {
    target.copy(point);
    return this.root.worldToLocal(target);
  }

  private buildRowboat(): void {
    this.harpoonOriginLocal.set(0, 0.88 + this.roleConfig.visualDraftOffset, 2.2);
    this.wakeOriginLocal.set(0, 0.3 + this.roleConfig.visualDraftOffset, -3.2);
    this.towPortOriginLocal.set(-0.64, 0.4 + this.roleConfig.visualDraftOffset, -2.68);
    this.towStarboardOriginLocal.set(0.64, 0.4 + this.roleConfig.visualDraftOffset, -2.68);

    const hullBottom = new THREE.Mesh(new THREE.SphereGeometry(1.16, 12, 10), this.hullMaterial);
    hullBottom.scale.set(0.98, 0.82, 2.04);
    hullBottom.position.set(0, 0.02, 0.16);

    const hullTop = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.28, 4.08), this.hullMaterial);
    hullTop.position.y = 0.52;

    const gunwale = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.12, 4.4), this.mastMaterial);
    gunwale.position.set(0, 0.68, 0.02);

    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 0.5), this.mastMaterial);
    bench.position.set(0, 0.55, -0.1);

    const bow = new THREE.Mesh(new THREE.ConeGeometry(1, 2.2, 5), this.hullMaterial);
    bow.rotation.x = Math.PI / 2;
    bow.position.set(0, 0.22, 3.15);

    const stern = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.44, 0.9), this.hullMaterial);
    stern.position.set(0, 0.42, -2.18);

    const leftOar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.18), this.mastMaterial);
    leftOar.position.set(-1.5, 0.6, -0.1);
    leftOar.rotation.z = 0.16;

    const rightOar = leftOar.clone();
    rightOar.position.x *= -1;
    rightOar.rotation.z *= -1;

    this.fallbackVisualRoot.add(hullBottom, hullTop, gunwale, bench, bow, stern, leftOar, rightOar);
    this.addLantern(new THREE.Vector3(0, 0.92, 0.45));
  }

  private buildFlagship(): void {
    this.harpoonOriginLocal.set(0, 2.4 + this.roleConfig.visualDraftOffset, 7.6);
    this.wakeOriginLocal.set(0, 0.72 + this.roleConfig.visualDraftOffset, -9.4);
    this.towPortOriginLocal.set(-1.7, 1.08 + this.roleConfig.visualDraftOffset, -8.2);
    this.towStarboardOriginLocal.set(1.7, 1.08 + this.roleConfig.visualDraftOffset, -8.2);

    const hullBottom = new THREE.Mesh(new THREE.CapsuleGeometry(2.7, 10.4, 6, 12), this.hullMaterial);
    hullBottom.rotation.x = Math.PI / 2;
    hullBottom.scale.set(1.18, 0.84, 1.08);
    hullBottom.position.set(0, 0.18, 0.2);

    const hullTop = new THREE.Mesh(new THREE.BoxGeometry(6.1, 1.16, 14.2), this.hullMaterial);
    hullTop.position.y = 1.18;

    const rail = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.18, 15.2), this.mastMaterial);
    rail.position.set(0, 1.92, -0.12);

    const foredeck = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.9, 4.4), this.hullMaterial);
    foredeck.position.set(0, 1.74, 4.3);

    const sternDeck = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.1, 4), this.hullMaterial);
    sternDeck.position.set(0, 2.02, -4.5);

    const bow = new THREE.Mesh(new THREE.ConeGeometry(2.8, 5.4, 6), this.hullMaterial);
    bow.rotation.x = Math.PI / 2;
    bow.position.set(0, 0.78, 9.1);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 9.8, 5), this.mastMaterial);
    mast.position.set(0, 5.5, -0.6);

    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 7.2), this.mastMaterial);
    boom.position.set(0, 6.0, -0.4);
    boom.rotation.x = Math.PI / 2;

    const sail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4.2, 5.4), this.sailMaterial);
    sail.position.set(0, 5.9, 0.35);

    this.fallbackVisualRoot.add(hullBottom, hullTop, rail, foredeck, sternDeck, bow, mast, boom, sail);

    const cannonDepths = [4.4, 1.1, -2.2];

    for (const depth of cannonDepths) {
      const portOffset = new THREE.Vector3(-3.4, 1.45, depth);
      const starboardOffset = new THREE.Vector3(3.4, 1.45, depth);
      this.portCannonOffsets.push(portOffset.clone());
      this.starboardCannonOffsets.push(starboardOffset.clone());
      this.addCannon(portOffset, 'port');
      this.addCannon(starboardOffset, 'starboard');
    }

    this.addLantern(new THREE.Vector3(0, 2.35, 5.2));
    this.addLantern(new THREE.Vector3(-1.5, 2.3, -3.1));
    this.addLantern(new THREE.Vector3(1.5, 2.3, -3.1));
    this.addLantern(new THREE.Vector3(0, 2.5, -6.1));
  }

  private buildCorporateWhaler(): void {
    this.harpoonOriginLocal.set(0, 3.8 + this.roleConfig.visualDraftOffset, 14.8);
    this.wakeOriginLocal.set(0, 1.12 + this.roleConfig.visualDraftOffset, -18.4);
    this.towPortOriginLocal.set(-2.1, 1.46 + this.roleConfig.visualDraftOffset, -14.8);
    this.towStarboardOriginLocal.set(2.1, 1.46 + this.roleConfig.visualDraftOffset, -14.8);

    const hullBottom = new THREE.Mesh(new THREE.CapsuleGeometry(2.8, 13.8, 7, 14), this.hullMaterial);
    hullBottom.rotation.x = Math.PI / 2;
    hullBottom.scale.set(1.22, 0.94, 1.12);
    hullBottom.position.set(0, 0.3, 0.45);

    const hullTop = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.4, 18.2), this.hullMaterial);
    hullTop.position.y = 1.78;

    const deckRail = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.2, 19.2), this.mastMaterial);
    deckRail.position.set(0, 2.72, -0.16);

    const bow = new THREE.Mesh(new THREE.ConeGeometry(3.1, 6.2, 7), this.hullMaterial);
    bow.rotation.x = Math.PI / 2;
    bow.position.set(0, 1.02, 11.2);

    const sternBlock = new THREE.Mesh(new THREE.BoxGeometry(6.6, 3, 6.8), this.hullMaterial);
    sternBlock.position.set(0, 2.96, -7.2);

    const midSuperstructure = new THREE.Mesh(new THREE.BoxGeometry(4.8, 4.0, 5.6), this.mastMaterial);
    midSuperstructure.position.set(0, 4.9, 1.7);

    const aftSuperstructure = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4.4, 4.8), this.mastMaterial);
    aftSuperstructure.position.set(0, 5.36, -6.4);

    const foreMast = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.38, 11, 6), this.mastMaterial);
    foreMast.position.set(0, 7.72, 2.6);

    const aftMast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 9.4, 6), this.mastMaterial);
    aftMast.position.set(0, 7.12, -7.2);

    const foreCanvas = new THREE.Mesh(new THREE.BoxGeometry(0.14, 4.8, 5.4), this.sailMaterial);
    foreCanvas.position.set(0, 7.96, 3.2);

    const aftCanvas = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.0, 4.6), this.sailMaterial);
    aftCanvas.position.set(0, 7.26, -7.6);

    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, 3.6, 6), this.mastMaterial);
    funnel.position.set(0, 7.3, -0.7);

    this.fallbackVisualRoot.add(
      hullBottom,
      hullTop,
      deckRail,
      bow,
      sternBlock,
      midSuperstructure,
      aftSuperstructure,
      foreMast,
      aftMast,
      foreCanvas,
      aftCanvas,
      funnel,
    );

    const cannonDepths = [10, 6, 2, -2, -6, -10];

    for (const depth of cannonDepths) {
      const portOffset = new THREE.Vector3(-4.8, 2.1, depth);
      const starboardOffset = new THREE.Vector3(4.8, 2.1, depth);
      this.portCannonOffsets.push(portOffset.clone());
      this.starboardCannonOffsets.push(starboardOffset.clone());
      this.addCannon(portOffset, 'port');
      this.addCannon(starboardOffset, 'starboard');
    }

    const launchOffsets = [
      new THREE.Vector3(-4.9, 1.72, 9),
      new THREE.Vector3(-4.9, 1.72, 4),
      new THREE.Vector3(-4.9, 1.72, -1),
      new THREE.Vector3(-4.9, 1.72, -6),
      new THREE.Vector3(4.9, 1.72, 9),
      new THREE.Vector3(4.9, 1.72, 4),
      new THREE.Vector3(4.9, 1.72, -1),
      new THREE.Vector3(4.9, 1.72, -6),
      new THREE.Vector3(-2.2, 1.58, -11.8),
      new THREE.Vector3(2.2, 1.58, -11.8),
    ];

    for (const offset of launchOffsets) {
      this.reinforcementLaunchOffsets.push(offset);
    }

    this.addLantern(new THREE.Vector3(0, 4.7, 6.8));
    this.addLantern(new THREE.Vector3(-2.2, 5.1, 1.8));
    this.addLantern(new THREE.Vector3(2.2, 5.1, 1.8));
    this.addLantern(new THREE.Vector3(-2.8, 5.7, -6.4));
    this.addLantern(new THREE.Vector3(2.8, 5.7, -6.4));
    this.addLantern(new THREE.Vector3(0, 6, -9.8));
  }

  private addCannon(offset: THREE.Vector3, side: BroadsideSide): void {
    const cannonMaterial = createCelMaterial({
      color: '#2b313b',
      emissive: '#ff9e56',
      emissiveIntensity: 0,
    });

    const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.9, 8), cannonMaterial);
    cannon.position.copy(offset);
    cannon.rotation.z = Math.PI / 2;

    if (side === 'port') {
      cannon.rotation.y = Math.PI;
      this.portCannons.push(cannon);
      this.cannonPortMaterials.push(cannonMaterial);
    } else {
      this.starboardCannons.push(cannon);
      this.cannonStarboardMaterials.push(cannonMaterial);
    }

    this.visualRoot.add(cannon);
  }

  private addLantern(offset: THREE.Vector3): void {
    const lanternMaterial = createCelMaterial({
      color: '#ffd18f',
      emissive: '#ffac4c',
      emissiveIntensity: 0.9,
    });

    const lanternRadius = this.role === 'corporate_whaler' ? 0.34 : this.role === 'flagship' ? 0.28 : 0.22;
    const haloRadius = this.role === 'corporate_whaler' ? 1.5 : this.role === 'flagship' ? 1.2 : 0.9;
    const lightIntensity = this.role === 'corporate_whaler' ? 3.2 : this.role === 'flagship' ? 2.6 : 1.5;
    const lightDistance = this.role === 'corporate_whaler' ? 30 : this.role === 'flagship' ? 24 : 16;

    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(lanternRadius, 8, 8),
      lanternMaterial,
    );
    lantern.position.copy(offset);

    const lanternHaloMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffcf8f'),
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    lanternHaloMaterial.toneMapped = false;

    const lanternHalo = new THREE.Mesh(
      new THREE.SphereGeometry(haloRadius, 10, 10),
      lanternHaloMaterial,
    );
    lanternHalo.position.copy(offset);

    const lanternLight = new THREE.PointLight('#ffb25a', lightIntensity, lightDistance, 2);
    lanternLight.position.copy(offset);

    this.lanternMaterials.push(lanternMaterial);
    this.lanternMeshes.push(lantern);
    this.lanternHaloMaterials.push(lanternHaloMaterial);
    this.lanternHalos.push(lanternHalo);
    this.lanternLights.push(lanternLight);

    this.visualRoot.add(lantern, lanternHalo, lanternLight);
  }

  private updateCannonTelegraphVisuals(telegraphAlpha: number): void {
    const portTelegraph = this.broadsideTelegraphSide === 'port' ? telegraphAlpha : 0;
    const starboardTelegraph = this.broadsideTelegraphSide === 'starboard' ? telegraphAlpha : 0;
    const portFlash = this.broadsideFlashSide === 'port' ? this.broadsideFlash : 0;
    const starboardFlash = this.broadsideFlashSide === 'starboard' ? this.broadsideFlash : 0;

    for (const material of this.cannonPortMaterials) {
      material.emissiveIntensity = portTelegraph * 1.1 + portFlash * 1.6;
    }

    for (const material of this.cannonStarboardMaterials) {
      material.emissiveIntensity = starboardTelegraph * 1.1 + starboardFlash * 1.6;
    }
  }

  private updateDamageLook(): void {
    const damageRatio = 1 - this.healthPercent;
    const hullBase =
      this.role === 'corporate_whaler'
        ? new THREE.Color('#4a372b')
        : this.role === 'flagship'
          ? new THREE.Color('#5e4330')
          : new THREE.Color('#4c3828');
    const hullDamage =
      this.role === 'corporate_whaler'
        ? new THREE.Color('#1b1411')
        : this.role === 'flagship'
          ? new THREE.Color('#23150f')
          : new THREE.Color('#1e1410');
    const mastBase =
      this.role === 'corporate_whaler'
        ? new THREE.Color('#6f5c4c')
        : this.role === 'flagship'
          ? new THREE.Color('#8c674d')
          : new THREE.Color('#81614a');
    const mastDamage =
      this.role === 'corporate_whaler'
        ? new THREE.Color('#332922')
        : this.role === 'flagship'
          ? new THREE.Color('#403127')
          : new THREE.Color('#3c2e24');
    const sailBase =
      this.role === 'corporate_whaler'
        ? new THREE.Color('#8f816c')
        : this.role === 'flagship'
          ? new THREE.Color('#ccb996')
          : new THREE.Color('#9e8a6a');
    const sailDamage =
      this.role === 'corporate_whaler'
        ? new THREE.Color('#4b4439')
        : this.role === 'flagship'
          ? new THREE.Color('#6f6351')
          : new THREE.Color('#56493a');

    for (const material of this.hullTintMaterials) {
      material.color.copy(hullBase).lerp(hullDamage, damageRatio * 0.75);
    }

    for (const material of this.mastTintMaterials) {
      material.color.copy(mastBase).lerp(mastDamage, damageRatio * 0.68);
    }

    for (const material of this.sailTintMaterials) {
      material.color.copy(sailBase).lerp(sailDamage, damageRatio * 0.42);
    }

    for (const lanternMaterial of this.lanternMaterials) {
      lanternMaterial.color.set('#ffd18f').lerp(new THREE.Color('#6d4d28'), damageRatio * 0.6);
    }
  }
}

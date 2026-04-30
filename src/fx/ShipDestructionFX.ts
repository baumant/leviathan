import * as THREE from 'three';

import {
  createCapitalShipWreckVisualAsset,
  releaseCapitalShipWreckVisualAsset,
  type CapitalShipVisualRole,
  type CapitalShipWreckVisualAsset,
} from '../entities/CapitalShipVisualAsset';
import type { ShipRole } from '../entities/Ship';
import { createCelMaterial } from './createCelMaterial';
import {
  WATER_FOAM_GOLDEN_ANGLE,
  WaterFoamStampLayer,
} from './WaterFoamStampLayer';

export type ShipDestructionTriggerKind =
  | 'ram'
  | 'breach_launch'
  | 'breach_slam'
  | 'tail_slap'
  | 'drag_under'
  | 'fallback';

export interface ShipDestructionSnapshot {
  readonly shipId: string;
  readonly role: ShipRole;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scale: THREE.Vector3;
  readonly halfExtents: THREE.Vector3;
  readonly surfaceHeight: number;
}

export interface ShipDestructionTrigger {
  readonly kind: ShipDestructionTriggerKind;
  readonly origin: THREE.Vector3;
  readonly direction: THREE.Vector3;
  readonly intensity: number;
}

interface ShipDestructionRoleProfile {
  readonly lifetime: number;
  readonly wreckLifetime?: number;
  readonly splinterCount: readonly [number, number];
  readonly hullChunkCount: readonly [number, number];
  readonly mastCount: readonly [number, number];
  readonly sailCount: readonly [number, number];
  readonly sparkCount: readonly [number, number];
  readonly foamRadius: number;
  readonly foamOpacity: number;
  readonly horizontalImpulse: number;
  readonly verticalImpulse: number;
  readonly sinkRate: number;
  readonly gravityScale: number;
  readonly chunkScale: number;
  readonly splinterScale: number;
}

interface DebrisPieceState {
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly rotation: THREE.Euler;
  readonly spin: THREE.Vector3;
  readonly scale: THREE.Vector3;
  waterAge: number;
  extinguished: boolean;
}

interface CapitalWreckHalfState {
  readonly root: THREE.Group;
  readonly visual: CapitalShipWreckVisualAsset;
  readonly clippingPlane: THREE.Plane;
  readonly localClippingPlane: THREE.Plane;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly angularVelocity: THREE.Vector3;
  readonly rotation: THREE.Euler;
  readonly baseQuaternion: THREE.Quaternion;
  readonly baseScale: THREE.Vector3;
  readonly seamPlanks: THREE.Mesh<THREE.BoxGeometry, THREE.MeshToonMaterial>[];
  readonly bottomClearance: number;
  sinkDepth: number;
  settled: boolean;
}

interface CapitalWreckState {
  readonly role: CapitalShipVisualRole;
  readonly bow: CapitalWreckHalfState;
  readonly stern: CapitalWreckHalfState;
  sinkSpeed: number;
  rollDamping: number;
}

interface DestructionSlot {
  readonly root: THREE.Group;
  readonly splinters: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshToonMaterial>;
  readonly hullChunks: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshToonMaterial>;
  readonly masts: THREE.InstancedMesh<THREE.CylinderGeometry, THREE.MeshToonMaterial>;
  readonly sails: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly sparks: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  readonly sparkLight: THREE.PointLight;
  readonly foam: WaterFoamStampLayer;
  readonly splinterPieces: DebrisPieceState[];
  readonly hullPieces: DebrisPieceState[];
  readonly mastPieces: DebrisPieceState[];
  readonly sailPieces: DebrisPieceState[];
  readonly sparkPieces: DebrisPieceState[];
  readonly anchor: THREE.Vector3;
  capitalWreck: CapitalWreckState | null;
  active: boolean;
  age: number;
  lifetime: number;
  debrisLifetime: number;
  wreckLifetime: number;
  intensity: number;
  foamRadius: number;
  foamOpacity: number;
  sinkRate: number;
  gravityScale: number;
  splinterCount: number;
  hullChunkCount: number;
  mastCount: number;
  sailCount: number;
  sparkCount: number;
}

const MAX_BURSTS = 8;
const MAX_SPLINTERS = 64;
const MAX_HULL_CHUNKS = 18;
const MAX_MASTS = 6;
const MAX_SAILS = 12;
const MAX_SPARKS = 1;
const MAX_FOAM_STAMPS = 112;
const MAX_FOAM_CUTOUTS = MAX_FOAM_STAMPS * 3;
const SURFACE_OFFSET = 0.1;
const GRAVITY = 13.6;
const AIR_DRAG = 0.78;
const WATER_DRAG = 4.4;
const FOAM_RENDER_ORDER = 26;
const DEBRIS_RENDER_ORDER = 18;
const WRECK_RENDER_ORDER = 17;

const CAPITAL_WRECK_LOCAL_BOUNDS: Record<
  CapitalShipVisualRole,
  {
    readonly minZ: number;
    readonly maxZ: number;
    readonly splitZ: number;
  }
> = {
  flagship: {
    minZ: -7.4,
    maxZ: 11,
    splitZ: 1.8,
  },
  corporate_whaler: {
    minZ: -12.55,
    maxZ: 15.25,
    splitZ: 1.35,
  },
};

const ROLE_PROFILES: Record<ShipRole, ShipDestructionRoleProfile> = {
  rowboat: {
    lifetime: 1.35,
    splinterCount: [12, 20],
    hullChunkCount: [2, 4],
    mastCount: [0, 1],
    sailCount: [0, 0],
    sparkCount: [1, 1],
    foamRadius: 3.8,
    foamOpacity: 0.36,
    horizontalImpulse: 8.4,
    verticalImpulse: 7.6,
    sinkRate: 1.15,
    gravityScale: 1.08,
    chunkScale: 0.92,
    splinterScale: 0.9,
  },
  flagship: {
    lifetime: 2.65,
    wreckLifetime: 92,
    splinterCount: [10, 18],
    hullChunkCount: [2, 4],
    mastCount: [1, 2],
    sailCount: [2, 3],
    sparkCount: [1, 1],
    foamRadius: 8.4,
    foamOpacity: 0.42,
    horizontalImpulse: 10.2,
    verticalImpulse: 8.8,
    sinkRate: 0.82,
    gravityScale: 0.9,
    chunkScale: 1.55,
    splinterScale: 1.18,
  },
  corporate_whaler: {
    lifetime: 3.15,
    wreckLifetime: 108,
    splinterCount: [8, 14],
    hullChunkCount: [3, 5],
    mastCount: [1, 2],
    sailCount: [2, 3],
    sparkCount: [1, 1],
    foamRadius: 11.6,
    foamOpacity: 0.44,
    horizontalImpulse: 8.4,
    verticalImpulse: 7.4,
    sinkRate: 0.68,
    gravityScale: 0.82,
    chunkScale: 2.2,
    splinterScale: 1.35,
  },
};

const CAPITAL_DAMAGE_DEBRIS_PROFILES: Record<CapitalShipVisualRole, ShipDestructionRoleProfile> = {
  flagship: {
    lifetime: 1.25,
    splinterCount: [4, 8],
    hullChunkCount: [0, 2],
    mastCount: [0, 1],
    sailCount: [0, 1],
    sparkCount: [0, 1],
    foamRadius: 4.2,
    foamOpacity: 0.16,
    horizontalImpulse: 6.6,
    verticalImpulse: 4.2,
    sinkRate: 0.76,
    gravityScale: 1,
    chunkScale: 1.15,
    splinterScale: 0.96,
  },
  corporate_whaler: {
    lifetime: 1.45,
    splinterCount: [5, 9],
    hullChunkCount: [1, 2],
    mastCount: [0, 1],
    sailCount: [0, 1],
    sparkCount: [0, 1],
    foamRadius: 5.4,
    foamOpacity: 0.14,
    horizontalImpulse: 5.4,
    verticalImpulse: 3.7,
    sinkRate: 0.68,
    gravityScale: 0.94,
    chunkScale: 1.55,
    splinterScale: 1.08,
  },
};

export class ShipDestructionFX {
  private readonly root = new THREE.Group();
  private readonly splinterGeometry = new THREE.BoxGeometry(0.12, 0.12, 1);
  private readonly hullChunkGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly mastGeometry = new THREE.CylinderGeometry(0.16, 0.2, 1, 6);
  private readonly sailGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly sparkGeometry = new THREE.SphereGeometry(0.16, 8, 6);
  private readonly fracturePlankGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly fracturePlankMaterial = createCelMaterial({
    color: '#1d120e',
    emissive: '#07080a',
    emissiveIntensity: 0.02,
  });
  private readonly slots: DestructionSlot[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly tempDirection = new THREE.Vector3();
  private readonly tempForward = new THREE.Vector3();
  private readonly tempRight = new THREE.Vector3();
  private readonly tempUp = new THREE.Vector3();
  private readonly tempOffset = new THREE.Vector3();
  private readonly tempSideVector = new THREE.Vector3();
  private readonly tempForwardVector = new THREE.Vector3();
  private readonly tempOutward = new THREE.Vector3();
  private readonly tempQuaternion = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    this.root.renderOrder = DEBRIS_RENDER_ORDER;
    this.fracturePlankMaterial.fog = true;
    scene.add(this.root);

    for (let index = 0; index < MAX_BURSTS; index += 1) {
      this.slots.push(this.createSlot());
    }

    this.reset();
  }

  spawn(snapshot: ShipDestructionSnapshot, trigger: ShipDestructionTrigger): void {
    const slot = this.claimSlot();

    if (!slot) {
      return;
    }

    const profile = ROLE_PROFILES[snapshot.role];
    const triggerProfile = this.getTriggerProfile(trigger.kind);
    const debrisLifetime = profile.lifetime * triggerProfile.lifetimeScale;
    const wreckLifetime =
      snapshot.role === 'rowboat'
        ? debrisLifetime
        : (profile.wreckLifetime ?? profile.lifetime) * triggerProfile.lifetimeScale;
    const { triggerDirection, intensity } = this.activateDebrisSlot({
      slot,
      snapshot,
      trigger,
      profile,
      intensity: THREE.MathUtils.clamp(trigger.intensity, 0.22, 1.18),
      debrisLifetime,
      wreckLifetime,
    });

    if (snapshot.role !== 'rowboat') {
      const hasWreck = this.spawnCapitalWreck(slot, snapshot, triggerDirection, intensity);

      if (!hasWreck) {
        slot.wreckLifetime = slot.debrisLifetime;
        slot.lifetime = slot.debrisLifetime;
      }
    }

    this.updateSlotMatrices(slot, 0, () => snapshot.surfaceHeight);
  }

  spawnDamage(snapshot: ShipDestructionSnapshot, trigger: ShipDestructionTrigger, damageRatio: number): void {
    if (snapshot.role === 'rowboat') {
      return;
    }

    const slot = this.claimSlot(true);

    if (!slot) {
      return;
    }

    const role: CapitalShipVisualRole = snapshot.role === 'corporate_whaler' ? 'corporate_whaler' : 'flagship';
    const profile = CAPITAL_DAMAGE_DEBRIS_PROFILES[role];
    const scaledDamage = THREE.MathUtils.clamp(damageRatio, 0.015, 0.18);
    const intensity = THREE.MathUtils.clamp(Math.max(trigger.intensity * 0.72, scaledDamage * 5.4), 0.2, 0.86);
    const debrisLifetime = profile.lifetime * THREE.MathUtils.lerp(0.9, 1.24, intensity);

    this.activateDebrisSlot({
      slot,
      snapshot,
      trigger,
      profile,
      intensity,
      debrisLifetime,
      wreckLifetime: debrisLifetime,
    });
    this.updateSlotMatrices(slot, 0, () => snapshot.surfaceHeight);
  }

  private activateDebrisSlot(params: {
    slot: DestructionSlot;
    snapshot: ShipDestructionSnapshot;
    trigger: ShipDestructionTrigger;
    profile: ShipDestructionRoleProfile;
    intensity: number;
    debrisLifetime: number;
    wreckLifetime: number;
  }): {
    triggerDirection: THREE.Vector3;
    intensity: number;
  } {
    const { slot, snapshot, trigger, profile, intensity, debrisLifetime, wreckLifetime } = params;
    const triggerDirection = this.resolveTriggerDirection(snapshot, trigger);
    const triggerProfile = this.getTriggerProfile(trigger.kind);

    this.clearCapitalWreck(slot);
    slot.active = true;
    slot.age = 0;
    slot.debrisLifetime = debrisLifetime;
    slot.wreckLifetime = wreckLifetime;
    slot.lifetime = Math.max(debrisLifetime, wreckLifetime);
    slot.intensity = intensity;
    slot.foamRadius = profile.foamRadius * THREE.MathUtils.lerp(0.82, 1.18, intensity);
    slot.foamOpacity = profile.foamOpacity;
    slot.sinkRate = profile.sinkRate * triggerProfile.sinkScale;
    slot.gravityScale = profile.gravityScale * triggerProfile.gravityScale;
    slot.anchor.set(snapshot.position.x, snapshot.surfaceHeight + SURFACE_OFFSET, snapshot.position.z);
    slot.root.position.set(0, 0, 0);
    slot.root.visible = true;

    slot.splinterCount = this.randomCount(profile.splinterCount);
    slot.hullChunkCount = this.randomCount(profile.hullChunkCount);
    slot.mastCount = this.randomCount(profile.mastCount);
    slot.sailCount = this.randomCount(profile.sailCount);
    slot.sparkCount = this.randomCount(profile.sparkCount);

    this.tempForward.set(0, 0, 1).applyQuaternion(snapshot.quaternion).setY(0);
    if (this.tempForward.lengthSq() <= 0.0001) {
      this.tempForward.set(0, 0, 1);
    } else {
      this.tempForward.normalize();
    }

    this.tempRight.set(1, 0, 0).applyQuaternion(snapshot.quaternion).setY(0);
    if (this.tempRight.lengthSq() <= 0.0001) {
      this.tempRight.crossVectors(this.tempForward, new THREE.Vector3(0, 1, 0)).normalize();
    } else {
      this.tempRight.normalize();
    }

    this.tempUp.set(0, 1, 0);

    this.seedPieces({
      pieces: slot.splinterPieces,
      count: slot.splinterCount,
      snapshot,
      triggerDirection,
      horizontalImpulse: profile.horizontalImpulse * triggerProfile.horizontalScale,
      verticalImpulse: profile.verticalImpulse * triggerProfile.verticalScale,
      baseScale: profile.splinterScale,
      category: 'splinter',
    });
    this.seedPieces({
      pieces: slot.hullPieces,
      count: slot.hullChunkCount,
      snapshot,
      triggerDirection,
      horizontalImpulse: profile.horizontalImpulse * 0.74 * triggerProfile.horizontalScale,
      verticalImpulse: profile.verticalImpulse * 0.72 * triggerProfile.verticalScale,
      baseScale: profile.chunkScale,
      category: 'chunk',
    });
    this.seedPieces({
      pieces: slot.mastPieces,
      count: slot.mastCount,
      snapshot,
      triggerDirection,
      horizontalImpulse: profile.horizontalImpulse * 0.8 * triggerProfile.horizontalScale,
      verticalImpulse: profile.verticalImpulse * 1.05 * triggerProfile.verticalScale,
      baseScale: profile.splinterScale,
      category: 'mast',
    });
    this.seedPieces({
      pieces: slot.sailPieces,
      count: slot.sailCount,
      snapshot,
      triggerDirection,
      horizontalImpulse: profile.horizontalImpulse * 0.62 * triggerProfile.horizontalScale,
      verticalImpulse: profile.verticalImpulse * 0.82 * triggerProfile.verticalScale,
      baseScale: profile.chunkScale,
      category: 'sail',
    });
    this.seedPieces({
      pieces: slot.sparkPieces,
      count: slot.sparkCount,
      snapshot,
      triggerDirection,
      horizontalImpulse: profile.horizontalImpulse * 0.46,
      verticalImpulse: profile.verticalImpulse * 1.16,
      baseScale: profile.splinterScale,
      category: 'spark',
    });

    return {
      triggerDirection,
      intensity,
    };
  }

  update(
    deltaSeconds: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
    sampleFloorHeight?: (x: number, z: number) => number,
  ): void {
    for (const slot of this.slots) {
      if (!slot.active) {
        continue;
      }

      slot.age += deltaSeconds;

      if (slot.age >= slot.lifetime) {
        this.deactivateSlot(slot);
        continue;
      }

      this.updateSlotMatrices(slot, deltaSeconds, sampleSurfaceHeight, sampleFloorHeight);
    }
  }

  reset(): void {
    for (const slot of this.slots) {
      this.deactivateSlot(slot);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.splinterGeometry.dispose();
    this.hullChunkGeometry.dispose();
    this.mastGeometry.dispose();
    this.sailGeometry.dispose();
    this.sparkGeometry.dispose();
    this.fracturePlankGeometry.dispose();
    this.fracturePlankMaterial.dispose();

    for (const slot of this.slots) {
      this.clearCapitalWreck(slot);
      slot.splinters.material.dispose();
      slot.hullChunks.material.dispose();
      slot.masts.material.dispose();
      slot.sails.material.dispose();
      slot.sparks.material.dispose();
      slot.foam.dispose();
    }
  }

  private createSlot(): DestructionSlot {
    const root = new THREE.Group();
    root.visible = false;

    const splinters = new THREE.InstancedMesh(
      this.splinterGeometry,
      this.createWoodMaterial('#3f2d22', 0.98),
      MAX_SPLINTERS,
    );
    const hullChunks = new THREE.InstancedMesh(
      this.hullChunkGeometry,
      this.createWoodMaterial('#2b1c16', 0.98),
      MAX_HULL_CHUNKS,
    );
    const masts = new THREE.InstancedMesh(this.mastGeometry, this.createWoodMaterial('#614a38', 0.96), MAX_MASTS);
    const sails = new THREE.InstancedMesh(this.sailGeometry, this.createSailMaterial(), MAX_SAILS);
    const sparks = new THREE.InstancedMesh(this.sparkGeometry, this.createSparkMaterial(), MAX_SPARKS);
    const sparkLight = new THREE.PointLight('#f2ac5d', 0, 7, 2);
    const foam = new WaterFoamStampLayer(root, {
      maxStamps: MAX_FOAM_STAMPS,
      maxCutouts: MAX_FOAM_CUTOUTS,
      color: '#d7e6e2',
      opacity: 0.44,
      blending: THREE.NormalBlending,
      renderOrder: FOAM_RENDER_ORDER,
      cutoutRenderOrder: FOAM_RENDER_ORDER - 0.3,
    });

    for (const mesh of [splinters, hullChunks, masts, sails, sparks]) {
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = DEBRIS_RENDER_ORDER;
    }

    sparkLight.visible = false;

    root.add(splinters, hullChunks, masts, sails, sparks, sparkLight);
    this.root.add(root);

    return {
      root,
      splinters,
      hullChunks,
      masts,
      sails,
      sparks,
      sparkLight,
      foam,
      splinterPieces: this.createPiecePool(MAX_SPLINTERS),
      hullPieces: this.createPiecePool(MAX_HULL_CHUNKS),
      mastPieces: this.createPiecePool(MAX_MASTS),
      sailPieces: this.createPiecePool(MAX_SAILS),
      sparkPieces: this.createPiecePool(MAX_SPARKS),
      anchor: new THREE.Vector3(),
      capitalWreck: null,
      active: false,
      age: 0,
      lifetime: 0,
      debrisLifetime: 0,
      wreckLifetime: 0,
      intensity: 0,
      foamRadius: 1,
      foamOpacity: 0,
      sinkRate: 0,
      gravityScale: 1,
      splinterCount: 0,
      hullChunkCount: 0,
      mastCount: 0,
      sailCount: 0,
      sparkCount: 0,
    };
  }

  private createPiecePool(count: number): DebrisPieceState[] {
    const pieces: DebrisPieceState[] = [];

    for (let index = 0; index < count; index += 1) {
      pieces.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        rotation: new THREE.Euler(),
        spin: new THREE.Vector3(),
        scale: new THREE.Vector3(),
        waterAge: 0,
        extinguished: false,
      });
    }

    return pieces;
  }

  private createWoodMaterial(color: THREE.ColorRepresentation, opacity: number): THREE.MeshToonMaterial {
    const material = createCelMaterial({
      color,
      emissive: '#08090b',
      emissiveIntensity: 0.03,
      transparent: true,
      opacity,
      depthWrite: true,
    });
    material.fog = true;
    return material;
  }

  private createSailMaterial(): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: '#b7ad8f',
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    material.fog = true;
    return material;
  }

  private createSparkMaterial(): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: '#f2ac5d',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    material.fog = true;
    material.toneMapped = false;
    return material;
  }

  private claimSlot(preserveCapitalWrecks = false): DestructionSlot | null {
    const inactiveSlot = this.slots.find((slot) => !slot.active);

    if (inactiveSlot) {
      return inactiveSlot;
    }

    if (!preserveCapitalWrecks) {
      return this.slots.reduce((oldest, slot) => (slot.age > oldest.age ? slot : oldest), this.slots[0]);
    }

    const reusableSlots = this.slots.filter((slot) => !slot.capitalWreck);

    if (reusableSlots.length <= 0) {
      return null;
    }

    return reusableSlots.reduce((oldest, slot) => (slot.age > oldest.age ? slot : oldest), reusableSlots[0]);
  }

  private deactivateSlot(slot: DestructionSlot): void {
    this.clearCapitalWreck(slot);
    slot.active = false;
    slot.age = 0;
    slot.lifetime = 0;
    slot.debrisLifetime = 0;
    slot.wreckLifetime = 0;
    slot.root.visible = false;
    slot.root.position.set(0, 0, 0);
    slot.splinters.count = 0;
    slot.hullChunks.count = 0;
    slot.masts.count = 0;
    slot.sails.count = 0;
    slot.sparks.count = 0;
    slot.sparkLight.visible = false;
    slot.sparkLight.intensity = 0;
    slot.foam.reset();
  }

  private resolveTriggerDirection(
    snapshot: ShipDestructionSnapshot,
    trigger: ShipDestructionTrigger,
  ): THREE.Vector3 {
    this.tempDirection.copy(trigger.direction);

    if (this.tempDirection.lengthSq() <= 0.0001) {
      this.tempDirection.copy(snapshot.position).sub(trigger.origin);
    }

    if (this.tempDirection.lengthSq() <= 0.0001) {
      this.tempDirection.set(0, 0, 1).applyQuaternion(snapshot.quaternion);
    }

    if (this.tempDirection.lengthSq() <= 0.0001) {
      this.tempDirection.set(0, 0, 1);
    }

    return this.tempDirection.normalize();
  }

  private getTriggerProfile(kind: ShipDestructionTriggerKind): {
    horizontalScale: number;
    verticalScale: number;
    gravityScale: number;
    sinkScale: number;
    lifetimeScale: number;
  } {
    switch (kind) {
      case 'breach_launch':
        return {
          horizontalScale: 0.82,
          verticalScale: 1.42,
          gravityScale: 0.92,
          sinkScale: 0.88,
          lifetimeScale: 1.08,
        };
      case 'breach_slam':
        return { horizontalScale: 1.08, verticalScale: 1.04, gravityScale: 1, sinkScale: 1, lifetimeScale: 1 };
      case 'tail_slap':
        return {
          horizontalScale: 1.26,
          verticalScale: 0.78,
          gravityScale: 1.08,
          sinkScale: 1.08,
          lifetimeScale: 0.96,
        };
      case 'drag_under':
        return {
          horizontalScale: 0.48,
          verticalScale: 0.34,
          gravityScale: 0.86,
          sinkScale: 1.5,
          lifetimeScale: 1.12,
        };
      case 'ram':
        return { horizontalScale: 1.18, verticalScale: 0.82, gravityScale: 1.04, sinkScale: 1, lifetimeScale: 0.98 };
      default:
        return { horizontalScale: 0.9, verticalScale: 0.8, gravityScale: 1, sinkScale: 1, lifetimeScale: 1 };
    }
  }

  private spawnCapitalWreck(
    slot: DestructionSlot,
    snapshot: ShipDestructionSnapshot,
    triggerDirection: THREE.Vector3,
    intensity: number,
  ): boolean {
    const role: CapitalShipVisualRole = snapshot.role === 'corporate_whaler' ? 'corporate_whaler' : 'flagship';
    const bowClippingPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const sternClippingPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const bowVisual = createCapitalShipWreckVisualAsset(role, bowClippingPlane);
    const sternVisual = createCapitalShipWreckVisualAsset(role, sternClippingPlane);

    if (!bowVisual || !sternVisual) {
      if (bowVisual) {
        releaseCapitalShipWreckVisualAsset(bowVisual);
      }

      if (sternVisual) {
        releaseCapitalShipWreckVisualAsset(sternVisual);
      }

      return false;
    }

    const isCorporate = role === 'corporate_whaler';
    const metrics = CAPITAL_WRECK_LOCAL_BOUNDS[role];
    const bowCenterLocalZ = (metrics.splitZ + metrics.maxZ) * 0.5;
    const sternCenterLocalZ = (metrics.minZ + metrics.splitZ) * 0.5;
    const bowCutLocalZ = metrics.splitZ - bowCenterLocalZ;
    const sternCutLocalZ = metrics.splitZ - sternCenterLocalZ;
    const separationSpeed = isCorporate ? 4.35 : 6.3;
    const sideSeparationSpeed = isCorporate ? 1.1 : 1.55;
    const impactSpeed = isCorporate ? 0.82 : 1.08;
    const sinkSpeed = isCorporate ? 1.85 : 2.15;
    const localHalfWidth = Math.max(1.6, snapshot.halfExtents.x / Math.max(snapshot.scale.x, 0.001) * 0.58);
    const localHalfHeight = Math.max(1.1, snapshot.halfExtents.y / Math.max(snapshot.scale.y, 0.001) * 0.42);
    const impactSide = Math.sign(triggerDirection.dot(this.tempRight)) || this.randomSign();
    const cutFaceGap =
      Math.max(isCorporate ? 8.8 : 4.8, snapshot.halfExtents.z * (isCorporate ? 0.2 : 0.24)) *
      THREE.MathUtils.lerp(0.86, 1.16, intensity);
    const flattenedImpact = triggerDirection.clone().setY(0);

    if (flattenedImpact.lengthSq() <= 0.0001) {
      flattenedImpact.copy(this.tempRight).multiplyScalar(impactSide);
    } else {
      flattenedImpact.normalize();
    }

    const lateralOffset = cutFaceGap * (isCorporate ? 0.18 : 0.24);
    const bowPositionOffset = this.tempForward
      .clone()
      .multiplyScalar(bowCenterLocalZ * snapshot.scale.z + cutFaceGap * 0.56)
      .addScaledVector(this.tempRight, impactSide * lateralOffset)
      .addScaledVector(flattenedImpact, cutFaceGap * 0.05 * intensity);
    const sternPositionOffset = this.tempForward
      .clone()
      .multiplyScalar(sternCenterLocalZ * snapshot.scale.z - cutFaceGap * 0.5)
      .addScaledVector(this.tempRight, -impactSide * lateralOffset * 0.82)
      .addScaledVector(flattenedImpact, -cutFaceGap * 0.03 * intensity);
    const bowVelocity = this.tempForward
      .clone()
      .multiplyScalar(separationSpeed)
      .addScaledVector(this.tempRight, impactSide * sideSeparationSpeed)
      .addScaledVector(triggerDirection, impactSpeed * 0.24 * intensity);
    const sternVelocity = this.tempForward
      .clone()
      .multiplyScalar(-separationSpeed * 0.78)
      .addScaledVector(this.tempRight, -impactSide * sideSeparationSpeed * 0.74)
      .addScaledVector(triggerDirection, -impactSpeed * 0.12 * intensity);

    bowVelocity.y = isCorporate ? -0.04 : 0.04;
    sternVelocity.y = isCorporate ? -0.12 : -0.06;

    const bow = this.createCapitalWreckHalf({
      visual: bowVisual,
      clippingPlane: bowClippingPlane,
      localClippingPlane: new THREE.Plane(new THREE.Vector3(0, 0, -1), bowCutLocalZ),
      snapshot,
      positionOffset: bowPositionOffset,
      visualLocalOffset: new THREE.Vector3(0, 0, -bowCenterLocalZ),
      velocity: bowVelocity,
      angularVelocity: new THREE.Vector3(isCorporate ? -0.2 : -0.34, 0, -impactSide * (isCorporate ? 0.18 : 0.28)),
      seamSide: 1,
      seamLocalZ: bowCutLocalZ,
      splitWidth: localHalfWidth,
      splitHeight: localHalfHeight,
      bottomClearance: isCorporate ? 0.9 : 0.65,
    });
    const stern = this.createCapitalWreckHalf({
      visual: sternVisual,
      clippingPlane: sternClippingPlane,
      localClippingPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), -sternCutLocalZ),
      snapshot,
      positionOffset: sternPositionOffset,
      visualLocalOffset: new THREE.Vector3(0, 0, -sternCenterLocalZ),
      velocity: sternVelocity,
      angularVelocity: new THREE.Vector3(isCorporate ? 0.08 : 0.14, 0, impactSide * (isCorporate ? 0.12 : 0.2)),
      seamSide: -1,
      seamLocalZ: sternCutLocalZ,
      splitWidth: localHalfWidth,
      splitHeight: localHalfHeight,
      bottomClearance: isCorporate ? 0.85 : 0.58,
    });

    slot.root.add(bow.root, stern.root);
    slot.capitalWreck = {
      role,
      bow,
      stern,
      sinkSpeed,
      rollDamping: isCorporate ? 0.75 : 1.05,
    };
    return true;
  }

  private createCapitalWreckHalf(params: {
    visual: CapitalShipWreckVisualAsset;
    clippingPlane: THREE.Plane;
    localClippingPlane: THREE.Plane;
    snapshot: ShipDestructionSnapshot;
    positionOffset: THREE.Vector3;
    visualLocalOffset: THREE.Vector3;
    velocity: THREE.Vector3;
    angularVelocity: THREE.Vector3;
    seamSide: number;
    seamLocalZ: number;
    splitWidth: number;
    splitHeight: number;
    bottomClearance: number;
  }): CapitalWreckHalfState {
    const root = new THREE.Group();
    const seamPlanks = this.createSeamPlanks(
      params.seamSide,
      params.splitWidth,
      params.splitHeight,
      params.seamLocalZ,
    );
    const initialPosition = params.snapshot.position.clone().add(params.positionOffset);

    params.visual.root.position.copy(params.visualLocalOffset);
    root.position.copy(initialPosition);
    root.quaternion.copy(params.snapshot.quaternion);
    root.scale.copy(params.snapshot.scale);
    root.renderOrder = WRECK_RENDER_ORDER;
    root.add(params.visual.root, ...seamPlanks);
    root.traverse((object) => {
      object.frustumCulled = true;
      object.renderOrder = WRECK_RENDER_ORDER;
    });
    for (const plank of seamPlanks) {
      plank.renderOrder = WRECK_RENDER_ORDER + 1;
    }
    root.updateMatrixWorld(true);
    params.clippingPlane.copy(params.localClippingPlane).applyMatrix4(root.matrixWorld);

    return {
      root,
      visual: params.visual,
      clippingPlane: params.clippingPlane,
      localClippingPlane: params.localClippingPlane,
      position: initialPosition,
      velocity: params.velocity.clone(),
      angularVelocity: params.angularVelocity.clone(),
      rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
      baseQuaternion: params.snapshot.quaternion.clone(),
      baseScale: params.snapshot.scale.clone(),
      seamPlanks,
      bottomClearance: params.bottomClearance,
      sinkDepth: 0,
      settled: false,
    };
  }

  private createSeamPlanks(
    sideSign: number,
    localHalfWidth: number,
    localHalfHeight: number,
    seamLocalZ: number,
  ): THREE.Mesh<THREE.BoxGeometry, THREE.MeshToonMaterial>[] {
    const planks: THREE.Mesh<THREE.BoxGeometry, THREE.MeshToonMaterial>[] = [];
    const plankCount = THREE.MathUtils.randInt(6, 9);

    for (let index = 0; index < plankCount; index += 1) {
      const plank = new THREE.Mesh(this.fracturePlankGeometry, this.fracturePlankMaterial);
      const widthAlpha = index / Math.max(1, plankCount - 1);
      const centeredX = (widthAlpha - 0.5) * localHalfWidth * 1.65;

      plank.position.set(
        centeredX + (Math.random() * 2 - 1) * localHalfWidth * 0.1,
        THREE.MathUtils.lerp(0.15, localHalfHeight, Math.random()),
        seamLocalZ + sideSign * THREE.MathUtils.lerp(0.08, 0.34, Math.random()),
      );
      plank.rotation.set(
        (Math.random() * 2 - 1) * 0.34,
        (Math.random() * 2 - 1) * 0.28,
        (Math.random() * 2 - 1) * 0.7,
        'YXZ',
      );
      plank.scale.set(
        THREE.MathUtils.lerp(0.18, 0.42, Math.random()),
        THREE.MathUtils.lerp(0.12, 0.34, Math.random()),
        THREE.MathUtils.lerp(0.72, 1.64, Math.random()),
      );
      plank.frustumCulled = true;
      plank.renderOrder = WRECK_RENDER_ORDER + 1;
      planks.push(plank);
    }

    return planks;
  }

  private updateCapitalWreck(
    slot: DestructionSlot,
    deltaSeconds: number,
    progress: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
    sampleFloorHeight?: (x: number, z: number) => number,
  ): void {
    const wreck = slot.capitalWreck;

    if (!wreck) {
      return;
    }

    this.updateCapitalWreckHalf(wreck.bow, wreck, deltaSeconds, progress, sampleSurfaceHeight, sampleFloorHeight, 1);
    this.updateCapitalWreckHalf(wreck.stern, wreck, deltaSeconds, progress, sampleSurfaceHeight, sampleFloorHeight, -1);
  }

  private updateCapitalWreckHalf(
    half: CapitalWreckHalfState,
    wreck: CapitalWreckState,
    deltaSeconds: number,
    progress: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
    sampleFloorHeight: ((x: number, z: number) => number) | undefined,
    halfSign: number,
  ): void {
    if (half.settled) {
      return;
    }

    if (deltaSeconds > 0) {
      const surfaceHeight = sampleSurfaceHeight(half.position.x, half.position.z);
      const floorHeight = sampleFloorHeight?.(half.position.x, half.position.z) ?? Number.NEGATIVE_INFINITY;
      const bottomRestHeight = floorHeight + half.bottomClearance;
      const sinkRamp = THREE.MathUtils.smoothstep(progress, 0.012, 0.18);
      const sinkTarget = Math.max(bottomRestHeight, surfaceHeight - half.sinkDepth);

      half.sinkDepth +=
        wreck.sinkSpeed * THREE.MathUtils.lerp(0.16, halfSign > 0 ? 1.22 : 1.04, sinkRamp) * deltaSeconds;
      half.velocity.x = THREE.MathUtils.damp(half.velocity.x, 0, 0.46, deltaSeconds);
      half.velocity.z = THREE.MathUtils.damp(half.velocity.z, 0, 0.46, deltaSeconds);
      half.velocity.y = THREE.MathUtils.damp(
        half.velocity.y,
        -wreck.sinkSpeed * THREE.MathUtils.lerp(0.18, 1.28, sinkRamp),
        1.35,
        deltaSeconds,
      );
      half.position.addScaledVector(half.velocity, deltaSeconds);
      half.position.y = THREE.MathUtils.damp(
        half.position.y,
        sinkTarget,
        halfSign > 0 ? 1.1 : 0.9,
        deltaSeconds,
      );

      half.rotation.x += half.angularVelocity.x * deltaSeconds;
      half.rotation.y += half.angularVelocity.y * deltaSeconds;
      half.rotation.z += half.angularVelocity.z * deltaSeconds;
      half.angularVelocity.multiplyScalar(Math.exp(-wreck.rollDamping * deltaSeconds));

      if (Number.isFinite(floorHeight) && half.position.y <= bottomRestHeight + 0.14 && sinkTarget <= bottomRestHeight + 0.2) {
        half.position.y = bottomRestHeight;
        half.velocity.set(0, 0, 0);
        half.angularVelocity.set(0, 0, 0);
        half.settled = true;
      }
    }

    half.root.position.copy(half.position);
    half.root.scale.copy(half.baseScale);
    this.tempQuaternion.setFromEuler(half.rotation);
    half.root.quaternion.copy(half.baseQuaternion).multiply(this.tempQuaternion);
    half.root.updateMatrixWorld(true);
    half.clippingPlane.copy(half.localClippingPlane).applyMatrix4(half.root.matrixWorld);
  }

  private clearCapitalWreck(slot: DestructionSlot): void {
    const wreck = slot.capitalWreck;

    if (!wreck) {
      return;
    }

    this.disposeCapitalWreckHalf(wreck.bow);
    this.disposeCapitalWreckHalf(wreck.stern);
    slot.capitalWreck = null;
  }

  private disposeCapitalWreckHalf(half: CapitalWreckHalfState): void {
    half.root.removeFromParent();
    releaseCapitalShipWreckVisualAsset(half.visual);

    for (const plank of half.seamPlanks) {
      plank.removeFromParent();
    }
  }

  private seedPieces(params: {
    pieces: DebrisPieceState[];
    count: number;
    snapshot: ShipDestructionSnapshot;
    triggerDirection: THREE.Vector3;
    horizontalImpulse: number;
    verticalImpulse: number;
    baseScale: number;
    category: 'splinter' | 'chunk' | 'mast' | 'sail' | 'spark';
  }): void {
    const { pieces, count, snapshot, triggerDirection, horizontalImpulse, verticalImpulse, baseScale, category } = params;
    const width = Math.max(0.8, snapshot.halfExtents.x);
    const length = Math.max(1.8, snapshot.halfExtents.z);
    const height = Math.max(0.7, snapshot.halfExtents.y);

    for (let index = 0; index < count; index += 1) {
      const piece = pieces[index];
      const sideBias = Math.random() > 0.54 ? Math.sign(this.tempRight.dot(triggerDirection) || 1) : this.randomSign();
      const localX =
        category === 'spark'
          ? sideBias * width * THREE.MathUtils.lerp(0.18, 0.52, Math.random())
          : (Math.random() * 2 - 1) * width * (category === 'mast' ? 0.24 : 0.72);
      const localY =
        category === 'spark'
          ? THREE.MathUtils.lerp(0.42, 0.86, Math.random()) * height
          : (Math.random() * 0.8 + 0.06) * height;
      const localZ =
        category === 'spark'
          ? (Math.random() * 2 - 1) * length * 0.38
          : (Math.random() * 2 - 1) * length * (category === 'mast' ? 0.28 : 0.74);

      this.tempOffset
        .copy(this.tempRight)
        .multiplyScalar(localX)
        .addScaledVector(this.tempUp, localY)
        .addScaledVector(this.tempForward, localZ);

      piece.position.copy(snapshot.position).add(this.tempOffset);

      if (category !== 'spark') {
        piece.position.y = Math.max(piece.position.y, snapshot.surfaceHeight + 0.08 + Math.random() * 0.8);
      } else {
        piece.position.y = Math.max(piece.position.y, snapshot.surfaceHeight + 0.35 + Math.random() * 1.2);
      }

      const spread = category === 'spark' ? 0.8 : category === 'sail' ? 0.42 : 0.62;
      const sideVector = this.tempSideVector.copy(this.tempRight).multiplyScalar(sideBias * (Math.random() * 0.8 + 0.2));
      const forwardVector = this.tempForwardVector.copy(this.tempForward).multiplyScalar((Math.random() * 2 - 1) * spread);
      const outward = this.tempOutward
        .copy(triggerDirection)
        .multiplyScalar(1.1 + Math.random() * 0.55)
        .add(sideVector)
        .add(forwardVector);

      if (outward.lengthSq() <= 0.0001) {
        outward.copy(this.tempForward);
      }

      outward.normalize();
      piece.velocity.copy(outward).multiplyScalar(horizontalImpulse * (0.45 + Math.random() * 0.78));
      piece.velocity.y += verticalImpulse * (0.38 + Math.random() * 0.9);

      if (category === 'spark') {
        piece.velocity.copy(outward).multiplyScalar(horizontalImpulse * (0.62 + Math.random() * 0.28));
        piece.velocity.y = verticalImpulse * (0.14 + Math.random() * 0.2) + 0.72;
      } else if (category === 'chunk') {
        piece.velocity.multiplyScalar(0.72);
      } else if (category === 'sail') {
        piece.velocity.multiplyScalar(0.58);
        piece.velocity.y += 1.8;
      }

      piece.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      piece.spin.set(
        (Math.random() * 2 - 1) * (category === 'chunk' ? 2.2 : 5.6),
        (Math.random() * 2 - 1) * (category === 'chunk' ? 2.6 : 6.2),
        (Math.random() * 2 - 1) * (category === 'chunk' ? 2.4 : 6.6),
      );
      this.seedPieceScale(piece.scale, category, baseScale);
      piece.waterAge = 0;
      piece.extinguished = false;
    }
  }

  private seedPieceScale(scale: THREE.Vector3, category: 'splinter' | 'chunk' | 'mast' | 'sail' | 'spark', baseScale: number): void {
    switch (category) {
      case 'splinter':
        scale.set(
          baseScale * THREE.MathUtils.lerp(0.45, 0.95, Math.random()),
          baseScale * THREE.MathUtils.lerp(0.38, 0.72, Math.random()),
          baseScale * THREE.MathUtils.lerp(1.6, 3.6, Math.random()),
        );
        break;
      case 'chunk':
        scale.set(
          baseScale * THREE.MathUtils.lerp(0.55, 1.25, Math.random()),
          baseScale * THREE.MathUtils.lerp(0.24, 0.62, Math.random()),
          baseScale * THREE.MathUtils.lerp(0.8, 1.9, Math.random()),
        );
        break;
      case 'mast':
        scale.set(
          baseScale * THREE.MathUtils.lerp(0.72, 1.15, Math.random()),
          baseScale * THREE.MathUtils.lerp(3.2, 6.4, Math.random()),
          baseScale * THREE.MathUtils.lerp(0.72, 1.15, Math.random()),
        );
        break;
      case 'sail':
        scale.set(
          baseScale * THREE.MathUtils.lerp(1.1, 2.8, Math.random()),
          baseScale * THREE.MathUtils.lerp(0.65, 1.8, Math.random()),
          1,
        );
        break;
      case 'spark':
        scale.setScalar(Math.min(1.15, baseScale) * THREE.MathUtils.lerp(0.72, 1.08, Math.random()));
        break;
    }
  }

  private updateSlotMatrices(
    slot: DestructionSlot,
    deltaSeconds: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
    sampleFloorHeight?: (x: number, z: number) => number,
  ): void {
    const debrisProgress = THREE.MathUtils.clamp(slot.age / Math.max(slot.debrisLifetime, 0.0001), 0, 1);
    const wreckProgress = THREE.MathUtils.clamp(slot.age / Math.max(slot.wreckLifetime, 0.0001), 0, 1);
    const debrisFade = 1 - THREE.MathUtils.smoothstep(debrisProgress, 0.68, 1);
    const sailFade = 1 - THREE.MathUtils.smoothstep(debrisProgress, 0.5, 0.96);
    const sparkFade = 1 - THREE.MathUtils.smoothstep(debrisProgress, 0.78, 1);
    const splinterCount = debrisFade > 0.001 ? slot.splinterCount : 0;
    const hullChunkCount = debrisFade > 0.001 ? slot.hullChunkCount : 0;
    const mastCount = debrisFade > 0.001 ? slot.mastCount : 0;
    const sailCount = sailFade > 0.001 ? slot.sailCount : 0;
    const sparkCount = sparkFade > 0.001 ? slot.sparkCount : 0;

    if (debrisProgress >= 1 && this.isCapitalWreckSettled(slot)) {
      this.hideExpiredDebris(slot);
      return;
    }

    if (debrisProgress < 1) {
      this.updateFoam(slot, debrisProgress, sampleSurfaceHeight(slot.anchor.x, slot.anchor.z));
      this.updatePieces(slot.splinters, slot.splinterPieces, splinterCount, deltaSeconds, sampleSurfaceHeight, debrisFade, slot);
      this.updatePieces(slot.hullChunks, slot.hullPieces, hullChunkCount, deltaSeconds, sampleSurfaceHeight, debrisFade, slot);
      this.updatePieces(slot.masts, slot.mastPieces, mastCount, deltaSeconds, sampleSurfaceHeight, debrisFade, slot);
      this.updatePieces(slot.sails, slot.sailPieces, sailCount, deltaSeconds, sampleSurfaceHeight, sailFade, slot);
      this.updatePieces(slot.sparks, slot.sparkPieces, sparkCount, deltaSeconds, sampleSurfaceHeight, sparkFade, slot);
      this.updateSparkLight(slot, sparkFade);

      slot.splinters.material.opacity = 0.98 * debrisFade;
      slot.hullChunks.material.opacity = 0.98 * debrisFade;
      slot.masts.material.opacity = 0.94 * debrisFade;
      slot.sails.material.opacity = 0.58 * sailFade;
      slot.sparks.material.opacity = 0.9 * sparkFade;
    } else {
      this.hideExpiredDebris(slot);
    }

    this.updateCapitalWreck(slot, deltaSeconds, wreckProgress, sampleSurfaceHeight, sampleFloorHeight);
  }

  private isCapitalWreckSettled(slot: DestructionSlot): boolean {
    return Boolean(slot.capitalWreck?.bow.settled && slot.capitalWreck.stern.settled);
  }

  private hideExpiredDebris(slot: DestructionSlot): void {
    this.hideInstancedMesh(slot.splinters);
    this.hideInstancedMesh(slot.hullChunks);
    this.hideInstancedMesh(slot.masts);
    this.hideInstancedMesh(slot.sails);
    this.hideInstancedMesh(slot.sparks);
    slot.sparkLight.visible = false;
    slot.sparkLight.intensity = 0;
    slot.foam.reset();
    slot.splinters.material.opacity = 0;
    slot.hullChunks.material.opacity = 0;
    slot.masts.material.opacity = 0;
    slot.sails.material.opacity = 0;
    slot.sparks.material.opacity = 0;
  }

  private hideInstancedMesh(mesh: THREE.InstancedMesh): void {
    if (mesh.count === 0) {
      return;
    }

    mesh.count = 0;
    mesh.instanceMatrix.needsUpdate = true;
  }

  private updateFoam(slot: DestructionSlot, progress: number, surfaceHeight: number): void {
    const eased = 1 - Math.pow(1 - progress, 3);
    const ringRadius = THREE.MathUtils.lerp(slot.foamRadius * 0.24, slot.foamRadius, eased);
    const innerRadius = THREE.MathUtils.lerp(slot.foamRadius * 0.12, slot.foamRadius * 0.58, eased);
    const opacity = (1 - THREE.MathUtils.smoothstep(progress, 0.18, 0.9)) * slot.foamOpacity * slot.intensity;

    if (opacity <= 0.001) {
      slot.foam.reset();
      return;
    }

    slot.foam.begin(opacity);
    this.writeFoamRing(slot, ringRadius, Math.round(THREE.MathUtils.clamp(ringRadius * 4.2, 14, 48)), progress, surfaceHeight, 0.42);
    this.writeFoamRing(slot, innerRadius, Math.round(THREE.MathUtils.clamp(innerRadius * 3.8, 8, 32)), progress, surfaceHeight, 0.3);
    this.writeFoamCluster(
      slot,
      THREE.MathUtils.lerp(slot.foamRadius * 0.16, slot.foamRadius * 0.72, eased),
      16,
      progress,
      surfaceHeight,
    );
    slot.foam.end();
  }

  private writeFoamRing(
    slot: DestructionSlot,
    radius: number,
    count: number,
    progress: number,
    surfaceHeight: number,
    scale: number,
  ): void {
    const scaleFade = 1 - THREE.MathUtils.smoothstep(progress, 0.78, 1) * 0.45;

    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const seed = slot.age * 1.17 + index * WATER_FOAM_GOLDEN_ANGLE;
      const localRadius = radius * THREE.MathUtils.lerp(0.92, 1.08, (Math.sin(seed) + 1) * 0.5);
      const stampScale =
        scale *
        THREE.MathUtils.lerp(0.78, 1.26, (Math.cos(seed * 0.73) + 1) * 0.5) *
        scaleFade;

      slot.foam.addStamp({
        x: slot.anchor.x + Math.cos(angle) * localRadius,
        y: surfaceHeight + SURFACE_OFFSET + (index % 7) * 0.001,
        z: slot.anchor.z + Math.sin(angle) * localRadius,
        yaw: angle + Math.PI * 0.5 + Math.sin(seed * 0.59) * 0.34,
        width: stampScale * THREE.MathUtils.lerp(0.9, 1.32, (Math.sin(seed * 0.47) + 1) * 0.5),
        length: stampScale * THREE.MathUtils.lerp(0.72, 1.06, (Math.cos(seed * 0.51) + 1) * 0.5),
        phase: seed,
        progress,
        variant: index,
      });
    }
  }

  private writeFoamCluster(
    slot: DestructionSlot,
    radius: number,
    count: number,
    progress: number,
    surfaceHeight: number,
  ): void {
    const fadeScale = 1 - THREE.MathUtils.smoothstep(progress, 0.48, 1) * 0.62;

    for (let index = 0; index < count; index += 1) {
      const seed = slot.age * 1.33 + index * 2.19;
      const angle = (index * WATER_FOAM_GOLDEN_ANGLE) % (Math.PI * 2);
      const localRadius = radius * Math.sqrt((index + 0.5) / count) * THREE.MathUtils.lerp(0.64, 1.08, (Math.sin(seed) + 1) * 0.5);
      const stampScale = THREE.MathUtils.lerp(0.22, 0.44, (Math.cos(seed * 0.71) + 1) * 0.5) * fadeScale;

      slot.foam.addStamp({
        x: slot.anchor.x + Math.cos(angle) * localRadius,
        y: surfaceHeight + SURFACE_OFFSET + 0.014 + (index % 5) * 0.001,
        z: slot.anchor.z + Math.sin(angle) * localRadius,
        yaw: seed,
        width: stampScale,
        length: stampScale * THREE.MathUtils.lerp(0.82, 1.2, (Math.sin(seed * 0.63) + 1) * 0.5),
        phase: seed,
        progress,
        variant: index + 3,
        cutoutScale: 0.84,
      });
    }
  }

  private updateSparkLight(slot: DestructionSlot, fade: number): void {
    const spark = slot.sparkPieces[0];

    if (slot.sparkCount <= 0 || fade <= 0.001 || !spark || spark.extinguished) {
      slot.sparkLight.visible = false;
      slot.sparkLight.intensity = 0;
      return;
    }

    slot.sparkLight.visible = true;
    slot.sparkLight.position.copy(spark.position);
    slot.sparkLight.intensity = THREE.MathUtils.lerp(0.7, 1.45, slot.intensity) * fade;
    slot.sparkLight.distance = THREE.MathUtils.lerp(4.5, 7.5, slot.intensity);
  }

  private updatePieces<TGeometry extends THREE.BufferGeometry, TMaterial extends THREE.Material>(
    mesh: THREE.InstancedMesh<TGeometry, TMaterial>,
    pieces: readonly DebrisPieceState[],
    count: number,
    deltaSeconds: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
    fade: number,
    slot: DestructionSlot,
  ): void {
    if (count <= 0) {
      if (mesh.count !== 0) {
        mesh.count = 0;
        mesh.instanceMatrix.needsUpdate = true;
      }

      return;
    }

    mesh.count = count;

    for (let index = 0; index < count; index += 1) {
      const piece = pieces[index];

      if (deltaSeconds > 0) {
        const surfaceHeight = sampleSurfaceHeight(piece.position.x, piece.position.z);
        const underWater = piece.position.y < surfaceHeight + 0.02;
        const drag = underWater ? WATER_DRAG : AIR_DRAG;
        const isSpark = (mesh as THREE.InstancedMesh) === slot.sparks;

        if (isSpark && underWater) {
          piece.extinguished = true;
          piece.velocity.set(0, 0, 0);
        }

        if (!piece.extinguished) {
          piece.velocity.y -= GRAVITY * this.getPieceGravityScale(mesh) * slot.gravityScale * deltaSeconds;
          piece.velocity.multiplyScalar(Math.exp(-drag * deltaSeconds));

          if (underWater) {
            piece.waterAge += deltaSeconds;
            piece.velocity.y = Math.max(piece.velocity.y, -0.7);
            piece.position.y -= this.getPieceSinkRate(mesh) * slot.sinkRate * (0.2 + piece.waterAge) * deltaSeconds;
          }

          piece.position.addScaledVector(piece.velocity, deltaSeconds);

          if (isSpark && piece.position.y <= sampleSurfaceHeight(piece.position.x, piece.position.z) + 0.02) {
            piece.extinguished = true;
            piece.velocity.set(0, 0, 0);
          }

          piece.rotation.x += piece.spin.x * deltaSeconds;
          piece.rotation.y += piece.spin.y * deltaSeconds;
          piece.rotation.z += piece.spin.z * deltaSeconds;
        }
      }

      this.dummy.position.copy(piece.position);
      this.dummy.rotation.copy(piece.rotation);
      this.dummy.scale.copy(piece.scale).multiplyScalar(piece.extinguished ? 0 : Math.max(0, fade));
      this.dummy.updateMatrix();
      mesh.setMatrixAt(index, this.dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = count > 0;
  }

  private getPieceGravityScale(mesh: THREE.InstancedMesh): number {
    if (mesh.geometry === this.sparkGeometry) {
      return 0.95;
    }

    if (mesh.geometry === this.sailGeometry) {
      return 0.38;
    }

    return 1;
  }

  private getPieceSinkRate(mesh: THREE.InstancedMesh): number {
    if (mesh.geometry === this.sailGeometry || mesh.geometry === this.sparkGeometry) {
      return 0.12;
    }

    if (mesh.geometry === this.hullChunkGeometry) {
      return 0.32;
    }

    return 0.24;
  }

  private randomCount(range: readonly [number, number]): number {
    return THREE.MathUtils.randInt(range[0], range[1]);
  }

  private randomSign(): number {
    return Math.random() > 0.5 ? 1 : -1;
  }
}

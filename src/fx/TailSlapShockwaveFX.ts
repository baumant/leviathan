import * as THREE from 'three';

const MAX_IMPACT_SHOCKWAVES = 3;
const IMPACT_LIFETIME = 0.56;
const TELEGRAPH_LIFETIME = 0.18;
const SURFACE_OFFSET = 0.14;
const TELEGRAPH_HALF_ANGLE = THREE.MathUtils.degToRad(34);
const TELEGRAPH_INNER_RADIUS = 2.8;
const TELEGRAPH_OUTER_RADIUS = 5.0;
const TELEGRAPH_FILL_OPACITY = 0.36;
const TELEGRAPH_EDGE_OPACITY = 0.56;
const IMPACT_FILL_OPACITY = 0.28;
const IMPACT_EDGE_OPACITY = 0.6;

interface ImpactShockwaveSlot {
  readonly root: THREE.Group;
  readonly sector: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly edge: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly sectorMaterial: THREE.MeshBasicMaterial;
  readonly edgeMaterial: THREE.MeshBasicMaterial;
  active: boolean;
  age: number;
  x: number;
  z: number;
  yaw: number;
  startRadius: number;
  endRadius: number;
  intensity: number;
  halfAngle: number;
  sectorGeometry: THREE.ShapeGeometry;
  edgeGeometry: THREE.ShapeGeometry;
}

export class TailSlapShockwaveFX {
  private readonly root = new THREE.Group();
  private readonly impactSlots: ImpactShockwaveSlot[] = [];
  private readonly telegraphRoot = new THREE.Group();
  private readonly telegraphFill: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly telegraphEdge: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly telegraphFillMaterial: THREE.MeshBasicMaterial;
  private readonly telegraphEdgeMaterial: THREE.MeshBasicMaterial;

  private telegraphActive = false;
  private telegraphAge = 0;
  private telegraphX = 0;
  private telegraphZ = 0;
  private telegraphYaw = 0;

  constructor(scene: THREE.Scene) {
    this.root.renderOrder = 28;
    scene.add(this.root);

    for (let index = 0; index < MAX_IMPACT_SHOCKWAVES; index += 1) {
      this.impactSlots.push(this.createImpactSlot());
    }

    this.telegraphFillMaterial = this.createMaterial('#7aaeb9', THREE.NormalBlending);
    this.telegraphEdgeMaterial = this.createMaterial('#effcff', THREE.AdditiveBlending);
    this.telegraphFill = new THREE.Mesh(
      this.createArcBandGeometry(TELEGRAPH_HALF_ANGLE, TELEGRAPH_INNER_RADIUS / TELEGRAPH_OUTER_RADIUS, 1),
      this.telegraphFillMaterial,
    );
    this.telegraphEdge = new THREE.Mesh(
      this.createArcBandGeometry(TELEGRAPH_HALF_ANGLE, 0.88, 1),
      this.telegraphEdgeMaterial,
    );

    this.telegraphFill.rotation.x = -Math.PI / 2;
    this.telegraphFill.scale.setScalar(TELEGRAPH_OUTER_RADIUS);
    this.telegraphFill.frustumCulled = false;
    this.telegraphFill.renderOrder = 28;

    this.telegraphEdge.rotation.x = -Math.PI / 2;
    this.telegraphEdge.position.y = 0.01;
    this.telegraphEdge.scale.setScalar(TELEGRAPH_OUTER_RADIUS);
    this.telegraphEdge.frustumCulled = false;
    this.telegraphEdge.renderOrder = 29;

    this.telegraphRoot.visible = false;
    this.telegraphRoot.add(this.telegraphFill, this.telegraphEdge);
    this.root.add(this.telegraphRoot);

    this.reset();
  }

  startTelegraph(origin: THREE.Vector3, direction: THREE.Vector3): void {
    this.telegraphActive = true;
    this.telegraphAge = 0;
    this.telegraphRoot.visible = true;
    this.telegraphFillMaterial.opacity = 0;
    this.telegraphEdgeMaterial.opacity = 0;
    this.updateTelegraph(origin, direction);
  }

  updateTelegraph(origin: THREE.Vector3, direction: THREE.Vector3): void {
    if (!this.telegraphActive) {
      return;
    }

    this.telegraphX = origin.x;
    this.telegraphZ = origin.z;
    this.telegraphYaw = Math.atan2(direction.x, direction.z);
  }

  clearTelegraph(): void {
    this.telegraphActive = false;
    this.telegraphAge = 0;
    this.telegraphRoot.visible = false;
    this.telegraphFillMaterial.opacity = 0;
    this.telegraphEdgeMaterial.opacity = 0;
  }

  spawnImpact(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    innerRadius: number,
    outerRadius: number,
    halfAngle: number,
    intensity = 1,
  ): void {
    const slot = this.claimImpactSlot();
    const yaw = Math.atan2(direction.x, direction.z);
    const normalizedIntensity = THREE.MathUtils.clamp(intensity, 0.7, 1.3);

    if (Math.abs(slot.halfAngle - halfAngle) > 0.0001) {
      slot.sectorGeometry.dispose();
      slot.edgeGeometry.dispose();
      slot.sectorGeometry = this.createSectorGeometry(halfAngle);
      slot.edgeGeometry = this.createSectorBandGeometry(halfAngle, 0.86, 1);
      slot.sector.geometry = slot.sectorGeometry;
      slot.edge.geometry = slot.edgeGeometry;
      slot.halfAngle = halfAngle;
    }

    slot.active = true;
    slot.age = 0;
    slot.x = origin.x;
    slot.z = origin.z;
    slot.yaw = yaw;
    slot.startRadius = Math.max(3, innerRadius * 0.28);
    slot.endRadius = outerRadius + 1.5;
    slot.intensity = normalizedIntensity;
    slot.root.visible = true;
    slot.sectorMaterial.opacity = 0;
    slot.edgeMaterial.opacity = 0;
  }

  update(
    deltaSeconds: number,
    underwaterRatio: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
  ): void {
    const aboveWaterAlpha = 1 - THREE.MathUtils.smoothstep(underwaterRatio, 0.08, 0.78);

    this.updateTelegraphVisual(deltaSeconds, aboveWaterAlpha, sampleSurfaceHeight);
    this.updateImpactVisuals(deltaSeconds, aboveWaterAlpha, sampleSurfaceHeight);
  }

  reset(): void {
    this.clearTelegraph();

    for (const slot of this.impactSlots) {
      this.deactivateImpactSlot(slot);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.telegraphFill.geometry.dispose();
    this.telegraphEdge.geometry.dispose();
    this.telegraphFillMaterial.dispose();
    this.telegraphEdgeMaterial.dispose();

    for (const slot of this.impactSlots) {
      slot.sectorGeometry.dispose();
      slot.edgeGeometry.dispose();
      slot.sectorMaterial.dispose();
      slot.edgeMaterial.dispose();
    }
  }

  private updateTelegraphVisual(
    deltaSeconds: number,
    aboveWaterAlpha: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
  ): void {
    if (!this.telegraphActive) {
      return;
    }

    this.telegraphAge += deltaSeconds;

    if (this.telegraphAge >= TELEGRAPH_LIFETIME || aboveWaterAlpha <= 0.01) {
      this.clearTelegraph();
      return;
    }

    const progress = this.telegraphAge / TELEGRAPH_LIFETIME;
    const fadeIn = THREE.MathUtils.smoothstep(progress, 0, 0.18);
    const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.44, 1);
    const opacityAlpha = fadeIn * fadeOut * aboveWaterAlpha;
    const surfaceHeight = sampleSurfaceHeight(this.telegraphX, this.telegraphZ);
    const pulseScale = THREE.MathUtils.lerp(0.96, 1.04, progress);

    this.telegraphRoot.position.set(this.telegraphX, surfaceHeight + SURFACE_OFFSET, this.telegraphZ);
    this.telegraphRoot.rotation.set(0, this.telegraphYaw, 0);
    this.telegraphRoot.visible = true;
    this.telegraphFill.scale.setScalar(TELEGRAPH_OUTER_RADIUS * pulseScale);
    this.telegraphEdge.scale.setScalar(TELEGRAPH_OUTER_RADIUS * pulseScale);
    this.telegraphFillMaterial.opacity = opacityAlpha * TELEGRAPH_FILL_OPACITY;
    this.telegraphEdgeMaterial.opacity = opacityAlpha * TELEGRAPH_EDGE_OPACITY;
  }

  private updateImpactVisuals(
    deltaSeconds: number,
    aboveWaterAlpha: number,
    sampleSurfaceHeight: (x: number, z: number) => number,
  ): void {
    for (const slot of this.impactSlots) {
      if (!slot.active) {
        continue;
      }

      slot.age += deltaSeconds;

      if (slot.age >= IMPACT_LIFETIME || aboveWaterAlpha <= 0.01) {
        this.deactivateImpactSlot(slot);
        continue;
      }

      const progress = slot.age / IMPACT_LIFETIME;
      const eased = 1 - Math.pow(1 - progress, 2);
      const radius = THREE.MathUtils.lerp(slot.startRadius, slot.endRadius, eased);
      const surfaceHeight = sampleSurfaceHeight(slot.x, slot.z);
      const opacityFalloff = (1 - THREE.MathUtils.smoothstep(progress, 0.22, 1)) * aboveWaterAlpha;

      slot.root.position.set(slot.x, surfaceHeight + SURFACE_OFFSET, slot.z);
      slot.root.rotation.set(0, slot.yaw, 0);
      slot.root.visible = true;

      slot.sector.scale.setScalar(radius);
      slot.edge.scale.setScalar(radius);
      slot.sectorMaterial.opacity = opacityFalloff * IMPACT_FILL_OPACITY * slot.intensity;
      slot.edgeMaterial.opacity = opacityFalloff * IMPACT_EDGE_OPACITY * slot.intensity;
    }
  }

  private createImpactSlot(): ImpactShockwaveSlot {
    const sectorGeometry = this.createSectorGeometry(THREE.MathUtils.degToRad(78));
    const edgeGeometry = this.createSectorBandGeometry(THREE.MathUtils.degToRad(78), 0.86, 1);
    const sectorMaterial = this.createMaterial('#5f8c96', THREE.NormalBlending);
    const edgeMaterial = this.createMaterial('#e7fbff', THREE.AdditiveBlending);
    const sector = new THREE.Mesh(sectorGeometry, sectorMaterial);
    const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);
    const root = new THREE.Group();

    sector.rotation.x = -Math.PI / 2;
    sector.frustumCulled = false;
    sector.renderOrder = 30;

    edge.rotation.x = -Math.PI / 2;
    edge.position.y = 0.01;
    edge.frustumCulled = false;
    edge.renderOrder = 31;

    root.visible = false;
    root.add(sector, edge);
    this.root.add(root);

    return {
      root,
      sector,
      edge,
      sectorMaterial,
      edgeMaterial,
      active: false,
      age: 0,
      x: 0,
      z: 0,
      yaw: 0,
      startRadius: 3,
      endRadius: 18,
      intensity: 1,
      halfAngle: THREE.MathUtils.degToRad(78),
      sectorGeometry,
      edgeGeometry,
    };
  }

  private createMaterial(color: string, blending: THREE.Blending): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      blending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    material.fog = false;
    material.toneMapped = false;
    return material;
  }

  private createSectorGeometry(halfAngle: number): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    const segments = 28;
    const startAngle = -halfAngle;
    const endAngle = halfAngle;

    shape.moveTo(0, 0);
    shape.lineTo(Math.sin(startAngle), Math.cos(startAngle));

    for (let index = 1; index <= segments; index += 1) {
      const alpha = index / segments;
      const angle = THREE.MathUtils.lerp(startAngle, endAngle, alpha);
      shape.lineTo(Math.sin(angle), Math.cos(angle));
    }

    shape.closePath();
    return new THREE.ShapeGeometry(shape, 1);
  }

  private createSectorBandGeometry(halfAngle: number, innerRadius: number, outerRadius: number): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    const hole = new THREE.Path();
    const segments = 28;
    const startAngle = -halfAngle;
    const endAngle = halfAngle;

    shape.moveTo(Math.sin(startAngle) * outerRadius, Math.cos(startAngle) * outerRadius);

    for (let index = 1; index <= segments; index += 1) {
      const alpha = index / segments;
      const angle = THREE.MathUtils.lerp(startAngle, endAngle, alpha);
      shape.lineTo(Math.sin(angle) * outerRadius, Math.cos(angle) * outerRadius);
    }

    shape.lineTo(Math.sin(startAngle) * outerRadius, Math.cos(startAngle) * outerRadius);

    hole.moveTo(Math.sin(endAngle) * innerRadius, Math.cos(endAngle) * innerRadius);

    for (let index = segments - 1; index >= 0; index -= 1) {
      const alpha = index / segments;
      const angle = THREE.MathUtils.lerp(startAngle, endAngle, alpha);
      hole.lineTo(Math.sin(angle) * innerRadius, Math.cos(angle) * innerRadius);
    }

    hole.lineTo(Math.sin(endAngle) * innerRadius, Math.cos(endAngle) * innerRadius);
    shape.holes.push(hole);
    return new THREE.ShapeGeometry(shape, 1);
  }

  private createArcBandGeometry(halfAngle: number, innerRadius: number, outerRadius: number): THREE.ShapeGeometry {
    return this.createSectorBandGeometry(halfAngle, innerRadius, outerRadius);
  }

  private claimImpactSlot(): ImpactShockwaveSlot {
    const inactive = this.impactSlots.find((slot) => !slot.active);

    if (inactive) {
      return inactive;
    }

    let oldest = this.impactSlots[0];

    for (let index = 1; index < this.impactSlots.length; index += 1) {
      if (this.impactSlots[index].age > oldest.age) {
        oldest = this.impactSlots[index];
      }
    }

    this.deactivateImpactSlot(oldest);
    return oldest;
  }

  private deactivateImpactSlot(slot: ImpactShockwaveSlot): void {
    slot.active = false;
    slot.age = 0;
    slot.root.visible = false;
    slot.sectorMaterial.opacity = 0;
    slot.edgeMaterial.opacity = 0;
  }
}

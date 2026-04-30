import * as THREE from 'three';

export const WATER_FOAM_STAMP_VARIANTS = 5;
export const WATER_FOAM_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface WaterFoamStampLayerOptions {
  readonly maxStamps: number;
  readonly maxCutouts: number;
  readonly color: THREE.ColorRepresentation;
  readonly opacity: number;
  readonly blending?: THREE.Blending;
  readonly renderOrder: number;
  readonly cutoutRenderOrder?: number;
  readonly polygonOffsetFactor?: number;
  readonly polygonOffsetUnits?: number;
}

export interface WaterFoamStamp {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly length: number;
  readonly yaw?: number;
  readonly rotation?: THREE.Euler;
  readonly variant?: number;
  readonly phase?: number;
  readonly progress?: number;
  readonly cutoutCount?: number;
  readonly cutoutScale?: number;
}

export class WaterFoamStampLayer {
  private readonly foamGeometries = Array.from({ length: WATER_FOAM_STAMP_VARIANTS }, (_, index) =>
    createWaterFoamStampGeometry(index),
  );
  private readonly cutoutGeometry = new THREE.CircleGeometry(1, 18);
  private readonly foamMeshes: THREE.InstancedMesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>[];
  private readonly cutouts: THREE.InstancedMesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly counts = Array.from({ length: WATER_FOAM_STAMP_VARIANTS }, () => 0);
  private readonly dummy = new THREE.Object3D();
  private readonly cutoutDummy = new THREE.Object3D();
  private readonly rotation = new THREE.Euler();
  private readonly planeRight = new THREE.Vector3();
  private readonly planeForward = new THREE.Vector3();
  private readonly options: WaterFoamStampLayerOptions;
  private cutoutCount = 0;
  private stampCount = 0;

  constructor(parent: THREE.Object3D, options: WaterFoamStampLayerOptions) {
    this.options = options;
    this.foamMeshes = this.foamGeometries.map((geometry, index) => {
      const mesh = new THREE.InstancedMesh(geometry, this.createFoamMaterial(), options.maxStamps);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = options.renderOrder + index * 0.01;
      parent.add(mesh);
      return mesh;
    });

    this.cutouts = new THREE.InstancedMesh(
      this.cutoutGeometry,
      this.createCutoutMaterial(),
      options.maxCutouts,
    );
    this.cutouts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cutouts.count = 0;
    this.cutouts.frustumCulled = false;
    this.cutouts.renderOrder = options.cutoutRenderOrder ?? options.renderOrder - 0.2;
    parent.add(this.cutouts);
  }

  begin(opacityMultiplier = 1): void {
    this.counts.fill(0);
    this.cutoutCount = 0;
    this.stampCount = 0;
    this.setOpacityMultiplier(opacityMultiplier);
  }

  addStamp(stamp: WaterFoamStamp): boolean {
    if (this.stampCount >= this.options.maxStamps) {
      return false;
    }

    const variant = THREE.MathUtils.clamp(
      Math.floor(stamp.variant ?? this.stampCount),
      0,
      this.foamMeshes.length - 1,
    );
    const variantCount = this.counts[variant];

    if (variantCount >= this.options.maxStamps) {
      return false;
    }

    if (stamp.rotation) {
      this.rotation.copy(stamp.rotation);
    } else {
      this.rotation.set(-Math.PI / 2, 0, stamp.yaw ?? 0);
    }

    this.dummy.position.set(stamp.x, stamp.y, stamp.z);
    this.dummy.rotation.copy(this.rotation);
    this.dummy.scale.set(Math.max(0.001, stamp.width), Math.max(0.001, stamp.length), 1);
    this.dummy.updateMatrix();
    this.foamMeshes[variant].setMatrixAt(variantCount, this.dummy.matrix);
    this.counts[variant] = variantCount + 1;
    this.stampCount += 1;

    this.writeCutouts(stamp, this.rotation);
    return true;
  }

  end(): void {
    for (let index = 0; index < this.foamMeshes.length; index += 1) {
      const mesh = this.foamMeshes[index];
      mesh.count = this.counts[index];
      mesh.instanceMatrix.needsUpdate = mesh.count > 0;
    }

    this.cutouts.count = this.cutoutCount;
    this.cutouts.instanceMatrix.needsUpdate = this.cutoutCount > 0;
  }

  reset(): void {
    this.counts.fill(0);
    this.cutoutCount = 0;
    this.stampCount = 0;
    for (const mesh of this.foamMeshes) {
      mesh.count = 0;
      mesh.material.opacity = 0;
    }
    this.cutouts.count = 0;
  }

  setOpacityMultiplier(opacityMultiplier: number): void {
    const opacity = (this.options.opacity ?? 1) * THREE.MathUtils.clamp(opacityMultiplier, 0, 1.5);
    for (const mesh of this.foamMeshes) {
      mesh.material.opacity = opacity;
      mesh.visible = opacity > 0.001;
    }
    this.cutouts.visible = opacity > 0.001;
  }

  dispose(): void {
    for (const mesh of this.foamMeshes) {
      mesh.removeFromParent();
      mesh.material.dispose();
    }
    for (const geometry of this.foamGeometries) {
      geometry.dispose();
    }

    this.cutouts.removeFromParent();
    this.cutouts.material.dispose();
    this.cutoutGeometry.dispose();
  }

  private writeCutouts(stamp: WaterFoamStamp, rotation: THREE.Euler): void {
    const cutoutCount = stamp.cutoutCount ?? (stamp.width > 1.1 ? 3 : 2);

    if (cutoutCount <= 0 || this.cutoutCount >= this.options.maxCutouts) {
      return;
    }

    const progress = THREE.MathUtils.clamp(stamp.progress ?? 0, 0, 1);
    const phase = stamp.phase ?? 0;
    const cutoutScale = stamp.cutoutScale ?? 1;
    const coverSeed = phase * 1.63;
    const coverStart = THREE.MathUtils.lerp(0.16, 0.32, (Math.sin(coverSeed) + 1) * 0.5);
    const coverEnd = THREE.MathUtils.lerp(1.26, 1.46, (Math.cos(coverSeed * 1.37) + 1) * 0.5);
    const coverExpansion =
      THREE.MathUtils.lerp(coverStart, coverEnd, THREE.MathUtils.smoothstep(progress, 0.08, 0.86)) *
      cutoutScale;
    const holeStart = THREE.MathUtils.lerp(0.34, 0.54, (Math.sin(coverSeed * 0.73) + 1) * 0.5);
    const holeEnd = THREE.MathUtils.lerp(1.36, 1.62, (Math.cos(coverSeed * 0.91) + 1) * 0.5);
    const holeExpansion =
      THREE.MathUtils.lerp(holeStart, holeEnd, THREE.MathUtils.smoothstep(progress, 0.02, 0.68)) *
      cutoutScale;
    const cutoutDrift = THREE.MathUtils.lerp(0.55, 1.22, THREE.MathUtils.smoothstep(progress, 0.1, 1));
    const coverAngle = coverSeed * 2.41;
    const coverRadius = THREE.MathUtils.lerp(
      0.08,
      0.56,
      Math.pow((Math.sin(coverSeed * 2.19) + 1) * 0.5, 0.36),
    );
    const coverOffsetX = Math.cos(coverAngle) * stamp.width * coverRadius;
    const coverOffsetY = Math.sin(coverAngle) * stamp.length * coverRadius;
    const coverWander = 1 - THREE.MathUtils.smoothstep(progress, 0.22, 0.84);

    this.planeRight.set(1, 0, 0).applyEuler(rotation);
    this.planeForward.set(0, 1, 0).applyEuler(rotation);

    for (let index = 0; index < cutoutCount && this.cutoutCount < this.options.maxCutouts; index += 1) {
      const seed = phase * 2.31 + index * 3.17;
      const isCoverCutout = index === 0;
      const localX = isCoverCutout
        ? coverOffsetX * coverWander
        : Math.sin(seed) *
          stamp.width *
          THREE.MathUtils.lerp(0.24, 0.42, (Math.cos(seed * 1.11) + 1) * 0.5) *
          cutoutDrift;
      const localY = isCoverCutout
        ? coverOffsetY * coverWander
        : Math.cos(seed * 1.29) *
          stamp.length *
          THREE.MathUtils.lerp(0.24, 0.44, (Math.sin(seed * 0.97) + 1) * 0.5) *
          cutoutDrift;
      const scaleX = isCoverCutout
        ? stamp.width * coverExpansion
        : stamp.width *
          THREE.MathUtils.lerp(0.14, 0.28, (Math.sin(seed * 0.71) + 1) * 0.5) *
          holeExpansion;
      const scaleY = isCoverCutout
        ? stamp.length * coverExpansion
        : stamp.length *
          THREE.MathUtils.lerp(0.14, 0.3, (Math.cos(seed * 0.83) + 1) * 0.5) *
          holeExpansion;

      this.cutoutDummy.position
        .set(stamp.x, stamp.y, stamp.z)
        .addScaledVector(this.planeRight, localX)
        .addScaledVector(this.planeForward, localY);
      this.cutoutDummy.rotation.copy(rotation);
      this.cutoutDummy.rotateZ(Math.sin(seed) * 0.45);
      this.cutoutDummy.scale.set(Math.max(0.001, scaleX), Math.max(0.001, scaleY), 1);
      this.cutoutDummy.updateMatrix();
      this.cutouts.setMatrixAt(this.cutoutCount, this.cutoutDummy.matrix);
      this.cutoutCount += 1;
    }
  }

  private createFoamMaterial(): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(this.options.color),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: this.options.blending ?? THREE.NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: this.options.polygonOffsetFactor ?? -2,
      polygonOffsetUnits: this.options.polygonOffsetUnits ?? -2,
    });
    material.fog = true;
    material.toneMapped = false;
    material.stencilWrite = true;
    material.stencilWriteMask = 0x00;
    material.stencilFunc = THREE.NotEqualStencilFunc;
    material.stencilRef = 1;
    material.stencilFuncMask = 0xff;
    material.stencilFail = THREE.KeepStencilOp;
    material.stencilZFail = THREE.KeepStencilOp;
    material.stencilZPass = THREE.KeepStencilOp;
    return material;
  }

  private createCutoutMaterial(): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#000000'),
      colorWrite: false,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.toneMapped = false;
    material.stencilWrite = true;
    material.stencilFunc = THREE.AlwaysStencilFunc;
    material.stencilRef = 1;
    material.stencilFuncMask = 0xff;
    material.stencilWriteMask = 0xff;
    material.stencilFail = THREE.KeepStencilOp;
    material.stencilZFail = THREE.KeepStencilOp;
    material.stencilZPass = THREE.ReplaceStencilOp;
    return material;
  }
}

function createWaterFoamStampGeometry(variant: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const basePoints = [
    [-0.58, -0.2],
    [-0.48, 0.16],
    [-0.26, 0.42],
    [0.05, 0.52],
    [0.36, 0.42],
    [0.58, 0.18],
    [0.62, -0.08],
    [0.5, -0.34],
    [0.2, -0.52],
    [-0.14, -0.48],
    [-0.44, -0.34],
  ];
  const points = basePoints.map(([x, y], index) => {
    const chip = Math.sin(variant * 2.17 + index * 1.61);
    const tangent = Math.cos(variant * 1.31 + index * 2.29);
    return new THREE.Vector2(x + chip * 0.035, y + tangent * 0.028);
  });

  shape.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    shape.lineTo(points[index].x, points[index].y);
  }
  shape.closePath();

  const holeCount = 3 + (variant % 3);
  for (let index = 0; index < holeCount; index += 1) {
    const seed = variant * 11.73 + index * 5.19;
    const hole = new THREE.Path();
    hole.absellipse(
      THREE.MathUtils.clamp(Math.sin(seed) * 0.34, -0.46, 0.46),
      THREE.MathUtils.clamp(Math.cos(seed * 1.37) * 0.18, -0.2, 0.2),
      THREE.MathUtils.lerp(0.055, 0.17, (Math.sin(seed * 0.73) + 1) * 0.5),
      THREE.MathUtils.lerp(0.035, 0.095, (Math.cos(seed * 0.91) + 1) * 0.5),
      0,
      Math.PI * 2,
      false,
      seed,
    );
    shape.holes.push(hole);
  }

  return new THREE.ShapeGeometry(shape, 1);
}

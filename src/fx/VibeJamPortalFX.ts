import * as THREE from 'three';

type VibeJamPortalKind = 'exit' | 'return';
type VibeJamPortalPlacement = 'surface' | 'floor';

interface VibeJamPortalFXOptions {
  kind: VibeJamPortalKind;
  placement: VibeJamPortalPlacement;
  position: THREE.Vector3;
  heading: number;
}

const PORTAL_COLORS: Record<
  VibeJamPortalKind,
  {
    ring: THREE.ColorRepresentation;
    inner: THREE.ColorRepresentation;
    core: THREE.ColorRepresentation;
  }
> = {
  exit: {
    ring: '#d2b781',
    inner: '#d2b781',
    core: '#f1dba1',
  },
  return: {
    ring: '#8fa5b8',
    inner: '#6d8197',
    core: '#c6d6f5',
  },
};

export class VibeJamPortalFX {
  readonly root = new THREE.Group();

  private readonly ringGeometry = new THREE.TorusGeometry(4.8, 0.13, 8, 42);
  private readonly innerGeometry = new THREE.CircleGeometry(4.48, 32);
  private readonly fogGeometry = new THREE.CylinderGeometry(5.6, 7.8, 1.15, 28, 1, true);
  private readonly markerGeometry = new THREE.OctahedronGeometry(0.42, 0);
  private readonly vortexCoreGeometry = new THREE.CircleGeometry(1.32, 32);
  private readonly vortexRingGeometry = new THREE.TorusGeometry(1, 0.035, 6, 28);
  private readonly vortexArmGeometries: THREE.TubeGeometry[] = [];
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly innerMaterial: THREE.MeshBasicMaterial;
  private readonly fogMaterial: THREE.MeshBasicMaterial;
  private readonly markerMaterial: THREE.MeshBasicMaterial;
  private readonly vortexCoreMaterial: THREE.MeshBasicMaterial;
  private readonly vortexRingMaterial: THREE.MeshBasicMaterial;
  private readonly vortexArmMaterial: THREE.MeshBasicMaterial;
  private readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly inner: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly fog: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly marker: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>;
  private readonly vortexGroup = new THREE.Group();
  private readonly vortexCore: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly vortexRings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly vortexArms: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>[] = [];

  constructor(private readonly options: VibeJamPortalFXOptions) {
    const colors = PORTAL_COLORS[options.kind];

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: colors.ring,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.innerMaterial = new THREE.MeshBasicMaterial({
      color: colors.inner,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fogMaterial = new THREE.MeshBasicMaterial({
      color: '#6f8798',
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.markerMaterial = new THREE.MeshBasicMaterial({
      color: '#d2b781',
      transparent: true,
      opacity: 0.64,
      depthWrite: false,
    });
    this.vortexCoreMaterial = new THREE.MeshBasicMaterial({
      color: colors.core,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.vortexRingMaterial = new THREE.MeshBasicMaterial({
      color: colors.ring,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.vortexArmMaterial = new THREE.MeshBasicMaterial({
      color: colors.core,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    this.inner = new THREE.Mesh(this.innerGeometry, this.innerMaterial);
    this.fog = new THREE.Mesh(this.fogGeometry, this.fogMaterial);
    this.marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
    this.vortexCore = new THREE.Mesh(this.vortexCoreGeometry, this.vortexCoreMaterial);
    this.vortexGroup.add(this.vortexCore);

    for (const scale of [1.55, 2.25, 3.0]) {
      const vortexRing = new THREE.Mesh(this.vortexRingGeometry, this.vortexRingMaterial);
      vortexRing.scale.setScalar(scale);
      this.vortexRings.push(vortexRing);
      this.vortexGroup.add(vortexRing);
    }

    for (let armIndex = 0; armIndex < 3; armIndex += 1) {
      const armGeometry = this.createVortexArmGeometry((armIndex / 3) * Math.PI * 2);
      const arm = new THREE.Mesh(armGeometry, this.vortexArmMaterial);
      this.vortexArmGeometries.push(armGeometry);
      this.vortexArms.push(arm);
      this.vortexGroup.add(arm);
    }

    this.root.name = `vibe_jam_${options.kind}_portal`;
    this.root.position.copy(options.position);
    this.root.rotation.y = options.heading;

    if (options.placement === 'floor') {
      this.ring.rotation.x = -Math.PI / 2;
      this.inner.rotation.x = -Math.PI / 2;
      this.ring.position.y = 0.18;
      this.inner.position.y = 0.16;
      this.vortexGroup.rotation.x = -Math.PI / 2;
      this.vortexGroup.position.y = 0.24;
      this.fog.position.y = 4.2;
      this.fog.scale.set(1.15, 7, 1.15);
      this.marker.position.set(0, 4.6, 0);
      this.marker.scale.setScalar(1.45);
      this.root.scale.setScalar(1.28);
    } else {
      this.ring.position.y = 4.9;
      this.inner.position.y = 4.9;
      this.vortexGroup.position.y = 4.92;
      this.fog.position.y = 0.58;
      this.marker.position.set(0, 7.9, 0);
    }

    this.ring.renderOrder = 16;
    this.inner.renderOrder = 15;
    this.vortexGroup.renderOrder = 17;
    this.fog.renderOrder = 14;
    this.marker.renderOrder = 18;

    this.root.add(this.fog, this.inner, this.vortexGroup, this.ring, this.marker);
  }

  update(elapsedSeconds: number, anchorHeight: number, distanceToWhale: number): void {
    const proximity = 1 - THREE.MathUtils.smoothstep(distanceToWhale, 9, 34);
    const pulse = 0.5 + Math.sin(elapsedSeconds * 1.7 + (this.options.kind === 'return' ? 1.2 : 0)) * 0.5;
    const kindBoost = this.options.kind === 'return' ? 1.12 : 1;
    const floorPortal = this.options.placement === 'floor';

    this.root.position.y = floorPortal ? anchorHeight + 0.12 : anchorHeight - 0.08;
    this.ring.rotation.z = elapsedSeconds * 0.08;
    this.inner.rotation.z = -elapsedSeconds * 0.045;
    this.vortexGroup.rotation.z = elapsedSeconds * (floorPortal ? -0.42 : -0.34);
    this.marker.rotation.y = elapsedSeconds * 0.42;
    this.marker.position.y = floorPortal ? 4.5 + pulse * 0.38 : 7.8 + pulse * 0.28;

    for (let ringIndex = 0; ringIndex < this.vortexRings.length; ringIndex += 1) {
      const ringPulse = 1 + Math.sin(elapsedSeconds * 1.35 + ringIndex * 1.7) * 0.045;
      this.vortexRings[ringIndex].scale.setScalar([1.55, 2.25, 3.0][ringIndex] * ringPulse);
    }

    this.ringMaterial.opacity = (floorPortal ? 0.4 : 0.24) + proximity * 0.3 + pulse * 0.1;
    this.ringMaterial.opacity *= kindBoost;
    this.innerMaterial.opacity = (floorPortal ? 0.11 : 0.045) + proximity * 0.11;
    this.fogMaterial.opacity = (floorPortal ? 0.18 : 0.08) + proximity * 0.14;
    this.markerMaterial.opacity = (floorPortal ? 0.52 : 0.46) + pulse * 0.2 + proximity * 0.2;
    this.vortexCoreMaterial.opacity = (floorPortal ? 0.2 : 0.16) + proximity * 0.12 + pulse * 0.06;
    this.vortexRingMaterial.opacity = (floorPortal ? 0.34 : 0.26) + proximity * 0.14 + pulse * 0.08;
    this.vortexArmMaterial.opacity = (floorPortal ? 0.3 : 0.24) + proximity * 0.16 + pulse * 0.08;
  }

  dispose(): void {
    this.ringGeometry.dispose();
    this.innerGeometry.dispose();
    this.fogGeometry.dispose();
    this.markerGeometry.dispose();
    this.vortexCoreGeometry.dispose();
    this.vortexRingGeometry.dispose();
    for (const geometry of this.vortexArmGeometries) {
      geometry.dispose();
    }
    this.ringMaterial.dispose();
    this.innerMaterial.dispose();
    this.fogMaterial.dispose();
    this.markerMaterial.dispose();
    this.vortexCoreMaterial.dispose();
    this.vortexRingMaterial.dispose();
    this.vortexArmMaterial.dispose();
  }

  private createVortexArmGeometry(phase: number): THREE.TubeGeometry {
    const points: THREE.Vector3[] = [];

    for (let index = 0; index <= 36; index += 1) {
      const progress = index / 36;
      const radius = THREE.MathUtils.lerp(0.34, 3.55, progress);
      const angle = phase + progress * Math.PI * 2.2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
    }

    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 42, 0.025, 5, false);
  }
}

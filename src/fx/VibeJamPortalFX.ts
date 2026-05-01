import * as THREE from 'three';

type VibeJamPortalKind = 'exit' | 'return';
type VibeJamPortalPlacement = 'surface' | 'floor';

interface VibeJamPortalFXOptions {
  kind: VibeJamPortalKind;
  placement: VibeJamPortalPlacement;
  position: THREE.Vector3;
  heading: number;
}

export type { VibeJamPortalKind, VibeJamPortalPlacement };

const PORTAL_COLORS: Record<
  VibeJamPortalKind,
  {
    accent: THREE.ColorRepresentation;
    inner: THREE.ColorRepresentation;
    core: THREE.ColorRepresentation;
    void: THREE.ColorRepresentation;
  }
> = {
  exit: {
    accent: '#d2b781',
    inner: '#d2b781',
    core: '#f1dba1',
    void: '#061018',
  },
  return: {
    accent: '#8fa5b8',
    inner: '#6d8197',
    core: '#c6d6f5',
    void: '#030b16',
  },
};

const TUNNEL_RING_SCALES = [0.88, 0.68, 0.5, 0.34, 0.2] as const;

export class VibeJamPortalFX {
  readonly root = new THREE.Group();

  private readonly ringGeometry = new THREE.TorusGeometry(4.8, 0.13, 8, 42);
  private readonly innerGeometry = new THREE.CircleGeometry(4.48, 32);
  private readonly fogGeometry = new THREE.CylinderGeometry(5.6, 7.8, 1.15, 28, 1, true);
  private readonly markerGeometry = new THREE.OctahedronGeometry(0.42, 0);
  private readonly tunnelRingGeometry = new THREE.TorusGeometry(1, 0.032, 6, 34);
  private readonly vortexArmGeometries: THREE.TubeGeometry[] = [];
  private readonly ringMaterial: THREE.MeshBasicMaterial;
  private readonly innerMaterial: THREE.MeshBasicMaterial;
  private readonly fogMaterial: THREE.MeshBasicMaterial;
  private readonly markerMaterial: THREE.MeshBasicMaterial;
  private readonly tunnelRingMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly vortexArmMaterial: THREE.MeshBasicMaterial;
  private readonly ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly inner: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly fog: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly marker: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshBasicMaterial>;
  private readonly tunnelGroup = new THREE.Group();
  private readonly tunnelRings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly vortexGroup = new THREE.Group();
  private readonly vortexArms: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>[] = [];

  constructor(private readonly options: VibeJamPortalFXOptions) {
    const colors = PORTAL_COLORS[options.kind];
    const floorPortal = options.placement === 'floor';

    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: colors.accent,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    this.innerMaterial = new THREE.MeshBasicMaterial({
      color: colors.void,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    this.fogMaterial = new THREE.MeshBasicMaterial({
      color: '#6f8798',
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.markerMaterial = new THREE.MeshBasicMaterial({
      color: colors.accent,
      transparent: true,
      opacity: 0.64,
      depthWrite: false,
    });
    this.vortexArmMaterial = new THREE.MeshBasicMaterial({
      color: colors.core,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    this.inner = new THREE.Mesh(this.innerGeometry, this.innerMaterial);
    this.fog = new THREE.Mesh(this.fogGeometry, this.fogMaterial);
    this.marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);

    for (let ringIndex = 0; ringIndex < TUNNEL_RING_SCALES.length; ringIndex += 1) {
      const tunnelMaterial = new THREE.MeshBasicMaterial({
        color: ringIndex % 2 === 0 ? colors.inner : colors.core,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const tunnelRing = new THREE.Mesh(this.tunnelRingGeometry, tunnelMaterial);
      tunnelRing.position.z = -ringIndex * 0.075;
      tunnelRing.renderOrder = 15;
      this.tunnelRingMaterials.push(tunnelMaterial);
      this.tunnelRings.push(tunnelRing);
      this.tunnelGroup.add(tunnelRing);
    }

    for (let armIndex = 0; armIndex < 3; armIndex += 1) {
      const armGeometry = this.createVortexArmGeometry((armIndex / 3) * Math.PI * 2);
      const arm = new THREE.Mesh(armGeometry, this.vortexArmMaterial);
      arm.renderOrder = 17;
      this.vortexArmGeometries.push(armGeometry);
      this.vortexArms.push(arm);
      this.vortexGroup.add(arm);
    }

    this.root.name = `vibe_jam_${options.kind}_portal`;
    this.root.position.copy(options.position);
    this.root.rotation.y = options.heading;

    if (floorPortal) {
      this.ring.rotation.x = -Math.PI / 2;
      this.inner.rotation.x = -Math.PI / 2;
      this.tunnelGroup.rotation.x = -Math.PI / 2;
      this.ring.position.y = 0.18;
      this.inner.position.y = 0.16;
      this.tunnelGroup.position.y = 0.24;
      this.vortexGroup.rotation.x = -Math.PI / 2;
      this.vortexGroup.position.y = 0.24;
      this.fog.position.y = 4.2;
      this.fog.scale.set(1.15, 7, 1.15);
      this.fog.visible = false;
      this.marker.position.set(0, 4.6, 0);
      this.marker.scale.setScalar(1.45);
      this.root.scale.setScalar(1.28);
    } else {
      this.ring.position.y = 4.9;
      this.inner.position.set(0, 4.9, -0.12);
      this.tunnelGroup.position.y = 4.92;
      this.vortexGroup.position.y = 4.92;
      this.fog.position.y = 0.58;
      this.marker.position.set(0, 7.9, 0);
    }

    this.ring.renderOrder = 16;
    this.inner.renderOrder = 13;
    this.tunnelGroup.renderOrder = 15;
    this.vortexGroup.renderOrder = 17;
    this.fog.renderOrder = 14;
    this.marker.renderOrder = 18;

    this.root.add(this.fog, this.inner, this.tunnelGroup, this.vortexGroup, this.ring, this.marker);
  }

  update(elapsedSeconds: number, anchorHeight: number, distanceToWhale: number): void {
    const proximity = 1 - THREE.MathUtils.smoothstep(distanceToWhale, 9, 34);
    const pulse = 0.5 + Math.sin(elapsedSeconds * 1.7 + (this.options.kind === 'return' ? 1.2 : 0)) * 0.5;
    const kindBoost = this.options.kind === 'return' ? 1.12 : 1;
    const floorPortal = this.options.placement === 'floor';

    this.root.position.y = floorPortal ? anchorHeight + 0.12 : anchorHeight - 0.08;
    this.ring.rotation.z = elapsedSeconds * 0.08;
    this.inner.rotation.z = -elapsedSeconds * (floorPortal ? 0.08 : 0.06);
    this.tunnelGroup.rotation.z = elapsedSeconds * (floorPortal ? -0.34 : -0.28);
    this.vortexGroup.rotation.z = elapsedSeconds * (floorPortal ? -0.72 : -0.58);
    this.marker.rotation.y = elapsedSeconds * 0.42;
    this.marker.position.y = floorPortal ? 3.62 + pulse * 0.22 : 7.8 + pulse * 0.28;

    for (let ringIndex = 0; ringIndex < this.tunnelRings.length; ringIndex += 1) {
      const depthPulse = Math.sin(elapsedSeconds * 1.35 + ringIndex * 1.3) * 0.025;
      const scale = TUNNEL_RING_SCALES[ringIndex] + depthPulse;
      const depthFade = 1 - ringIndex / this.tunnelRings.length;
      this.tunnelRings[ringIndex].scale.setScalar(scale * 4.5);
      this.tunnelRingMaterials[ringIndex].opacity =
        (0.08 + depthFade * 0.18 + proximity * 0.06 + pulse * 0.025) * kindBoost;
    }

    for (let armIndex = 0; armIndex < this.vortexArms.length; armIndex += 1) {
      const armPulse = 1 + Math.sin(elapsedSeconds * 1.6 + armIndex * 1.9) * 0.035;
      this.vortexArms[armIndex].scale.setScalar(armPulse);
    }

    this.ringMaterial.opacity = ((floorPortal ? 0.4 : 0.24) + proximity * 0.3 + pulse * 0.1) * kindBoost;
    this.innerMaterial.opacity = THREE.MathUtils.clamp(
      ((floorPortal ? 0.84 : 0.78) + proximity * 0.1 + pulse * 0.04) * kindBoost,
      0,
      0.96,
    );
    this.fogMaterial.opacity = floorPortal ? 0 : 0.08 + proximity * 0.14;
    this.markerMaterial.opacity = (floorPortal ? 0.52 : 0.46) + pulse * 0.2 + proximity * 0.2;
    this.vortexArmMaterial.opacity = (floorPortal ? 0.12 : 0.08) + proximity * 0.08 + pulse * 0.035;
  }

  dispose(): void {
    this.ringGeometry.dispose();
    this.innerGeometry.dispose();
    this.fogGeometry.dispose();
    this.markerGeometry.dispose();
    this.tunnelRingGeometry.dispose();
    for (const geometry of this.vortexArmGeometries) {
      geometry.dispose();
    }
    this.ringMaterial.dispose();
    this.innerMaterial.dispose();
    this.fogMaterial.dispose();
    this.markerMaterial.dispose();
    for (const material of this.tunnelRingMaterials) {
      material.dispose();
    }
    this.vortexArmMaterial.dispose();
  }

  private createVortexArmGeometry(phase: number): THREE.TubeGeometry {
    const points: THREE.Vector3[] = [];

    for (let index = 0; index <= 36; index += 1) {
      const progress = index / 36;
      const radius = THREE.MathUtils.lerp(0.24, 2.85, progress);
      const angle = phase + progress * Math.PI * 2.45;
      const depthBias = Math.sin(progress * Math.PI) * 0.025;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, depthBias));
    }

    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 42, 0.012, 5, false);
  }
}

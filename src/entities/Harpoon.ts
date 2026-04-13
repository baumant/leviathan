import * as THREE from 'three';

export type HarpoonMode = 'flying' | 'tethered';

const TETHER_AXIS = new THREE.Vector3(0, 1, 0);

export class Harpoon {
  readonly root = new THREE.Group();
  readonly ownerShipId: string;
  readonly radius = 0.7;
  readonly maxTetherLength = 24;
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();

  ageSeconds = 0;
  active = false;
  mode: HarpoonMode = 'flying';

  private readonly direction = new THREE.Vector3();
  private readonly tipAnchor = new THREE.Vector3();
  private readonly projectile: THREE.Group;
  private readonly impactMarker: THREE.Group;
  private readonly tetherCore: THREE.Mesh;
  private readonly tetherGlow: THREE.Mesh;
  private readonly tetherCoreMaterial: THREE.MeshStandardMaterial;
  private readonly tetherGlowMaterial: THREE.MeshBasicMaterial;
  private readonly tetherMidpoint = new THREE.Vector3();

  constructor(ownerShipId: string) {
    this.ownerShipId = ownerShipId;

    const shaftMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#6e5945'),
      roughness: 0.88,
      metalness: 0.04,
      flatShading: true,
    });

    const tipMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#c7d6e7'),
      roughness: 0.28,
      metalness: 0.3,
      flatShading: true,
    });

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5), shaftMaterial);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.08;

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.36, 5), shaftMaterial);
    grip.rotation.x = Math.PI / 2;
    grip.position.z = -0.82;

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.7, 5), tipMaterial);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = 1.45;

    const barbGeometry = new THREE.BoxGeometry(0.08, 0.02, 0.34);
    const leftBarb = new THREE.Mesh(barbGeometry, tipMaterial);
    leftBarb.position.set(-0.14, 0, 1.04);
    leftBarb.rotation.y = Math.PI / 5;
    leftBarb.rotation.z = -0.3;

    const rightBarb = leftBarb.clone();
    rightBarb.position.x *= -1;
    rightBarb.rotation.y *= -1;
    rightBarb.rotation.z *= -1;

    this.projectile = new THREE.Group();
    this.projectile.add(shaft, grip, tip, leftBarb, rightBarb);
    this.position = this.projectile.position;

    const impactCore = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 0),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#cfe4ef'),
        emissive: new THREE.Color('#7db6d8'),
        emissiveIntensity: 0.2,
        roughness: 0.42,
        metalness: 0.22,
        flatShading: true,
      }),
    );
    const impactFin = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.22, 0.44),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#7d9cae'),
        roughness: 0.7,
        metalness: 0.08,
        flatShading: true,
      }),
    );
    const impactFinCross = impactFin.clone();
    impactFinCross.rotation.z = Math.PI / 2;

    this.impactMarker = new THREE.Group();
    this.impactMarker.add(impactCore, impactFin, impactFinCross);
    this.impactMarker.visible = false;

    const tetherGeometry = new THREE.CylinderGeometry(0.08, 0.08, 1, 6);
    this.tetherCoreMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#c3d8e4'),
      emissive: new THREE.Color('#7db7d8'),
      emissiveIntensity: 0.22,
      roughness: 0.72,
      metalness: 0.04,
      flatShading: true,
    });
    this.tetherGlowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#8fdcff'),
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
    });
    this.tetherGlowMaterial.depthWrite = false;

    this.tetherCore = new THREE.Mesh(tetherGeometry, this.tetherCoreMaterial);
    this.tetherGlow = new THREE.Mesh(tetherGeometry, this.tetherGlowMaterial);
    this.tetherGlow.scale.set(2.4, 1, 2.4);
    this.tetherCore.visible = false;
    this.tetherGlow.visible = false;
    this.tetherGlow.renderOrder = 2;

    this.root.add(this.projectile, this.impactMarker, this.tetherCore, this.tetherGlow);
    this.root.visible = false;
  }

  launch(origin: THREE.Vector3, direction: THREE.Vector3, speed: number): void {
    this.active = true;
    this.mode = 'flying';
    this.ageSeconds = 0;
    this.position.copy(origin);
    this.velocity.copy(direction).normalize().multiplyScalar(speed);
    this.projectile.visible = true;
    this.impactMarker.visible = false;
    this.tetherCore.visible = false;
    this.tetherGlow.visible = false;
    this.root.visible = true;
    this.alignToVelocity();
    this.root.updateMatrixWorld();
  }

  attach(attachPoint: THREE.Vector3): void {
    this.mode = 'tethered';
    this.velocity.setScalar(0);
    this.position.copy(attachPoint);
    this.tipAnchor.copy(attachPoint);
    this.projectile.visible = true;
    this.impactMarker.visible = true;
    this.tetherCore.visible = true;
    this.tetherGlow.visible = true;
    this.tetherGlowMaterial.opacity = 0.28;
    this.root.visible = true;
    this.impactMarker.position.copy(this.tipAnchor);
    this.root.updateMatrixWorld();
  }

  update(deltaSeconds: number): void {
    if (!this.active) {
      return;
    }

    this.ageSeconds += deltaSeconds;

    if (this.mode === 'flying') {
      this.position.addScaledVector(this.velocity, deltaSeconds);
      this.alignToVelocity();
    }

    this.root.updateMatrixWorld();
  }

  updateTether(shipOrigin: THREE.Vector3, attachPoint: THREE.Vector3, tensionAlpha: number): void {
    if (!this.active || this.mode !== 'tethered') {
      return;
    }

    this.tipAnchor.copy(attachPoint);
    this.position.copy(this.tipAnchor);
    this.impactMarker.position.copy(this.tipAnchor);
    this.direction.copy(this.tipAnchor).sub(shipOrigin);
    const tetherLength = Math.max(0.001, this.direction.length());
    this.direction.multiplyScalar(1 / tetherLength);
    this.tetherMidpoint.copy(shipOrigin).lerp(this.tipAnchor, 0.5);

    this.tetherCore.position.copy(this.tetherMidpoint);
    this.tetherGlow.position.copy(this.tetherMidpoint);
    this.tetherCore.quaternion.setFromUnitVectors(TETHER_AXIS, this.direction);
    this.tetherGlow.quaternion.copy(this.tetherCore.quaternion);
    this.tetherCore.scale.set(1, tetherLength, 1);
    this.tetherGlow.scale.set(2.4, tetherLength, 2.4);
    this.tetherCoreMaterial.emissiveIntensity = THREE.MathUtils.lerp(0.14, 0.42, tensionAlpha);
    this.tetherGlowMaterial.opacity = THREE.MathUtils.lerp(0.16, 0.42, tensionAlpha);

    this.direction.copy(shipOrigin).sub(this.tipAnchor).normalize();
    this.projectile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction);
    this.impactMarker.quaternion.copy(this.projectile.quaternion);
    this.root.updateMatrixWorld();
  }

  getTetherLength(shipOrigin: THREE.Vector3, attachPoint: THREE.Vector3): number {
    return shipOrigin.distanceTo(attachPoint);
  }

  deactivate(): void {
    this.active = false;
    this.mode = 'flying';
    this.root.visible = false;
    this.projectile.visible = false;
    this.impactMarker.visible = false;
    this.tetherCore.visible = false;
    this.tetherGlow.visible = false;
    this.root.removeFromParent();
  }

  private alignToVelocity(): void {
    this.direction.copy(this.velocity).normalize();
    this.projectile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction);
  }
}

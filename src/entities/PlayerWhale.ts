import * as THREE from 'three';

export class PlayerWhale {
  readonly root = new THREE.Group();
  readonly position = this.root.position;

  speed = 0;
  throttle = 0.35;
  yaw = 0;
  pitch = 0;
  roll = 0;
  depth = -1.2;
  verticalSpeed = 0;
  health = 100;
  boostActive = false;
  submerged = true;
  readonly radius = 2.5;

  constructor() {
    const whaleMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#e9f1ff'),
      roughness: 0.7,
      metalness: 0.02,
      emissive: new THREE.Color('#6681aa'),
      emissiveIntensity: 0.2,
      flatShading: true,
    });

    const bellyMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#ced9eb'),
      roughness: 0.82,
      metalness: 0.01,
      emissive: new THREE.Color('#526886'),
      emissiveIntensity: 0.12,
      flatShading: true,
    });

    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), whaleMaterial);
    body.scale.set(1.2, 0.85, 2.75);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), whaleMaterial);
    head.scale.set(1.1, 0.95, 1.4);
    head.position.set(0, -0.08, 3.9);

    const belly = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), bellyMaterial);
    belly.scale.set(0.82, 0.45, 2.1);
    belly.position.set(0, -0.85, 1.5);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(1.15, 2.7, 5), whaleMaterial);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, 0.15, -4.5);

    const fluke = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 1.15), whaleMaterial);
    fluke.position.set(0, 0, -5.8);

    const dorsalFin = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.45, 4), whaleMaterial);
    dorsalFin.position.set(0, 1.05, -0.55);
    dorsalFin.rotation.x = Math.PI / 2;

    const leftFin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.95), whaleMaterial);
    leftFin.position.set(-1.55, -0.35, 0.9);
    leftFin.rotation.z = Math.PI / 8;
    leftFin.rotation.x = -Math.PI / 4;

    const rightFin = leftFin.clone();
    rightFin.position.x *= -1;
    rightFin.rotation.z *= -1;

    this.root.add(body, head, belly, tail, fluke, dorsalFin, leftFin, rightFin);
    this.root.position.set(0, -1.2, 0);
    this.root.rotation.order = 'YXZ';
  }

  getForward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 0, 1).applyQuaternion(this.root.quaternion).normalize();
  }
}

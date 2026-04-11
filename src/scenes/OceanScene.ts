import * as THREE from 'three';

import { PlayerWhale } from '../entities/PlayerWhale';
import { Ship } from '../entities/Ship';
import { Input } from '../game/Input';
import { DamageSystem } from '../systems/DamageSystem';
import { UISystem } from '../systems/UISystem';
import { WhaleMovementSystem } from '../systems/WhaleMovementSystem';

const SURFACE_FOG = new THREE.Color('#07111d');
const UNDERWATER_FOG = new THREE.Color('#0a1926');

export class OceanScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.1, 700);

  private readonly whale = new PlayerWhale();
  private readonly ship = new Ship();
  private readonly whaleMovement = new WhaleMovementSystem();
  private readonly damageSystem = new DamageSystem();
  private readonly oceanGeometry = new THREE.PlaneGeometry(460, 460, 56, 56);
  private readonly oceanMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly baseWaveCoordinates: Float32Array;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly oceanSamplePoint = new THREE.Vector3();
  private readonly atmosphereColor = SURFACE_FOG.clone();

  private elapsedSeconds = 0;
  private impactShake = 0;

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

    this.setupLights();
    this.setupSky();
    this.scene.add(this.oceanMesh, this.whale.root, this.ship.root);

    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    this.elapsedSeconds = elapsedSeconds;

    this.animateOcean();
    this.whaleMovement.update(this.whale, this.input, deltaSeconds, this.sampleOceanHeight);
    this.ship.update(deltaSeconds, elapsedSeconds, this.sampleOceanHeight);

    const ramResult = this.damageSystem.resolveRam(this.whale, this.ship, elapsedSeconds);
    if (ramResult) {
      this.impactShake = Math.max(this.impactShake, ramResult.intensity);
    }

    this.updateCamera(deltaSeconds);
    this.updateAtmosphere(deltaSeconds);
    this.updateHud();
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  private createOcean(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
    this.oceanGeometry.rotateX(-Math.PI / 2);

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#0d2336'),
      roughness: 0.84,
      metalness: 0.03,
      flatShading: true,
      side: THREE.DoubleSide,
    });

    const ocean = new THREE.Mesh(this.oceanGeometry, material);
    ocean.receiveShadow = false;
    return ocean;
  }

  private setupLights(): void {
    const moonLight = new THREE.DirectionalLight('#a8c7ff', 2.5);
    moonLight.position.set(-20, 40, -10);

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
  }

  private readonly sampleOceanHeight = (x: number, z: number): number => {
    const time = this.elapsedSeconds;
    const longSwell = Math.sin(x * 0.03 + time * 0.72) * 0.85;
    const crossSwell = Math.cos(z * 0.037 - time * 0.94) * 0.55;
    const chop = Math.sin((x + z) * 0.09 + time * 1.8) * 0.18;
    return longSwell + crossSwell + chop;
  };

  private updateCamera(deltaSeconds: number): void {
    const forward = this.whale.getForward(this.oceanSamplePoint);
    const underwaterRatio = THREE.MathUtils.clamp((-this.whale.depth - 0.4) / 5, 0, 1);
    const cameraDistance = THREE.MathUtils.lerp(14, 10.5, underwaterRatio);
    const cameraHeight = THREE.MathUtils.lerp(5.6, 2.8, underwaterRatio);

    this.cameraTarget
      .copy(this.whale.position)
      .addScaledVector(forward, -cameraDistance)
      .add(new THREE.Vector3(0, cameraHeight, 0));

    if (this.whale.submerged) {
      this.cameraTarget.y = Math.min(this.cameraTarget.y, this.sampleOceanHeight(this.cameraTarget.x, this.cameraTarget.z) - 0.35);
    }

    if (this.impactShake > 0.001) {
      this.cameraTarget.x += (Math.random() - 0.5) * this.impactShake;
      this.cameraTarget.y += (Math.random() - 0.5) * this.impactShake * 0.6;
      this.cameraTarget.z += (Math.random() - 0.5) * this.impactShake;
      this.impactShake = THREE.MathUtils.damp(this.impactShake, 0, 8, deltaSeconds);
    }

    this.camera.position.lerp(this.cameraTarget, 1 - Math.exp(-deltaSeconds * 4.4));
    this.lookTarget.copy(this.whale.position).addScaledVector(forward, 6.5);
    this.camera.lookAt(this.lookTarget);
  }

  private updateAtmosphere(deltaSeconds: number): void {
    const targetFog = this.whale.submerged ? UNDERWATER_FOG : SURFACE_FOG;
    this.atmosphereColor.lerp(targetFog, 1 - Math.exp(-deltaSeconds * 2.4));
    (this.scene.fog as THREE.FogExp2).color.copy(this.atmosphereColor);
  }

  private updateHud(): void {
    this.ui.update({
      objective: this.ship.sunk
        ? 'The hull is gone. Circle the wreck and feel the sea take it.'
        : 'Drive beneath the lantern glow, build speed underwater, and ram the hull.',
      whaleHealth: this.whale.health / 100,
      shipHealth: this.ship.healthPercent,
      shipStatus: this.ship.sunk
        ? 'Whaler lost beneath the fog'
        : this.ship.sinking
          ? 'Target is breaking apart'
          : 'Single whaler holding station',
      speed: this.whale.speed,
      depth: -this.whale.depth,
      submerged: this.whale.submerged,
      burstActive: this.whale.boostActive,
    });
  }
}

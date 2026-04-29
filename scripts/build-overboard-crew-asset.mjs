import fs from 'node:fs';
import path from 'node:path';

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

class NodeFileReader {
  constructor() {
    this.result = null;
    this.onloadend = null;
  }

  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }

  async readAsDataURL(blob) {
    const buffer = Buffer.from(await blob.arrayBuffer());
    this.result = `data:${blob.type || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
    this.onloadend?.();
  }
}

globalThis.FileReader = NodeFileReader;

const DEFAULT_SOURCE_PATH = path.resolve('source-assets/models/overboard-crew/source.glb');
const SOURCE_PATH = process.env.OVERBOARD_CREW_SOURCE_GLTF
  ? path.resolve(process.env.OVERBOARD_CREW_SOURCE_GLTF)
  : DEFAULT_SOURCE_PATH;
const OUTPUT_PATH = path.resolve('public/models/overboard-crew.glb');
const TARGET_HEIGHT = 1.65;

const exporter = new GLTFExporter();
const loader = new GLTFLoader();

function createMaterial(color, roughness = 0.88) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    flatShading: true,
    metalness: 0,
    roughness,
  });
}

function createCylinder(name, radius, height, color) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 6),
    createMaterial(color),
  );
  mesh.name = name;
  return mesh;
}

function createGeneratedCrewSource() {
  const root = new THREE.Group();
  root.name = 'GeneratedOverboardCrewSource';

  const coat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.76, 0.26), createMaterial('#22303a'));
  coat.name = 'CrewCoat';
  coat.position.set(0, 0.9, 0);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), createMaterial('#7a5b46'));
  head.name = 'CrewHead';
  head.scale.set(0.92, 1.08, 0.9);
  head.position.set(0, 1.38, 0.02);

  const hat = createCylinder('CrewHat', 0.18, 0.12, '#d6d0bc');
  hat.position.set(0, 1.58, 0.02);

  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.035, 8), createMaterial('#bbb49c'));
  hatBrim.name = 'CrewHatBrim';
  hatBrim.position.set(0, 1.5, 0.02);

  const leftArm = createCylinder('CrewSleeveLeft', 0.075, 0.66, '#1a2630');
  leftArm.position.set(-0.38, 0.86, 0);
  leftArm.rotation.z = -0.22;

  const rightArm = createCylinder('CrewSleeveRight', 0.075, 0.66, '#1a2630');
  rightArm.position.set(0.38, 0.86, 0);
  rightArm.rotation.z = 0.34;

  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), createMaterial('#765945'));
  leftHand.name = 'CrewHandLeft';
  leftHand.position.set(-0.48, 0.48, 0.02);

  const rightHand = leftHand.clone();
  rightHand.name = 'CrewHandRight';
  rightHand.material = leftHand.material.clone();
  rightHand.position.set(0.52, 0.48, 0.02);

  const leftLeg = createCylinder('CrewTrouserLeft', 0.085, 0.76, '#151c24');
  leftLeg.position.set(-0.14, 0.28, 0);
  leftLeg.rotation.z = 0.08;

  const rightLeg = createCylinder('CrewTrouserRight', 0.085, 0.76, '#151c24');
  rightLeg.position.set(0.14, 0.28, 0);
  rightLeg.rotation.z = -0.18;

  const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.26), createMaterial('#101318'));
  leftBoot.name = 'CrewBootLeft';
  leftBoot.position.set(-0.16, -0.12, 0.05);

  const rightBoot = leftBoot.clone();
  rightBoot.name = 'CrewBootRight';
  rightBoot.material = leftBoot.material.clone();
  rightBoot.position.set(0.18, -0.12, -0.02);

  root.add(coat, head, hat, hatBrim, leftArm, rightArm, leftHand, rightHand, leftLeg, rightLeg, leftBoot, rightBoot);
  return root;
}

function parseGlb(sourcePath) {
  const buffer = fs.readFileSync(sourcePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  return new Promise((resolve, reject) => {
    loader.parse(
      arrayBuffer,
      `${path.dirname(sourcePath)}${path.sep}`,
      (gltf) => resolve(gltf.scene),
      (error) => reject(error),
    );
  });
}

function replaceMaterials(root) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const name = object.name.toLowerCase();
    const color = name.includes('head') || name.includes('hand')
      ? '#725743'
      : name.includes('hat')
        ? '#c4bea8'
        : name.includes('boot') || name.includes('trouser') || name.includes('leg')
          ? '#121922'
          : '#1b2832';

    object.material = createMaterial(color);
    object.geometry.computeVertexNormals();
    object.castShadow = false;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
}

function normalizeAndPose(sourceRoot) {
  sourceRoot.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(sourceRoot);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const sourceHeight = Math.max(size.y, 0.001);
  const scale = TARGET_HEIGHT / sourceHeight;

  sourceRoot.position.sub(center);
  sourceRoot.scale.multiplyScalar(scale);
  sourceRoot.rotation.set(0.1, 0.16, -Math.PI / 2.08);
  sourceRoot.name = 'overboard_crew_model';

  const root = new THREE.Group();
  root.name = 'overboard_crew_visual_asset';
  root.add(sourceRoot);
  root.updateMatrixWorld(true);
  return root;
}

function exportBinary(root) {
  return new Promise((resolve, reject) => {
    exporter.parse(
      root,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(Buffer.from(result));
          return;
        }

        reject(new Error('Expected GLTFExporter to return a binary GLB buffer.'));
      },
      (error) => reject(error),
      {
        binary: true,
        trs: true,
        onlyVisible: true,
      },
    );
  });
}

const sourceRoot = fs.existsSync(SOURCE_PATH)
  ? await parseGlb(SOURCE_PATH)
  : createGeneratedCrewSource();

replaceMaterials(sourceRoot);
const runtimeRoot = normalizeAndPose(sourceRoot);
const output = await exportBinary(runtimeRoot);

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, output);
console.log(`Wrote ${path.relative(process.cwd(), OUTPUT_PATH)} (${output.length} bytes)`);

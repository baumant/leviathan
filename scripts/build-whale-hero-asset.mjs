import fs from 'node:fs';
import path from 'node:path';

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

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

const SOURCE_PATH = process.env.WHALE_SOURCE_GLTF
  ? path.resolve(process.env.WHALE_SOURCE_GLTF)
  : path.resolve('public/models/whale-source.glb');
const OUTPUT_PATH = path.resolve('public/models/whale-hero.glb');
const TARGET_LENGTH = 13.1;
const TAIL_PIVOT_POSITION = new THREE.Vector3(0, -0.012, -0.235);
const FLUKE_PIVOT_WORLD_POSITION = new THREE.Vector3(0, -0.022, -0.395);
const LEFT_FIN_PIVOT_POSITION = new THREE.Vector3(-0.145, -0.08, -0.01);
const RIGHT_FIN_PIVOT_POSITION = new THREE.Vector3(0.145, -0.08, -0.01);
const TAIL_NEUTRAL_PITCH = 0;
const FLUKE_NEUTRAL_PITCH = 0;
const TAIL_STRAIGHTEN_START_Z = -0.08;
const TAIL_STRAIGHTEN_END_Z = -0.50048828125;
const TAIL_STRAIGHTEN_ROTATION = THREE.MathUtils.degToRad(-13);
const TAIL_STRAIGHTEN_DROP = 0.016;
const TAIL_STRAIGHTEN_PIVOT_Y = -0.04;
const TAIL_STRAIGHTEN_PIVOT_Z = -0.08;

const exporter = new GLTFExporter();

function parseGlb(glbBuffer) {
  const view = new DataView(glbBuffer.buffer, glbBuffer.byteOffset, glbBuffer.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const length = view.getUint32(8, true);

  if (magic !== 0x46546c67 || version !== 2) {
    throw new Error('Expected a glTF 2.0 binary (.glb) source asset.');
  }

  let offset = 12;
  let json = null;
  let binChunk = null;

  while (offset < length) {
    const chunkLength = view.getUint32(offset, true);
    offset += 4;
    const chunkType = view.getUint32(offset, true);
    offset += 4;
    const chunk = glbBuffer.subarray(offset, offset + chunkLength);
    offset += chunkLength;

    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(chunk));
    } else if (chunkType === 0x004e4942) {
      binChunk = chunk;
    }
  }

  if (!json || !binChunk) {
    throw new Error('Source GLB is missing JSON or BIN chunks.');
  }

  return { json, binChunk };
}

function getAccessorArray(json, binChunk, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const bufferView = json.bufferViews[accessor.bufferView];
  const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const componentCount = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
  }[accessor.type];
  const ArrayType = {
    5126: Float32Array,
    5125: Uint32Array,
    5123: Uint16Array,
    5121: Uint8Array,
  }[accessor.componentType];

  if (!ArrayType || !componentCount) {
    throw new Error(`Unsupported accessor format: type=${accessor.type} componentType=${accessor.componentType}`);
  }

  return new ArrayType(
    binChunk.buffer,
    binChunk.byteOffset + byteOffset,
    accessor.count * componentCount,
  );
}

function createTriangleGeometry(positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function offsetRegionPositions(positions, offset) {
  if (offset.x === 0 && offset.y === 0 && offset.z === 0) {
    return positions;
  }

  const shifted = new Array(positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    shifted[index] = positions[index] - offset.x;
    shifted[index + 1] = positions[index + 1] - offset.y;
    shifted[index + 2] = positions[index + 2] - offset.z;
  }
  return shifted;
}

function straightenTailPositions(positions) {
  const shaped = new Array(positions.length);

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index];
    let y = positions[index + 1];
    let z = positions[index + 2];

    if (z < TAIL_STRAIGHTEN_START_Z) {
      const rawProgress =
        (TAIL_STRAIGHTEN_START_Z - z) / Math.max(TAIL_STRAIGHTEN_START_Z - TAIL_STRAIGHTEN_END_Z, 0.0001);
      const progress = THREE.MathUtils.clamp(rawProgress, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      const angle = TAIL_STRAIGHTEN_ROTATION * eased;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const localY = y - TAIL_STRAIGHTEN_PIVOT_Y;
      const localZ = z - TAIL_STRAIGHTEN_PIVOT_Z;

      y = localY * cos - localZ * sin + TAIL_STRAIGHTEN_PIVOT_Y - TAIL_STRAIGHTEN_DROP * eased;
      z = localY * sin + localZ * cos + TAIL_STRAIGHTEN_PIVOT_Z;
    }

    shaped[index] = x;
    shaped[index + 1] = y;
    shaped[index + 2] = z;
  }

  return shaped;
}

function classifyRegion(cx, cy, cz) {
  if (cz < -0.36) {
    return cx < 0 ? 'left_fluke' : 'right_fluke';
  }

  if (cz < -0.18) {
    return 'tail_stem';
  }

  if (cz > -0.08 && cz < 0.1 && Math.abs(cx) > 0.11 && cy < 0.02) {
    return cx < 0 ? 'left_pectoral' : 'right_pectoral';
  }

  if (cy < -0.045 && cz > -0.22) {
    return 'belly';
  }

  return 'body';
}

const sourceBuffer = fs.readFileSync(SOURCE_PATH);
const { json, binChunk } = parseGlb(sourceBuffer);
const primitive = json.meshes?.[0]?.primitives?.[0];

if (!primitive) {
  throw new Error('Source GLB does not contain a readable primary mesh primitive.');
}

const sourcePositions = getAccessorArray(json, binChunk, primitive.attributes.POSITION);
const positions = straightenTailPositions(sourcePositions);
const indices = primitive.indices != null ? getAccessorArray(json, binChunk, primitive.indices) : null;
const regionPositions = {
  body: [],
  belly: [],
  tail_stem: [],
  left_fluke: [],
  right_fluke: [],
  left_pectoral: [],
  right_pectoral: [],
};

const triangleCount = indices ? indices.length / 3 : positions.length / 9;

for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
  const triangleVertexIndices = indices
    ? [
        indices[triangleIndex * 3],
        indices[triangleIndex * 3 + 1],
        indices[triangleIndex * 3 + 2],
      ]
    : [triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2];

  let centroidX = 0;
  let centroidY = 0;
  let centroidZ = 0;

  for (const vertexIndex of triangleVertexIndices) {
    centroidX += positions[vertexIndex * 3];
    centroidY += positions[vertexIndex * 3 + 1];
    centroidZ += positions[vertexIndex * 3 + 2];
  }

  centroidX /= 3;
  centroidY /= 3;
  centroidZ /= 3;

  const region = classifyRegion(centroidX, centroidY, centroidZ);

  for (const vertexIndex of triangleVertexIndices) {
    regionPositions[region].push(
      positions[vertexIndex * 3],
      positions[vertexIndex * 3 + 1],
      positions[vertexIndex * 3 + 2],
    );
  }
}

const material = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#d8e1ea'),
  roughness: 0.95,
  metalness: 0,
});
const bellyMaterial = material.clone();
bellyMaterial.color = new THREE.Color('#c6d2de');

const assetRoot = new THREE.Group();
assetRoot.name = 'whale_hero_root';
assetRoot.scale.setScalar(TARGET_LENGTH);

const bodyRoot = new THREE.Group();
bodyRoot.name = 'body_root';
assetRoot.add(bodyRoot);

const tailPivot = new THREE.Group();
tailPivot.name = 'tail_pivot';
tailPivot.position.copy(TAIL_PIVOT_POSITION);
assetRoot.add(tailPivot);

const flukePivot = new THREE.Group();
flukePivot.name = 'fluke_pivot';
flukePivot.position.copy(FLUKE_PIVOT_WORLD_POSITION).sub(TAIL_PIVOT_POSITION);
tailPivot.add(flukePivot);

const leftFinPivot = new THREE.Group();
leftFinPivot.name = 'left_fin_pivot';
leftFinPivot.position.copy(LEFT_FIN_PIVOT_POSITION);
assetRoot.add(leftFinPivot);

const rightFinPivot = new THREE.Group();
rightFinPivot.name = 'right_fin_pivot';
rightFinPivot.position.copy(RIGHT_FIN_PIVOT_POSITION);
assetRoot.add(rightFinPivot);

const bodyMesh = new THREE.Mesh(createTriangleGeometry(regionPositions.body), material.clone());
bodyMesh.name = 'body';
bodyRoot.add(bodyMesh);

const bellyMesh = new THREE.Mesh(createTriangleGeometry(regionPositions.belly), bellyMaterial.clone());
bellyMesh.name = 'belly';
bodyRoot.add(bellyMesh);

const tailMesh = new THREE.Mesh(
  createTriangleGeometry(offsetRegionPositions(regionPositions.tail_stem, TAIL_PIVOT_POSITION)),
  material.clone(),
);
tailMesh.name = 'tail_stem';
tailMesh.position.y = 0;
tailMesh.rotation.x = TAIL_NEUTRAL_PITCH;
tailPivot.add(tailMesh);

const leftFlukeMesh = new THREE.Mesh(
  createTriangleGeometry(offsetRegionPositions(regionPositions.left_fluke, FLUKE_PIVOT_WORLD_POSITION)),
  material.clone(),
);
leftFlukeMesh.name = 'left_fluke';
leftFlukeMesh.position.y = 0;
leftFlukeMesh.rotation.x = FLUKE_NEUTRAL_PITCH;
flukePivot.add(leftFlukeMesh);

const rightFlukeMesh = new THREE.Mesh(
  createTriangleGeometry(offsetRegionPositions(regionPositions.right_fluke, FLUKE_PIVOT_WORLD_POSITION)),
  material.clone(),
);
rightFlukeMesh.name = 'right_fluke';
rightFlukeMesh.position.y = 0;
rightFlukeMesh.rotation.x = FLUKE_NEUTRAL_PITCH;
flukePivot.add(rightFlukeMesh);

const leftPectoralMesh = new THREE.Mesh(
  createTriangleGeometry(offsetRegionPositions(regionPositions.left_pectoral, LEFT_FIN_PIVOT_POSITION)),
  material.clone(),
);
leftPectoralMesh.name = 'left_pectoral';
leftFinPivot.add(leftPectoralMesh);

const rightPectoralMesh = new THREE.Mesh(
  createTriangleGeometry(offsetRegionPositions(regionPositions.right_pectoral, RIGHT_FIN_PIVOT_POSITION)),
  material.clone(),
);
rightPectoralMesh.name = 'right_pectoral';
rightFinPivot.add(rightPectoralMesh);

const eyeGeometry = new THREE.SphereGeometry(0.012, 10, 8);
const eyeMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#1b2430'),
  roughness: 1,
  metalness: 0,
});

const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial.clone());
leftEye.name = 'eye_left';
leftEye.position.set(-0.095, -0.012, 0.265);
bodyRoot.add(leftEye);

const rightEye = leftEye.clone();
rightEye.name = 'eye_right';
rightEye.position.x *= -1;
bodyRoot.add(rightEye);

const blowholeCap = new THREE.Mesh(
  new THREE.SphereGeometry(0.02, 16, 12),
  material.clone(),
);
blowholeCap.name = 'blowhole_cap';
blowholeCap.scale.set(1.8, 0.28, 0.92);
blowholeCap.position.set(0, 0.108, 0.308);
bodyRoot.add(blowholeCap);

const blowhole = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.014, 0.006, 16),
  new THREE.MeshStandardMaterial({
    color: new THREE.Color('#485464'),
    roughness: 1,
    metalness: 0,
  }),
);
blowhole.name = 'blowhole';
blowhole.scale.set(1.5, 0.22, 0.56);
blowhole.position.set(0, 0.114, 0.31);
blowhole.rotation.set(Math.PI / 2, 0, 0);
bodyRoot.add(blowhole);

const tetherAttach = new THREE.Object3D();
tetherAttach.name = 'tether_attach';
tetherAttach.position.set(0, 0.028, 0.19);
assetRoot.add(tetherAttach);

const tailSlapAnchor = new THREE.Object3D();
tailSlapAnchor.name = 'tail_slap_anchor';
tailSlapAnchor.position.set(0, 0.0, -0.49);
assetRoot.add(tailSlapAnchor);

const towAttachLeft = new THREE.Object3D();
towAttachLeft.name = 'tow_attach_left';
towAttachLeft.position.set(-0.11, 0.02, 0.18);
assetRoot.add(towAttachLeft);

const towAttachCenter = new THREE.Object3D();
towAttachCenter.name = 'tow_attach_center';
towAttachCenter.position.set(0, 0.026, 0.2);
assetRoot.add(towAttachCenter);

const towAttachRight = new THREE.Object3D();
towAttachRight.name = 'tow_attach_right';
towAttachRight.position.set(0.11, 0.02, 0.18);
assetRoot.add(towAttachRight);

assetRoot.updateMatrixWorld(true);

const exported = await exporter.parseAsync(assetRoot, {
  binary: true,
  onlyVisible: false,
});

fs.writeFileSync(OUTPUT_PATH, Buffer.from(exported));

const regionSummary = Object.fromEntries(
  Object.entries(regionPositions).map(([name, values]) => [name, values.length / 9]),
);

console.log(`Wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);
console.log(JSON.stringify({ source: SOURCE_PATH, triangles: regionSummary }, null, 2));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, reorder, simplify, weld } from '@gltf-transform/functions';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

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

const SOURCE_PATH = process.env.ROWBOAT_SOURCE_GLTF
  ? path.resolve(process.env.ROWBOAT_SOURCE_GLTF)
  : path.resolve('public/models/rowboat-source.glb');
const OUTPUT_PATH = path.resolve('public/models/rowboat.glb');
const TARGET_LENGTH = 4.15;
const TARGET_TRIANGLES = 8000;
const FORWARD_ROTATION_Y = -Math.PI / 2;

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
  geometry.rotateY(FORWARD_ROTATION_Y);
  geometry.computeBoundingBox();

  const bounds = geometry.boundingBox ?? new THREE.Box3();
  const sourceLength = Math.max(bounds.max.z - bounds.min.z, 0.0001);
  const scale = TARGET_LENGTH / sourceLength;
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();

  const centeredBounds = geometry.boundingBox ?? new THREE.Box3();
  const center = centeredBounds.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

function classifyRegion(cx, cy, cz) {
  if (cy > 0.02 || Math.abs(cz) > 0.18) {
    return 'trim';
  }

  return 'hull';
}

function createMarker(name, x, y, z) {
  const marker = new THREE.Group();
  marker.name = name;
  marker.position.set(x, y, z);
  marker.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.01, 0.01),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#ffffff'),
        transparent: true,
        opacity: 0,
        roughness: 1,
        metalness: 0,
        depthWrite: false,
      }),
    ),
  );
  marker.children[0].name = `MarkerProxy_${name}`;
  return marker;
}

function exportBinary(scene) {
  return new Promise((resolve, reject) => {
    exporter.parse(
      scene,
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

function countTriangles(document) {
  let triangles = 0;

  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      if (indices) {
        triangles += Math.floor(indices.getCount() / 3);
        continue;
      }

      const position = primitive.getAttribute('POSITION');
      if (position) {
        triangles += Math.floor(position.getCount() / 3);
      }
    }
  }

  return triangles;
}

const sourceBuffer = fs.readFileSync(SOURCE_PATH);
const { json, binChunk } = parseGlb(sourceBuffer);
const primitive = json.meshes?.[0]?.primitives?.[0];

if (!primitive) {
  throw new Error('Source GLB does not contain a readable primary mesh primitive.');
}

const sourcePositions = getAccessorArray(json, binChunk, primitive.attributes.POSITION);
const sourceIndices = primitive.indices != null ? getAccessorArray(json, binChunk, primitive.indices) : null;

const regionPositions = {
  hull: [],
  trim: [],
};

const sourceLength = json.accessors?.[primitive.attributes.POSITION]?.max?.[0] - json.accessors?.[primitive.attributes.POSITION]?.min?.[0];
if (!Number.isFinite(sourceLength) || sourceLength <= 0.0001) {
  throw new Error('Unable to determine source rowboat length.');
}

const triangleCount = sourceIndices ? sourceIndices.length / 3 : sourcePositions.length / 9;

for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
  const triangleVertexIndices = sourceIndices
    ? [
        sourceIndices[triangleIndex * 3],
        sourceIndices[triangleIndex * 3 + 1],
        sourceIndices[triangleIndex * 3 + 2],
      ]
    : [triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2];

  let centroidX = 0;
  let centroidY = 0;
  let centroidZ = 0;

  for (const vertexIndex of triangleVertexIndices) {
    centroidX += sourcePositions[vertexIndex * 3];
    centroidY += sourcePositions[vertexIndex * 3 + 1];
    centroidZ += sourcePositions[vertexIndex * 3 + 2];
  }

  centroidX /= 3;
  centroidY /= 3;
  centroidZ /= 3;

  const region = classifyRegion(centroidX, centroidY, centroidZ);

  for (const vertexIndex of triangleVertexIndices) {
    regionPositions[region].push(
      sourcePositions[vertexIndex * 3],
      sourcePositions[vertexIndex * 3 + 1],
      sourcePositions[vertexIndex * 3 + 2],
    );
  }
}

const auxScene = new THREE.Scene();
auxScene.name = 'AuxScene';

const rowboatVisual = new THREE.Group();
rowboatVisual.name = 'RowboatVisual';
auxScene.add(rowboatVisual);

const hullMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#4f3d2e'),
  roughness: 0.98,
  metalness: 0.01,
});
const trimMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color('#7a6348'),
  roughness: 0.96,
  metalness: 0.01,
});

if (regionPositions.hull.length > 0) {
  const hull = new THREE.Mesh(createTriangleGeometry(regionPositions.hull), hullMaterial);
  hull.name = 'Hull_Main';
  rowboatVisual.add(hull);
}

if (regionPositions.trim.length > 0) {
  const trim = new THREE.Mesh(createTriangleGeometry(regionPositions.trim), trimMaterial);
  trim.name = 'Wood_Trim';
  rowboatVisual.add(trim);
}

// Keep the shipping asset broad and low-noise so fog, light bands, and the whale
// remain the dominant read instead of the source model's baked texture detail.
rowboatVisual.add(
  createMarker('markerwake_origin', 0, 0.3, -3),
  createMarker('markerharpoon_origin', 0, 0.88, 2.18),
  createMarker('markerlantern_0', 0, 0.62, -0.08),
);

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'leviathan-rowboat-'));
const tempPath = path.join(tempDirectory, 'rowboat-normalized.glb');

try {
  const exportedGlb = await exportBinary(auxScene);
  fs.writeFileSync(tempPath, exportedGlb);

  const io = new NodeIO().registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.simplifier': MeshoptSimplifier,
  });

  const attempts = [
    { ratio: 0.05, error: 0.01 },
    { ratio: 0.04, error: 0.014 },
    { ratio: 0.03, error: 0.02 },
  ];

  let bestDocument = null;
  let bestTriangleCount = Number.POSITIVE_INFINITY;

  for (const attempt of attempts) {
    const document = await io.read(tempPath);
    await document.transform(
      dedup(),
      weld(),
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: attempt.ratio,
        error: attempt.error,
      }),
      reorder({
        encoder: MeshoptEncoder,
        target: 'size',
      }),
      prune(),
    );

    const currentTriangleCount = countTriangles(document);

    if (currentTriangleCount < bestTriangleCount) {
      bestDocument = document;
      bestTriangleCount = currentTriangleCount;
    }

    if (currentTriangleCount <= TARGET_TRIANGLES) {
      break;
    }
  }

  if (!bestDocument) {
    throw new Error('Failed to generate a runtime rowboat document.');
  }

  await io.write(OUTPUT_PATH, bestDocument);

  const outputBytes = fs.statSync(OUTPUT_PATH).size;
  console.log(
    `Built rowboat runtime asset: ${OUTPUT_PATH} (${bestTriangleCount} triangles, ${(outputBytes / 1024).toFixed(1)} KiB).`,
  );
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}

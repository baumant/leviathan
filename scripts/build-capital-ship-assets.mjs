import fs from 'node:fs';
import path from 'node:path';

import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, reorder, weld } from '@gltf-transform/functions';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { MeshoptEncoder } from 'meshoptimizer';

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

const SOURCE_DIR = path.resolve('source-assets/models/kenney-watercraft');
const OUTPUT_DIR = path.resolve('public/models');
const exporter = new GLTFExporter();

const FLAGSHIP_DRAFT_OFFSET = -0.88;
const CORPORATE_DRAFT_OFFSET = -1.55;

const CAPITAL_ASSETS = [
  {
    role: 'flagship',
    sourceFile: 'ship-large.glb',
    outputFile: 'flagship.glb',
    rootName: 'FlagshipVisual',
    targetLength: 18.4,
    targetHeight: 9.2,
    zOffset: 1.8,
    hullColor: '#5a4130',
    trimColor: '#8d6a52',
    sailColor: '#c8b28d',
    draftOffset: FLAGSHIP_DRAFT_OFFSET,
    markerGroups: {
      fixed: [
        marker('markerwake_origin', 0, 0.72, -9.4),
        marker('markerharpoon_origin', 0, 2.4, 7.6),
        marker('markertow_port_origin', -1.7, 1.08, -8.2),
        marker('markertow_starboard_origin', 1.7, 1.08, -8.2),
        marker('markerhealth_bar_anchor', 0, 4.05, -0.4),
      ],
      lanterns: [
        [0, 2.35, 5.2],
        [-1.5, 2.3, -3.1],
        [1.5, 2.3, -3.1],
        [0, 2.5, -6.1],
      ],
      portCannons: [4.4, 1.1, -2.2].map((z) => [-3.4, rootYToVisualY(1.45, FLAGSHIP_DRAFT_OFFSET), z]),
      starboardCannons: [4.4, 1.1, -2.2].map((z) => [3.4, rootYToVisualY(1.45, FLAGSHIP_DRAFT_OFFSET), z]),
      reinforcementLaunches: [],
    },
  },
  {
    role: 'corporate_whaler',
    sourceFile: 'ship-small-ghost.glb',
    outputFile: 'corporate-whaler.glb',
    rootName: 'CorporateWhalerVisual',
    targetLength: 27.8,
    targetHeight: 10.2,
    zOffset: 1.35,
    hullColor: '#4a372b',
    trimColor: '#6f5c4c',
    sailColor: '#8f816c',
    draftOffset: CORPORATE_DRAFT_OFFSET,
    markerGroups: {
      fixed: [
        marker('markerwake_origin', 0, 1.12, -18.4),
        marker('markerharpoon_origin', 0, 3.8, 14.8),
        marker('markertow_port_origin', -2.1, 1.46, -14.8),
        marker('markertow_starboard_origin', 2.1, 1.46, -14.8),
        marker('markerhealth_bar_anchor', 0, 6.7, -1.1),
      ],
      lanterns: [
        [0, 4.7, 6.8],
        [-2.2, 5.1, 1.8],
        [2.2, 5.1, 1.8],
        [-2.8, 5.7, -6.4],
        [2.8, 5.7, -6.4],
        [0, 6, -9.8],
      ],
      portCannons: [10, 6, 2, -2, -6, -10].map((z) => [
        -4.8,
        rootYToVisualY(2.1, CORPORATE_DRAFT_OFFSET),
        z,
      ]),
      starboardCannons: [10, 6, 2, -2, -6, -10].map((z) => [
        4.8,
        rootYToVisualY(2.1, CORPORATE_DRAFT_OFFSET),
        z,
      ]),
      reinforcementLaunches: [
        [-4.9, rootYToVisualY(1.72, CORPORATE_DRAFT_OFFSET), 9],
        [-4.9, rootYToVisualY(1.72, CORPORATE_DRAFT_OFFSET), 4],
        [-4.9, rootYToVisualY(1.72, CORPORATE_DRAFT_OFFSET), -1],
        [-4.9, rootYToVisualY(1.72, CORPORATE_DRAFT_OFFSET), -6],
        [4.9, rootYToVisualY(1.72, CORPORATE_DRAFT_OFFSET), 9],
        [4.9, rootYToVisualY(1.72, CORPORATE_DRAFT_OFFSET), 4],
        [4.9, rootYToVisualY(1.72, CORPORATE_DRAFT_OFFSET), -1],
        [4.9, rootYToVisualY(1.72, CORPORATE_DRAFT_OFFSET), -6],
        [-2.2, rootYToVisualY(1.58, CORPORATE_DRAFT_OFFSET), -11.8],
        [2.2, rootYToVisualY(1.58, CORPORATE_DRAFT_OFFSET), -11.8],
      ],
    },
  },
];

function rootYToVisualY(rootY, draftOffset) {
  return rootY - draftOffset;
}

function marker(name, x, y, z) {
  return { name, position: new THREE.Vector3(x, y, z) };
}

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

function getAccessorInfo(json, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const bufferView = json.bufferViews[accessor.bufferView];
  const componentCount = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
  }[accessor.type];
  const bytesPerComponent = {
    5126: 4,
    5125: 4,
    5123: 2,
    5121: 1,
  }[accessor.componentType];

  if (!componentCount || !bytesPerComponent) {
    throw new Error(`Unsupported accessor format: type=${accessor.type} componentType=${accessor.componentType}`);
  }

  return {
    accessor,
    bufferView,
    componentCount,
    bytesPerComponent,
    byteOffset: (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    byteStride: bufferView.byteStride ?? componentCount * bytesPerComponent,
  };
}

function readAccessorComponent(view, componentType, byteOffset) {
  if (componentType === 5126) {
    return view.getFloat32(byteOffset, true);
  }

  if (componentType === 5125) {
    return view.getUint32(byteOffset, true);
  }

  if (componentType === 5123) {
    return view.getUint16(byteOffset, true);
  }

  if (componentType === 5121) {
    return view.getUint8(byteOffset);
  }

  throw new Error(`Unsupported accessor component type: ${componentType}`);
}

function readAccessorTuple(json, binChunk, accessorIndex, itemIndex) {
  const info = getAccessorInfo(json, accessorIndex);
  const view = new DataView(binChunk.buffer, binChunk.byteOffset, binChunk.byteLength);
  const tuple = [];
  const itemOffset = info.byteOffset + itemIndex * info.byteStride;

  for (let componentIndex = 0; componentIndex < info.componentCount; componentIndex += 1) {
    tuple.push(
      readAccessorComponent(
        view,
        info.accessor.componentType,
        itemOffset + componentIndex * info.bytesPerComponent,
      ),
    );
  }

  return tuple;
}

function createNodeMatrix(node) {
  if (node.matrix) {
    return new THREE.Matrix4().fromArray(node.matrix);
  }

  const position = new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]);
  const rotation = new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]);
  const scale = new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]);
  return new THREE.Matrix4().compose(position, rotation, scale);
}

function collectSourceRegions(config, json, binChunk) {
  const regions = {
    hull: [],
    trim: [],
    sail: [],
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const sceneNodes = scene?.nodes ?? [];

  for (const nodeIndex of sceneNodes) {
    collectNodeRegions(config, json, binChunk, nodeIndex, new THREE.Matrix4(), regions);
  }

  return regions;
}

function collectNodeRegions(config, json, binChunk, nodeIndex, parentMatrix, regions) {
  const node = json.nodes[nodeIndex];
  const worldMatrix = parentMatrix.clone().multiply(createNodeMatrix(node));

  if (node.mesh !== undefined) {
    const mesh = json.meshes[node.mesh];
    const sourceName = `${node.name ?? ''} ${mesh.name ?? ''}`;

    for (const primitive of mesh.primitives ?? []) {
      collectPrimitiveRegions(config, json, binChunk, primitive, sourceName, worldMatrix, regions);
    }
  }

  for (const childIndex of node.children ?? []) {
    collectNodeRegions(config, json, binChunk, childIndex, worldMatrix, regions);
  }
}

function collectPrimitiveRegions(config, json, binChunk, primitive, sourceName, matrix, regions) {
  const positionAccessorIndex = primitive.attributes.POSITION;
  const positionAccessor = json.accessors[positionAccessorIndex];
  const indexAccessorIndex = primitive.indices ?? null;
  const triangleCount = indexAccessorIndex === null
    ? Math.floor(positionAccessor.count / 3)
    : Math.floor(json.accessors[indexAccessorIndex].count / 3);
  const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const vertexIndices = indexAccessorIndex === null
      ? [triangleIndex * 3, triangleIndex * 3 + 1, triangleIndex * 3 + 2]
      : [
          readAccessorTuple(json, binChunk, indexAccessorIndex, triangleIndex * 3)[0],
          readAccessorTuple(json, binChunk, indexAccessorIndex, triangleIndex * 3 + 1)[0],
          readAccessorTuple(json, binChunk, indexAccessorIndex, triangleIndex * 3 + 2)[0],
        ];
    const centroid = new THREE.Vector3();

    for (let vertexSlot = 0; vertexSlot < 3; vertexSlot += 1) {
      const sourcePosition = readAccessorTuple(json, binChunk, positionAccessorIndex, vertexIndices[vertexSlot]);
      vertices[vertexSlot].set(sourcePosition[0], sourcePosition[1], sourcePosition[2]).applyMatrix4(matrix);
      centroid.add(vertices[vertexSlot]);
    }

    centroid.multiplyScalar(1 / 3);

    const region = classifyRegion(config, sourceName, centroid);
    for (const vertex of vertices) {
      regions[region].push(vertex.x, vertex.y, vertex.z);
    }
  }
}

function classifyRegion(config, sourceName, centroid) {
  const normalizedName = sourceName.toLowerCase();

  if (normalizedName.includes('sail') || normalizedName.includes('flag')) {
    return 'sail';
  }

  if (config.role === 'corporate_whaler') {
    return centroid.y > 2.6 ? 'trim' : 'hull';
  }

  return centroid.y > 2.3 ? 'trim' : 'hull';
}

function getBounds(regionPositions) {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();

  for (const positions of Object.values(regionPositions)) {
    for (let index = 0; index < positions.length; index += 3) {
      bounds.expandByPoint(point.set(positions[index], positions[index + 1], positions[index + 2]));
    }
  }

  if (bounds.isEmpty()) {
    throw new Error('No source geometry was collected.');
  }

  return bounds;
}

function normalizePositions(positions, sourceBounds, config) {
  const center = sourceBounds.getCenter(new THREE.Vector3());
  const sourceLength = Math.max(sourceBounds.max.z - sourceBounds.min.z, 0.0001);
  const sourceHeight = Math.max(sourceBounds.max.y - sourceBounds.min.y, 0.0001);
  const scaleXZ = config.targetLength / sourceLength;
  const scaleY = config.targetHeight / sourceHeight;
  const normalized = new Array(positions.length);

  for (let index = 0; index < positions.length; index += 3) {
    normalized[index] = (positions[index] - center.x) * scaleXZ;
    normalized[index + 1] = (positions[index + 1] - sourceBounds.min.y) * scaleY;
    normalized[index + 2] = (positions[index + 2] - center.z) * scaleXZ + (config.zOffset ?? 0);
  }

  return normalized;
}

function createTriangleGeometry(positions, sourceBounds, config) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(normalizePositions(positions, sourceBounds, config), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createMarkerNode(name, position) {
  const markerRoot = new THREE.Group();
  markerRoot.name = name;
  markerRoot.position.copy(position);
  markerRoot.add(
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
  markerRoot.children[0].name = `MarkerProxy_${name}`;
  return markerRoot;
}

function addMarkerGroup(root, prefix, positions) {
  positions.forEach((position, index) => {
    root.add(createMarkerNode(`${prefix}_${index}`, new THREE.Vector3(...position)));
  });
}

function addMarkers(root, config) {
  for (const fixedMarker of config.markerGroups.fixed) {
    root.add(createMarkerNode(fixedMarker.name, fixedMarker.position));
  }

  addMarkerGroup(root, 'markerlantern', config.markerGroups.lanterns);
  addMarkerGroup(root, 'markerport', config.markerGroups.portCannons);
  addMarkerGroup(root, 'markerstarboard', config.markerGroups.starboardCannons);
  addMarkerGroup(root, 'markerreinforcement_launch', config.markerGroups.reinforcementLaunches);
}

function addCorporateWhalerGantry(root, material) {
  const gantryRoot = new THREE.Group();
  gantryRoot.name = 'Mast_HarpoonGantry';

  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 5.6), material);
  boom.name = 'Mast_BowHarpoonBoom';
  boom.position.set(0, 4.75, 14.35);
  boom.rotation.x = -0.14;

  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.16, 0.18), material);
  crossbar.name = 'Mast_BowHarpoonCrossbar';
  crossbar.position.set(0, 4.36, 12.25);

  const bracePort = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 3.4), material);
  bracePort.name = 'Mast_BowHarpoonBracePort';
  bracePort.position.set(-1.35, 3.85, 12.9);
  bracePort.rotation.set(-0.32, 0.18, 0.08);

  const braceStarboard = bracePort.clone();
  braceStarboard.name = 'Mast_BowHarpoonBraceStarboard';
  braceStarboard.position.x *= -1;
  braceStarboard.rotation.y *= -1;
  braceStarboard.rotation.z *= -1;

  gantryRoot.add(boom, crossbar, bracePort, braceStarboard);
  root.add(gantryRoot);
}

function createRuntimeScene(config, regions) {
  const sourceBounds = getBounds(regions);
  const scene = new THREE.Scene();
  scene.name = `${config.rootName}Scene`;

  const root = new THREE.Group();
  root.name = config.rootName;
  scene.add(root);

  const hullMaterial = new THREE.MeshStandardMaterial({
    name: 'CapitalHullMaterial',
    color: new THREE.Color(config.hullColor),
    roughness: 0.98,
    metalness: 0.01,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    name: 'CapitalTrimMaterial',
    color: new THREE.Color(config.trimColor),
    roughness: 0.96,
    metalness: 0.01,
  });
  const sailMaterial = new THREE.MeshStandardMaterial({
    name: 'CapitalSailMaterial',
    color: new THREE.Color(config.sailColor),
    roughness: 0.99,
    metalness: 0,
  });

  if (regions.hull.length > 0) {
    const hull = new THREE.Mesh(createTriangleGeometry(regions.hull, sourceBounds, config), hullMaterial);
    hull.name = 'Hull_Main';
    root.add(hull);
  }

  if (regions.trim.length > 0) {
    const trim = new THREE.Mesh(createTriangleGeometry(regions.trim, sourceBounds, config), trimMaterial);
    trim.name = 'Mast_Trim';
    root.add(trim);
  }

  if (regions.sail.length > 0) {
    const sail = new THREE.Mesh(createTriangleGeometry(regions.sail, sourceBounds, config), sailMaterial);
    sail.name = 'Sail_Canvas';
    root.add(sail);
  }

  if (config.role === 'corporate_whaler') {
    addCorporateWhalerGantry(root, trimMaterial);
  }

  addMarkers(root, config);
  return scene;
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

async function optimizeAndWrite(buffer, outputPath) {
  const io = new NodeIO().registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
  });
  const document = await io.readBinary(buffer);

  await document.transform(
    dedup(),
    weld(),
    reorder({
      encoder: MeshoptEncoder,
      target: 'size',
    }),
    prune(),
  );

  await io.write(outputPath, document);
  return countTriangles(document);
}

for (const config of CAPITAL_ASSETS) {
  const sourcePath = path.join(SOURCE_DIR, config.sourceFile);
  const outputPath = path.join(OUTPUT_DIR, config.outputFile);
  const sourceBuffer = fs.readFileSync(sourcePath);
  const { json, binChunk } = parseGlb(sourceBuffer);
  const regions = collectSourceRegions(config, json, binChunk);
  const scene = createRuntimeScene(config, regions);
  const exportedBuffer = await exportBinary(scene);
  const triangleCount = await optimizeAndWrite(exportedBuffer, outputPath);
  const outputBytes = fs.statSync(outputPath).size;

  console.log(
    `Built ${config.role} runtime asset: ${outputPath} (${triangleCount} triangles, ${(outputBytes / 1024).toFixed(1)} KiB).`,
  );
}

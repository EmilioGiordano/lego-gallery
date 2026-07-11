import * as THREE from "../../assets/vendor/three.module.js";

export function parseLegacyGeometry(data) {
  const sourceVertices = data.vertices || [];
  const sourceNormals = data.normals || [];
  const faces = data.faces || [];
  const uvLayerCount = (data.uvs || []).filter((layer) => layer.length > 0).length;
  const triangles = new Map();
  let offset = 0;
  let highestMaterial = 0;

  const addTriangle = (indices, normalIndices, materialIndex) => {
    if (!triangles.has(materialIndex)) triangles.set(materialIndex, []);
    triangles.get(materialIndex).push({ indices, normalIndices });
    highestMaterial = Math.max(highestMaterial, materialIndex);
  };

  while (offset < faces.length) {
    const type = faces[offset++];
    const isQuad = (type & 1) !== 0;
    const vertexCount = isQuad ? 4 : 3;
    const vertexIndices = faces.slice(offset, offset + vertexCount);
    offset += vertexCount;

    let materialIndex = 0;
    if (type & 2) materialIndex = faces[offset++];
    if (type & 4) offset += uvLayerCount;
    if (type & 8) offset += uvLayerCount * vertexCount;

    let faceNormal = null;
    if (type & 16) faceNormal = faces[offset++];

    let vertexNormals = null;
    if (type & 32) {
      vertexNormals = faces.slice(offset, offset + vertexCount);
      offset += vertexCount;
    }
    if (type & 64) offset += 1;
    if (type & 128) offset += vertexCount;

    const normalFor = (vertex) => {
      if (vertexNormals) return vertexNormals[vertex];
      return faceNormal;
    };

    if (isQuad) {
      addTriangle(
        [vertexIndices[0], vertexIndices[1], vertexIndices[3]],
        [normalFor(0), normalFor(1), normalFor(3)],
        materialIndex,
      );
      addTriangle(
        [vertexIndices[1], vertexIndices[2], vertexIndices[3]],
        [normalFor(1), normalFor(2), normalFor(3)],
        materialIndex,
      );
    } else {
      addTriangle(vertexIndices, [normalFor(0), normalFor(1), normalFor(2)], materialIndex);
    }
  }

  const positions = [];
  const normals = [];
  const groups = [];
  let groupStart = 0;
  let hasProvidedNormals = true;

  [...triangles.keys()].sort((a, b) => a - b).forEach((materialIndex) => {
    const materialTriangles = triangles.get(materialIndex);
    for (const triangle of materialTriangles) {
      triangle.indices.forEach((vertexIndex, corner) => {
        positions.push(
          sourceVertices[vertexIndex * 3],
          sourceVertices[vertexIndex * 3 + 1],
          sourceVertices[vertexIndex * 3 + 2],
        );
        const normalIndex = triangle.normalIndices[corner];
        if (normalIndex === null || normalIndex === undefined || !sourceNormals.length) {
          hasProvidedNormals = false;
          normals.push(0, 1, 0);
        } else {
          normals.push(
            sourceNormals[normalIndex * 3],
            sourceNormals[normalIndex * 3 + 1],
            sourceNormals[normalIndex * 3 + 2],
          );
        }
      });
    }
    const count = materialTriangles.length * 3;
    groups.push({ start: groupStart, count, materialIndex });
    groupStart += count;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  groups.forEach((group) => geometry.addGroup(group.start, group.count, group.materialIndex));
  if (!hasProvidedNormals) geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.materialCount = highestMaterial + 1;
  return geometry;
}

function mergeGeometryParts(parts) {
  const expanded = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const vertexCount = expanded.reduce(
    (total, part) => total + part.getAttribute("position").count,
    0,
  );
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  let offset = 0;

  expanded.forEach((part) => {
    positions.set(part.getAttribute("position").array, offset * 3);
    normals.set(part.getAttribute("normal").array, offset * 3);
    offset += part.getAttribute("position").count;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  geometry.userData.materialCount = 1;
  return geometry;
}

export function createFlexibleGeometry(descriptor) {
  const points = descriptor.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curveForOffset = (offset = 0) =>
    new THREE.CubicBezierCurve3(
      ...points.map((point) => point.clone().add(new THREE.Vector3(offset, 0, 0))),
    );

  if (descriptor.kind === "hose") {
    const geometry = new THREE.TubeGeometry(curveForOffset(), 72, 3.1, 8, false);
    const positions = geometry.getAttribute("position");
    const curve = curveForOffset();
    const temporaryPosition = new THREE.Vector3();
    for (let ring = 0; ring <= 72; ring += 1) {
      const center = curve.getPoint(ring / 72);
      const ribScale = ring % 2 === 0 ? 1.16 : 0.92;
      for (let side = 0; side <= 8; side += 1) {
        const vertex = ring * 9 + side;
        temporaryPosition.fromBufferAttribute(positions, vertex);
        temporaryPosition.sub(center).multiplyScalar(ribScale).add(center);
        positions.setXYZ(vertex, temporaryPosition.x, temporaryPosition.y, temporaryPosition.z);
      }
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.userData.materialCount = 1;
    return geometry;
  }

  const parts = [
    new THREE.TubeGeometry(curveForOffset(-10), 56, 1.35, 6, false),
    new THREE.TubeGeometry(curveForOffset(10), 56, 1.35, 6, false),
  ];
  const centerCurve = curveForOffset();
  for (let index = 0; index < 15; index += 1) {
    const point = centerCurve.getPoint(index / 14);
    const rung = new THREE.CylinderGeometry(1.05, 1.05, 20, 6);
    const transform = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    transform.setPosition(point);
    rung.applyMatrix4(transform);
    parts.push(rung);
  }
  return mergeGeometryParts(parts);
}

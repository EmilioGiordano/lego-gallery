import * as THREE from "../../assets/vendor/three.module.js";
import JSZip from "../../assets/vendor/jszip.module.js";
import { clamp, hash, TAU } from "../math.js";
import { createFlexibleGeometry, parseLegacyGeometry } from "./geometry.js";

function resolveMaterialDefinition(sceneData, set, reference) {
  const base = sceneData.materials[String(reference)] || {
    hex: "#A3A2A4",
    transparent: false,
    kind: "solid",
  };
  const override = set.material?.overrides?.[reference];
  return override ? { ...base, ...override } : base;
}

function materialSurfaceProperties(kind = "solid") {
  if (/chrome/i.test(kind)) {
    return { roughness: 0.18, metalness: 0.88 };
  }
  if (/metal/i.test(kind)) {
    return { roughness: 0.24, metalness: 0.72 };
  }
  if (/pearlescent/i.test(kind)) {
    return { roughness: 0.32, metalness: 0.68 };
  }
  if (/speckle/i.test(kind)) {
    return { roughness: 0.44, metalness: 0.48 };
  }
  return { roughness: 0.66, metalness: 0.06 };
}

function createMaterialFactory(sceneData, set) {
  const cache = new Map();
  const emissiveReferences = new Set(set.material.emissiveReferences);

  return (reference) => {
    if (cache.has(reference)) return cache.get(reference);
    const definition = resolveMaterialDefinition(sceneData, set, reference);
    const transparent = Boolean(definition.transparent);
    const { roughness, metalness } = materialSurfaceProperties(definition.kind);
    const isEmissive = emissiveReferences.has(reference);
    const material = new THREE.MeshStandardMaterial({
      color: definition.hex,
      roughness,
      metalness,
      transparent,
      opacity: transparent ? (isEmissive ? 0.82 : 0.46) : 1,
      depthWrite: !transparent,
      emissive: isEmissive ? definition.hex : 0x000000,
      emissiveIntensity: isEmissive ? 0.85 : 0,
    });
    cache.set(reference, material);
    return material;
  };
}

function createAssemblyRecord(matrixArray, globalIndex, bag, modelCenter, animation) {
  const targetMatrix = new THREE.Matrix4().fromArray(matrixArray);
  const targetPosition = new THREE.Vector3();
  const targetQuaternion = new THREE.Quaternion();
  const targetScale = new THREE.Vector3();
  targetMatrix.decompose(targetPosition, targetQuaternion, targetScale);

  const angle = hash(globalIndex, 11) * TAU;
  const radius =
    animation.startRadius[0] +
    hash(globalIndex, 12) * (animation.startRadius[1] - animation.startRadius[0]);
  const startPosition = new THREE.Vector3(
    modelCenter.x + Math.cos(angle) * radius,
    modelCenter.y + (hash(globalIndex, 13) - 0.5) * animation.verticalSpread,
    modelCenter.z + Math.sin(angle) * radius,
  );
  const startQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      hash(globalIndex, 14) * TAU,
      hash(globalIndex, 15) * TAU,
      hash(globalIndex, 16) * TAU,
    ),
  );
  const bagDelay =
    clamp((bag - 1) / animation.bagDivisor, 0, 1) * animation.bagDelay;

  return {
    targetPosition,
    targetQuaternion,
    targetScale,
    startPosition,
    startQuaternion,
    angle,
    radius,
    delay: bagDelay + hash(globalIndex, 17) * animation.pieceDelay,
    index: globalIndex,
    lastLock: -1,
  };
}

export async function loadLegoSet({ set, shipPivot, ui }) {
  ui.setLoading("Loading manifest", 3);
  ui.setControlsDisabled(true);

  const [manifestResponse, archiveResponse] = await Promise.all([
    fetch(set.assets.manifest),
    fetch(set.assets.geometries),
  ]);
  if (!manifestResponse.ok || !archiveResponse.ok) {
    throw new Error(`Assets for ${set.name} could not be loaded.`);
  }

  const sceneData = await manifestResponse.json();
  const archive = await JSZip.loadAsync(await archiveResponse.arrayBuffer());
  const totalParts = sceneData.metadata.parts;
  const modelCenter = new THREE.Vector3(...sceneData.bounds.center);
  shipPivot.position.copy(modelCenter).multiplyScalar(-1);
  ui.setTotalParts(totalParts);

  ui.setLoading("Decoding real bricks", 7);
  const geometries = new Array(sceneData.geometries.length);
  for (let index = 0; index < sceneData.geometries.length; index += 1) {
    const descriptor = sceneData.geometries[index];
    if (descriptor.flex) {
      geometries[index] = createFlexibleGeometry(descriptor.flex);
    } else {
      const file = archive.file(descriptor.path);
      if (!file) throw new Error(`Missing geometry ${descriptor.path}`);
      geometries[index] = parseLegacyGeometry(
        JSON.parse(await file.async("string")),
      );
    }
    if (index % 10 === 0) {
      ui.setLoading(
        "Decoding real bricks",
        7 + index / sceneData.geometries.length * 58,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  const materialFor = createMaterialFactory(sceneData, set);
  const batches = [];
  const temporary = new THREE.Object3D();
  let globalIndex = 0;

  for (let groupIndex = 0; groupIndex < sceneData.groups.length; groupIndex += 1) {
    const definition = sceneData.groups[groupIndex];
    const geometry = geometries[definition.g];
    const materialCount = geometry.userData.materialCount || 1;
    const materials = Array.from({ length: materialCount }, (_, materialIndex) =>
      materialFor(definition.c[materialIndex] ?? definition.c[0]),
    );
    const mesh = new THREE.InstancedMesh(
      geometry,
      materials.length === 1 ? materials[0] : materials,
      definition.i.length,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const records = definition.i.map((instance) => {
      const record = createAssemblyRecord(
        instance.m,
        globalIndex,
        instance.b,
        modelCenter,
        set.animation,
      );
      globalIndex += 1;
      return record;
    });

    records.forEach((record, instanceIndex) => {
      temporary.position.copy(record.startPosition);
      temporary.quaternion.copy(record.startQuaternion);
      temporary.scale.setScalar(set.animation.initialScale);
      temporary.updateMatrix();
      mesh.setMatrixAt(instanceIndex, temporary.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    shipPivot.add(mesh);
    batches.push({ mesh, records });

    if (groupIndex % 20 === 0) {
      ui.setLoading(
        `Placing ${totalParts.toLocaleString()} bricks`,
        66 + groupIndex / sceneData.groups.length * 31,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  ui.setReady();
  return { batches, modelCenter, totalParts };
}

import * as THREE from "./assets/vendor/three.module.js";
import JSZip from "./assets/vendor/jszip.module.js";

const ui = {
  progress: document.querySelector("#progressBar"),
  count: document.querySelector("#brickCount"),
  total: document.querySelector("#brickTotal"),
  velocity: document.querySelector("#velocity"),
  phase: document.querySelector("#phaseLabel"),
  rebuild: document.querySelector("#rebuildButton"),
  pause: document.querySelector("#pauseButton"),
  sound: document.querySelector(".sound-toggle"),
};

const DURATION = 22000;
const TAU = Math.PI * 2;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const canvas = document.querySelector("#scene");

let startTime = performance.now();
let pausedAt = 0;
let isPaused = false;
let ready = false;
let orbitYaw = 0;
let orbitPitch = 0.73;
let targetOrbitYaw = 0;
let targetOrbitPitch = 0.73;
let orbitZoom = 1;
let targetOrbitZoom = 1;
let isOrbiting = false;
let pointerStartX = 0;
let pointerStartY = 0;
let audioContext;
let masterGain;
let buildProcessBuffer;
let buildProcessLoadPromise;
let buildLoopSource;
let buildLoopGain;
let completionBuffer;
let completionLoadPromise;
let soundOn = false;
let completionSoundPlayed = false;
let previousAssembly = 0;
let sceneData;
let modelCenter;
let totalParts = 0;
let lastLocked = -1;

const instanceBatches = [];
const materialCache = new Map();
const temporary = new THREE.Object3D();
const temporaryPosition = new THREE.Vector3();
const temporaryQuaternion = new THREE.Quaternion();
const temporaryScale = new THREE.Vector3();

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smoothstep = (value) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

function hash(index, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.65));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.55;
renderer.setClearColor(0x02050a, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x02050a, 0.00052);

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 1, 7000);
camera.position.set(0, 1040, 1120);

scene.add(new THREE.HemisphereLight(0xd8e6e9, 0x171c24, 4.2));

const keyLight = new THREE.DirectionalLight(0xffe7c3, 7.4);
keyLight.position.set(-500, 900, 450);
scene.add(keyLight);

const undersideLight = new THREE.DirectionalLight(0x9fb9c5, 3.2);
undersideLight.position.set(0, -900, 260);
scene.add(undersideLight);

const rimLight = new THREE.PointLight(0x55b9dc, 420000, 2200);
rimLight.position.set(-700, 260, -620);
scene.add(rimLight);

const warmLight = new THREE.PointLight(0xef4b2f, 190000, 1700);
warmLight.position.set(650, 380, 560);
scene.add(warmLight);

const starGeometry = new THREE.BufferGeometry();
const starPositions = [];
for (let index = 0; index < 1100; index += 1) {
  const radius = 2100 + hash(index, 1) * 2300;
  const theta = hash(index, 2) * TAU;
  const y = (hash(index, 3) - 0.5) * 3000;
  starPositions.push(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
}
starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
const stars = new THREE.Points(
  starGeometry,
  new THREE.PointsMaterial({
    color: 0xa9b9c0,
    size: 2.2,
    transparent: true,
    opacity: 0.72,
    sizeAttenuation: true,
  }),
);
scene.add(stars);

const shipRoot = new THREE.Group();
scene.add(shipRoot);
const shipPivot = new THREE.Group();
shipRoot.add(shipPivot);

const halo = new THREE.Mesh(
  new THREE.RingGeometry(330, 780, 96),
  new THREE.MeshBasicMaterial({
    color: 0x224858,
    transparent: true,
    opacity: 0.065,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
halo.rotation.x = -Math.PI / 2;
halo.position.y = -120;
scene.add(halo);

function sequenceAt(time) {
  if (!ready) return { cycle: 0, assembly: 0 };
  const cycle = (((time - startTime) % DURATION) + DURATION) % DURATION / DURATION;
  let assembly = 0;
  if (cycle < 0.12) assembly = 0;
  else if (cycle < 0.72) assembly = (cycle - 0.12) / 0.6;
  else if (cycle < 0.95) assembly = 1;
  else assembly = 1 - (cycle - 0.95) / 0.05;
  return { cycle, assembly: clamp(assembly) };
}

function parseLegacyGeometry(data) {
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

function flexibleGeometry(descriptor) {
  const points = descriptor.points.map(
    ([x, y, z]) => new THREE.Vector3(x, y, z),
  );
  const curveForOffset = (offset = 0) =>
    new THREE.CubicBezierCurve3(
      ...points.map((point) => point.clone().add(new THREE.Vector3(offset, 0, 0))),
    );

  if (descriptor.kind === "hose") {
    const geometry = new THREE.TubeGeometry(curveForOffset(), 72, 3.1, 8, false);
    const positions = geometry.getAttribute("position");
    const curve = curveForOffset();
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

function materialFor(reference) {
  if (materialCache.has(reference)) return materialCache.get(reference);
  const definition = sceneData.materials[String(reference)] || {
    hex: "#A3A2A4",
    transparent: false,
    kind: "solid",
  };
  const transparent = Boolean(definition.transparent);
  const isMetal = /metal|chrome/i.test(definition.kind);
  const isEngineGlow = reference === 42;
  const material = new THREE.MeshStandardMaterial({
    color: definition.hex,
    roughness: isMetal ? 0.24 : 0.66,
    metalness: isMetal ? 0.72 : 0.06,
    transparent,
    opacity: transparent ? (isEngineGlow ? 0.82 : 0.46) : 1,
    depthWrite: !transparent,
    emissive: isEngineGlow ? definition.hex : 0x000000,
    emissiveIntensity: isEngineGlow ? 0.85 : 0,
  });
  materialCache.set(reference, material);
  return material;
}

function createRecord(matrixArray, globalIndex, bag) {
  const targetMatrix = new THREE.Matrix4().fromArray(matrixArray);
  const targetPosition = new THREE.Vector3();
  const targetQuaternion = new THREE.Quaternion();
  const targetScale = new THREE.Vector3();
  targetMatrix.decompose(targetPosition, targetQuaternion, targetScale);

  const angle = hash(globalIndex, 11) * TAU;
  const radius = 620 + hash(globalIndex, 12) * 920;
  const startPosition = new THREE.Vector3(
    modelCenter.x + Math.cos(angle) * radius,
    modelCenter.y + (hash(globalIndex, 13) - 0.5) * 1050,
    modelCenter.z + Math.sin(angle) * radius,
  );
  const startQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      hash(globalIndex, 14) * TAU,
      hash(globalIndex, 15) * TAU,
      hash(globalIndex, 16) * TAU,
    ),
  );
  const bagDelay = clamp((bag - 1) / 16, 0, 1) * 0.49;
  const delay = bagDelay + hash(globalIndex, 17) * 0.13;

  return {
    targetPosition,
    targetQuaternion,
    targetScale,
    startPosition,
    startQuaternion,
    angle,
    radius,
    delay,
    index: globalIndex,
    lastLock: -1,
  };
}

async function loadModel() {
  ui.phase.textContent = "Loading manifest";
  ui.progress.style.width = "3%";
  ui.rebuild.disabled = true;
  ui.pause.disabled = true;

  const [manifestResponse, archiveResponse] = await Promise.all([
    fetch("./assets/falcon/scene.json"),
    fetch("./assets/falcon/geometries.zip"),
  ]);
  if (!manifestResponse.ok || !archiveResponse.ok) {
    throw new Error("Model assets could not be loaded.");
  }

  sceneData = await manifestResponse.json();
  const archiveBuffer = await archiveResponse.arrayBuffer();
  const archive = await JSZip.loadAsync(archiveBuffer);
  totalParts = sceneData.metadata.parts;
  modelCenter = new THREE.Vector3(...sceneData.bounds.center);
  shipPivot.position.copy(modelCenter).multiplyScalar(-1);
  ui.total.textContent = `/${String(totalParts).padStart(4, "0")}`;
  ui.count.textContent = "0000";

  ui.phase.textContent = "Decoding real bricks";
  const geometries = new Array(sceneData.geometries.length);

  for (let index = 0; index < sceneData.geometries.length; index += 1) {
    const descriptor = sceneData.geometries[index];
    if (descriptor.flex) {
      geometries[index] = flexibleGeometry(descriptor.flex);
    } else {
      const file = archive.file(descriptor.path);
      if (!file) throw new Error(`Missing geometry ${descriptor.path}`);
      const raw = JSON.parse(await file.async("string"));
      geometries[index] = parseLegacyGeometry(raw);
    }
    if (index % 10 === 0) {
      const progress = 7 + index / sceneData.geometries.length * 58;
      ui.progress.style.width = `${progress}%`;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  ui.phase.textContent = `Placing ${totalParts.toLocaleString()} bricks`;
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
      const record = createRecord(instance.m, globalIndex, instance.b);
      globalIndex += 1;
      return record;
    });

    records.forEach((record, instanceIndex) => {
      temporary.position.copy(record.startPosition);
      temporary.quaternion.copy(record.startQuaternion);
      temporary.scale.setScalar(0.01);
      temporary.updateMatrix();
      mesh.setMatrixAt(instanceIndex, temporary.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    shipPivot.add(mesh);
    instanceBatches.push({ mesh, records });

    if (groupIndex % 20 === 0) {
      const progress = 66 + groupIndex / sceneData.groups.length * 31;
      ui.progress.style.width = `${progress}%`;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  ready = true;
  startTime = performance.now();
  ui.progress.style.width = "0%";
  ui.phase.textContent = "Vortex forming";
  ui.rebuild.disabled = false;
  ui.pause.disabled = false;

  const query = new URLSearchParams(location.search);
  if (reduceMotion || query.has("complete") || query.has("vortex")) {
    isPaused = true;
    pausedAt = startTime + DURATION * (query.has("vortex") ? 0.06 : 0.76);
  }
}

function updateInstances(time, assembly) {
  let locked = 0;
  const seconds = time / 1000;

  for (const batch of instanceBatches) {
    let dirty = false;
    batch.records.forEach((record, instanceIndex) => {
      const lock = smoothstep((assembly - record.delay) / 0.25);
      if (lock > 0.995) locked += 1;
      if (Math.abs(lock - record.lastLock) < 0.0001) return;
      record.lastLock = lock;
      dirty = true;

      const orbitAngle = record.angle + seconds * (0.72 + hash(record.index, 20) * 0.48);
      const collapsingRadius = record.radius * (1 - lock * 0.8);
      temporaryPosition.set(
        modelCenter.x + Math.cos(orbitAngle) * collapsingRadius,
        record.startPosition.y + Math.sin(orbitAngle * 2.1) * 95,
        modelCenter.z + Math.sin(orbitAngle) * collapsingRadius,
      );
      temporaryPosition.lerp(record.targetPosition, lock);

      temporaryQuaternion.copy(record.startQuaternion);
      temporaryQuaternion.slerp(record.targetQuaternion, lock);
      temporaryScale.copy(record.targetScale).multiplyScalar(0.5 + lock * 0.5);

      temporary.position.copy(temporaryPosition);
      temporary.quaternion.copy(temporaryQuaternion);
      temporary.scale.copy(temporaryScale);
      temporary.updateMatrix();
      batch.mesh.setMatrixAt(instanceIndex, temporary.matrix);
    });

    if (dirty) batch.mesh.instanceMatrix.needsUpdate = true;
  }
  return locked;
}

function updateInterface(sequence, locked) {
  const shownLocked = Math.max(0, locked);
  const actualProgress = totalParts > 0 ? shownLocked / totalParts : 0;
  if (shownLocked !== lastLocked) {
    ui.count.textContent = String(shownLocked).padStart(4, "0");
    lastLocked = shownLocked;
  }
  ui.progress.style.width = `${actualProgress * 100}%`;
  ui.velocity.textContent = ((1 - actualProgress) * 18.4).toFixed(1);

  let phase = "Vortex forming";
  if (sequence.assembly > 0.01) phase = "Bags locking in sequence";
  if (shownLocked >= totalParts && totalParts > 0) phase = "YT-1300 complete";
  if (sequence.cycle > 0.95) phase = "Sequence reset";
  ui.phase.textContent = phase;
}

function render(now) {
  const time = isPaused ? pausedAt : now;
  const sequence = sequenceAt(time);
  orbitYaw += (targetOrbitYaw - orbitYaw) * 0.09;
  orbitPitch += (targetOrbitPitch - orbitPitch) * 0.09;
  orbitZoom += (targetOrbitZoom - orbitZoom) * 0.09;

  let locked = 0;
  if (ready) {
    locked = updateInstances(time, sequence.assembly);
    updateInterface(sequence, locked);
    updateBuildAudio(now, sequence, locked);
  }

  const mobile = innerWidth < 760;
  const cameraDistance = (mobile ? 3000 : 2050) * orbitZoom;
  scene.fog.density = 0.00052 * (0.68 / orbitZoom);
  const horizontalDistance = Math.cos(orbitPitch) * cameraDistance;
  camera.position.set(
    Math.sin(orbitYaw) * horizontalDistance,
    Math.sin(orbitPitch) * cameraDistance,
    Math.cos(orbitYaw) * horizontalDistance,
  );
  camera.lookAt(0, 6, 0);
  shipRoot.rotation.y = mobile ? -0.5 : -0.12;
  stars.rotation.y = time * 0.000006;
  halo.rotation.z = -time * 0.00004;

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function rebuild() {
  if (!ready) return;
  startTime = performance.now() - DURATION * 0.03;
  isPaused = false;
  completionSoundPlayed = false;
  previousAssembly = 0;
  stopBuildLoop();
  instanceBatches.forEach((batch) =>
    batch.records.forEach((record) => {
      record.lastLock = -1;
    }),
  );
  ui.pause.setAttribute("aria-pressed", "false");
  ui.pause.querySelector("span").textContent = "Pause sequence";
}

function togglePause() {
  if (!ready) return;
  if (isPaused) {
    startTime += performance.now() - pausedAt;
    isPaused = false;
  } else {
    pausedAt = performance.now();
    isPaused = true;
  }
  ui.pause.setAttribute("aria-pressed", String(isPaused));
  ui.pause.querySelector("span").textContent = isPaused ? "Resume sequence" : "Pause sequence";
}

function setupAudio() {
  if (audioContext) return;
  audioContext = new AudioContext();
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioContext.destination);

  const loadAudio = (path, label) =>
    fetch(path)
    .then((response) => {
      if (!response.ok) throw new Error(`${label} sound could not be loaded.`);
      return response.arrayBuffer();
    })
    .then((buffer) => audioContext.decodeAudioData(buffer))
    .catch((error) => console.warn(error));

  buildProcessLoadPromise = loadAudio(
    "./assets/audio/lego-build-process.mp3?v=2",
    "Build process",
  ).then((buffer) => {
    buildProcessBuffer = buffer;
  });
  completionLoadPromise = loadAudio(
    "./assets/audio/lego-build-complete.mp3",
    "Completion",
  ).then((buffer) => {
    completionBuffer = buffer;
  });
}

function startBuildLoop() {
  if (!soundOn || !audioContext || !buildProcessBuffer || buildLoopSource) return;
  const time = audioContext.currentTime;
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = buildProcessBuffer;
  source.loop = false;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(0.78, time + 0.06);
  source.connect(gain).connect(masterGain);
  source.start(time);
  source.onended = () => {
    if (buildLoopSource === source) {
      buildLoopSource = null;
      buildLoopGain = null;
    }
  };
  buildLoopSource = source;
  buildLoopGain = gain;
}

function stopBuildLoop() {
  if (!buildLoopSource || !audioContext) return;
  const source = buildLoopSource;
  const gain = buildLoopGain;
  const time = audioContext.currentTime;
  buildLoopSource = null;
  buildLoopGain = null;
  gain.gain.cancelScheduledValues(time);
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
  source.stop(time + 0.065);
}

function playCompletionChime() {
  if (!soundOn || !audioContext) return;
  if (!completionBuffer) {
    completionLoadPromise?.then(() => {
      if (soundOn && completionBuffer) playCompletionChime();
    });
    return;
  }
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = completionBuffer;
  gain.gain.value = 0.82;
  source.connect(gain).connect(masterGain);
  source.start(audioContext.currentTime + 0.02);
}

function updateBuildAudio(_now, sequence, locked) {
  if (sequence.assembly < 0.08) completionSoundPlayed = false;
  const isFullyBuilt = totalParts > 0 && locked >= totalParts;

  const isConstructing =
    soundOn &&
    !isPaused &&
    !isFullyBuilt &&
    sequence.assembly > 0.005 &&
    sequence.assembly >= previousAssembly - 0.001;

  if (isConstructing) startBuildLoop();
  else stopBuildLoop();

  if (isFullyBuilt && !completionSoundPlayed) {
    stopBuildLoop();
    playCompletionChime();
    completionSoundPlayed = true;
  }
  previousAssembly = sequence.assembly;
}

function toggleSound() {
  setupAudio();
  audioContext.resume();
  soundOn = !soundOn;
  masterGain.gain.cancelScheduledValues(audioContext.currentTime);
  masterGain.gain.linearRampToValueAtTime(soundOn ? 0.9 : 0, audioContext.currentTime + 0.08);
  ui.sound.setAttribute("aria-pressed", String(soundOn));
  ui.sound.querySelector(".sound-label").textContent = soundOn ? "Sound on" : "Sound off";
  if (!soundOn) stopBuildLoop();
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  isOrbiting = true;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  canvas.classList.add("is-dragging");
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!isOrbiting) return;
  const deltaX = event.clientX - pointerStartX;
  const deltaY = event.clientY - pointerStartY;
  targetOrbitYaw -= deltaX * 0.006;
  targetOrbitPitch = clamp(targetOrbitPitch + deltaY * 0.0045, -1.34, 1.34);
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
});

function stopOrbit(event) {
  isOrbiting = false;
  canvas.classList.remove("is-dragging");
  if (event?.pointerId !== undefined && canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

canvas.addEventListener("pointerup", stopOrbit);
canvas.addEventListener("pointercancel", stopOrbit);
addEventListener("blur", stopOrbit);
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    targetOrbitZoom = clamp(targetOrbitZoom + event.deltaY * 0.00075, 0.4, 1.55);
  },
  { passive: false },
);

ui.rebuild.addEventListener("click", rebuild);
ui.pause.addEventListener("click", togglePause);
ui.sound.addEventListener("click", toggleSound);

loadModel().catch((error) => {
  console.error(error);
  ui.phase.textContent = "Model load failed";
  ui.progress.style.width = "0%";
});
requestAnimationFrame(render);

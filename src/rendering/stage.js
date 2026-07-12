import * as THREE from "../../assets/vendor/three.module.js";
import { hash, TAU } from "../math.js";

export function createStage(canvas, set) {
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
  renderer.toneMappingExposure = set.rendering?.exposure ?? 1.55;
  renderer.setClearColor(0x02050a, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x02050a, 0.00052);
  const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 1, 7000);
  camera.position.set(0, 1040, 1120);
  const lightScale = set.rendering?.lightScale ?? 1;
  const keyLightColor = set.rendering?.keyLightColor ?? 0xffe7c3;
  const warmLightScale = set.rendering?.warmLightScale ?? 1;

  scene.add(new THREE.HemisphereLight(0xd8e6e9, 0x171c24, 4.2 * lightScale));

  const keyLight = new THREE.DirectionalLight(keyLightColor, 7.4 * lightScale);
  keyLight.position.set(-500, 900, 450);
  scene.add(keyLight);

  const undersideLight = new THREE.DirectionalLight(0x9fb9c5, 3.2 * lightScale);
  undersideLight.position.set(0, -900, 260);
  scene.add(undersideLight);

  const rimLight = new THREE.PointLight(0x55b9dc, 420000 * lightScale, 2200);
  rimLight.position.set(-700, 260, -620);
  scene.add(rimLight);

  const warmLight = new THREE.PointLight(
    0xef4b2f,
    190000 * lightScale * warmLightScale,
    1700,
  );
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
  starGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(starPositions, 3),
  );
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
  const shipPivot = new THREE.Group();
  shipRoot.add(shipPivot);
  scene.add(shipRoot);

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

  const onResize = () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  addEventListener("resize", onResize);

  return {
    shipPivot,

    render(time, orbit) {
      const mobile = innerWidth < set.camera.mobileBreakpoint;
      const cameraDistance =
        (mobile ? set.camera.mobileDistance : set.camera.desktopDistance) *
        orbit.zoom;
      scene.fog.density = 0.00052 * (set.camera.fogZoomScale / orbit.zoom);
      const horizontalDistance = Math.cos(orbit.pitch) * cameraDistance;
      camera.position.set(
        Math.sin(orbit.yaw) * horizontalDistance,
        Math.sin(orbit.pitch) * cameraDistance,
        Math.cos(orbit.yaw) * horizontalDistance,
      );
      camera.lookAt(...set.camera.lookAt);
      shipRoot.rotation.y = mobile
        ? set.camera.mobileModelRotation
        : set.camera.desktopModelRotation;
      stars.rotation.y = time * 0.000006;
      halo.rotation.z = -time * 0.00004;
      renderer.render(scene, camera);
    },

    destroy() {
      removeEventListener("resize", onResize);
      renderer.dispose();
    },
  };
}

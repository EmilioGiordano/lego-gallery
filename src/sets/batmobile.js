import { sharedAnimation } from "./shared.js";

const batmobileAnimation = Object.freeze({
  ...sharedAnimation,
  duration: 16000,
  startRadius: [180, 520],
  verticalSpread: 340,
  bagDivisor: 3,
  bagDelay: 0.46,
  pieceDelay: 0.2,
  verticalOrbit: 48,
  maxVelocity: 12,
});

export const batmobile = Object.freeze({
  id: "batmobile",
  route: "batmobile",
  navigationLabel: "Batmobile",
  name: "LEGO 76331 Batman v Superman Batmobile",
  completionLabel: "Batmobile complete",
  ui: {
    documentTitle: "Batmobile Assembly",
    canvasLabel: "LEGO bricks swirling into the Batman v Superman Batmobile",
    eyebrow: "The night belongs to Gotham.",
    headingLead: "Build the",
    headingLines: ["armored legend", "of Gotham."],
    introLines: [
      "Three bags. Two hundred and twenty-five elements.",
      "One machine built to face the impossible.",
    ],
    footerLeft: "Wayne Applied Sciences",
    footerRight: "Unofficial fan experiment",
  },
  assets: {
    manifest: new URL(
      "../../assets/sets/batmobile/scene.json",
      import.meta.url,
    ).href,
    geometries: new URL(
      "../../assets/sets/batmobile/geometries.zip",
      import.meta.url,
    ).href,
  },
  audio: {
    build: new URL(
      "../../assets/audio/lego-build-process.mp3?v=2",
      import.meta.url,
    ).href,
    complete: new URL(
      "../../assets/audio/lego-build-complete.mp3",
      import.meta.url,
    ).href,
  },
  material: {
    emissiveReferences: [40, 41],
  },
  rendering: {
    exposure: 0.95,
    lightScale: 0.16,
    keyLightColor: 0xd5dadc,
    warmLightScale: 0.15,
  },
  camera: {
    initialPitch: 0.48,
    desktopDistance: 430,
    mobileDistance: 650,
    mobileBreakpoint: 760,
    lookAt: [0, 0, 0],
    desktopModelRotation: -0.18,
    mobileModelRotation: -0.42,
    minPitch: -1.34,
    maxPitch: 1.34,
    minZoom: 0.45,
    maxZoom: 1.8,
    fogZoomScale: 0.68,
  },
  animation: batmobileAnimation,
});

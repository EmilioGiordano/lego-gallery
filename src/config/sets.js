const sharedAnimation = {
  duration: 22000,
  timeline: {
    formationEnd: 0.12,
    assemblyEnd: 0.72,
    presentationEnd: 0.95,
  },
  freezeAt: {
    complete: 0.76,
    vortex: 0.06,
  },
  rebuildOffset: 0.03,
  startRadius: [620, 1540],
  verticalSpread: 1050,
  bagDivisor: 16,
  bagDelay: 0.49,
  pieceDelay: 0.13,
  lockDuration: 0.25,
  orbitSpeed: [0.72, 1.2],
  collapse: 0.8,
  verticalOrbit: 95,
  assemblingScale: 0.5,
  initialScale: 0.01,
  maxVelocity: 18.4,
};

export const legoSets = {
  falcon: {
    id: "falcon",
    name: "LEGO 75192 Millennium Falcon",
    completionLabel: "YT-1300 complete",
    ui: {
      documentTitle: "Millennium Falcon Assembly",
      canvasLabel: "LEGO bricks swirling into the Millennium Falcon",
      systemStatus: "YT-1300 / ASSEMBLY BAY 07",
      eyebrow: "A long time ago, in a toy box far, far away...",
      headingLead: "Build the",
      headingLines: ["fastest hunk", "of bricks."],
      introLines: [
        "Hundreds of loose bricks. One legendary freighter.",
        "Watch every stud lock into place.",
      ],
      footerLeft: "Corellian Engineering Corporation",
      footerRight: "Unofficial fan experiment",
    },
    assets: {
      manifest: "./assets/falcon/scene.json",
      geometries: "./assets/falcon/geometries.zip",
    },
    audio: {
      build: "./assets/audio/lego-build-process.mp3?v=2",
      complete: "./assets/audio/lego-build-complete.mp3",
    },
    material: {
      emissiveReferences: [42],
    },
    camera: {
      initialPitch: 0.73,
      desktopDistance: 2050,
      mobileDistance: 3000,
      mobileBreakpoint: 760,
      lookAt: [0, 6, 0],
      desktopModelRotation: -0.12,
      mobileModelRotation: -0.5,
      minPitch: -1.34,
      maxPitch: 1.34,
      minZoom: 0.4,
      maxZoom: 1.55,
      fogZoomScale: 0.68,
    },
    animation: sharedAnimation,
  },
};

export function resolveLegoSet(search = location.search) {
  const requestedId = new URLSearchParams(search).get("set");
  return legoSets[requestedId] || legoSets.falcon;
}

export function createSoundController({ assets, ui }) {
  let context;
  let masterGain;
  let buildBuffer;
  let buildLoadPromise;
  let buildSource;
  let buildGain;
  let completionBuffer;
  let completionLoadPromise;
  let enabled = true;
  let audioUnlocked = false;
  let completionPlayed = false;
  let previousAssembly = 0;
  let lastUpdateArgs = null;

  const loadAudio = (path, label) =>
    fetch(path)
      .then((response) => {
        if (!response.ok) throw new Error(`${label} sound could not be loaded.`);
        return response.arrayBuffer();
      })
      .then((buffer) => context.decodeAudioData(buffer))
      .catch((error) => console.warn(error));

  function setup() {
    if (context) return;
    context = new AudioContext();
    masterGain = context.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(context.destination);

    buildLoadPromise = loadAudio(assets.build, "Build process").then((buffer) => {
      buildBuffer = buffer;
      if (enabled && audioUnlocked) kick();
    });
    completionLoadPromise = loadAudio(assets.complete, "Completion").then((buffer) => {
      completionBuffer = buffer;
    });
  }

  function startBuild() {
    if (!enabled || !audioUnlocked || !context || !buildBuffer || buildSource) return;
    const time = context.currentTime;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buildBuffer;
    source.loop = false;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.78, time + 0.06);
    source.connect(gain).connect(masterGain);
    source.start(time);
    source.onended = () => {
      if (buildSource === source) {
        buildSource = null;
        buildGain = null;
      }
    };
    buildSource = source;
    buildGain = gain;
  }

  function stopBuild() {
    if (!buildSource || !context) return;
    const source = buildSource;
    const gain = buildGain;
    const time = context.currentTime;
    buildSource = null;
    buildGain = null;
    gain.gain.cancelScheduledValues(time);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
    source.stop(time + 0.065);
  }

  function playCompletion() {
    if (!enabled || !audioUnlocked || !context) return;
    if (!completionBuffer) {
      completionLoadPromise?.then(() => {
        if (enabled && audioUnlocked && completionBuffer) playCompletion();
      });
      return;
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = completionBuffer;
    gain.gain.value = 0.82;
    source.connect(gain).connect(masterGain);
    source.start(context.currentTime + 0.02);
  }

  function applyEnabledState() {
    if (!context) return;
    masterGain.gain.cancelScheduledValues(context.currentTime);
    masterGain.gain.linearRampToValueAtTime(
      enabled ? 0.9 : 0,
      context.currentTime + 0.08,
    );
  }

  function kick() {
    if (lastUpdateArgs) update(lastUpdateArgs);
    else startBuild();
  }

  function detachGestureListeners() {
    removeEventListener("pointerdown", onGesture);
    removeEventListener("keydown", onGesture);
    removeEventListener("wheel", onGesture);
  }

  function unlockAudio() {
    setup();
    if (audioUnlocked) {
      if (enabled) applyEnabledState();
      kick();
      return Promise.resolve();
    }
    audioUnlocked = true;
    detachGestureListeners();
    return context.resume().then(() => {
      if (enabled) applyEnabledState();
      kick();
    });
  }

  function onGesture(event) {
    if (audioUnlocked) return;
    if (event.target.closest?.(".sound-toggle")) return;
    unlockAudio();
  }

  function attachGestureListeners() {
    addEventListener("pointerdown", onGesture);
    addEventListener("keydown", onGesture);
    addEventListener("wheel", onGesture, { passive: true });
  }

  setup();
  attachGestureListeners();
  ui.setSoundEnabled(enabled);

  return {
    unlock: unlockAudio,

    toggle() {
      setup();
      if (!audioUnlocked) {
        unlockAudio();
        ui.setSoundEnabled(true);
        return;
      }
      context.resume();
      enabled = !enabled;
      applyEnabledState();
      ui.setSoundEnabled(enabled);
      if (!enabled) stopBuild();
      else kick();
    },

    update(args) {
      lastUpdateArgs = args;
      const { sequence, locked, totalParts, paused } = args;
      if (sequence.assembly < 0.08) completionPlayed = false;
      const fullyBuilt = totalParts > 0 && locked >= totalParts;
      const constructing =
        enabled &&
        audioUnlocked &&
        !paused &&
        !fullyBuilt &&
        sequence.assembly > 0.005 &&
        sequence.assembly >= previousAssembly - 0.001;

      if (constructing) startBuild();
      else stopBuild();

      if (fullyBuilt && !completionPlayed) {
        stopBuild();
        playCompletion();
        completionPlayed = true;
      }
      previousAssembly = sequence.assembly;
    },

    reset() {
      completionPlayed = false;
      previousAssembly = 0;
      stopBuild();
    },
  };
}

export function createSoundController({ assets, ui }) {
  let context;
  let masterGain;
  let buildBuffer;
  let buildLoadPromise;
  let buildSource;
  let buildGain;
  let completionBuffer;
  let completionLoadPromise;
  let enabled = false;
  let completionPlayed = false;
  let previousAssembly = 0;

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
    });
    completionLoadPromise = loadAudio(assets.complete, "Completion").then((buffer) => {
      completionBuffer = buffer;
    });
  }

  function startBuild() {
    if (!enabled || !context || !buildBuffer || buildSource) return;
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
    if (!enabled || !context) return;
    if (!completionBuffer) {
      completionLoadPromise?.then(() => {
        if (enabled && completionBuffer) playCompletion();
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

  return {
    toggle() {
      setup();
      context.resume();
      enabled = !enabled;
      masterGain.gain.cancelScheduledValues(context.currentTime);
      masterGain.gain.linearRampToValueAtTime(
        enabled ? 0.9 : 0,
        context.currentTime + 0.08,
      );
      ui.setSoundEnabled(enabled);
      if (!enabled) stopBuild();
    },

    update({ sequence, locked, totalParts, paused }) {
      if (sequence.assembly < 0.08) completionPlayed = false;
      const fullyBuilt = totalParts > 0 && locked >= totalParts;
      const constructing =
        enabled &&
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

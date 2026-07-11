export function createInterface(root = document) {
  const elements = {
    canvas: root.querySelector("#scene"),
    systemStatus: root.querySelector(".system-status span:last-child"),
    eyebrow: root.querySelector(".eyebrow"),
    headingLead: root.querySelector("h1 span"),
    headingMain: root.querySelector("h1 strong"),
    intro: root.querySelector(".intro"),
    progress: root.querySelector("#progressBar"),
    count: root.querySelector("#brickCount"),
    total: root.querySelector("#brickTotal"),
    velocity: root.querySelector("#velocity"),
    phase: root.querySelector("#phaseLabel"),
    rebuild: root.querySelector("#rebuildButton"),
    pause: root.querySelector("#pauseButton"),
    sound: root.querySelector(".sound-toggle"),
    footerLeft: root.querySelector("footer > span:first-child"),
    footerRight: root.querySelector("footer > span:last-child"),
  };
  let lastLocked = -1;

  const replaceLines = (element, lines) => {
    const content = [];
    lines.forEach((line, index) => {
      if (index > 0) content.push(root.createElement("br"));
      content.push(root.createTextNode(line));
    });
    element.replaceChildren(...content);
  };

  return {
    applySet(set) {
      root.title = set.ui.documentTitle;
      elements.canvas.setAttribute("aria-label", set.ui.canvasLabel);
      elements.systemStatus.textContent = set.ui.systemStatus;
      elements.eyebrow.textContent = set.ui.eyebrow;
      elements.headingLead.textContent = set.ui.headingLead;
      replaceLines(elements.headingMain, set.ui.headingLines);
      replaceLines(elements.intro, set.ui.introLines);
      elements.footerLeft.textContent = set.ui.footerLeft;
      elements.footerRight.textContent = set.ui.footerRight;
    },

    bind({ onRebuild, onPause, onSound }) {
      elements.rebuild.addEventListener("click", onRebuild);
      elements.pause.addEventListener("click", onPause);
      elements.sound.addEventListener("click", onSound);
    },

    setLoading(phase, progress) {
      elements.phase.textContent = phase;
      elements.progress.style.width = `${progress}%`;
    },

    setControlsDisabled(disabled) {
      elements.rebuild.disabled = disabled;
      elements.pause.disabled = disabled;
    },

    setTotalParts(totalParts) {
      elements.total.textContent = `/${String(totalParts).padStart(4, "0")}`;
      elements.count.textContent = "0000";
      lastLocked = -1;
    },

    setReady() {
      elements.progress.style.width = "0%";
      elements.phase.textContent = "Vortex forming";
      this.setControlsDisabled(false);
    },

    setError(message = "Model load failed") {
      elements.phase.textContent = message;
      elements.progress.style.width = "0%";
    },

    updateAssembly({
      sequence,
      locked,
      totalParts,
      maxVelocity,
      completionLabel,
      resetAt,
    }) {
      const shownLocked = Math.max(0, locked);
      const actualProgress = totalParts > 0 ? shownLocked / totalParts : 0;
      if (shownLocked !== lastLocked) {
        elements.count.textContent = String(shownLocked).padStart(4, "0");
        lastLocked = shownLocked;
      }
      elements.progress.style.width = `${actualProgress * 100}%`;
      elements.velocity.textContent = ((1 - actualProgress) * maxVelocity).toFixed(1);

      let phase = "Vortex forming";
      if (sequence.assembly > 0.01) phase = "Bags locking in sequence";
      if (shownLocked >= totalParts && totalParts > 0) phase = completionLabel;
      if (sequence.cycle > resetAt) phase = "Sequence reset";
      elements.phase.textContent = phase;
    },

    setPaused(paused) {
      elements.pause.setAttribute("aria-pressed", String(paused));
      elements.pause.querySelector("span").textContent =
        paused ? "Resume sequence" : "Pause sequence";
    },

    setSoundEnabled(enabled) {
      elements.sound.setAttribute("aria-pressed", String(enabled));
      elements.sound.querySelector(".sound-label").textContent =
        enabled ? "Sound on" : "Sound off";
    },
  };
}

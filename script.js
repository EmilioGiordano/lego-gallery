import { createAssemblyController } from "./src/animation/assembly-controller.js";
import { createSoundController } from "./src/audio/sound-controller.js";
import { resolveLegoSet } from "./src/config/sets.js";
import { createOrbitController } from "./src/controls/orbit-controller.js";
import { loadLegoSet } from "./src/model/load-lego-set.js";
import { createStage } from "./src/rendering/stage.js";
import { createInterface } from "./src/ui/interface.js";

const canvas = document.querySelector("#scene");
const set = resolveLegoSet();
const ui = createInterface();
const stage = createStage(canvas, set);
const orbit = createOrbitController(canvas, set.camera);
const sound = createSoundController({ assets: set.audio, ui });
let assembly;

ui.applySet(set);
ui.bind({
  onRebuild: () => assembly?.rebuild(),
  onPause: () => assembly?.togglePause(),
  onSound: () => sound.toggle(),
});

async function start() {
  const model = await loadLegoSet({
    set,
    shipPivot: stage.shipPivot,
    ui,
  });
  assembly = createAssemblyController({
    set,
    model,
    ui,
    sound,
    reduceMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
}

function render(now) {
  const animationTime = assembly?.update(now) ?? now;
  stage.render(animationTime, orbit.update());
  requestAnimationFrame(render);
}

start().catch((error) => {
  console.error(error);
  ui.setError();
});
requestAnimationFrame(render);

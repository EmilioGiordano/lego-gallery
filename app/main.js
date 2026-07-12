import * as THREE from "../assets/vendor/three.module.js";
import { createAssemblyController } from "../src/animation/assembly-controller.js";
import { createSoundController } from "../src/audio/sound-controller.js";
import { createOrbitController } from "../src/controls/orbit-controller.js";
import { loadLegoSet } from "../src/model/load-lego-set.js";
import { createStage } from "../src/rendering/stage.js";
import { createModelFade } from "../src/rendering/model-fade.js";
import {
  getSetHref,
  legoSets,
  resolveLegoSet,
  resolveSetFromHref,
} from "../src/sets/index.js";
import { createInterface } from "../src/ui/interface.js";

const canvas = document.querySelector("#scene");
const ui = createInterface();
let activeSet = resolveLegoSet();
const stage = createStage(canvas, activeSet);
const orbit = createOrbitController(canvas, activeSet.camera);
const sound = createSoundController({ assets: activeSet.audio, ui });
canvas.addEventListener("pointerdown", () => sound.unlock(), { passive: true });
const modelCache = new Map();
const loadingModels = new Map();
let model;
let assembly;
let switching = false;
const modelFade = createModelFade({
  reduceMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
});

function revealModel(nextModel) {
  showModel(nextModel);
  modelFade.reveal(nextModel);
}

function navigationItems(set) {
  return legoSets.map((candidate) => ({
    label: candidate.navigationLabel,
    href: getSetHref(candidate),
    current: candidate.id === set.id,
  }));
}

function createAssemblyForSet(set, loadedModel) {
  const controller = createAssemblyController({
    set,
    model: loadedModel,
    ui,
    sound,
    reduceMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  controller.warmUp?.(performance.now());
  return controller;
}

function showModel(nextModel) {
  if (model?.root) model.root.visible = false;
  model = nextModel;
  model.root.visible = true;
}

function applyActiveSet(set) {
  activeSet = set;
  document.title = set.ui.documentTitle;
  ui.applySet(set);
  ui.setNavigation(navigationItems(set));
  stage.applySet(set);
  orbit.applyConfig(set.camera);
}

function prefetchOtherSets(set) {
  for (const candidate of legoSets) {
    if (candidate.id === set.id) continue;
    fetch(candidate.assets.manifest).catch(() => {});
    fetch(candidate.assets.geometries).catch(() => {});
  }
}

async function ensureModel(set) {
  if (modelCache.has(set.id)) return modelCache.get(set.id);
  if (loadingModels.has(set.id)) return loadingModels.get(set.id);

  const loadPromise = (async () => {
    const root = new THREE.Group();
    root.visible = false;
    stage.shipPivot.add(root);

    try {
      const loaded = await loadLegoSet({
        set,
        modelRoot: root,
        ui,
        showProgress: false,
        silent: true,
      });
      modelCache.set(set.id, loaded);
      return loaded;
    } catch (error) {
      stage.shipPivot.remove(root);
      throw error;
    } finally {
      loadingModels.delete(set.id);
    }
  })();

  loadingModels.set(set.id, loadPromise);
  return loadPromise;
}

function rollbackSet(previousSet) {
  try {
    applyActiveSet(previousSet);
  } catch (error) {
    console.error(error);
    ui.applySet(previousSet);
    ui.setNavigation(navigationItems(previousSet));
  }
}

async function activateSet(nextSet, href, { replace = false } = {}) {
  if (switching || nextSet.id === activeSet.id) return;
  switching = true;
  ui.setControlsDisabled(true);

  const previousSet = activeSet;
  const previousHref = getSetHref(previousSet);

  try {
    const nextModel = await ensureModel(nextSet);
    applyActiveSet(nextSet);
    revealModel(nextModel);
    ui.setTotalParts(nextModel.totalParts);
    ui.setReady();
    assembly = createAssemblyForSet(nextSet, nextModel);
    if (replace) history.replaceState({ set: nextSet.id }, "", href);
    else history.pushState({ set: nextSet.id }, "", href);
  } catch (error) {
    console.error(error);
    rollbackSet(previousSet);
    history.replaceState({ set: previousSet.id }, "", previousHref);
    if (modelCache.has(previousSet.id)) {
      revealModel(modelCache.get(previousSet.id));
      assembly = createAssemblyForSet(previousSet, model);
    }
    ui.setError();
  } finally {
    switching = false;
    ui.setControlsDisabled(false);
  }
}

ui.applySet(activeSet);
ui.setNavigation(navigationItems(activeSet));
ui.bind({
  onRebuild: () => assembly?.rebuild(),
  onPause: () => assembly?.togglePause(),
  onSound: () => sound.toggle(),
  onNavigate: (href) => activateSet(resolveSetFromHref(href), href),
});

addEventListener("popstate", () => {
  activateSet(resolveLegoSet(), location.href, { replace: true });
});

async function start() {
  const root = new THREE.Group();
  stage.shipPivot.add(root);
  model = await loadLegoSet({
    set: activeSet,
    modelRoot: root,
    ui,
  });
  modelCache.set(activeSet.id, model);
  model.root.visible = true;
  assembly = createAssemblyForSet(activeSet, model);
  modelFade.reveal(model);
  prefetchOtherSets(activeSet);
  for (const candidate of legoSets) {
    if (candidate.id !== activeSet.id) {
      ensureModel(candidate).catch(() => {});
    }
  }
}

function render(now) {
  modelFade.tick(now, model);
  const animationTime = assembly?.update(now) ?? now;
  stage.render(animationTime, orbit.update());
  requestAnimationFrame(render);
}

start().catch((error) => {
  console.error(error);
  ui.setError();
});
requestAnimationFrame(render);

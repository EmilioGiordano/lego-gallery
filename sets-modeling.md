# LEGO Set Modeling Runbook

This document is an implementation guide for an AI agent adding another LEGO set to this repository. It defines the repeatable parts of the process, identifies the parts that still require visual judgment, and documents the runtime contract a new model must satisfy.

The goal is not to create a separate application for every set. The goal is to transform each set into the same runtime format and describe its presentation through configuration. Rendering, animation, controls, telemetry, audio, and navigation remain shared.

## Core principle

A new set should normally add only:

1. A processed scene manifest.
2. A compressed geometry archive.
3. One set definition module.
4. One entry in the set registry.

It should not duplicate the HTML shell, renderer, animation controller, model loader, controls, or UI implementation.

## Important limitation: a manual PDF is not a 3D model

An instruction manual is valuable, but it is not sufficient by itself to recover an exact digital model automatically.

The PDF provides:

- Set identity and variant.
- Bag and step order.
- Visible part selection and color.
- Assembly relationships.
- Validation views throughout construction.
- Evidence for excluding spare pieces, minifigures, tools, and display accessories.

The PDF usually does not provide:

- Machine-readable part IDs for every occurrence.
- Exact 4 × 4 transforms.
- Geometry files.
- Connection metadata.
- Reliable depth information for hidden pieces.

For an accurate implementation, the preferred input is:

- The instruction manual PDF, for sequencing and validation.
- A digital model export, for geometry and final transforms.

The current pipeline is designed around a Mecabricks export. A BrickLink Studio or LDraw model can also be useful, but it requires a converter into the runtime manifest described below.

If only a PDF is available, treat the task as a modeling project rather than a routine import. The AI must first reconstruct or obtain a digital model. It must not imply that exact geometry can be generated directly from instruction images without additional work.

## Required intake

Before editing the repository, collect:

- LEGO set number.
- Display name.
- Stable URL slug, such as `x-wing`.
- Instruction manual PDF.
- Digital model source, when available.
- Intended source license and redistribution constraints.
- Whether minifigures, accessories, stands, plaques, and spare pieces should appear.
- Desired completion label and presentation copy.

Record uncertainties before implementation. Do not guess a set variant when multiple editions use similar names.

## Repository architecture

```text
index.html                         Shared application shell
app/
├── main.js                        Composition root
└── styles/main.css                Shared presentation
src/
├── sets/
│   ├── index.js                   Set registry and route resolution
│   ├── shared.js                  Shared animation defaults
│   └── millennium-falcon.js       Example set definition
├── animation/                     Shared assembly controller
├── audio/                         Shared sound controller
├── controls/                      Shared orbit controls
├── model/                         Shared geometry parser and loader
├── rendering/                     Shared Three.js stage
└── ui/                            Shared DOM and navigation layer
assets/
└── sets/
    └── millennium-falcon/
        ├── scene.json
        └── geometries.zip
tools/
└── prepare-model.py               Current Mecabricks conversion pipeline
```

## Phase 1: inspect the manual

Use the PDF to establish a construction reference before processing the model.

### Extract

- Official set number and name.
- Numbered bag ranges.
- Major subassemblies.
- Final orientation.
- Moving sections or alternate positions.
- Flexible pieces.
- Transparent, metallic, printed, or decorated elements.
- Optional assemblies.
- Minifigures and accessories outside the main model.
- Display stand or information plaque.

### Decide

- What belongs to the final animated model.
- What should be excluded.
- Whether moving sections use their neutral or display position.
- Whether the animation should follow exact bag order or a simplified sequence.

The result should be a short set-specific modeling note. Coordinate filters must not be invented until the source model has been inspected.

## Phase 2: inspect the digital source

For a Mecabricks source, expect:

```text
model.json
materials.json
geometries.zip
```

Confirm:

- The source matches the same set edition as the PDF.
- The final assembly is complete.
- Object transforms are present.
- Parent-child hierarchy is intact.
- Bag groups are named consistently, ideally `Bag N`.
- Required geometry files exist in the export.
- Detached objects can be identified reliably.

Compare the digital model against several final manual views. Do not continue if the source represents a materially different edition.

## Phase 3: generalize the preparation pipeline

The current `tools/prepare-model.py` was written for the Millennium Falcon. It already performs the reusable work:

- Reads the object hierarchy.
- Composes local transforms into world transforms.
- Maps materials.
- Resolves geometry files.
- Groups repeated pieces for instanced rendering.
- Preserves bag numbers.
- Calculates model bounds.
- Compresses only the required geometries.

It also contains Falcon-specific assumptions:

- Hard-coded source paths.
- Hard-coded output path.
- Coordinate filters for detached Falcon objects.
- Flexible-part handling limited to known Falcon engine pieces.
- Bag timing assumptions tuned for 17 bags.

Before processing a second set, refactor the script to accept a set-specific configuration or command-line arguments. Do not copy the entire converter into a second script.

A desired future command is:

```bash
python tools/prepare-model.py --set x-wing
```

A set-specific preparation configuration should eventually describe:

```json
{
  "slug": "x-wing",
  "sourceDirectory": "model-sources/x-wing",
  "sourceArchive": "model-sources/x-wing/geometries.zip",
  "outputDirectory": "assets/sets/x-wing",
  "excludeObjectIds": [],
  "includeFlexiblePartIds": [],
  "bagPattern": "^Bag\\s+(\\d+)$"
}
```

This is a target design, not an implemented file format. An AI agent may introduce it when adding the next set, but it must preserve the existing Falcon output.

## Phase 4: filter the scene

Filtering is set-specific and must be evidence-based.

Common exclusions include:

- Minifigures arranged beside the model.
- Spare parts.
- Tools and weapons.
- Alternate build elements.
- Display plaques.
- Detached stands.
- Optional radar dishes or accessories.

Prefer stable object IDs, hierarchy names, or explicit source groups over broad coordinate filters. Coordinate filters are fragile and should only be used after visual inspection.

After filtering, verify:

- No valid hull or structural pieces were removed.
- No detached accessories remain.
- Bounds enclose only the intended model.
- The resulting part count is plausible.

The runtime part count may differ from the number printed on a retail box because minifigures, spares, unsupported flexible pieces, or accessories may be intentionally excluded.

## Phase 5: handle geometry and materials

The runtime loader currently supports:

- Legacy Mecabricks/Three.js triangle and quad records.
- Material groups.
- Face and vertex normals.
- Normal generation when source normals are missing.
- Instanced meshes grouped by geometry and material.
- Procedurally reconstructed hoses and lattices represented by supported flexible descriptors.

Inspect a new set for:

- New flexible part types.
- Printed or textured elements.
- Chrome or metallic parts.
- Transparent elements.
- Material references that should emit light.
- Missing geometry configurations.

Do not silently discard unsupported visible pieces. Either implement support, document the omission, or stop and ask for a decision.

## Phase 6: produce the runtime assets

The output directory must be:

```text
assets/sets/<set-slug>/
├── scene.json
└── geometries.zip
```

The manifest contract consumed by `loadLegoSet()` is:

```text
metadata.parts
bounds.min
bounds.max
bounds.center
bounds.size
materials
geometries[]
groups[]
```

Each instance in a group must contain:

```json
{
  "m": [16, "column-major matrix values"],
  "b": 1
}
```

Where:

- `m` is the final world transform.
- `b` is the construction bag number.

Do not manually enter the displayed piece total. The UI reads `metadata.parts`.

## Phase 7: create the set definition

Create:

```text
src/sets/<set-slug>.js
```

Use `src/sets/millennium-falcon.js` as the reference implementation.

Minimum responsibilities:

- Stable `id`.
- Clean route slug.
- Navigation label.
- Full display name.
- Completion label.
- UI text.
- Manifest and geometry URLs.
- Material overrides.
- Camera calibration.
- Animation configuration.

Example:

```js
import { sharedAnimation } from "./shared.js";

export const xWing = Object.freeze({
  id: "x-wing",
  route: "x-wing",
  navigationLabel: "X-Wing",
  name: "LEGO X-Wing",
  completionLabel: "T-65 complete",

  ui: {
    documentTitle: "X-Wing Assembly",
    canvasLabel: "LEGO pieces assembling into an X-Wing",
    eyebrow: "Incom T-65 space superiority fighter",
    headingLead: "Assemble the",
    headingLines: ["rebel", "starfighter."],
    introLines: [
      "One fighter. Hundreds of individual elements.",
      "Watch every piece lock into position.",
    ],
    footerLeft: "Incom Corporation",
    footerRight: "Unofficial fan experiment",
  },

  assets: {
    manifest: new URL(
      "../../assets/sets/x-wing/scene.json",
      import.meta.url,
    ).href,
    geometries: new URL(
      "../../assets/sets/x-wing/geometries.zip",
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
    emissiveReferences: [],
  },

  camera: {
    initialPitch: 0.6,
    desktopDistance: 1600,
    mobileDistance: 2400,
    mobileBreakpoint: 760,
    lookAt: [0, 0, 0],
    desktopModelRotation: 0,
    mobileModelRotation: -0.3,
    minPitch: -1.34,
    maxPitch: 1.34,
    minZoom: 0.4,
    maxZoom: 1.55,
    fogZoomScale: 0.68,
  },

  animation: sharedAnimation,
});
```

Start with shared animation values. Tune only after checking the model at vortex, mid-assembly, and completed states.

## Phase 8: register the set

Import the definition in `src/sets/index.js` and add it to `legoSets`.

```js
import { millenniumFalcon } from "./millennium-falcon.js";
import { xWing } from "./x-wing.js";

export const legoSets = Object.freeze([
  millenniumFalcon,
  xWing,
]);
```

The navbar is generated from this registry. It appears automatically when at least two sets are registered.

## Phase 9: routing

The application supports a query route without hosting configuration:

```text
/?set=x-wing
```

The registry can also resolve a clean pathname:

```text
/x-wing/
```

Clean pathnames require the hosting provider to rewrite unknown routes to the shared `index.html`.

For Netlify:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

For Vercel:

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

GitHub Pages does not provide arbitrary SPA rewrites when deploying directly from a branch. Use query routes, physical route directories, or a Pages deployment workflow that builds the required output.

## Phase 10: calibrate presentation

Every model has different bounds and visual weight. Review:

- Desktop camera distance.
- Mobile camera distance.
- Initial pitch.
- Model Y rotation.
- Camera look-at point.
- Vortex radius.
- Vertical spread.
- Fog density while zooming.
- Bag delay distribution.
- Total sequence duration.
- Emissive materials.

Avoid changing shared rendering logic to compensate for one set when the value can live in its definition.

## Validation checklist

### Data

- Manifest and archive return HTTP 200.
- Every referenced geometry exists in the ZIP.
- `metadata.parts` matches the number of exported instances.
- Bounds are finite and centered on the intended model.
- Materials resolve without unexpected fallbacks.
- Bag values are plausible.

### Visual

- `?vortex` shows all intended pieces.
- `?complete` produces the correct final model.
- No detached accessories remain.
- No important pieces are missing.
- Transparent and metallic parts look acceptable.
- Flexible pieces render correctly.
- Camera framing works on desktop and mobile.

### Interaction

- Drag orbit works.
- Wheel zoom works.
- Rebuild resets all instances.
- Pause and resume preserve sequence timing.
- Piece telemetry reaches the manifest total.
- Navbar shows every registered set.
- Direct query selection loads the expected set.

### Performance

- Geometry loading yields to animation frames.
- Repeated bricks use instancing.
- Pixel ratio remains capped.
- No per-frame geometry allocation is introduced.
- Browser console contains no model-loading errors.

## When shared code should change

Extend shared code only when the new requirement is genuinely reusable, for example:

- Supporting another geometry encoding.
- Adding a generic flexible-piece descriptor.
- Deriving camera defaults from bounds.
- Supporting per-set lighting profiles.
- Adding texture support.

Keep the behavior in the set definition when it is unique to one model, for example:

- A specific completion label.
- One emissive engine material.
- A display orientation.
- A set-specific exclusion list.
- A different animation duration.

## Completion criteria

A new set is complete when:

1. Its source and manual edition are identified.
2. Licensing constraints are documented.
3. Runtime assets are generated.
4. The final model matches the manual.
5. Bag sequencing is credible.
6. The set definition contains no Falcon-specific values by accident.
7. The registry and navbar include the new set.
8. Query routing works.
9. Clean routing is verified when supported by the host.
10. Desktop and mobile rendering are validated.
11. Existing sets still load and animate correctly.

## Instructions for an AI agent

- Read this file before adding a set.
- Inspect the current converter and set registry before editing.
- Treat the PDF as sequencing and validation evidence, not as geometry data.
- Prefer a digital model source with exact transforms.
- Do not duplicate the application shell or shared controllers.
- Do not hard-code the piece count in UI code.
- Do not reuse Falcon-specific filters for another model.
- Do not silently omit unsupported visible parts.
- Preserve existing sets and verify them after shared changes.
- Keep source-specific legal restrictions separate from the license for original code.
- Do not commit or push unless the user explicitly requests it.

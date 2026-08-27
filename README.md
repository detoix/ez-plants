# EZ-Tree

![NPM Version](https://img.shields.io/npm/v/%40detoix%2Fez-plants)
![NPM Downloads](https://img.shields.io/npm/dw/%40detoix%2Fez-plants)
![GitHub Repo stars](https://img.shields.io/github/stars/detoix/ez-plants)
![X (formerly Twitter) Follow](https://img.shields.io/twitter/follow/dangreenheck)
![YouTube Channel Subscribers](https://img.shields.io/youtube/channel/subscribers/UCrdx_EU_Wx8_uBfqO0cI-9Q)

<p align="center">
<img src="https://github.com/user-attachments/assets/cb5f5edd-3e1b-453d-925f-734965126b17">
</p>

# About

EZ-Tree is a procedural tree generator with dozens of tunable parameters. This repository additionally hosts **EZ-Plants**, a library of botanically specific garden plants for Polish and European gardens (see [Garden Plants](#garden-plants-poland--europe)). The standalone tree generation code is published as a library and can be imported into your own application for dynamically generating trees on demand. Additionally, there is a standalone web app which allows you to create trees within the browser and export as .PNG or .GLB files.

# App

https://eztree.dev

# Installation

```js
npm i @detoix/ez-plants
```

# Usage

```js
// Create new instance
const tree = new Tree();

// Set parameters
tree.options.seed = 12345;
tree.options.trunk.length = 20;
tree.options.branch.levels = 3;

// Generate tree and add to your Three.js scene
tree.generate();
scene.add(tree);
```

Any time the tree parameters are changed, you must call `generate()` to regenerate the geometry.

## Levels of Detail (LODs)

For scenes with many trees, `generateLODs()` builds the tree at multiple levels of detail hosted in a `THREE.LOD` object inside the tree group. The renderer automatically switches levels based on camera distance. All levels are meshed from the same skeleton, so the tree's silhouette stays consistent across switches — distant levels just use fewer ring segments and fewer (but larger) leaves.

```js
const tree = new Tree();
tree.loadPreset('Ash Medium');
tree.generateLODs(); // instead of generate()
scene.add(tree);
```

The default levels (`Tree.defaultLODLevels`) switch at 100 and 250 units, reducing to roughly 40% and 20% of the full triangle count. You can pass custom levels:

```js
tree.generateLODs([
  { distance: 0, detail: {} }, // full detail
  {
    distance: 80,
    hysteresis: 0.05,
    detail: {
      sectionStride: 3, // sample every 3rd ring along each branch
      segmentFactor: 0.75, // reduce radial segments to 75% (min 3)
      leafStride: 2, // keep every 2nd leaf...
      leafScale: 1.4, // ...enlarged to preserve canopy coverage
      billboard: 'single', // drop the second crossed leaf quad
    },
  },
]);
```

All LOD levels share one bark material and one leaf material, so `tree.update(time)` animates wind at every level. Calling `generate()` afterwards tears the LOD down and restores the single full-detail mesh pair (note that exporting a tree generated with `generateLODs()` to GLB will include every level).

If you have your own LOD or instancing system, `tree.createGeometry(detail)` returns raw `{ branches, leaves }` `BufferGeometry` pairs at any detail level without touching the tree's own meshes.

# Garden Plants (Poland & Europe)

Alongside the procedural tree generator, this repository hosts a growing library of
**botanically specific garden plants** for Polish and European gardens. Each plant is a
cultivar-level digital twin: a persistent cane structure driven by an **age** and a
**day of year**, with a phenology calendar built from cited real-world sources.

| Plant                                        | Cultivar     | Habit                                                                  | Defining behaviour                                                                                           |
| -------------------------------------------- | ------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Blackcurrant (_Ribes nigrum_)                | 'Tisel'      | Upright multi-cane stool, ~1.3 m                                       | Fruits on young wood; renewal pruning in dormancy                                                            |
| Forsythia (_Forsythia × intermedia_)         | 'Lynwood'    | Upright-arching multi-cane, ~2.2 m                                     | **Flowers on bare 1–2 year old wood before any leaf**; prune immediately after flowering                     |
| Panicle hydrangea (_Hydrangea paniculata_)   | 'Limelight'  | Broad framework; 1.85 × 2.25 m renderer target within the RHS envelope | **Terminal panicles on current-season shoots**; lime → cream → dusty pink → dry winter heads                 |
| Chinese silver grass (_Miscanthus sinensis_) | 'Malepartus' | Caespitose warm-season grass clump, ~2.0 × 1.5 m                       | **No woody tissue at all**; the whole plant is rebuilt from the crown each year and cut to 10 cm each spring |

All plants are modelled in **metres**, share the same wind shader, instance pools,
LOD controller and validated state cycle, and extend a common `PlantRenderer` base.
The three shrubs additionally share EZ-Tree's woody geometry, bark material and leaf
cards. Miscanthus is the exception that proves the base is not shrub-shaped: a grass
has no wood, so its culms, arching blades and silky plumes are instanced geometry with
baked vertex colours. It ships no texture _files_ — the one map it uses, a 64x1 strip
that lights the blades' white midribs, is generated in code at construction.

## Library rules

These are the standing rules for every plant in this library. They exist so a
plant added in a year's time behaves like the ones already here. A change that
breaks one of them is a change to this list first.

### 1. Two parameters drive everything: age and day of year

A plant is a function of **`ageYears`** and **`dayOfYear`**, plus a seed for
variation. Nothing else may be required to get a correct-looking plant. Height,
cane count, leaf colour, flower stage, dry winter heads and pruning scars are all
_derived_, never passed in. If a look cannot be reached from those two numbers,
the model is wrong — do not add a knob for it.

There is no care-history parameter. Every plant in this library is one somebody
looks after, so pruning, cutting back and division are part of the model rather
than a mode you switch on.

**The calendar is not a third parameter.** `dayOfYear` has to be read against
something, and that something is composed rather than hardcoded: a cited
regional observation (`region` / `seasonProfile` / `trialYear`), optionally
shifted by `offsetDays` to match a local site. North-east Poland flowers about
twelve days after central Poland and that difference is observed, not invented;
a frost pocket or a coastal garden that fits no named region says so with an
offset. Both together answer one question — _what does this day of the year mean
here_ — and neither reaches a look that the day itself could not.

That composition is the boundary. A parameter that places the calendar is
legitimate; a parameter that places the plant on it is not.

### 2. The plants are curated, not wild

Every plant is one somebody looks after: pruned on schedule, fed, not crowded,
not drought-stressed. That is the only plant this library models — there is no
neglected mode, and adding one would mean modelling a different plant, not a
setting on this one. Blackcurrant canes always leave on the renewal schedule,
forsythia always renews after flowering, Miscanthus is always cut back in March
and divided before its centre opens. Do not model disease, pests, storm damage
or nutrient deficiency either — this is a garden library, not a pathology
atlas.

### 3. Botany is the specification

Every plant is **cultivar-level**, not genus-level: 'Limelight', not "a
hydrangea". A cultivar profile carries its own dimensions, habit and calendar,
and every number in it is either

- **observed** — traceable to a cited source (`*_SOURCES`, `*_CALENDAR_PROVENANCE`), or
- **an assumption** — declared as one (`*_PHASE_ASSUMPTIONS`, render priors).

The two are never mixed silently. Phase _durations_ shape the animation and are
not claimed as observed station intervals; real weather moves a real plant by
weeks. The defining behaviour of the species is non-negotiable: forsythia flowers
on bare two-year-old wood before any leaf opens; hydrangea panicles are terminal
on current-season shoots; blackcurrant fruits on young wood; Miscanthus has no
woody tissue at all and is rebuilt from the crown every year.

### 4. Compare against real photographs before calling a plant done

Every plant is checked against real-life reference images of that cultivar at
that age and that time of year — not against a mental image, and not against
other renders. Render the candidate with

```bash
npm run dev &                       # the demo page the shot script drives
node scripts/shoot.mjs out.png "plant=forsythia&year=6&day=96" three-quarter
```

and compare silhouette, proportion, organ density, colour and stage against
photographs. Cite what you compared against in the cultivar profile. A render
that looks plausible but does not match the photograph is a bug.

### 5. Fast is a design constraint, not an optimisation pass

Budget: a mature plant is a handful of draw calls, and scrubbing the sliders must
never rebuild it.

- Every organ kind is one `InstancedMesh` from a **stable-capacity pool** — count
  changes per frame, allocation does not.
- Woody structure is one merged mesh, remeshed only when the skeleton actually
  changes (`_woodSnapshotKey`).
- `setState` / `setTime` mutate in place. Construction is the only place geometry
  is created.
- Wind is a vertex shader. Nothing animates on the CPU.
- Every plant supports distance LOD and reports `stats().drawCalls`.
- Every plant owns a `ResourceTracker` and a working `dispose()`.

### 6. Stay on EZ-Tree; diverge only where morphology forces it

This repo is a fork. Shared machinery — woody geometry and axes, bark and leaf
materials, leaf cards, wind, instance pools, LOD, detail levels, RNG — is reused,
extended or generalised in place. Write plant-specific code only for what a
species genuinely does differently. `PlantRenderer` owns everything common; a
plant subclass implements only `_buildStableGraph`, `_applySnapshot` and
`_evaluate`. Miscanthus is the licensed exception: a grass has no wood, so it
uses instanced vertex-coloured organ geometry instead of bark and leaf cards.

### 7. One plant is one self-contained folder

Distribution is shadcn-shaped: a user runs a command, and a plant's source lands
in their project. That only works if a plant is genuinely extractable, so
`src/lib/plants/<plant>/` holds these five source files, plus whatever assets the
plant itself needs, and nothing reaches sideways:

| File            | Holds                                             |
| --------------- | ------------------------------------------------- |
| `<cultivar>.js` | The cultivar profile, dimensions, sources         |
| `phenology.js`  | The calendar, stages, BBCH codes, care hints      |
| `model.js`      | The pure model: age + day → a plain-data snapshot |
| `geometry.js`   | The species' organ geometry                       |
| `<plant>.js`    | The renderer, a `PlantRenderer` subclass          |

Assets sit beside them: each shrub carries its `leaf.webp` and a `LICENSE.md`
recording where the plate came from. Miscanthus carries neither — a grass has no
leaf cards, and it generates the one map it needs in code.

Rules that follow from it: **no plant may import from another plant's folder** —
anything two plants need moves to shared `src/lib/` — the shared core an
extracted plant brings with it. The model layer stays pure data with no Three.js
in it. A plant must render correctly with no assets
supplied by the caller; any texture it needs it either generates in code or
carries in its own folder.

### 8. Two front doors, one behaviour

Every plant is usable as a bare `THREE.Group` and as an R3F component, and the
two accept the same options under the same names. Swapping one plant for another
is a one-word change in either. React and `@react-three/fiber` stay optional peer
dependencies — importing the root package must never pull React into a bundle.

## Where the library stands today

Measured against the rules above, at four plants and 264 passing tests
(`npm test`):

| Rule                      | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — two parameters        | Held. Age and day are the only plant parameters; `scenario` is gone and every plant is unconditionally maintained. The calendar selector and `offsetDays` compose the calendar that `dayOfYear` is read against — they place the calendar, not the plant.                                                                                                                                                                                                                                                 |
| 2 — curated               | Held, and now structural: a looked-after plant is the only plant the model can produce.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 3 — botany as spec        | Held. All four are cultivar-level with cited sources and separately labelled assumptions.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4 — photo comparison      | Partly. `scripts/shoot.mjs` renders the comparison shot, and `malepartus.js` cites its reference photographs in detail, but `lynwood.js` and `limelight.js` record none.                                                                                                                                                                                                                                                                                                                                  |
| 5 — fast                  | Held in the renderers. Barely enforced: `test/miscanthus-renderer.test.js` asserts a real draw-call bound, but `test/forsythia-renderer.test.js` only asserts `drawCalls > 0`, and the other two have no budget test.                                                                                                                                                                                                                                                                                     |
| 6 — stay on EZ-Tree       | Held. All four plants extend `PlantRenderer` and add only their own morphology; nothing in `src/lib/` imports from `src/app/`.                                                                                                                                                                                                                                                                                                                                                                            |
| 7 — self-contained folder | **Held for extraction.** No plant imports another — the shared calendar moved to `src/lib/calendar.js`, ending the `dayOfYear` leak. Each shrub carries its own `leaf.webp` and loads it itself, so `npm run plant:add` copies a plant that renders standing alone. Two gaps remain: bark is still supplied by the demo app (all three shrubs share `Bark001`, so it belongs in the shared core), and three of four models put `THREE.Vector3`/`Euler` into their snapshot instead of staying plain data. |
| 8 — two front doors       | Held. All four plants ship a three.js class and an R3F component with matching props.                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Extracting a plant

Distribution is shadcn-shaped, and the command exists:

```bash
npm run plant:add -- --list
npm run plant:add -- hydrangea ./src/ez-plants
```

The file list is never hardcoded — it is derived by walking the import graph from
the plant's renderer, so it cannot drift as the code moves, and it follows
`new URL('./leaf.webp', import.meta.url)` so a plant's plate travels with it.
Files keep their path relative to `src/lib/`, which is why every relative import
still resolves at the destination without rewriting.

| Plant        | Own files | Shared core | Total |
| ------------ | --------- | ----------- | ----- |
| miscanthus   | 5         | 17          | 22    |
| blackcurrant | 6         | 17          | 23    |
| forsythia    | 6         | 18          | 24    |
| hydrangea    | 6         | 19          | 25    |

`three` is the only dependency an extracted plant needs.
`test/plant-extraction.test.js` extracts into a fresh directory and renders the
result, so a reintroduced cross-plant import fails the build.

The open work, in the order it blocks the goal: move bark into the shared core so
a shrub renders textured standing alone, take Three.js back out of the model
layer, and settle rule 1's extra parameters.

### What the two sliders mean for a grass

Everything in this library is driven by **plant age** and **day of year**, but the two
sliders divide the work differently for a caespitose grass than for a shrub. On the
shrubs, age grows a persistent woody framework and the day paints organs onto it. On
Miscanthus there is no framework to grow:

- **Age** shapes only the crown — how wide the clump of tillers is, how many culms it
  carries. It is divided before its centre opens out, so it never develops the
  doughnut of an undivided clump.
- **Day of year** builds and dismantles the entire visible plant, once. Nothing above
  the crown is ever more than one season old. A C4 grass waits for warm soil, so the
  clump is still bare stubble well into April; it reaches 2 m by August, heads in
  mid-August, silvers through October and then stands dry all winter until the cut.

## Three.js usage

```js
import { Hydrangea } from '@detoix/ez-plants';

const bush = new Hydrangea({
  ageYears: 6,
  dayOfYear: 230, // cream-white peak in a typical central-Poland season
  seasonProfile: 'typical',
  lod: true,
});
scene.add(bush);

// Scrub through time — the plant is updated in place, never rebuilt.
bush.setTime({ ageYears: 12, dayOfYear: 200 });

// Per frame
bush.update(delta, elapsed, camera);

// When done
bush.dispose();
```

At day 230 the Hydrangea is fully leafed and its terminal panicles are near the
cream-white peak. Day 30 instead shows bare framework with last season's dry tan heads;
they are removed through the modeled spring pruning window.

## React Three Fiber usage

```tsx
import { Canvas } from '@react-three/fiber';
import { Hydrangea, type HydrangeaStats } from '@detoix/ez-plants/react';

<Canvas>
  <Hydrangea
    ageYears={6}
    dayOfYear={230}
    seasonProfile="late"
    onStats={(stats: HydrangeaStats) => console.log(stats.phenology.stage)}
  />
</Canvas>;
```

Every plant follows the same shape, so swapping one for another is a one-word change:

```tsx
import { Miscanthus } from '@detoix/ez-plants/react';

<Miscanthus ageYears={8} dayOfYear={250} seasonProfile="typical" />;
```

`react` and `@react-three/fiber` are optional peer dependencies; importing the root
package never pulls React into your bundle.

## Care guidance and provenance

Every plant exposes source-cited care hints and its own calendar provenance, so a UI can
show _why_ it is telling you something:

```js
const { careHints, phenology } = bush.stats();
careHints[0].message; // "The modeled display begins 15 July and runs into early October ..."
careHints[0].source; // https://www.rhs.org.uk/plants/pdfs/plant-trials-and-awards/plant-bulletins/hydrangea-paniculata.pdf
phenology.bbch; // BBCH growth-stage code
```

Observed values and renderer assumptions are labelled separately in each profile
(`LIMELIGHT_SOURCES`, `LIMELIGHT_PHASE_ASSUMPTIONS`). Phase durations shape the animation
and are **not** claimed as observed station intervals; weather shifts a real plant by weeks.

## Shared demo page

`npm run dev` serves one demo page for the whole library, with a plant selector, an
**age** slider, a **day of year** slider, seasonal shortcuts, regional phenology
profiles, care events and review cameras. State is reflected in the URL:

```
http://localhost:5173/?plant=hydrangea&year=6&day=230&profile=typical&view=three-quarter
http://localhost:5173/?plant=miscanthus&year=8&day=250&profile=typical&view=three-quarter
```

# Running Standalone App Locally

To run the standalone app locally, you first need to build the EZ-Tree library before running the app.

```bash
npm install
npm run app
```

# Running App with Docker

```bash
docker compose build
docker compose up -d
```

# Tree Parameters

The `TreeOptions` class defines an options object that controls various parameters of a procedurally generated tree. Each property of this object allows for customization of the tree's appearance, including bark, branches, and leaves. Below is a detailed explanation of each property of the `TreeOptions` object.

## General Properties

- **`seed`**: Sets the initial value for random generation, ensuring consistent tree generation when using the same seed.
- **`type`**: Defines the type of the tree, which can be set to one of the options from the `TreeType` enumeration (e.g., `TreeType.Deciduous`).

## Bark Parameters

The `bark` object controls the appearance and properties of the tree trunk.

- **`type`**: Optional informational identifier for the bark asset. The core library does not resolve texture names.
- **`tint`**: Determines the color tint applied to the bark, defined as a hexadecimal color value (e.g., `0xffffff` for white).
- **`flatShading`**: Boolean property indicating whether to use flat shading (`true`) or smooth shading (`false`) for the bark.
- **`textured`**: Boolean value that indicates if a texture is applied to the bark (`true` or `false`).
- **`maps`**: Caller-supplied `THREE.Texture` objects in `{ color, ao, normal, roughness }`. No textures are bundled with the library.
- **`textureScale`**: Controls the scale of the bark texture in both the `x` and `y` axes. It is an object with properties `x` and `y` to define the scaling factors.

## Branch Parameters

The `branch` object defines parameters for the trunk and branch levels of the tree.

- **`levels`**: Number of recursive branch levels. Setting this to `0` creates only the trunk, while higher values add more branches.
- **`angle`**: Defines the angle, in degrees, at which child branches grow relative to their parent branch. This is specified separately for each level.
- **`children`**: Specifies the number of child branches at each level, with the index (`0`, `1`, `2`, etc.) representing the level.
- **`force`**: Represents an external directional force encouraging tree growth, defined by `direction` (a vector object `{ x, y, z }`) and `strength` (a numeric value).
- **`gnarliness`**: Defines how twisted or curled each branch level should be, specified for each level.
- **`length`**: Length of the branches at each level. This is an object with keys representing each level.
- **`radius`**: Radius (or thickness) of the branches at each level.
- **`sections`**: Number of segments along the length of each branch level, controlling the resolution of the branch mesh.
- **`segments`**: Number of radial segments that make up each branch, with a higher value resulting in a smoother cylinder.
- **`start`**: Specifies where along the parent branch (as a fraction from `0` to `1`) the child branches should start forming.
- **`taper`**: Controls the tapering of the branches at each level. A value between `0` and `1` defines the reduction in radius from base to tip.
- **`twist`**: Defines the amount of twisting applied to each branch level.

## Leaf Parameters

The `leaves` object defines properties that control the appearance and placement of leaves.

- **`type`**: Optional informational identifier for the leaf asset. The core library does not resolve texture names.
- **`map`**: Caller-supplied leaf `THREE.Texture`. No leaf textures are bundled with the library.
- **`billboard`**: Defines how leaves are rendered. The `Billboard` enumeration can be set to `Single` or `Double` to indicate single or perpendicular double-sided leaves.
- **`angle`**: Defines the angle of the leaves relative to the parent branch, in degrees.
- **`count`**: Number of leaves to generate.
- **`start`**: Specifies where along the length of the branch (as a value between `0` and `1`) leaves should start growing.
- **`size`**: Size of the leaves, represented as a numeric value.
- **`sizeVariance`**: Specifies how much variance in size each leaf instance should have, making the leaves look more natural.
- **`tint`**: Tint color applied to the leaves, defined as a hexadecimal color value (e.g., `0xffffff` for white).
- **`alphaTest`**: Sets the alpha threshold for leaf transparency, controlling the transparency of the leaf textures.

# EZ-Tree

![NPM Version](https://img.shields.io/npm/v/%40dgreenheck%2Fez-tree)
![NPM Downloads](https://img.shields.io/npm/dw/%40dgreenheck%2Fez-tree)
![GitHub Repo stars](https://img.shields.io/github/stars/dgreenheck/ez-tree)
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
npm i @dgreenheck/ez-tree
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

| Plant                                      | Cultivar    | Habit                                                                  | Defining behaviour                                                                           |
| ------------------------------------------ | ----------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Blackcurrant (_Ribes nigrum_)              | 'Tisel'     | Upright multi-cane stool, ~1.3 m                                       | Fruits on young wood; renewal pruning in dormancy                                            |
| Forsythia (_Forsythia × intermedia_)       | 'Lynwood'   | Upright-arching multi-cane, ~2.2 m                                     | **Flowers on bare 1–2 year old wood before any leaf**; prune immediately after flowering     |
| Panicle hydrangea (_Hydrangea paniculata_) | 'Limelight' | Broad framework; 1.85 × 2.25 m renderer target within the RHS envelope | **Terminal panicles on current-season shoots**; lime → cream → dusty pink → dry winter heads |

All plants are modelled in **metres**, share the same EZ-Tree woody geometry, bark
material, leaf cards and wind shader, and extend a common `PlantRenderer` base.

## Three.js usage

```js
import { Hydrangea } from '@dgreenheck/ez-tree';

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
the maintained scenario removes them through the modeled spring pruning window.

## React Three Fiber usage

```tsx
import { Canvas } from '@react-three/fiber';
import { Hydrangea, type HydrangeaStats } from '@dgreenheck/ez-tree/react';

<Canvas>
  <Hydrangea
    ageYears={6}
    dayOfYear={230}
    seasonProfile="late"
    onStats={(stats: HydrangeaStats) => console.log(stats.phenology.stage)}
  />
</Canvas>;
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

# EZ-Plants

![NPM Version](https://img.shields.io/npm/v/%40detoix%2Fez-plants)
![NPM Downloads](https://img.shields.io/npm/dw/%40detoix%2Fez-plants)
![GitHub Repo stars](https://img.shields.io/github/stars/detoix/ez-plants)

> No cover image yet. The old one showed an EZ-Tree tree, which is not what this
> library is for; render a plant with `node scripts/shoot.mjs` to replace it.

# About

**EZ-Plants** is a library of botanically specific garden plants for Polish and
European gardens. Each plant is a cultivar-level digital twin — 'Limelight', not
"a hydrangea" — driven by two numbers, an **age** and a **day of year**, against a
phenology calendar built from cited sources. Give it a year and a date and it
grows the plant that belongs there: bare wood in February, forsythia in flower
before a leaf opens, hydrangea panicles turning cream in August, a grass standing
dry all winter until the March cut.

The plants are meant to be taken, not just imported. `npm run plant:add` copies
one into your project — source, leaf plate and all — the way you would add a
shadcn component. An extracted plant renders textured and correct with `three` as
its only dependency.

This repository is a fork of [EZ-Tree](https://github.com/dgreenheck/ez-tree) by
Dan Greenheck (MIT), whose procedural tree generator is the machinery the shrubs
are grown on: woody geometry and axes, bark and leaf materials, wind, instance
pools and LOD. The tree generator is still here and still works — see
[Tree generator](#tree-generator) below.

# Installation

```js
npm i @detoix/ez-plants
```

`three` is the only dependency a plant needs. Everything else the package
declares is an optional peer, installed only if you use the front door that
wants it.

### Optional peers

| Peer                          | Needed for                         |
| ----------------------------- | ---------------------------------- |
| `react`, `@react-three/fiber` | the R3F components (rule 8)        |
| `@three.ez/instanced-mesh`    | the field layer (`src/lib/field/`) |

**If you install `@three.ez/instanced-mesh`, deduplicate `three`.** It patches
`THREE.ShaderChunk` at import time, and those patches are what carry a
per-instance transform into the shader. If your bundler hands the library a
different `three` module instance than the one instanced-mesh imported, the
patches land where nothing reads them — and nothing throws. Materials compile,
instances draw, and per-instance effects such as the leaf-wind counter-rotation
are quietly wrong.

```js
// vite.config.js
export default {
  resolve: { dedupe: ['three'] },
};
```

Do not use an alias instead. Pointing `three` at a directory breaks the
`three/addons/*` subpath exports. The field layer asserts this at construction
(`src/lib/field/three-copy-guard.js`) so the failure is loud rather than silent,
but the fix is always bundler-side.

# The plants

Four cultivars so far, each a digital twin rather than a generic species: a
persistent structure driven by an **age** and a **day of year**, with a phenology
calendar built from cited real-world sources.

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

### 4. Look at real photographs before calling a plant done

This one is an instruction to whoever is doing the work, human or agent.

Before a plant is finished, **go and find photographs of that cultivar at that
age and that time of year, and compare.** Search for them then and there. Do not
work from memory of what a forsythia looks like, do not work from the model's own
earlier renders, and do not reason from the numbers in the profile — a plant can
have every measurement right and still be wrong in silhouette, organ density or
the way colour moves through a season, and those are exactly the things a
photograph settles and a spec sheet does not.

Render the candidate with

```bash
npm run dev &                       # the demo page the shot script drives
node scripts/shoot.mjs out.png "plant=forsythia&year=6&day=96" three-quarter
```

then compare silhouette, proportion, organ density, colour and stage. A render
that looks plausible but does not match the photograph is a bug.

The comparison is the point, not a paper trail: this repo does not collect
photographs or links to them. Images move, disappear and change licence, and a
stale URL is worse than none. What belongs in the cultivar profile is whatever
the looking _taught_ you — a corrected date, a revised colour, a habit that turned
out to arch further than assumed — recorded as an observation or a declared
assumption under rule 3.

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

The budget has a second half, at field scale: **a field of plants is a handful
of draw calls too, and the number does not grow with the number of plants.**

- Two plants of a species share every seed-independent geometry, and their bark
  material, through a cache that owns them (`src/lib/shared-resources.js`).
  Foliage materials are deliberately _not_ shared: a plant repaints its leaves
  as the day changes, and two plants sharing one would drag each other through
  the seasons.
- Shadows are their own budget. The shadow pass is a second traversal, so it
  coarsens on its own ladder: the near band casts everything, the middle bands
  keep only the woody silhouette, the far band casts nothing. That holds for a
  single plant. **The field does not carry it** — `PlantField` pools each organ
  kind into one mesh across every band, so the ladder has nowhere to live and
  only the wood gets an `addShadowLOD`.
- The optional field layer draws hundreds of plants in one instanced mesh per
  organ kind. See [Fields](#fields).

### 6. Stay on EZ-Tree; diverge only where morphology forces it

This repo is a fork. Shared machinery — woody geometry and axes, bark and leaf
materials, leaf cards, wind, instance pools, LOD, detail levels, RNG — is reused,
extended or generalised in place. Write plant-specific code only for what a
species genuinely does differently. `PlantRenderer` owns everything common; a
plant subclass implements only `_buildStableGraph`, `_applySnapshot` and
`_evaluate`. Where a plant's morphology has no use for part of the base — a
grass has no wood, so Miscanthus uses instanced vertex-coloured organ geometry
instead of bark and leaf cards — it simply declares fewer organ kinds. Nothing
in the library branches on which plant it is holding.

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

The field layer is arranged the same way: `@three.ez/instanced-mesh` is an
optional peer, reachable only through `src/lib/field/`, and the dependency arrow
points **field → plant, never plant → field**. That is what keeps `three` the
only dependency an extracted plant needs.

### 9. Every LOD band has a triangle budget, and the numbers are EZ-Tree's

Budget: **25,000 triangles at band 0, 10,000 at band 1, 5,000 at band 2** — drawn
as wood + leaves + one feature organ at band 0, and wood + leaves after that.

The numbers are measured, not invented. `Tree.defaultLODLevels` in
`src/lib/tree.js` states a contract — _"LOD1 is roughly 40% of the full triangle
count, LOD2 roughly 20%"_ — and across all fifteen presets EZ-Tree hits it: 40%
and 20% on the mean, with the heaviest tree in the set at 22,566 / 9,240 / 5,364
triangles and exactly **two draws at every level, forever**. A cultivated shrub
is not a more complex object than an oak, so that ladder is the bar.

- The draw budget is a design constraint, not a performance fix. At field scale
  draws are pooled per organ kind across every plant of a species, and the
  handful the field uses is nowhere near a bottleneck. It matters because the
  geometry that leaves with a dropped kind is what actually costs.
- Past band 0 a plant is wood and foliage. A feature organ — a panicle, a
  raceme, a truss — has to be carried by the leaf card or baked into the
  silhouette, exactly as EZ-Tree drops a leaf to a single billboard at LOD2.
- When a band is over budget, **merge kinds before dropping them**. Three blade
  kinds that differ only in posture are one kind with three transforms; a
  petiole belongs in the leaf card, not in a mesh of its own.
- Reducing organ _count_ is not the same as reducing organ _geometry_, and for
  a plant whose cost is in its flowers only the second one pays. Heads cannot be
  thinned — they are the cultivar — so `organLevel` gives an organ kind a
  ladder of geometries and lets the band pick a rung. A hydrangea head is 68
  floret cards at band 0, 30 at band 1 and 14 at band 2, growing as they thin so
  the cone stays clothed.
- **Fuzz is a texture, not geometry.** Hair, silk and dense small florets are
  the worst case for triangles and the best case for alpha: sub-pixel at any
  sane distance, so they alias into a crawling sparkle and cost a triangle each
  to do it. Miscanthus spent 145,656 triangles a clump on hair and spikelets;
  as a plate it is 136 per head. A plume also wants
  `material.alphaToCoverage`, because a plain alpha test has no middle — every
  pixel comes out solid or gone, and a feathery whisk turns into blunt fingers.
- `landmarkStride` is the lever for leafy wood, and usually the largest one. A
  woody tube's ring count is set by the organs attached to it, not by its own
  curve: hydrangea carries 1,260 attachment landmarks against 780 sections, so
  `sectionStride` alone bottoms out almost immediately. Thinning the landmarks
  alongside the organs they anchor took its band-2 wood from 7,041 triangles to
  2,433, with no visible change to a single twig.

**`test/geometry-budget.test.js` enforces this, and is the file to read before
touching plant geometry.** It is a ratchet rather than a plain assertion,
because the library did not start inside this budget and a test that failed the
whole suite on day one would be skipped within a week:

- A plant already recorded there may not get worse. Progress locks in as it is
  made, and the numbers only ever move down.
- A plant _not_ recorded there is held to the full budget immediately — a plant
  added tomorrow is inside it on the day it lands, or it fails the build.
- A plant that got cheaper without its record being lowered also fails, so a win
  cannot be silently given back.

Lower a plant's recorded entry in the same commit that earns it. The failure
message prints the numbers to paste.

## Where the library stands today

Measured against the rules above (`npm test`):

| Rule                      | State                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — two parameters        | Held. Age and day are the only plant parameters; `scenario` is gone and every plant is unconditionally maintained. The calendar selector and `offsetDays` compose the calendar that `dayOfYear` is read against — they place the calendar, not the plant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2 — curated               | Held, and now structural: a looked-after plant is the only plant the model can produce.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3 — botany as spec        | Held. All four are cultivar-level with cited sources and separately labelled assumptions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4 — photo comparison      | A standing working practice, not a repo artifact: it asks whoever builds a plant to go and look at photographs first. `scripts/shoot.mjs` renders the comparison shot. Nothing to audit here by design — the rule is satisfied while the plant is being built, or not at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5 — fast                  | Draw calls held and enforced: `test/draw-call-budget.test.js` holds every plant to one draw per organ kind plus one for the wood, and `test/plant-field.test.js` pins that field draws do not move between 10, 100 and 400 plants. The shadow clause holds for a single plant (`test/plant-shadow-lod.test.js`) but is **not** carried into the field, where organ kinds are pooled across bands and only the wood gets a shadow LOD.                                                                                                                                                                                                                                                                                                                                                    |
| 6 — stay on EZ-Tree       | Held. All four plants extend `PlantRenderer` and add only their own morphology; nothing in `src/lib/` imports from `src/app/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7 — self-contained folder | Held. No plant imports another — the shared calendar lives in `src/lib/calendar.js`. Each shrub carries its own `leaf.webp` and loads it itself; bark is generated in `src/lib/bark-plate.js` and shared, since no plant owns it. All four models are Three.js-free and their snapshots survive a JSON round-trip. `npm run plant:add` copies a plant that renders textured standing alone, with `three` as its only dependency.                                                                                                                                                                                                                                                                                                                                                         |
| 8 — two front doors       | Held. All four plants ship a three.js class and an R3F component with matching props.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 9 — band budgets          | Held in full on blackcurrant, and for triangles on hydrangea and miscanthus; not yet on forsythia. `test/geometry-budget.test.js` holds the current cost of every plant at every band and forbids it growing; read that file for where each plant actually stands, and lower its entry in the commit that earns it. What remains is forsythia, which has not been through the same pass: it spends 74,400 triangles and a draw on petioles that belong in its leaf card, and 71,228 on wood that has never seen `landmarkStride`. The draw gaps on hydrangea and miscanthus are both structural rather than costly — a head that rule 9 says should ride in the leaf card but has no atlas to ride in, and a grass's culms, which cannot be dropped without leaving its plumes floating. |

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

`three` is the only dependency an extracted plant needs, and that includes the
field layer: it is opt-in, lives outside every plant's import graph, and
`test/field-instancing.test.js` fails the build if a renderer ever reaches it.
`test/plant-extraction.test.js` extracts into a fresh directory and renders the
result, so a reintroduced cross-plant import fails the build too.

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
});
scene.add(bush);

// Scrub through time — the plant is updated in place, never rebuilt.
bush.setTime({ ageYears: 12, dayOfYear: 200 });

// Choose a level of detail whenever you want to. Nothing does it for you.
bush.setLevel(1);

// Per frame — wind only, no camera.
bush.update(delta, elapsed);

// When done
bush.dispose();
```

At day 230 the Hydrangea is fully leafed and its terminal panicles are near the
cream-white peak. Day 30 instead shows bare framework with last season's dry tan heads;
they are removed through the modeled spring pruning window.

## Levels of detail

Every plant publishes the levels it can be drawn at, and **you choose which one
to draw**:

```js
plant.lodLevels; // 3 levels, each with a suggested distance
plant.setLevel(2); // draw the coarsest
```

That is the whole contract. **The library never reads a camera**, never measures
a distance, and never changes a level on its own. An application knows things a
library cannot — whether the plant is behind the viewer, whether this is a
thumbnail or a hero shot, whether it is rendering for print at ten times screen
resolution, what the frame budget looks like right now — and any of those can
matter more than metres.

The suggested distances are still worth publishing, because the library does
know roughly where each level stops looking right for a plant of that size.
They are advice, as data:

```js
new Forsythia().lodLevels.map((level) => level.distance); // [0, 7, 12]
```

If metres are the basis you want, `PlantLODController` turns one into a level
index. It is opt-in — nothing in the library constructs one — and it exists
only because hysteresis is fiddly: without it a plant sitting on a boundary
flips level every frame, and the remesh that follows is expensive and the
flicker is visible.

```js
import { PlantLODController } from '@detoix/ez-plants';

const lod = new PlantLODController({ levels: plant.lodLevels });

function animate(delta, elapsed) {
  const distance = camera.position.distanceTo(plant.position);
  plant.setLevel(lod.levelFor(distance)); // your camera, your decision
  plant.update(delta, elapsed); // wind only
}
```

Levels remesh in place rather than retaining a copy of the plant per level, so
three levels cost one plant's memory. The trade is CPU on the switch, which is
the other reason to want hysteresis.

A plant's own levels are a default, not a ceiling — the distances that suit a
garden close-up are not the ones that suit a landscape:

```js
new Hydrangea({
  lodLevels: [
    { distance: 0 },
    { distance: 25, detail: { leafStride: 2, leafScale: 1.2 } },
    { distance: 90, detail: { sectionStride: 4, leafStride: 6 } },
  ],
});
```

Each level may state a `shadowCast` of `'all'`, `'wood'` or `'none'`. Left
unset — the normal case — it is derived from the level's position: finest casts
everything, coarsest casts nothing, the ones between keep only the woody
silhouette. `stats().shadowDrawCalls` and `stats().shadowTriangles` report what
that costs.

(`Tree` is the exception, and an inherited one: `generateLODs()` builds a
`THREE.LOD`, which three.js drives from the camera itself. See
[Levels of Detail (LODs)](#levels-of-detail-lods) under Tree generator.)

## Fields

For hundreds of plants rather than one, there is an opt-in field renderer. It is
the only part of the library that depends on `@three.ez/instanced-mesh`, which is
an optional peer — **install it, and deduplicate `three`, or per-instance
transforms silently stop reaching the shader.** See
[Installation](#installation).

```js
import { Forsythia } from '@detoix/ez-plants';
import { createPrototypePool, PlantField } from '@detoix/ez-plants/field';

// A pool of seeds. Wood depends on the seed, so a field takes its variety from
// a handful of distinct skeletons plus per-placement yaw and scale — not from
// a unique plant per position.
const seeds = [1, 2, 3, 4].map(
  (seed) => new Forsythia({ seed, ageYears: 6, dayOfYear: 200 }),
);
const prototypes = createPrototypePool(seeds);

const field = new PlantField({
  prototypes,
  placements: positions.map((position) => ({
    position,
    rotationY: Math.random() * Math.PI * 2,
    scale: 0.9 + Math.random() * 0.2,
    level: 0, // your choice, per plant
  })),
  renderer, // pass it: without one, nothing draws on the first frame
});
scene.add(field);

field.setLevels(levels); // one index per placement, whenever you decide
field.update(delta, elapsed); // wind only — no camera here either
```

**Keep the prototype plants alive.** A field draws their materials, and the wind
lives on those materials' compiled shaders. Dispose in order — field,
prototypes, then plants.

Two families, two strategies, because they want opposite answers:

- **Organs** are one instanced mesh for the whole field, spanning every level.
  Organ LOD here does not simplify geometry, it draws fewer organs, so a fine
  plant and a coarse one share a buffer and a draw call.
- **Wood** is one mesh per prototype with real geometry LODs, because the
  buffers genuinely differ between levels.

Draw calls do not grow with the number of plants:

| Plants | Draw calls |
| ------ | ---------- |
| 10     | 7          |
| 100    | 7          |
| 400    | 7          |

### Changing a level costs one plant

`setLevels` and `setLevelAt` write only the placements whose level actually
changed, and a placement costs its own organs. That is what makes it safe to
drive levels from a camera in a render loop: a plant crossing a band boundary
does not stall the frame, however large the field is around it.

| Plants | Organ instances | One plant changes band |
| ------ | --------------- | ---------------------- |
| 20     | 26,733          | 0.9 ms                 |
| 120    | 147,968         | 0.9 ms                 |
| 480    | 584,528         | 0.9 ms                 |

`stats().instanceWrites` is the number to watch if it ever stops being true — it
counts organ instances written since the field was built, and should track the
plants that moved band rather than the size of the field.

The trade is slack. A demotion frees more slots than the coarser band takes
back, and instanced buffers only shorten from the tail, so they settle at the
high-water mark of the finest arrangement the field has ever drawn. Nothing is
rendered there, but the per-frame culling pass still steps over it:

```js
field.stats(); // { slots: 436_000, unusedSlots: 158_765, ... }
field.compact(); // reclaims it, by rewriting every placement
```

`compact()` is the old whole-field cost by another name — 58 ms for 120
hydrangeas — so call it when a pause is acceptable, never inside a render loop.

### The budget is advice, not a governor

`budget` is the number of organ instances you expect to afford. If the levels
you chose need more, **the field draws them anyway** and says so:

```js
field.stats();
// { organInstances: 812_400, budget: 500_000, overBudget: true, ... }
```

Nothing is coarsened, nothing is dropped. Silently overruling a level you asked
for would put the library back in charge of a decision that is yours; reporting
it leaves you the choice of raising the budget, coarsening some plants, or
placing fewer.

Worth knowing when you size it: a mature Forsythia still draws around 2,100
organ instances at its **coarsest** level, because that level coarsens the wood
but keeps every surviving leaf as real geometry. Hydrangea is heavier still. A
large field is therefore expensive however you set this, until the coarsest
level becomes a card rather than a canopy — an impostor, which the library does
not have yet.

## React Three Fiber usage

```tsx
import { Canvas } from '@react-three/fiber';
import { Hydrangea, type HydrangeaStats } from '@detoix/ez-plants/react';

<Canvas>
  <Hydrangea
    ageYears={6}
    dayOfYear={230}
    seasonProfile="late"
    level={0}
    onStats={(stats: HydrangeaStats) => console.log(stats.phenology.stage)}
  />
</Canvas>;
```

`level` is the same decision as `setLevel` on the imperative side, and it is
just as much yours: the component reads no camera either. If you want
distance-driven detail, compute it in your own component — R3F hands you the
camera in `useFrame` — and pass the result down.

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

# Tree generator

The procedural tree generator inherited from EZ-Tree, unchanged. Trees are a
separate thing from the garden plants above: they take a `TreeOptions` bag rather
than an age and a day, and they are not cultivar-level. Dan Greenheck hosts the
original tree app at <https://eztree.dev>.

## Generating a tree

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

## Tree parameters

The `TreeOptions` class defines an options object that controls various parameters of a procedurally generated tree. Each property of this object allows for customization of the tree's appearance, including bark, branches, and leaves. Below is a detailed explanation of each property of the `TreeOptions` object.

### General Properties

- **`seed`**: Sets the initial value for random generation, ensuring consistent tree generation when using the same seed.
- **`type`**: Defines the type of the tree, which can be set to one of the options from the `TreeType` enumeration (e.g., `TreeType.Deciduous`).

### Bark Parameters

The `bark` object controls the appearance and properties of the tree trunk.

- **`type`**: Optional informational identifier for the bark asset. The core library does not resolve texture names.
- **`tint`**: Determines the color tint applied to the bark, defined as a hexadecimal color value (e.g., `0xffffff` for white).
- **`flatShading`**: Boolean property indicating whether to use flat shading (`true`) or smooth shading (`false`) for the bark.
- **`textured`**: Boolean value that indicates if a texture is applied to the bark (`true` or `false`).
- **`maps`**: Caller-supplied `THREE.Texture` objects in `{ color, ao, normal, roughness }`. No textures are bundled with the library.
- **`textureScale`**: Controls the scale of the bark texture in both the `x` and `y` axes. It is an object with properties `x` and `y` to define the scaling factors.

### Branch Parameters

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

### Leaf Parameters

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

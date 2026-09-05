# Working in this repo

## Running the demos in a browser

```bash
npx vite --config vite.app.config.js --port 5177 --strictPort
```

`/` is the single-plant review page. `/field` is the mixed field page and
`/bed` is the ornamental bed. Both use WebGPU and need a secure context: use
localhost or HTTPS, not a plain HTTP LAN/Tailscale-IP URL.

All three pages support touch. The field uses a left-side floating thumbstick
and a right-side look drag because pointer lock and WASD are unavailable on
phones; the bed uses one-finger orbit and two-finger pinch. A desktop
screenshot does not exercise either path.

The field HUD reports frame time, adapter, GPU memory, persistent lawn counts,
and aggregate plant-field culling/LOD statistics. CPU tests do not measure any
of those GPU costs.

## Field architecture

The field uses one Three.js/WebGPU runtime. Its camera-centred lawn lives under
`src/app/grass-webgpu/`: persistent storage buffers, GPU placement/culling,
distance thinning, three indirect LOD draws, and a CC0 Grass004 PBR underlay.
Read `src/app/grass-webgpu/README.md` before changing it. Texture provenance,
hashes, and optimization commands are recorded in
`src/app/grass-webgpu/assets/grass004/README.md`.

The plants use `@detoix/ez-plants/field/webgpu` and the packed
`@detoix/instanced-mesh/webgpu` backend. The application distributes a
deterministic 400-plant mix across all nine shipped species, including Thuja,
with a three-prototype pool by default. Frustum culling is the
backend's: it tests every organ and wood instance in a compute pass, so the
field is built with `perInstanceCulling: true`. Wood is culled against the
prototype's full bounds rather than its own branch bound, which is what makes
testing it per instance safe. `FieldViewDriver` no longer hides anything; it
still decides which plants are on screen, so its per-frame LOD budget is spent
on plants somebody can see. Wood consumes the field's already-applied band as
per-instance state (`setLODOverrideAt`), so branches and organs cross an LOD
boundary together without a per-instance JavaScript callback. Query dials are `count`,
`day`, `prototypes`, `budget`, `lod`, `wind`, `shadows`, `pixelratio`,
`terrain`, and `underlay`.

`src/lib/field/plant-material-webgpu.js` is the authoritative conversion
boundary for known plant shader behavior. It ports leaf wind and authored
back-face normals to TSL while the backend still rejects unknown GLSL hooks.
Do not strip plant effects in the application to make a material pass.

## The bed

`/bed` is the presentation page: one designed planting, filmed, rather than a
field measured. It shares the WebGPU runtime, the CC0 lawn surface and the
`PlantField` backend with `/field` and nothing else -- separate layout, camera,
props and page.

`src/app/bed-layout.js` is the dependency-free planting contract, read by the
plant fields, the mulch and edging geometry, the camera framing and the tests.
It scatters nothing. Species sit in concentric bands measured as metres in
from the outline: lavender at the edging, fountain grass behind it, hydrangeas
holding the middle. Because the camera orbits there is no front to hide
behind, which is why the tallest plant is in the centre rather than at the
back.

Three things in that module are load-bearing and were each wrong in the first
build:

- **Depth is measured to the outline polygon, not to the polar radius.** On a
  kidney those disagree by most of a metre across the notch, which puts the
  band boundaries in the wrong place.
- **The outline is recentred on its own area.** The harmonics that make the
  kidney a kidney also push its centre of area two thirds of a metre off the
  origin, which drifts the hydrangea core to one flank and makes the mulch
  wider on one side. `CENTRE_FRACTION` subtracts it; the cobble edging must
  therefore offset along each segment's own normal, never along a radius.
- **`footprint` is what the plant occupies at the age this page grows it to**,
  not its mature spread. Packing on mature figures leaves mulch showing
  between every clump, and the bed is meant to be full.

The boulders live in the layout, not in `bed-props.js`, because they occupy
ground: the band fill rejects candidates against them, which is what stops a
lavender growing through a stone.

`src/app/bed-props.js` builds the mulch, cobble edging and boulders in
`three/webgpu` and generates the mulch texture as seeded value-noise fBm. That
is deliberate: it is read at a metre under planting, and another CC0 texture
set would cost more in download and provenance bookkeeping than it buys. The
lawn keeps its Grass004 PBR set.

`/bed` runs the same `createGPUDrivenGrass` as the field, on a flat height
bake, and cuts the bed out of it with `createGPUDrivenGrass({ keepAt })`. The
grass rings are camera-centred and place blades from a world-space hash that
knows nothing about the planting, so without that mask they grow straight up
through the mulch and the cobbles.

`keepAt` is optional and tested in the culling pass, not baked into a placement
record: the six record words are full, and stealing precision from the blade
width channel to store one bit would change a packing contract the whole field
depends on. A caller that passes none builds no node, so `/field` generates the
shader it always did.

`bed-lawn-mask.js` holds the TSL form and evaluates the kidney with no trig at
all -- normalizing the vector gives sin and cos, and the angle-sum identities
turn both harmonics into multiplies, about fifteen ALU ops against the six
plane dot products the pass already pays. `bedKeepsLawnAt` in `bed-layout.js`
is its scalar twin and `test/bed-lawn-mask.test.js` holds the two to the same
answer against the outline polygon. `BED_SHAPE` exists so the curve's
coefficients are written once: the shader, `bedRadiusAt` and the centre-of-area
integral all read them, and a literal edited in one place used to move the bed
out from under its own grass.

Age and day-of-year are continuous sliders, because scrubbing them is what
this library is for -- the single-plant page has had both from the start, and a
bed that only offered six preset dates was hiding the feature, not simplifying
it. Both are fixed when a plant is built, so neither can be animated per frame:
the sliders commit on `change` rather than `input`, which is one rebuild per
drag when the handle is released, and read back on `input` so the labels stay
live meanwhile. `bed-plants.js` keeps the six most recent `age:day` states,
prototypes included; since those are CPU bakes and only `PlantField` owns GPU
buffers, returning to a held state rebuilds three fields and regrows no
geometry. `BED_SEASON_MARKS` are tick marks on the day slider, not a menu. The
default is day 212 because it is the one date all three species are showing;
day 230 reads well on paper and falls four days after the lavender is sheared,
so it opens on stubble.

`BED_DEFAULT_LOD_SCALE` is 4 and is not cosmetic. The shipped ladders are tuned
for walking a field -- a lavender drops to its coarsest band past 3.5 m -- and
this camera sits at 13 m, so unscaled the whole skirt renders at level 2. It
was measured at 33 of 33 lavenders on the coarsest band before the scale was
added.

The camera is `bed-orbit.js`, not the field's walk controls: it drifts on its
own so the page can be left running and screen-captured, and a drag interrupts
it. Query dials are `age`, `day`, `prototypes`, `budget`, `lod`, `wind`,
`shadows`, `orbit`, `pixelratio` and `ui`; the two sliders write `age` and
`day` back into the URL, so a framing is a link. `?ui=0` hides the panel for recording. There is no `terrain` dial -- a
designed bed on a hillside is a different bed.

## Seeing the plants on this laptop

The Radeon HD 6770M is pre-GCN, so the `gpu-browser` tool reaches WebGPU only
through Dawn's OpenGLES adapter at the **compatibility** feature level, which
reports `maxStorageBuffersInVertexStage: 0`. The
`@detoix/instanced-mesh/webgpu` backend is storage-buffer instancing, so under
`webgpu: true` every plant pipeline fails to create:

```
number of storage buffers used in vertex stage (2) exceeds
maxStorageBuffersInVertexStage (0)
```

`/field` fails identically. Terrain, lawn, mulch, edging and boulders
render fine; the plants sit in the scene, visible, with correct instance
counts, and rasterize nothing.

There is a way to see them. Launch Playwright's Chromium **without**
`webgpu: true` -- so without `--use-webgpu-adapter=opengles` and without the
compatibility init script -- and Chrome falls back to SwiftShader, which is a
core device reporting `maxStorageBuffersInVertexStage: 10`:

```js
launchGpuBrowser({ channel: 'chromium', args: ['--enable-unsafe-webgpu'] });
```

The whole bed then renders with zero validation errors. It is a software
rasterizer, so every timing from it is meaningless and `assertWebGpu` will
correctly refuse it -- use it to look at a composition, never to measure one.
Expect tens of seconds per frame with the bed on its finest LOD, and raise the
screenshot timeout accordingly.

## Terrain and lawn surface

`src/app/field-terrain-height.js` owns the dependency-free height function.
The terrain mesh, plant scatter, walker's eye, and GPU height texture all read
that scalar contract. `?terrain=flat` restores a flat control field.

The `lawn` underlay uses optimized ambientCG Grass004 albedo/roughness and
normal maps in world space. `?underlay=solid` switches to the allocation-stable
control material; it does not recreate the terrain, textures, or grass grids.
The maintained grass blades have no wind deformation. That is independent of
the plant `wind` query, which must retain the requested plant behavior.

## Tests

`npm test` runs `node --test`. These tests protect CPU contracts: deterministic
scatter and bed planting, terrain agreement, storage layout, snapping, density,
material gates, field-stat aggregation, and resource disposal. They do not execute WebGPU
compute shaders or indirect draws. A production build checks bundling, not GPU
shader execution; final verification still needs a hardware-WebGPU browser.

## Plant geometry budgets

Library rule 9 in the README sets a per-band triangle and draw budget, taken
from EZ-Tree's measured LOD ladder. `test/geometry-budget.test.js` enforces it
as a ratchet: recorded plants may only shrink, unrecorded plants must meet the
target immediately. Read it before changing plant geometry, and lower a
plant's recorded entry in the same commit that earns it.

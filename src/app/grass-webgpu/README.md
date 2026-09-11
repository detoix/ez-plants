# GPU-driven lawn

This is the lawn rendered by `/field`, alongside the nine-species WebGPU plant
field. Storage buffers, compute atomics, distance thinning and indirect draws
all run through the same Three.js `WebGPURenderer` as the plants. The small
entry module loads this runtime only after its capability gate succeeds.

It requires a browser with WebGPU in a
[secure context](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API).
`localhost` is secure; an ordinary `http://` LAN-IP URL is not.
Unsupported browsers get an explanation. There is intentionally no WebGL
fallback whose performance would mean something different.

## Data flow

```text
three persistent camera-centred grids (near / mid / far)
                ↓ only after a grid crosses its own cell boundary
snapped integer world cells → deterministic placement + terrain sampling
                           + one shared lawn-macro sample per candidate
                           + one patch-scale health sample per candidate
                           + one 3x3 Voronoi clump search per candidate
                ↓ every frame
reset three indirect instance counts
                ↓
GPU ring ownership + distance thinning + strict frustum test
                ↓ atomic append
three fixed visible-ID buffers
                ↓
three drawIndirect calls (one blade geometry per distance band)
```

Nothing is allocated, destroyed or repacked as the camera moves. Each slot is
always the same slot in the same GPU buffers. Snapping changes only a ring's
two-number origin uniform; placement is recomputed into that persistent buffer
when the snapped cell changes. Integer world coordinates seed all jitter,
height, width, yaw and thinning values, so leaving a location and returning to
it reconstructs the same lawn.

| Ring | Distance | Candidate spacing | Fixed slots | Blade segments | Base target density |
| ---- | -------- | ----------------- | ----------- | -------------- | ------------------- |
| near | 0–8 m    | 2.5 cm            | 412,164     | 3              | 1,600 → 177.78 /m²  |
| mid  | 8–24 m   | 7.5 cm            | 412,164     | 2              | 177.78 → 25 /m²     |
| far  | 24–52 m  | 20 cm             | 272,484     | 1              | 25 → 0 /m²          |

A candidate is a **crown**, not a blade. Each one grows `LAWN.tillers` blades,
so the blade densities are that multiple of the table's, while slots, records,
placement work and culling work are all per crown and unchanged by it. The
multiplier is deliberately the same on every ring: the bands hand over at
matched densities, and tillering one harder than its neighbour would put a
visible step at 8 m or 24 m. A tiller stands off the crown centre, fans off its
facing and may be shorter than it, all from the crown's own hash, so the tuft
is as reproducible as the crown.

The three rings contain 1,096,812 fixed candidate slots. Their packed 28-byte
placement records and 4-byte compacted visible IDs use about 33.5 MiB of
typed-array data on the CPU and the same amount of storage on the GPU, before
renderer overhead. The original 48-byte float record used 54.4 MiB together
with those IDs, so packing removes 20.9 MiB (38.5%) from each side.
Density falls continuously inside every band. A world-space lawn signal scales
that base density by 0.78–1.0, using the same value that tints the terrain and
blades. Ring ownership is exclusive, the boundary densities match, and the far
ring reaches zero, so real blade geometry changes LOD and then hands off to the
textured terrain without a density step or a hard outer edge.

The culling compute pass tests each retained blade's conservative bounding
sphere against the six normalized frustum planes, avoiding centreline-only
edge pops. Only appended IDs reach the vertex shader, and each indirect
instance count is the corresponding append counter. Ordinary camera rotation
does not rerun placement; it only resets, culls/compacts and draws.

## Terrain, motion and shadows

The lawn and plants use the field's scalar `terrainHeightAt()` contract. The
runtime bakes a 1,024 × 1,024 R16 height texture, samples height and
central-difference normal during placement compute, and builds the terrain
geometry from the same scalar function.

The flat horizon plane sits below the deepest possible displaced hollow. It
must not sit only a few centimetres below zero: that covers negative parts of
the terrain and makes the horizon material look like holes in the lawn.

## Lawn underlay and the A/B control

The default `lawn` underlay is a terrain shading layer beneath the real blades,
not a texture pasted onto every blade. It uses optimized derivatives of
[ambientCG Grass 004](https://ambientcg.com/a/Grass004), a seamless short-lawn
PBR material with a documented 1.4 m physical width:

- one 1,024² WebP packs sRGB albedo in RGB and coarse linear roughness in alpha;
- one 512² 4:4:4 JPEG carries the OpenGL tangent-space normal;
- both repeat in world-space XZ, use trilinear mip filtering and up to 8×
  anisotropy;
- a rotated, offset, non-harmonic second sample is blended with the first to
  break the obvious 1.4 m repeat. Its tangent normal is rotated back into the
  primary frame before blending;
- normal strength fades from 8–24 m, where sub-pixel micro-relief would alias,
  while the albedo/roughness texture remains the far-field grass representation.

The two encoded maps total 615,023 bytes (about 600.6 KiB). Their complete
RGBA8 mip chains occupy 6,990,504 bytes (about 6.7 MiB) on the GPU. Roughness is
packed because it does not warrant an additional texture allocation or sample.
Displacement and AO are deliberately omitted: material displacement would
diverge from the scalar terrain used by walking, blade roots and shadows, while
the dense real blade layer already supplies the relevant large-scale occlusion.

A deliberately coarse sample of the same Grass004 albedo supplies the shared
world-space lawn signal. Placement compute stores it once in the packed
appearance word; culling uses it for deterministic density variation, and both
terrain and blade materials use it for tint. No map is sampled in grass
fragments, no storage buffer grows, and no grass resource is allocated or
discarded as the camera moves.

Each candidate record is seven `u32` words. World X/Z keep their exact `f32` bit
patterns. Ground/blade height, upper-hemisphere terrain normal X/Z, yaw/width,
tint and macro variation use normalized 16- or 8-bit fields. The 16-bit
retention value uses midpoint decoding, so quantization cannot create a blade
cohort that survives a zero-density boundary. Core WGSL pack/unpack operations
provide this layout without requesting optional native `f16` shader storage.

The HUD switches live between `PBR lawn` and the original `Solid control`.
Both materials and both textures remain allocated; switching changes only the
terrain's material reference. It does not recreate a mesh, material, texture,
candidate record or visible-ID buffer, and the blades stay identical so the A/B
isolates the terrain surface. Use
`?underlay=solid` for a repeatable control URL; `?underlay=lawn` and an omitted
parameter both select the default. Reload each URL before timing so one-time
pipeline compilation is outside the comparison.

## What placement computes, and why it is not the vertex stage

A crown's clump, its patch health, its terrain normal and its macro sample are
all functions of one thing: where the crown stands. Placement decides that and
then never changes it, so all four are computed there, once, and packed into
the record.

The clump is the one that was not. `clumpAt()` is a 3x3 Voronoi search -- a
clump point is jittered anywhere inside its own cell, so the nearest one to a
crown near a corner can be in any of the eight cells around it, and a 2x2
search picks the wrong clump along two of the four edges. That search used to
run in `material.positionNode`, which is per _vertex_: a near crown draws three
tillers of three segments, 15 vertices each, and every one of those 45 vertices
searched nine cells for the same angle and the same scale. 405 hash-and-compare
sequences per visible near crown, 243 in the mid ring, 81 in the far one.

It now runs once per crown and costs four bytes of record, which is the whole
trade. Two things make those four bytes cost exactly four:

- The word is full: 16 bits of clump heading, 8 of clump shortening, 8 of
  health. The heading gets the wide field because every crown in a clump reads
  it, and a byte of angle steps 1.4 degrees -- enough to land whole patches of
  lawn on the same heading and grow a visible grain across open ground. How
  much of that grain survives is `LAWN.clumpPull`, which is a _weight_ on the
  clump's heading against the crown's own and not a replacement for it: see
  below.
- World X and Z are two scalar `u32` fields and not the `uvec2` they read as.
  WGSL rounds an array's stride up to its element's alignment, and a `uvec2`
  aligns to eight bytes: with the pair in it, six words of fields stride at six
  but seven stride at **eight**. The padding word is silent -- nothing reports
  it but `getLength()` -- so the seventh word would have cost 8.4 MiB across
  the three rings rather than 4.2.
  `test/field-webgpu-record.test.js` holds both layouts side by side.

Placement runs only when a ring's snapped origin changes, so this moved work
off every frame and onto a cell crossing. It did not make placement free: a
near-ring snap now runs the Voronoi search and a second texture sample across
all 412,164 candidates, and the near ring snaps every 2.5 cm of movement.
Reducing that is a separate change -- the grid would have to update the
incoming row and column rather than its whole area -- and it is not done here.

## Grounding and variation

Two shading terms exist to stop the lawn reading as a plane of evenly lit
strips.

`LAWN.rootOcclusion` darkens the bottom `rootOcclusionHeight` of every blade.
Nothing in this lawn draws that occlusion -- blades cast no shadow-map
silhouette on purpose -- so it is asserted rather than computed. It multiplies
albedo rather than arriving through `aoNode`, which in a standard material
attenuates only indirect light: the occlusion being faked here takes the sun
out too.

Dry patches come from a second world-space signal, `surface.healthAt()`. It is
the same channel of the same map at the same mip as the macro signal, over a
161.3 m tile instead of a 31.7 m one -- so it is the same distribution at a
different scale, about 5 m a patch, and the 0.045-0.32 window stays valid
without re-measuring it against the asset. Placement stores it in the clump
word; the blade shades from it and **the terrain underneath reads the same
function**, through the same `dryAt`/`dryTintFrom` pair, so a dry patch is dry
all the way down rather than green turf standing on straw.

A blade's own hash only ever _modulates_ its patch -- `dryScatter` is a
multiplier on the patch value, never a signal of its own -- so a blade in
green turf multiplies zero and stays green however its hash fell. That is the
difference between correlated patches and independently yellow blades, and
`test/field-webgpu-blade-bounds.test.js` holds it.

A blade also passes light _through_ itself. `blade-lighting.js` adds that as a
real directional term in a `PhysicalLightingModel` subclass rather than as an
emissive rim, for one reason: the `lightColor` handed to `LightingModel.direct()`
has already been multiplied by the light's shadow node, so the term is
suppressed inside shadow for free. An emissive version would glow under a
tree, at night and on the shadowed side of a hill. It is strongest at the tip,
where the tissue is thin, and `LAWN.backscatterTip` is held above
`LAWN.rootOcclusionHeight` so the blade never lights up at the same height the
occlusion term just darkened.

**Ask the blade, not the camera.** The term shipped as
`pow(dot(-lightDirection, viewDirection), 4)` and nothing else, which is a
question about where the _camera_ is pointing. Under a directional sun both of
those vectors are shared by the whole lawn, so the answer was shared too:
turning the head lit or unlit every exposed tip on screen together, as one
coherent sheet, and the lawn changed character with yaw rather than with the
grass. It is gated on `-dot(normalView, lightDirection)` now -- is the light
arriving at the face of _this_ blade that the eye cannot see -- so a hundred
thousand headings average into a canopy instead of switching in step. Three
constants shape what gets through:

- `backscatterAbsorb` is Beer-Lambert over a path of thickness/cosine, which
  is what makes a blade edge-on to the sun dark rather than merely dim. Square
  on, a blade passes 0.78 of the coefficient; at 60 degrees, 0.30.
- `backscatterView` is how much of the term the old forward lobe still
  carries, at 0.4. Tissue does scatter forward, so a backlit blade really is
  brighter seen towards the light; the other 0.6 survives at any view angle,
  and that split is the whole difference between a material and a switch.
- `backscatter` is 0.7, up from 0.55, because the gate costs the term most of
  its range. The best-oriented blade now sees the 0.55 the _whole lawn_ used
  to see and the average one about a third of it.

`?backlight=off` is the A/B control. Note that both pages open looking away
from their own sun, where the _lobe_ is zero -- but the transmission no longer
is, which is the point of the change, so the A/B is worth running in both
framings now. Measured facing the sun on `/field` under the old view-only
term, it changed 10.7% of the frame, 72,926 pixels brighter against 27 darker,
none of them above the horizon.

**The palette is drawn around one hue, and that hue is measured.** Turfgrass
research scores lawn colour with the Dark Green Colour Index, whose hue
transform is `(H - 60) / 60` -- scaled so 60 degrees is the yellow end of a
lawn and 120 the deep-green end, with published thresholds for healthy turf
running 60-120. A reference photograph of a well-fed lawn measures **99
degrees** and holds it at every depth.

This page rendered at **75**, which scores 0.26 on that axis against the
photograph's 0.65. Three things stacked the same direction to get there, and
no single one of them was as yellow as the result:

- the blade greens were authored at 87-91 degrees,
- the Grass004 underlay is 72 -- olive, and it is the ground seen through
  every gap between blades,
- the sun is `#fff0cd`, and a warm light costs another 5 to 7 degrees on the
  way through.

`LAWN_TARGET_HUE` is therefore **105**, not 99: the albedo overshoots so the
_image_ lands on the target. Move the sun's colour and that number moves with
it. `lawnColorsFor()` rotates every green by the same delta -- so the few
degrees between root and tip survive -- and solves each one back to its exact
original linear luminance, because rotating a hue in HSV alone changes how
bright a colour reads and a lawn that got brighter would flatter itself for
the wrong reason. The underlay is a photograph and cannot be recoloured, so it
gets `groundTint`, a per-channel multiplier carrying the asset's own mean from
72 to the target at unchanged luminance.

`?lawnhue=86.7` returns the palette exactly as it was authored -- the dial is
lossless, and `test/field-webgpu-blade-bounds.test.js` holds it to that.

**How much neighbouring blades agree is a dial.** `LAWN.clumpPull` weights a
clump's heading against each crown's own, and it shipped at 1.2, where the
clump outvoted the crown: every crown in a 45 cm patch faced within a few
degrees of one heading, so the patch presented one shared normal and lit as a
sheet even under the stock lighting model. That grain is right for a meadow
and wrong for mown turf, which is cut from every direction and is close to
azimuthally isotropic. It is 0.3 now, with `LAWN.tillerFan` raised from 0.7 to
1 radian of spread so the crown's own four blades supply the variety the clump
used to. The clump keeps its other jobs either way -- `clumpShortest` and the
health signal are not routed through the heading.

`?clumppull=1.2&tillerfan=0.7` on `/field` restores the shipped pair, and
`?clumppull=0` makes every crown independent. A pull within
`CLUMP_PULL_MARGIN` of 1 is refused: a crown heading opposed to its clump's
sums to `|clumpPull - 1|`, and normalizing a zero vector has no answer, so
`createGPUDrivenGrass` throws and the dial steps over the band rather than
clamping into it.

There is no wind input, animation node or time-dependent blade deformation.
These are short maintained-lawn blades. They receive the directional light's
terrain shadow but do not cast individual blade shadows: at 4–8 cm, that extra
silhouette pass costs more than it contributes. The terrain itself casts and
receives shadows. Use `?shadows=off` to isolate the cost.

Other query controls are `?terrain=flat` (or a numeric amplitude),
`?shadows=off`, `?pixelratio=1`, the lawn's own `tillers`, `bendmin`,
`bendmax`, `clumppull`, `tillerfan`, `lawnhue`, `bladeheight` and
`bladewidth`, plus the mixed plant field's `count`,
`day`, `prototypes`, `budget`, `lod`, and `wind`. `?count=0` removes the plants
entirely, which is the control URL for timing or inspecting the lawn on its
own. The HUD reports the
asynchronously read-back visible counts, fixed candidate count, three indirect
grass draws, this-frame versus steady compute count, placements, aggregate
plant statistics, PBR transfer/GPU footprint, and the renderer's memory
estimate.

## Disposal

`createGPUDrivenGrass()` returns a `dispose()` that must free the storage
buffers itself, through `renderer._attributes.delete()`. That private field is
deliberate. `BufferAttribute.dispose()` in three r185 only dispatches an event,
and the sole listener in the WebGPU path is registered by `Geometries` on a
geometry, for that geometry's own attributes. The lawn's are not among them:
the placement records and visible IDs are bound as `storage()` nodes, and the
indirect draw commands arrive through `setIndirect()`, which
`Geometries.onDispose` does not touch either. `Attributes.delete()` is the same
call that listener makes -- it destroys the `GPUBuffer` and corrects
`renderer.info.memory`, which the HUD reports -- and there is no public
equivalent. `renderer.backend.destroyAttribute()` is not one: it skips the
memory accounting and throws for an attribute that was never uploaded.

Today the lawn is built once per page and torn down with the renderer, so the
buffers would be reclaimed with the device regardless. The cost of getting this
wrong appears the first time something rebuilds the lawn mid-session: 33.5 MiB
of storage per rebuild, held until the page closes, with the HUD's memory
estimate reporting the sum of every generation.

## Provenance

The architecture was informed by
[momentchan/false-earth](https://github.com/momentchan/false-earth), inspected at
commit `468a0cfd71698400103198a8eb91d5176fe4f59e`. The repository is MIT licensed.
This implementation is project-native vanilla three.js/TSL code: no source,
shader helper, asset or purchased model was copied. In particular, False
Earth's separately referenced `three-core` submodule was not vendored or used.

The lawn maps are optimized derivatives of ambientCG Grass 004. ambientCG
publishes the downloadable files under CC0 1.0 Universal and explicitly permits
modified redistribution and inclusion in a game. Source/archive hashes, runtime
hashes and the exact conversion commands are retained beside the maps in
[`assets/grass004/README.md`](assets/grass004/README.md).

The surface hybrid follows the same class of representation documented in
[Papavasiliou's real-time grass rendering paper](https://jcgt.org/published/0004/01/02/paper.pdf)
and the
[Ghost of Tsushima vegetation slides](https://media.gdcvault.com/GDC%2B2021/ghost_streaming_gdc2021.pdf):
real geometry near the viewer, deterministic thinning with distance, and a
terrain texture carrying the far-field lawn rather than submitting every blade.

False Earth demonstrated the important combination—camera-centred snapped
placement, compute culling, LOD buffers and indirect draws—but its sample keeps
a uniform candidate grid. This implementation adds deterministic, continuous
distance thinning and independent persistent clipmap-style rings to meet this
field's near-dense/far-sparse lawn requirement.

## Verification boundary

`test/field-webgpu-grid.test.js` verifies the CPU contract: fixed capacities,
stable state identity, snapping, deterministic return-to-place placement,
exclusive ring ownership, monotonic density and capability messages.
`test/field-webgpu-record.test.js` verifies the packed stride, exact storage
budget, height bounds, float-bit preservation, quantization error limits and
the `uvec2` alignment trap that would make the seven-word record stride at
eight. `test/field-webgpu-grid.test.js` also holds the blade vertex and
triangle counts the indirect draw commands and the HUD are both built from.
Those tests do not execute WebGPU. `test/field-webgpu-surface.test.js` verifies
the checked-in map hashes, byte/GPU budgets, texture configuration, failed-load
cleanup, resource-preserving mode switches, query parsing and backdrop
clearance. A production build checks bundling, not GPU shader execution.
Compute, indirect draws, node-material texture sampling, culling counts and
frame time still require inspection in a hardware-WebGPU browser.

Headless Chromium will do it, but **check which adapter you got before you
believe a number**. The default headless launch reports
`google · swiftshader` and renders the field at about 400 ms a frame, which is
a CPU rasteriser and not a measurement of anything. On this project's Linux
box, `--use-gl=angle --use-angle=vulkan` alongside `--enable-unsafe-webgpu` is
what produces `intel · gen-12lp`; `--use-angle=swiftshader` or omitting the
pair produces the software device. The HUD's `gpu` row is the check, and it is
worth reading on every run.

Two more cautions, both learned by getting them wrong:

- Frame time on an integrated GPU, on a machine in use, may not be resolvable
  at all. Repeated runs of one configuration here spread 42 to 56 fps, and in
  some of them a heavier setting beat a lighter one -- with the frame rate
  unlocked _and_ against vsync. Counts are exact and time is not: prefer the
  HUD's triangle, visible-crown and memory rows for any claim you intend to
  write down, and treat an fps figure from this box as a direction rather than
  a magnitude.
- Use `?count=0` to price the lawn on its own. With the plants in, the plant
  field's per-frame LOD budget adds variance of its own on top.

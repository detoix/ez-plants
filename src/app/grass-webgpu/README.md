# GPU-driven lawn

This is the lawn rendered by `/field`, alongside the seven-species WebGPU plant
field. Storage buffers, compute atomics, distance thinning and indirect draws
all run through the same Three.js `WebGPURenderer` as the plants. The small
entry module loads this runtime only after its capability gate succeeds.

It requires a browser with WebGPU in a
[secure context](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API).
`localhost` is secure; an ordinary `http://` LAN or Tailscale-IP URL is not.
Unsupported browsers get an explanation. There is intentionally no WebGL
fallback whose performance would mean something different.

## Data flow

```text
three persistent camera-centred grids (near / mid / far)
                ↓ only after a grid crosses its own cell boundary
snapped integer world cells → deterministic placement + terrain sampling
                           + one shared lawn-macro sample per candidate
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

The three rings contain 1,096,812 fixed candidate slots. Their packed 24-byte
placement records and 4-byte compacted visible IDs use about 29.3 MiB of
typed-array data on the CPU and the same amount of storage on the GPU, before
renderer overhead. The original 48-byte float record used 54.4 MiB together
with those IDs, so packing removes 25.1 MiB (46.2%) from each side.
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

Each candidate record is six `u32` words. World X/Z keep their exact `f32` bit
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

There is no wind input, animation node or time-dependent blade deformation.
These are short maintained-lawn blades. They receive the directional light's
terrain shadow but do not cast individual blade shadows: at 4–8 cm, that extra
silhouette pass costs more than it contributes. The terrain itself casts and
receives shadows. Use `?shadows=off` to isolate the cost.

Other query controls are `?terrain=flat` (or a numeric amplitude),
`?shadows=off`, `?pixelratio=1`, plus the mixed plant field's `count`, `day`,
`prototypes`, `budget`, `lod`, and `wind`. The HUD reports the
asynchronously read-back visible counts, fixed candidate count, three indirect
grass draws, this-frame versus steady compute count, placements, aggregate
plant statistics, PBR transfer/GPU footprint, and the renderer's memory
estimate.

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
budget, height bounds, float-bit preservation and quantization error limits.
Those tests do not execute WebGPU. `test/field-webgpu-surface.test.js` verifies
the checked-in map hashes, byte/GPU budgets, texture configuration, failed-load
cleanup, resource-preserving mode switches, query parsing and backdrop
clearance. A production build checks bundling, not GPU shader execution.
Compute, indirect draws, node-material texture sampling, culling counts and
frame time still require inspection in a hardware-WebGPU browser.

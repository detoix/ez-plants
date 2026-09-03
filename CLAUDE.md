# Working in this repo

## Running the demos in a browser

```bash
npx vite --config vite.app.config.js --port 5177 --strictPort
```

`/` is the single-plant review page. `/field` is the sole mixed field page and
uses WebGPU. It needs a secure context: use localhost or HTTPS, not a plain
HTTP LAN/Tailscale-IP URL.

Both pages support touch. The field uses a left-side floating thumbstick and a
right-side look drag because pointer lock and WASD are unavailable on phones.
A desktop screenshot does not exercise that path.

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
scatter, terrain agreement, storage layout, snapping, density, material gates,
field-stat aggregation, and resource disposal. They do not execute WebGPU
compute shaders or indirect draws. A production build checks bundling, not GPU
shader execution; final verification still needs a hardware-WebGPU browser.

## Plant geometry budgets

Library rule 9 in the README sets a per-band triangle and draw budget, taken
from EZ-Tree's measured LOD ladder. `test/geometry-budget.test.js` enforces it
as a ratchet: recorded plants may only shrink, unrecorded plants must meet the
target immediately. Read it before changing plant geometry, and lower a
plant's recorded entry in the same commit that earns it.

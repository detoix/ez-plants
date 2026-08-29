# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### The demo pages work on a phone

Both pages were built for a mouse and a wide window, and on a phone that showed.
The field walkaround had **no input at all** — its only controls were pointer
lock and WASD, neither of which exists on a touch screen, so the page loaded,
showed one fixed view of the garden and could not be moved. The review page put
a control panel over two thirds of a portrait screen before anything had been
asked of it, and framed the plant so that a shrub as wide as it is tall had its
outer canes cut off at both edges.

- **The field walks by thumb.** A floating thumbstick appears wherever a thumb
  lands on the left of the screen, and a drag anywhere else looks around; the
  stick is analogue, so half a tilt is half the speed and a full one runs.
  Which input is live follows what the visitor actually uses rather than a
  device sniff, so a touchscreen laptop keeps both — and pointer lock is now
  only offered to a real pointer, since asking for it from a tap either fails
  or swallows the drags the stick needs.
- **The field HUD folds.** On a small screen it is a one-line summary — frame
  rate and frame time, live — that opens on a tap. It was previously the whole
  readout, which on a phone is most of the screen and overflowed the bottom of
  it.
- **The review panel is a bottom sheet.** It starts peeked at its header, so
  the plant is the first thing on screen, and opens with a grab handle. Held
  sideways the same panel peeks from the right, because at 844 × 390 there is
  no more room for it open than there is upright.
- **The camera frames the plant for the viewport it is in.** The review poses
  were distances that fit the plant's height, which is also the tighter fit on
  anything wider than about 4:5 — so nothing changes on a desktop. Below that
  the shortfall in width is measured against the `front` pose and applied to
  all of them, which keeps `close-up` a close-up instead of quietly promoting
  it to the same shot. Upright, the frustum is also sheared to lift the plant
  clear of the sheet, so it stays watchable while the day is scrubbed.
- Sliders are 34 px tall rather than 16 on touch, the canvas no longer
  competes with pull-to-refresh, and the walk hint says what the gestures are
  instead of naming keys that are not there.

### Forsythia inside its geometry budget, with the display the photographs show

Library rule 9 gives a plant 25,000 / 10,000 / 5,000 triangles and 3 / 2 / 2
draws across its three LOD bands. 'Lynwood' was drawing 154,508 / 86,334 /
58,780 in four draws at every band on a summer day, and 392,330 at band 0 in
full bloom — **15.7× over**. It is now inside triangles and draws at every
band on every day of its year, worst case 24,774 / 8,752 / 4,804 at the
flowering peak, while carrying roughly three times the corollas it used to.

- **The corolla is a two-triangle alpha card.** It was a 66-triangle mesh —
  four twisted lobes on a floored tube — and 2,895 of them came to 191,070
  triangles for a flower 3.5 cm across. A four-armed star with wide gaps
  between its arms is the best case for alpha and the worst case for triangles,
  exactly as rule 9 says of dense small florets. A new `flower.webp`, generated
  by `scripts/make-flower-texture.mjs`, holds one corolla: deliberately
  off-quadrant lobes of unequal length, because every flower on the plant is
  cut from that one tile and a stamped cross is visible instantly.
- **More flowers, because the source says so.** Bean gives 1-6 flowers _per
  leaf-scar_; the model was reading that as a per-node total, and this species
  is opposite-leaved, so every node has two scars. Each scar now draws its own
  count, the weights moved toward the top of the sourced range, and node
  occupancy went up after a photo pass — a cane in full bloom flowers along
  essentially its whole length. Peak display goes from about 3,100 corollas to
  close to 11,000, and the branches read as the yellow ropes the references
  show rather than as dotted whips.
- **The petiole is painted into the leaf plate.** Not into the leaf card, the
  way hydrangea's is: this plant has 3,720 leaves and a 1 cm stalk, so two more
  triangles each would have been a third of the band-0 budget. The plate's
  bottom eighth is now the stalk and the card is rooted at the node, so the
  same two triangles draw both, and 74,400 triangles and a draw call are gone.
- **Seven organ kinds became four.** Pedicels were dropped — a 3-9 mm stalk
  standing directly behind the corolla hanging on it, meshed as a tube 3,280
  times. The dormant leaf buds and the swelling flower buds merged into one
  `buds` kind, since they are the same pointed teardrop at two sizes in two
  colours, and colour and size are per-instance values rather than meshes. A
  bud is now one triangle.
- **`woodOrderLimit`, a new LOD lever for twiggy wood.** Strides bottom out at
  two rings an axis, so a shrub whose wood cost is its branch count — 464 axes,
  309 of them short shoots — has a 7,086-triangle floor no stride reaches
  under, which is already over what band 2 is allowed in total. Bands 1 and 2
  stop meshing the short shoots and keep everything growing on them: what
  leaves is a 15 cm stick, thinner than a pixel at seven metres, inside foliage
  its own leaves already fill. Off by default, so no other plant moves.
- **A plant is now built at its own band 0.** `plant.level` said 0 while the
  plant was drawn at the species-neutral default detail, and `setLevel(0)`
  could not fix it because the level was already 0 and the call returned early.
  Hydrangea's and miscanthus's band-0 detail now actually applies to a live
  plant, as their bands always said it should.

### Miscanthus inside its geometry budget

Library rule 9 gives a plant 25,000 / 10,000 / 5,000 triangles and 3 / 2 / 2
draws across its three LOD bands. Malepartus was drawing 336,804 / 261,612 /
87,036 in seven draws at every band — up to **26.2× over**. It is now inside
the triangle budget at every band, at 23,526 / 9,076 / 4,368, and inside the
draw budget at band 0, in 3 / 3 / 3.

- **A head is one instanced organ, not three.** The raceme skeleton, the
  spikelets on it and the hairs over them were three meshes drawn at the same
  place with the same matrix, for 3,620 triangles a head. `panicles` is all of
  it: 136, 88 or 28.
- **The silky hairs are carried on a plate.** 1,260 single-triangle hairs a
  head is the worst case geometry has — each one is sub-pixel at any sane
  viewing distance, so it aliases into a crawling sparkle and costs a triangle
  to do it. A new `raceme.webp`, generated by
  `scripts/make-raceme-texture.mjs`, holds one whole raceme — axis, paired
  spikelets and hair tufts — so a head is fifteen crossed cards.
- **Plumes render with `alphaToCoverage`.** A plain alpha test has no middle:
  every pixel is solid or gone, and fifteen such cards turn a feathery whisk
  into blunt fingers. Converting alpha to an MSAA coverage mask restores the
  partial coverage the old sub-pixel triangles got for free, without the sort
  order a transparent material would need.
- **One blade is meshed, not three.** The three arch variants differed only in
  posture, so posture became a rotation in the blade's own arch plane —
  library rule 9's own prescription. Baking at the middle variant keeps every
  correction under fifteen degrees. Blades also dropped from five vertex
  columns to two: the midrib is an additive emissive strip sampled by `uv.x`,
  and `uv.x` interpolates across a fragment whether two vertices span it or
  five, so the signature white stripe survives untouched.
- The cost is that every blade now shares the middle variant's twist and width
  ratio, and an erect flag leaf is a gently arched blade held upright rather
  than a straighter one. Across a clump of several hundred blades that reads as
  the same fountain; at the scale of one blade it is an approximation.
- The far band thins blades less hard than before (`leafStride` 5 → 3), because
  it was tuned when a blade cost 176 triangles and now costs 8.
- Not met: the third draw at bands 1 and 2, which is culms. Dropping them fits
  the budget and looks wrong — the heads are carried on those stems, and
  without them a clump at six metres has its plumes floating in a gap above its
  own foliage. Merging culms into either of the other two kinds would mean
  drawing a stem tube as a leaf ribbon. Their triangles are already gone; what
  is left is one draw call, and correctness is worth more than it.

### Hydrangea inside its geometry budget

Library rule 9 gives a plant 25,000 / 10,000 / 5,000 triangles across its three
LOD bands. Hydrangea was drawing 437,865 / 413,170 / 267,737 — up to **53.5×
over** — and 87% of it was the flowers. It is now inside the budget at every
band, at 23,841 / 9,498 / 4,145.

- **A head is one instanced organ, not five.** Peduncle, rachis, fertile
  interior and the two sterile layers were 6,468 triangles and five draws for a
  single flower. `panicles` is the whole head: 100, 60 or 28 triangles.
- **Sterile florets are carried on a plate rather than meshed.** The old shell
  spent 24 triangles on each of 212 florets and still had to draw them at 4-6 cm
  — over the cultivar's 2.7-4.7 cm — because 212 is a fifth of the real count
  and anything smaller read as a wire cone. A new `floret.webp`, generated by
  `scripts/make-floret-texture.mjs`, puts nine overlapping four-sepal florets on
  one tile, so a two-triangle card carries nine flowers at their true size.
- **Petioles moved into the leaf card.** 1,757 meshed petiole tubes cost 35,140
  triangles and a draw — five times what the leaves they carried cost. A leaf
  card now grows its own stalk on the plate's midrib, for two triangles and no
  draw, and drops it past band 0 where a 1.5 mm petiole is thinner than a pixel.
- **Current-season shoots and peduncles share one `stems` pool**, dropped
  entirely past seven metres.
- Bud stage, lime, cream, dusty rose, parchment and retained winter heads all
  still render; an unopened head is now the same cards, smaller and green,
  rather than a separate set of meshes appearing when the sepals expand.
- Not yet met: the draw half of the budget, at 4 / 3 / 3 against 3 / 2 / 2.
  Closing it needs foliage-atlas UVs per instance so heads and leaves can share
  one mesh; the geometry still at stake is 60 and 28 triangles a head.

### Two new LOD levers, and a shadow opt-out

- **`organLevel`** lets an organ kind carry a ladder of geometries and lets the
  band pick a rung. Thinning counts and dropping kinds were the only levers a
  pool had, and neither helps an organ that is both irreducible and the reason
  the plant is worth drawing.
- **`landmarkStride`** thins the attachment landmarks a woody tube is pinned to.
  Ring count on a leafy shrub is set by the organs hanging off an axis, not by
  its own curve — hydrangea has 1,260 landmarks against 780 sections — so
  `sectionStride` alone barely moved it. Band-2 wood fell from 7,041 triangles
  to 2,433 with no visible change to a twig.
- An organ kind can now decline to **receive** shadows while still casting them,
  for kinds meshed as a shell of cards standing in for a solid mass. The demo
  scene no longer overrides the plant's own per-organ shadow flags on the way
  in, which had been silently discarding all of this.

### Compact demo textures

- Converted every demo leaf plate and bark map to compact WebP assets. Leaves retain their alpha silhouettes; bark normal maps use bounded channel quantization followed by lossless WebP to avoid chroma-subsampling damage. Bark maps use clean `Bark###/{color,normal,roughness}.webp` paths, and all demo textures are now ordinary Git assets with no Git LFS dependency.

### Hydrangea paniculata 'Limelight' — age and season digital twin

- New `Hydrangea` renderer built on the shared `PlantRenderer`, EZ-Tree force-grown woody axes, one combined wood mesh and stable instanced organ pools.
- Direct, non-cycling 0–30 year model: a persistent low framework is calibrated against measured RHS/Chicago size references and stays inside the published RHS envelope instead of resetting through artificial replacement cycles.
- Current-season terminal flowering biology with broad 15–29 cm panicles. Each head is one instanced cone of four-sepal sterile florets, and a baked base-to-apex gradient keeps the real bottom-up opening sequence — the apex staying greener and darker than the base through every colour change the season makes.
- Typical/early/late central-Poland calendars cover leaf-out, green panicle bud, lime, cream-white, restrained dusty pink, autumn drying and leafless winter heads. Observed July–October anchors are kept separate from interpolation assumptions.
- Dedicated transparent WebP leaf plate with an opposite ovate, finely serrated blade based on patented 8.5–10 × 4–5.5 cm dimensions and source photographs.
- The demo now exposes Limelight age/season controls, calibrated camera views and source-backed care cues. Initial deep-linked phenology profiles are also passed correctly for the two earlier plants, the picker wraps for three entries, and the remaining generic startup events no longer carry blackcurrant names.

### Forsythia × intermedia 'Lynwood' — second plant in the garden library

- **`Forsythia`** renderer for _Forsythia × intermedia_ 'Lynwood Variety' (sold as 'Lynwood Gold'), modelled in metres for central-Poland conditions.
  - **Flowers on bare one- and two-year-old wood before any leaf expands.** At peak bloom the renderer draws corollas and zero leaf cards; leaf-out begins as the last flowers fade. This is the behaviour the whole model is organised around.
  - **Opposite, decussate leaves** (two per node, 90° turn between nodes), narrow ovate-lanceolate blades scaled independently in width.
  - Four-lobed corolla geometry with oblong, revolute and twisted lobes; closed teardrop flower buds; sparse, non-ornamental two-celled capsules (a thrum-eyed clone sets almost no seed).
  - Upright-arching cane architecture with a back-loaded arch and tip droop, sized to the RHS 1.5–2.5 m envelope.
  - **Pruning follows flowering, not dormancy** (RHS pruning group 2): `pruneOldestCane()` refuses cuts before flowering ends, enforces the one-fifth-of-oldest-stems seasonal quota, and refuses cuts after mid-July because that wood carries next spring's display.
  - Regional phenology profiles: `central`, `northeast` (the reported 10–14 day lag for Mazury/Podlasie/Suwalszczyzna), plus `early`/`late` season brackets.
  - Every default is traceable: `LYNWOOD_SOURCES` cites RHS, Trees and Shrubs Online, NC State Extension, Atlas Roślin and Polish horticultural sources, and `LYNWOOD_PHASE_ASSUMPTIONS` labels which numbers are renderer assumptions rather than observations.

### Organ morphology corrections

- **Leaf cards were rendering square.** A stray width factor cancelled the narrowing, so forsythia was wearing blackcurrant foliage at a 1.04 width:length ratio. Cards now carry the blade's true metres (2.09:1, against the published 4-10 x 2-5 cm) and the drawn blade fills the card instead of leaving transparent margins.
- **Blade silhouette redrawn** from the botanical description: cuneate base with finite width at the petiole and a convex lower margin (ovate, not a symmetric spindle), gradual acute apex, and shallow forward-leaning teeth confined to the upper margin. The previous outline had a rounded spatulate base and deep regular sawteeth that read as a fern frond.
- **Opposite buds no longer stack.** Two leaves share every node, and both buds were written at the node centre, duplicating half the bud pool into a z-fighting blob. Each bud now sits on its own side of the stem.
- **Corolla lobes narrowed** to the oblong straps the sources describe; broad swelling lobes read as a buttercup. The deeper gold is confined to the throat so the flower reads as clear forsythia yellow, and the corolla tube is floored so the flower is not see-through face on.
- Regression tests cover blade aspect and bud coincidence; both defects passed the previous suite.

### Shared plant infrastructure

- **`PlantRenderer`** base class extracts the machinery common to every multi-cane shrub: group layout, tracked materials and geometry, stable-capacity instance pools sized from peak annual concurrency, the combined EZ-Tree woody meshing pass, distance LOD, care-event validation and the atomic validate-evaluate-apply state cycle. `Forsythia` is built on it; organ placement stays species-specific by design.

### React Three Fiber and TypeScript

- New **`@dgreenheck/ez-tree/react`** entry point with `<Hydrangea>`, `<Forsythia>` and `<Blackcurrant>` components. Plants are built once per seed and mounted with `<primitive>`; `ageYears` and `dayOfYear` are applied to the live object rather than rebuilding it. `react` and `@react-three/fiber` are optional peer dependencies.
- Hand-authored TypeScript declarations (`types/plants.d.ts`) for the plant API. Generated declarations reduced option bags to `{}` and cultivar unions to `any`; the hand-authored surface types cultivars, regions, season profiles, trial years, stats, phenology and prune-refusal reasons precisely.

### Shared demo page

- The demo is no longer blackcurrant-specific. A plant registry (`src/app/plants.js`) declares each species' label, defaults, seasonal shortcuts, organ stat rows, phenology control and care actions, and one panel renders any of them. Adding a plant to the library adds it to the page.
- Plant selector with in-place swapping that disposes the previous plant's GPU resources; camera framing, ground scale, grid and lighting derive from the plant's own size; plant selection and phenology profile are reflected in the URL.
- Procedural forsythia leaf texture drawn from the botanical description (serrate above, entire toward the base), avoiding a binary asset with no citable provenance.

### Build

- Type declarations are now emitted by `tsc` for both entry points instead of `vite-plugin-dts`, whose bundled api-extractor broke across TypeScript releases and overwrote the hand-authored types entry.

## [2.0.0] - 2026-07-16

### Levels of Detail

- **`Tree.generateLODs(levels)`** builds the tree at multiple levels of detail hosted in a `THREE.LOD` inside the tree group, with automatic distance-based switching.
  - All levels are meshed from a single skeleton, so the silhouette is identical across levels and switches don't pop.
  - All levels share one bark and one leaf material, so `update()` animates wind at every level.
  - Default levels (`Tree.defaultLODLevels`) reduce to ~40% of the full triangle count at 100 units and ~20% at 250 units.
- **`Tree.createGeometry(detail)`** returns raw `{ branches, leaves }` `BufferGeometry` pairs at any detail level (`sectionStride`, `segmentFactor`, `leafStride`, `leafScale`, `billboard`) for external instancing or custom LOD systems.
- Internally, tree generation is now split into a skeleton pass (all randomness) and a meshing pass (geometry emission). Output for a given seed is bit-identical to before; the undocumented internals `generateBranch`, `generateLeaf`, and `generateBranchIndices` were replaced by private methods.
- Demo app:
  - The background forest generates with LODs.
  - New viewport stats overlay shows live triangle/vertex counts, with buttons to preview each LOD level on the hero tree.
  - New "Export LODs (ZIP)" button downloads one GLB per LOD level; "Export GLB (Full Detail)" always exports full detail regardless of the active LOD preview.

### Texture System (breaking)

- The library no longer bundles any textures. `bark.maps = { color, ao, normal, roughness }` and `leaves.map` slots on `TreeOptions` accept caller-supplied `THREE.Texture` instances.
- **Breaking:** removed `BarkType` and `LeafType` enums and the bundled-texture lookup. Callers must now load `THREE.Texture` instances themselves and assign them to `options.bark.maps` / `options.leaves.map`. `bark.type` / `leaves.type` strings are still carried through presets but are now purely informational identifiers the host app can use to resolve textures.
- Bark UVs now scale with `branch.radius` (integer-rounded per branch) so bark feature size stays consistent across thick trunks and thin twigs; `bark.textureScale.x` now means "wraps per unit radius" rather than "wraps per branch" (existing preset values may need re-tuning).
- Demo app ships with 11 CC0 bark variants from ambientcg.com under `src/app/public/textures/bark/` with attribution in `src/app/public/textures/LICENSE.md`.
- Trimmed the bark texture sets to the maps the demo actually uses (color, GL normal, roughness) — removed the ambient-occlusion, displacement, and DirectX normal variants (~15 MB). The library still applies an `ao` map when a caller supplies one.

### Rendering Improvements

- Bark, leaf, ground, and grass materials switched from `MeshPhongMaterial` to `MeshStandardMaterial` (PBR). Bark roughness maps now actually affect shading, and GLB exports round-trip cleanly without the exporter's Phong-conversion warnings.
- Leaves use custom rounded normals for softer, canopy-shaped shading (#43).

### Bug Fixes

- GLB export silently failed for trees using the default bark: the Bark001 texture set has no ambient-occlusion file, the dev server masks the 404 by serving `index.html`, and GLTFExporter aborts on the resulting never-loaded texture. Texture loading now drops missing maps from the cache, and exports strip any never-loaded textures from materials for the duration of the export.
- The growth force was not being applied correctly. Branches now grow uniformly in the same world direction.
- Child branches and leaves are now placed with stratified sampling (with a permuted slot assignment) instead of fixed angular spacing, eliminating visible spirals and one-sided clumping.

### Demo App

- Refreshed the UI with a glassmorphism design: tinted-glass panels and dialogs, a canopy-green accent palette, Space Grotesk typography, filled slider tracks, a live build-time stat, and a mobile bottom-sheet layout over a full-screen canvas.

### Development & Tooling

- `npm run dev` script and Vite mode-based alias so the dev server resolves `@dgreenheck/ez-tree` directly to `src/lib/` source — instant HMR with no rebuild step.
- Reorganized `src/app/public/` into `audio/`, `fonts/`, `images/`, `icons/`, `models/`, `textures/{bark,ground,leaves}/`; browser/SEO well-known files remain at the root.
- Updated Dockerfile to Node 24 and removed the obsolete `version` attribute from `docker-compose.yml`.

## [1.1.0] - 2026-01-14

- Trellis system with force attraction for branch growth, enabling guided/structured tree shapes (#35).
- Disabled the trellis system on presets where it isn't applicable.

## [1.0.1] - 2026-01-14

- Redesigned the application UI (#34).
- Reduced bundled asset sizes by more than 50%.
- Updated CI/publish workflow dependencies.

## [1.0.0] - 2024-10-18

Initial 1.0 release of the procedural tree generator and demo application.

[2.0.0]: https://github.com/dgreenheck/ez-tree/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/dgreenheck/ez-tree/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/dgreenheck/ez-tree/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/dgreenheck/ez-tree/releases/tag/v1.0.0

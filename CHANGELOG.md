# Changelog

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Compact demo textures

- Converted every demo leaf plate and bark map to compact WebP assets. Leaves retain their alpha silhouettes; bark normal maps use bounded channel quantization followed by lossless WebP to avoid chroma-subsampling damage. Bark maps use clean `Bark###/{color,normal,roughness}.webp` paths, and all demo textures are now ordinary Git assets with no Git LFS dependency.

### Hydrangea paniculata 'Limelight' — age and season digital twin

- New `Hydrangea` renderer built on the shared `PlantRenderer`, EZ-Tree force-grown woody axes, one combined wood mesh and stable instanced organ pools.
- Direct, non-cycling 0–30 year model: a persistent low framework is calibrated against measured RHS/Chicago size references and stays inside the published RHS envelope instead of resetting through artificial replacement cycles.
- Current-season terminal flowering biology with broad 15–29 cm panicles. Each head combines an open branched rachis, sparse fertile interior and a representative shell of exactly four-sepal sterile florets; lower and upper layers preserve the real base-to-tip opening sequence.
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

# Working in this repo

## Running the demo in a browser

```bash
npx vite --config vite.app.config.js --port 5177 --strictPort
```

Not a service — start it yourself, it dies with your session. `/` is the
single-plant review page, `/field` the walkable field.

Both pages have a touch layout, and it is a different layout rather than a
smaller one: the review panel becomes a peeked bottom sheet, the field HUD folds
to one line, and the field is walked with an on-screen thumbstick because
pointer lock and WASD do not exist there. A desktop screenshot proves nothing
about it — drive a mobile viewport (`isMobile`, `hasTouch`) and dispatch real
touch events through CDP `Input.dispatchTouchEvent`, since Playwright's mouse
API produces `pointerType: "mouse"` and takes the desktop path.

To drive it, use the **`gpu-browser` skill**. It owns the browser setup for this
machine and works from any directory. Do not build a launcher here: without a
Wayland compositor Chrome silently falls back to SwiftShader, and a
software-rendered frame time looks exactly like a slow one. The skill asserts
against that; a hand-rolled `chromium.launch()` will not.

The field HUD reports frame time and the renderer string, so reading it is
usually enough — there is no separate measurement script to run.

## Reading the field HUD

`renderer.info` **excludes the shadow pass** — in three.js `shadowMap.render()`
runs before `info.reset()`, so the HUD's "Draw calls" and "Triangles" are the
main pass only. With shadows on, real geometry load is ~1.85× what is displayed.
`shadows=off` reporting an identical triangle count is this, not a bug.

The field is triangle-bound on the maintainer's GPU: `frame_ms ≈ 24.6 + 7.05 ×
million_triangles` with shadows on. Fill rate, CPU, draw-call count and shadow
map resolution have all been measured and ruled out. See the `/field` query
parameters (`count`, `shadows`, `pixelratio`, `lod`, `wind`, `culling`,
`prototypes`, `day`) — each isolates one dial.

## Tests

`npm test` runs `node --test`. Those tests run on the CPU with no rendering;
they are sound for CPU questions (repack cost, instance counts) and worthless
for predicting frame rate. Do not extrapolate them to GPU behaviour.

## Plant geometry budgets

Library rule 9 in the README sets a per-band triangle and draw budget, taken
from EZ-Tree's measured LOD ladder. `test/geometry-budget.test.js` enforces it
as a ratchet: recorded plants may only shrink, unrecorded plants must meet the
target immediately. Read it before changing plant geometry, and lower a plant's
recorded entry in the same commit that earns it.

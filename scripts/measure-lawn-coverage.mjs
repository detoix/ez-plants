/**
 * Measure the lawn's bare ground against distance, on the real adapter.
 *
 * Coverage is the whole argument for blade height, blade width, tillering and
 * ring density, and none of it is visible to `npm test`: the CPU tests never
 * run a draw. This drives `/field` in headless Chromium on hardware WebGPU,
 * paints the underlay control emissive blue so that every pixel of ground no
 * blade covers is unmistakable, and counts them by screen row -- which, for a
 * known camera over flat terrain, is a known ground distance.
 *
 * It exists because the numbers behind `minHeight`/`maxHeight` were measured
 * once by a sweep nobody kept, and could not be reproduced when the blade's
 * width was questioned. Re-run it when any of those five dials move.
 *
 *   npm run dev
 *   node scripts/measure-lawn-coverage.mjs "bladewidth=1" [pitchDown]
 *
 * Any `/field` query works: `?tillers=`, `?bladeheight=`, `?bendmax=` and
 * `?count=` all change coverage, and A/B-ing two runs is the point.
 */
import { chromium } from 'playwright';

const [, , query = '', pitch = '0'] = process.argv;

/** Where the camera stands, and what it sees through. Matches field-runtime. */
const EYE = 1.7;
const FOV = 62;
const WIDTH = 1280;
const HEIGHT = 720;

/** Ground distance seen by screen row `y`, for a camera pitched `pitch` down. */
function distanceOfRow(y, pitchDegrees) {
  const half = Math.tan((FOV * Math.PI) / 360);
  const ndc = 1 - (2 * (y + 0.5)) / HEIGHT;
  const angle = Math.atan(ndc * half) - (pitchDegrees * Math.PI) / 180;
  return angle >= 0 ? Infinity : EYE / Math.tan(-angle);
}

const BANDS = [
  [0.8, 1.5],
  [1.5, 2],
  [2, 3],
  [3, 4],
  [4, 6],
  [6, 8],
  [8, 12],
  [12, 16],
  [16, 24],
  [24, 32],
  [32, 52],
];

const browser = await chromium.launch({
  // The full browser, not the headless shell: WebGPU needs a real GPU process,
  // and the shell has none. `npx playwright install chromium` provides it.
  channel: 'chromium',
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
    '--enable-gpu',
  ],
});
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});
page.on('pageerror', (error) => console.error('[pageerror]', error.message));

// Flat terrain, no plants: a hill or a hydrangea in front of the grass is a
// pixel this cannot tell from bare ground.
await page.goto(
  `http://localhost:5173/field?count=0&terrain=flat&underlay=solid&${query}`,
  { waitUntil: 'load', timeout: 60000 },
);
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
await page.waitForTimeout(1500);

const rows = await page.evaluate(
  async ({ pitchDegrees, width, height }) => {
    const field = window.__field;
    // Every panel is a hole in the measurement.
    const canvas = document.querySelector('canvas');
    for (const node of document.body.querySelectorAll('*')) {
      if (node !== canvas && !node.contains(canvas)) {
        node.style.display = 'none';
      }
    }
    // Ground in one colour no blade can wear: emissive, so neither the sun,
    // the shadow nor the tone mapper can turn a lit blade into it.
    const solid = field.surface.solidMaterial;
    solid.color.set('#000000');
    solid.emissive.set('#0000ff');
    solid.emissiveIntensity = 1;
    solid.needsUpdate = true;
    // A known pose: a row is only a distance if the height and pitch are.
    const camera = field.camera;
    camera.rotation.order = 'YXZ';
    camera.rotation.set((-pitchDegrees * Math.PI) / 180, 0, 0);
    camera.updateMatrixWorld(true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    camera.rotation.set((-pitchDegrees * Math.PI) / 180, 0, 0);
    camera.updateMatrixWorld(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const flat = document.createElement('canvas');
    flat.width = width;
    flat.height = height;
    const context = flat.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const bare = [];
    for (let y = 0; y < height; y += 1) {
      let blue = 0;
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (data[i + 2] > data[i + 1]) blue += 1;
      }
      bare.push(blue / width);
    }
    return bare;
  },
  { pitchDegrees: Number(pitch), width: WIDTH, height: HEIGHT },
);
await browser.close();

if (rows.every((value) => value === 0)) {
  console.error(
    'Every row reads as covered, which means the ground never came back blue.\n' +
      'The canvas probably composited empty -- check the page rendered at all.',
  );
  process.exit(1);
}

console.log(
  `/field?${query || '(defaults)'}  pitch ${pitch}deg  ${WIDTH}x${HEIGHT}`,
);
console.log(`${'band (m)'.padEnd(12)} ${'rows'.padStart(5)}  bare ground`);
for (const [low, high] of BANDS) {
  const ys = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    const distance = distanceOfRow(y, Number(pitch));
    if (distance >= low && distance < high) ys.push(y);
  }
  if (ys.length < 2) continue;
  const bare = ys.reduce((total, y) => total + rows[y], 0) / ys.length;
  const label = `${low}-${high}`.padEnd(12);
  console.log(
    `${label} ${String(ys.length).padStart(5)}  ${(100 * bare)
      .toFixed(1)
      .padStart(5)}%  ${'#'.repeat(Math.round(bare * 40))}`,
  );
}

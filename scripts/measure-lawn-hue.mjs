/**
 * Measure the lawn's rendered colour against depth, on the real adapter.
 *
 * `LAWN_TARGET_HUE` is a property of the *rendered image*, not of the palette:
 * the blades, the Grass004 underlay, the canopy proxy, the ground occlusion
 * and the sun's colour all decide what a pixel of lawn is made of, and the
 * number has to be re-swept after any of them moves. Its own comment says so
 * twice and then records it moving twice in one day.
 *
 * That sweep had no script. It was done by hand, kept in a commit message, and
 * re-derived from scratch the next time somebody needed it -- which is the
 * same way the blade-height numbers were lost, as `measure-lawn-coverage.mjs`
 * records. This is that script.
 *
 *   npm run dev
 *   node scripts/measure-lawn-hue.mjs                      # the shipped lawn
 *   node scripts/measure-lawn-hue.mjs "lawnhue=103"        # a sweep point
 *   node scripts/measure-lawn-hue.mjs "proxy=0"            # a known A/B
 *
 * Any `/field` query works. The recorded landmarks, for checking the harness
 * agrees with the numbers already written down:
 *
 *   lawnhue=103   mean 97.6      lawnhue=105  mean 99.7
 *   lawnhue=107   mean 101.5     shipped      mean 99
 *   proxy=0       mean about 90  groundao=1   about two degrees higher
 *
 * It needs `npx playwright install chromium` -- Playwright's default headless
 * shell has no GPU process and therefore no WebGPU at all.
 */
import { chromium } from 'playwright';

const [, , query = '', pitch = '28'] = process.argv;

/** Where the camera stands, and what it sees through. Matches field-runtime. */
const EYE = 1.7;
const FOV = 62;
const WIDTH = 1280;
const HEIGHT = 720;

/**
 * Six bands, because the recorded mean is the mean *of the band means* rather
 * than of the pixels: a pitched camera gives the near field an order of
 * magnitude more rows than the far, and a pixel mean would be a measurement of
 * the camera angle.
 *
 * The default 28 degrees of pitch is what puts ground in all six at once -- it
 * reaches in to 1 m at the bottom row and still shows the horizon at the top.
 */
const BANDS = [
  [1, 2],
  [2, 4],
  [4, 8],
  [8, 16],
  [16, 24],
  [24, 52],
];

/** Ground distance seen by screen row `y`, for a camera pitched `pitch` down. */
function distanceOfRow(y, pitchDegrees) {
  const half = Math.tan((FOV * Math.PI) / 360);
  const ndc = 1 - (2 * (y + 0.5)) / HEIGHT;
  const angle = Math.atan(ndc * half) - (pitchDegrees * Math.PI) / 180;
  return angle >= 0 ? Infinity : EYE / Math.tan(-angle);
}

/**
 * Hue, saturation and relative luminance of an 8-bit sRGB pixel.
 *
 * Hue is read in display sRGB and not in linear light, because the reference
 * it is scored against is a photograph and the Dark Green Colour Index is
 * defined on the photograph's own numbers.
 */
const toLinear = (channel) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function measurePixel(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const span = high - low;
  if (span === 0) return null;
  let hue;
  if (high === r) hue = ((g - b) / span) % 6;
  else if (high === g) hue = (b - r) / span + 2;
  else hue = (r - g) / span + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return {
    hue,
    saturation: span / high,
    luminance:
      0.2126 * toLinear(red) +
      0.7152 * toLinear(green) +
      0.0722 * toLinear(blue),
  };
}

const browser = await chromium.launch({
  // The full browser, not the headless shell: WebGPU needs a real GPU process.
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

// Flat terrain and no plants: a hill changes what distance a row is, and a
// hydrangea in front of the grass is a pixel this cannot tell from lawn.
await page.goto(`http://localhost:5173/field?count=0&terrain=flat&${query}`, {
  waitUntil: 'load',
  timeout: 60000,
});
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
await page.waitForTimeout(1500);

const pixels = await page.evaluate(
  async ({ pitchDegrees, width, height }) => {
    const field = window.__field;
    // Every panel is a hole in the measurement.
    const canvas = document.querySelector('canvas');
    for (const node of document.body.querySelectorAll('*')) {
      if (node !== canvas && !node.contains(canvas))
        node.style.display = 'none';
    }
    // A known pose: a row is only a distance if the height and the pitch are.
    // Looking down the negative Z axis, away from the sun's azimuth, which is
    // the framing the page opens in.
    const camera = field.camera;
    camera.rotation.order = 'YXZ';
    const aim = () => {
      camera.rotation.set((-pitchDegrees * Math.PI) / 180, 0, 0);
      camera.updateMatrixWorld(true);
    };
    aim();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    aim();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const flat = document.createElement('canvas');
    flat.width = width;
    flat.height = height;
    const context = flat.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0, width, height);
    return Array.from(context.getImageData(0, 0, width, height).data);
  },
  { pitchDegrees: Number(pitch), width: WIDTH, height: HEIGHT },
);
await browser.close();

const rows = [];
for (const [low, high] of BANDS) {
  let hue = 0;
  let saturation = 0;
  let luminance = 0;
  let counted = 0;
  let scanlines = 0;
  for (let y = 0; y < HEIGHT; y += 1) {
    const distance = distanceOfRow(y, Number(pitch));
    if (distance < low || distance >= high) continue;
    scanlines += 1;
    for (let x = 0; x < WIDTH; x += 2) {
      const index = (y * WIDTH + x) * 4;
      const pixel = measurePixel(
        pixels[index],
        pixels[index + 1],
        pixels[index + 2],
      );
      if (!pixel) continue;
      hue += pixel.hue;
      saturation += pixel.saturation;
      luminance += pixel.luminance;
      counted += 1;
    }
  }
  rows.push({
    band: `${low}-${high}`,
    scanlines,
    hue: counted ? hue / counted : null,
    saturation: counted ? saturation / counted : null,
    luminance: counted ? luminance / counted : null,
  });
}

const filled = rows.filter((row) => row.hue !== null);
if (filled.length === 0) {
  console.error(
    'No band caught a single lawn pixel, which means the page rendered\n' +
      'something other than ground where the pitch says ground is.',
  );
  process.exit(1);
}

const mean = (pick) =>
  filled.reduce((total, row) => total + pick(row), 0) / filled.length;

console.log(
  `/field?count=0&terrain=flat&${query || '(defaults)'}  pitch ${pitch}deg  ${WIDTH}x${HEIGHT}`,
);
console.log(
  `${'band (m)'.padEnd(10)} ${'rows'.padStart(5)}  ${'hue'.padStart(6)}  ${'sat'.padStart(6)}  luminance`,
);
for (const row of rows) {
  if (row.hue === null) {
    console.log(
      `${row.band.padEnd(10)} ${String(row.scanlines).padStart(5)}  ${'—'.padStart(6)}`,
    );
    continue;
  }
  console.log(
    `${row.band.padEnd(10)} ${String(row.scanlines).padStart(5)}  ` +
      `${row.hue.toFixed(1).padStart(6)}  ${row.saturation.toFixed(3).padStart(6)}  ` +
      `${row.luminance.toFixed(4)}`,
  );
}

const near = filled[0];
const far = filled[filled.length - 1];
console.log(
  `\nmean hue over ${filled.length} bands  ${mean((row) => row.hue).toFixed(1)}` +
    `   (a healthy lawn photographs at 99 and holds it at every depth)`,
);
// The three axes the palette was calibrated on, as ratios rather than values,
// because the photographs they came from were shot at their own exposures.
console.log(
  `hue drift near to far      ${(far.hue - near.hue >= 0 ? '+' : '') + (far.hue - near.hue).toFixed(1)}` +
    `   (photographs: within a few degrees)`,
);
console.log(
  `luminance near to far      ${((far.luminance / near.luminance - 1) * 100).toFixed(0)}%` +
    `   (photographs: +20%, +37%, +50%)`,
);
console.log(
  `saturation near to far     ${((far.saturation / near.saturation - 1) * 100).toFixed(0)}%`,
);

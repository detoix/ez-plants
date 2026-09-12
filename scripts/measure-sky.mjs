/**
 * Measure the rendered sky, on the real adapter.
 *
 * The atmosphere is solved with the sun's irradiance set to 1, so a single
 * number -- `SKY_EXPOSURE` in `field-runtime.js` -- decides how bright the
 * whole image is, and nothing on the CPU can check it: `npm test` never runs a
 * draw, and the sky's three lookup tables are written by compute passes.
 *
 * This drives `/field` in headless Chromium on hardware WebGPU, points the
 * camera along known directions and reads the pixel back. It reports two
 * things:
 *
 *   sky        what each named direction renders as, after ACES and sRGB
 *   far band   the fully fogged ground just under the horizon line
 *
 * The second is the calibration. Past `far` the haze has taken over entirely,
 * so those rows *are* the fog colour -- and the fog colour is the sky. The
 * lawn's hue is calibrated over depth (see `LAWN_TARGET_HUE`), so the far band
 * is the one thing this change must not re-expose. Run it against `sky=flat`
 * to get the luminance the page shipped with, then against the atmosphere:
 * rendered luminance is very nearly linear in the exposure, so one run of each
 * gives the exposure that holds the band still.
 *
 *   npm run dev
 *   node scripts/measure-sky.mjs                  # the shipped atmosphere
 *   node scripts/measure-sky.mjs "sky=flat"       # the control
 *   node scripts/measure-sky.mjs "skyexposure=9"  # a sweep point
 *
 * It needs `npx playwright install chromium` -- Playwright's default headless
 * shell has no GPU process and therefore no WebGPU at all.
 */
import { chromium } from 'playwright';

import { sunAnglesOf } from '../src/app/sky/atmosphere.js';

const [, , query = ''] = process.argv;

const WIDTH = 1280;
const HEIGHT = 720;
const EYE = 1.7;
const FOV = 62;

const SUN = sunAnglesOf([24, 34, 17]);

/**
 * Directions worth a number. The sun is sampled five degrees off its centre:
 * the disk is a tenth of a degree of clipped white and says nothing, while the
 * Mie lobe around it is the whole reason the sky is not a gradient.
 */
const LOOKS = [
  ['zenith', 89, SUN.azimuth],
  ['45 deg toward sun', 45, SUN.azimuth],
  ['5 deg off the sun', SUN.elevation - 5, SUN.azimuth],
  ['horizon toward sun', 2, SUN.azimuth],
  ['horizon across', 2, SUN.azimuth + 90],
  ['horizon away', 2, SUN.azimuth + 180],
  ['45 deg away', 45, SUN.azimuth + 180],
];

/**
 * Ground distance seen by screen row `y` for a level camera. Rows 361-366 are
 * 200 m and further, well past the haze's 125 m: whatever colour they are is
 * the colour the haze ends at.
 */
function distanceOfRow(y) {
  const half = Math.tan((FOV * Math.PI) / 360);
  const ndc = 1 - (2 * (y + 0.5)) / HEIGHT;
  const angle = Math.atan(ndc * half);
  return angle >= 0 ? Infinity : EYE / Math.tan(-angle);
}

const FAR_ROWS = [];
for (let y = HEIGHT / 2 + 1; y < HEIGHT; y += 1) {
  if (distanceOfRow(y) > 200) FAR_ROWS.push(y);
}

const toLinear = (value) => {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const hex = ([r, g, b]) =>
  '#' +
  [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

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

// No plants and no hills: a hydrangea or a ridge on the horizon line is a
// sample of a plant, not of the sky behind it.
await page.goto(`http://localhost:5173/field?count=0&terrain=flat&${query}`, {
  waitUntil: 'load',
  timeout: 60000,
});
await page.waitForFunction(() => window.__ready === true, { timeout: 120000 });
await page.waitForTimeout(1200);

const result = await page.evaluate(
  async ({ looks, farRows, width, height }) => {
    const field = window.__field;
    const canvas = document.querySelector('canvas');
    for (const node of document.body.querySelectorAll('*')) {
      if (node !== canvas && !node.contains(canvas))
        node.style.display = 'none';
    }
    const camera = field.camera;
    camera.rotation.order = 'YXZ';

    const flat = document.createElement('canvas');
    flat.width = width;
    flat.height = height;
    const context = flat.getContext('2d', { willReadFrequently: true });

    const shoot = async (elevation, azimuth) => {
      // YXZ forward is (-sin yaw cos pitch, sin pitch, -cos yaw cos pitch), so
      // a direction at (elevation, azimuth) is this yaw and this pitch.
      const pitch = (elevation * Math.PI) / 180;
      const yaw = Math.PI + (azimuth * Math.PI) / 180;
      camera.rotation.set(pitch, yaw, 0);
      camera.updateMatrixWorld(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      camera.rotation.set(pitch, yaw, 0);
      camera.updateMatrixWorld(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      context.drawImage(canvas, 0, 0, width, height);
      return context.getImageData(0, 0, width, height).data;
    };

    const centre = (data) => {
      // A 9 x 9 patch at the centre, so one dithered pixel is not the answer.
      const out = [0, 0, 0];
      let count = 0;
      for (let y = height / 2 - 4; y <= height / 2 + 4; y += 1) {
        for (let x = width / 2 - 4; x <= width / 2 + 4; x += 1) {
          const i = (y * width + x) * 4;
          out[0] += data[i];
          out[1] += data[i + 1];
          out[2] += data[i + 2];
          count += 1;
        }
      }
      return out.map((channel) => channel / count);
    };

    const sky = [];
    for (const [name, elevation, azimuth] of looks) {
      sky.push([name, centre(await shoot(elevation, azimuth))]);
    }

    // The far band, level, averaged around the compass: the haze takes its
    // colour from the sky it is standing in front of now, so one heading is a
    // heading and not a calibration.
    const band = [0, 0, 0];
    let samples = 0;
    for (const azimuth of [0, 90, 180, 270]) {
      const level = await shoot(0, azimuth);
      for (const y of farRows) {
        for (let x = 0; x < width; x += 4) {
          const i = (y * width + x) * 4;
          band[0] += level[i];
          band[1] += level[i + 1];
          band[2] += level[i + 2];
          samples += 1;
        }
      }
    }
    return { sky, band: band.map((channel) => channel / samples), samples };
  },
  { looks: LOOKS, farRows: FAR_ROWS, width: WIDTH, height: HEIGHT },
);

await browser.close();

console.log(
  `/field?count=0&terrain=flat&${query || '(sky defaults)'}  ${WIDTH}x${HEIGHT}`,
);
console.log(`${'direction'.padEnd(20)} ${'sRGB'.padEnd(9)} luminance`);
for (const [name, colour] of result.sky) {
  console.log(
    `${name.padEnd(20)} ${hex(colour).padEnd(9)} ${luminance(colour).toFixed(4)}`,
  );
}
console.log(
  `\nfar band (${FAR_ROWS.length} rows, >200 m, four headings, ${result.samples} samples)\n` +
    `  ${hex(result.band)}  luminance ${luminance(result.band).toFixed(4)}`,
);

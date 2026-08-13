/**
 * Capture the demo scene headlessly.
 *
 * WebGL in headless Chromium runs on SwiftShader, so this is a software
 * rasterisation of the real scene: correct geometry, materials and colour
 * management, but slower and without GPU-specific quirks. It exists so the
 * plants can actually be looked at without a browser extension in the loop.
 *
 *   node scripts/shoot.mjs out.png "plant=forsythia&year=6&day=96" [view]
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const [, , output = 'shot.png', query = 'plant=forsythia&year=6&day=96', view] =
  process.argv;

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});

page.on('console', (message) => {
  if (message.type() === 'error') console.error('[page]', message.text());
});
page.on('pageerror', (error) => console.error('[pageerror]', error.message));

await page.goto(`http://localhost:5173/?${query}&ui=0`, {
  waitUntil: 'load',
  timeout: 60000,
});

// The app flips this once the first frame has been rendered.
await page.waitForFunction(() => window.__ready === true, { timeout: 90000 });
if (view) await page.evaluate((v) => window.setReviewView(v), view);

// Let the wind animation and LOD settle.
await page.waitForTimeout(1500);

const stats = await page.evaluate(() => {
  const s = window.plant?.stats?.();
  if (!s) return null;
  return {
    stage: s.phenology.stage,
    bbch: s.phenology.bbch,
    leaves: s.visibleLeaves,
    flowers: s.visibleFlowers,
    flowerBuds: s.visibleFlowerBuds,
    canes: s.visibleCanes,
    heightM: s.dimensions?.heightM,
    drawCalls: s.drawCalls,
  };
});

const dataUrl = await page.evaluate(() => window.__capture());
writeFileSync(output, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(JSON.stringify(stats, null, 2));
await browser.close();

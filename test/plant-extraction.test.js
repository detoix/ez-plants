import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const REPO = new URL('..', import.meta.url).pathname;
const SCRIPT = join(REPO, 'scripts/add-plant.mjs');
const PLANTS = ['blackcurrant', 'forsythia', 'hydrangea', 'miscanthus'];

/** Runs the extractor and returns the file list it reports. */
function plan(plant) {
  const out = execFileSync(
    process.execPath,
    [SCRIPT, plant, './anywhere', '--dry-run'],
    { cwd: REPO, encoding: 'utf8' },
  );
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.includes(' ') && line.includes('.'));
}

test('extracting a plant never drags in another plant', () => {
  for (const plant of PLANTS) {
    const foreign = plan(plant).filter(
      (file) =>
        file.startsWith('plants/') && !file.startsWith(`plants/${plant}/`),
    );
    assert.deepEqual(
      foreign,
      [],
      `${plant} must not reach into another plant's folder`,
    );
  }
});

test('an extracted plant carries its own leaf plate', () => {
  for (const plant of PLANTS) {
    const files = plan(plant);
    const hasPlate = existsSync(
      join(REPO, 'src/lib/plants', plant, 'leaf.webp'),
    );
    // Miscanthus is the licensed exception: a grass has no leaf cards, so it
    // generates the one map it needs in code instead of carrying a plate.
    assert.equal(
      files.includes(`plants/${plant}/leaf.webp`),
      hasPlate,
      `${plant} must ship the plate its renderer defaults to`,
    );
  }
});

test('an extracted plant depends only on three', () => {
  for (const plant of PLANTS) {
    const out = execFileSync(
      process.execPath,
      [SCRIPT, plant, './anywhere', '--dry-run'],
      { cwd: REPO, encoding: 'utf8' },
    );
    const deps = out
      .split('\n')
      .find((line) => line.startsWith('Install peer dependencies:'))
      .replace('Install peer dependencies:', '')
      .trim();
    assert.equal(deps, 'three', `${plant} pulled in more than three`);
  }
});

test('a plant extracted into a bare directory constructs and renders', async () => {
  // Inside the repo so Node resolves `three` by walking up to node_modules;
  // a truly bare directory would fail on that peer dependency, which is what
  // the command's own "install peer dependencies" line tells the user.
  const target = mkdtempSync(join(REPO, '.extract-test-'));
  try {
    execFileSync(process.execPath, [SCRIPT, 'hydrangea', target], {
      cwd: REPO,
      encoding: 'utf8',
    });

    // Nothing from the demo app, and no sibling plant, may have come along.
    assert.deepEqual(readdirSync(join(target, 'plants')), ['hydrangea']);

    const { Hydrangea } = await import(
      pathToFileURL(join(target, 'plants/hydrangea/hydrangea.js')).href
    );
    const plant = new Hydrangea({ ageYears: 6, dayOfYear: 230 });
    assert.equal(plant.cultivar, 'Limelight');
    assert.ok(plant.stats().drawCalls > 0);
    assert.match(plant.stats().phenology.stage, /panicle/i);
    plant.dispose();
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

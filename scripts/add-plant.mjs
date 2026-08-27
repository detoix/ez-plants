/**
 * Copy one plant, and the shared core it needs, into another project.
 *
 * Library rule 7 makes distribution shadcn-shaped: a user runs a command and a
 * plant's source lands in their project, theirs to edit. This is that command.
 *
 * The file list is never hardcoded. It is derived by walking the import graph
 * from the plant's renderer, so it cannot drift as the code changes: move a
 * helper into `src/lib/`, and the next extraction picks it up. Assets referenced
 * as `new URL('./leaf.webp', import.meta.url)` are followed too, which is how a
 * plant's own leaf plate travels with it.
 *
 * Files keep their path relative to `src/lib/`, so every relative import still
 * resolves at the destination and nothing has to be rewritten.
 *
 *   node scripts/add-plant.mjs --list
 *   node scripts/add-plant.mjs hydrangea ./src/ez-plants
 *   node scripts/add-plant.mjs hydrangea ./src/ez-plants --dry-run
 */
import {
  readdirSync,
  readFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(REPO, 'src/lib');
const PLANTS = join(LIB, 'plants');

const IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const ASSET = /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;

const listPlants = () =>
  readdirSync(PLANTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

/**
 * Every file the plant needs, plus the bare npm specifiers it imports.
 * @param {string} plant
 */
function collect(plant) {
  const entry = join(PLANTS, plant, `${plant}.js`);
  if (!existsSync(entry)) {
    throw new Error(`No renderer at ${relative(REPO, entry)}`);
  }

  const files = new Set();
  const packages = new Set();
  const queue = [entry];

  while (queue.length) {
    const file = queue.pop();
    if (files.has(file)) continue;
    files.add(file);

    // Assets are leaves of the graph: copy them, do not parse them. The
    // existence check matters — the pattern also appears in documentation
    // comments, where it names an example rather than a real sibling file.
    const source = readFileSync(file, 'utf8');
    for (const [, spec] of source.matchAll(ASSET)) {
      const asset = resolve(dirname(file), spec);
      if (existsSync(asset)) files.add(asset);
    }
    for (const [, spec] of source.matchAll(IMPORT)) {
      if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec));
      else packages.add(spec);
    }
  }

  return { files: [...files].sort(), packages: [...packages].sort() };
}

const [, , plant, target, ...flags] = process.argv;
const dryRun = flags.includes('--dry-run');

if (!plant || plant === '--list' || plant === '--help') {
  console.log(`Available plants: ${listPlants().join(', ')}\n`);
  console.log('  node scripts/add-plant.mjs <plant> <target-dir> [--dry-run]');
  console.log(
    '\nThe target directory becomes the equivalent of src/lib/, so a\nplant lands at <target>/plants/<plant>/ with its shared core beside it.',
  );
  process.exit(plant ? 0 : 1);
}

if (!listPlants().includes(plant)) {
  console.error(
    `Unknown plant "${plant}". Available: ${listPlants().join(', ')}`,
  );
  process.exit(1);
}
if (!target) {
  console.error('A target directory is required.');
  process.exit(1);
}

const { files, packages } = collect(plant);
const destination = resolve(process.cwd(), target);

let own = 0;
let shared = 0;
for (const file of files) {
  const path = relative(LIB, file);
  const to = join(destination, path);
  if (path.startsWith(`plants/${plant}/`)) own += 1;
  else shared += 1;

  if (dryRun) {
    console.log(`  ${path}`);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(file, to);
}

const where = relative(process.cwd(), destination) || '.';
console.log(
  `${dryRun ? 'Would copy' : 'Copied'} ${files.length} files to ${where}/ ` +
    `(${own} for ${plant}, ${shared} shared).`,
);
console.log(`Install peer dependencies: ${packages.join(', ')}`);
console.log(
  'The files are ES modules: the host package.json needs "type": "module".',
);
console.log(
  `\n  import { ${plant[0].toUpperCase()}${plant.slice(1)} } from '${where}/plants/${plant}/${plant}.js';`,
);

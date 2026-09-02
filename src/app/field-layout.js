export const FIELD_DEFAULT_COUNT = 400;
export const FIELD_SPECIES_COUNT = 8;
export const FIELD_LAYOUT_SEED = 20260828;

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The original field's deterministic jittered grid.
 *
 * Cells are shuffled before plants are dealt round-robin to the species. That
 * keeps each species spread across the complete garden without introducing
 * the clumps a free random scatter would create.
 */
export function createFieldLayout({
  count = FIELD_DEFAULT_COUNT,
  speciesCount = FIELD_SPECIES_COUNT,
  seed = FIELD_LAYOUT_SEED,
  groundAt,
} = {}) {
  if (!Number.isFinite(count) || count < 1) {
    throw new RangeError('Field count must be a positive finite number.');
  }
  if (!Number.isInteger(speciesCount) || speciesCount < 1) {
    throw new RangeError('Species count must be a positive integer.');
  }
  if (typeof groundAt !== 'function') {
    throw new TypeError('Field layout needs a terrain height function.');
  }

  const random = mulberry32(seed);
  const perSide = Math.ceil(Math.sqrt(count));
  const spacing = 2.4;
  const jitter = 0.75;
  const gridExtent = ((perSide - 1) * spacing) / 2;
  const cells = Array.from({ length: perSide * perSide }, (_, index) => index);

  for (let index = cells.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [cells[index], cells[swap]] = [cells[swap], cells[index]];
  }

  const perSpecies = Array.from({ length: speciesCount }, () => []);
  for (let index = 0; index < count; index += 1) {
    const cell = cells[index];
    const x =
      (cell % perSide) * spacing - gridExtent + (random() - 0.5) * 2 * jitter;
    const z =
      Math.floor(cell / perSide) * spacing -
      gridExtent +
      (random() - 0.5) * 2 * jitter;
    const y = groundAt(x, z);
    if (!Number.isFinite(y)) {
      throw new RangeError(`Terrain height is not finite at (${x}, ${z}).`);
    }
    perSpecies[index % speciesCount].push({
      position: [x, y, z],
      rotationY: random() * Math.PI * 2,
      scale: 0.85 + random() * 0.3,
    });
  }

  return {
    perSpecies,
    extent: gridExtent + spacing,
  };
}

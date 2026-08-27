import { selectPlantLODLevel } from '../plant-lod.js';

/**
 * Decide which LOD band each plant in a field renders at.
 *
 * Distance picks a band, exactly as it would for a single plant — the same
 * hysteresis function drives both, so a plant in a field pops no differently
 * from one on its own. Then the budget has its say.
 *
 * ## Why there is a budget at all
 *
 * A shared organ buffer has to be sized for **peak concurrency**, not for the
 * total number of organs in the field. Five hundred plants at their nearest
 * band is over a million leaf instances; sizing for that means allocating for a
 * frame that may never happen and cannot be afforded if it does.
 *
 * So the field states a number it can afford, and band assignment respects it:
 * when too many plants are near at once, the marginal ones are pushed one band
 * further out. That converts an unbounded worst case into a number the
 * application chose, which is what a frame budget needs to be.
 *
 * ## Which plants give way
 *
 * The furthest ones. Demotion costs detail, and detail is least missed where it
 * is least resolved — a plant at 40 m dropping a band is close to invisible,
 * the one filling the screen is not. Plants are demoted one band at a time,
 * furthest first, so the field degrades evenly rather than dropping a few
 * plants to nothing.
 *
 * A plant already at its coarsest band cannot be demoted further; if the budget
 * is still exceeded once everything is at its coarsest, the furthest plants are
 * dropped entirely rather than silently overflowing the buffer.
 */

/**
 * @param {object} options
 * @param {number} options.count Number of placements.
 * @param {readonly object[]} options.bands Normalized LOD levels, ascending.
 * @param {(index: number) => number} options.distanceOf Camera distance.
 * @param {(index: number, band: number) => number} options.costOf Instances one
 *   placement contributes at one band.
 * @param {Int32Array|null} [options.previous] Last frame's assignment, for
 *   hysteresis. Entries of -1 (dropped) are treated as no previous band.
 * @param {number} [options.budget] Maximum total instances. `Infinity` to
 *   disable.
 * @returns {{ bands: Int32Array, total: number, demoted: number, dropped: number }}
 */
export function assignBands({
  count,
  bands,
  distanceOf,
  costOf,
  previous = null,
  budget = Infinity,
}) {
  if (!Array.isArray(bands) && !ArrayBuffer.isView(bands) && !bands?.length) {
    throw new TypeError('Band assignment needs at least one band.');
  }
  if (!Number.isFinite(budget) && budget !== Infinity) {
    throw new RangeError('The instance budget must be a number or Infinity.');
  }

  const assigned = new Int32Array(count);
  const distances = new Float64Array(count);
  let total = 0;

  for (let index = 0; index < count; index += 1) {
    const distance = distanceOf(index);
    distances[index] = distance;
    const wasDropped = previous ? previous[index] < 0 : true;
    const band = selectPlantLODLevel(
      distance,
      bands,
      wasDropped ? null : previous[index],
    );
    assigned[index] = band;
    total += costOf(index, band);
  }

  if (total <= budget) {
    return { bands: assigned, total, demoted: 0, dropped: 0 };
  }

  // Furthest first. A stable tiebreak on index keeps the outcome deterministic
  // for placements at identical distances, which matters for reproducible
  // screenshots and tests.
  const order = Array.from({ length: count }, (_, index) => index).sort(
    (a, b) => distances[b] - distances[a] || a - b,
  );

  const last = bands.length - 1;
  let demoted = 0;
  let dropped = 0;

  // One band at a time across the whole field before anyone gives up a second,
  // so the loss is spread rather than concentrated on a handful of plants.
  let progress = true;
  while (total > budget && progress) {
    progress = false;
    for (const index of order) {
      if (total <= budget) break;
      const band = assigned[index];
      if (band >= last) continue;
      total -= costOf(index, band);
      assigned[index] = band + 1;
      total += costOf(index, band + 1);
      demoted += 1;
      progress = true;
    }
  }

  // Everything is at its coarsest and it still does not fit. Dropping the
  // furthest plants is the honest answer; overflowing the buffer is not.
  for (const index of order) {
    if (total <= budget) break;
    if (assigned[index] < 0) continue;
    total -= costOf(index, assigned[index]);
    assigned[index] = -1;
    dropped += 1;
  }

  return { bands: assigned, total, demoted, dropped };
}

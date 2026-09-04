import * as THREE from 'three';

/**
 * A coarser organ band, expressed as the finest band with organs culled.
 *
 * ## Why
 *
 * A field stores every band of every organ kind as an independent instance
 * set, so a band change frees one set and allocates another. Allocation is not
 * cheap: a storage buffer cannot resize in place, so growth reallocates it,
 * re-uploads it whole, and rebuilds both the material node graph and the
 * culling compute graph — and three compiles render pipelines synchronously,
 * with no async path at all for compute. A band change that grows a buffer is
 * a stall.
 *
 * It is also unnecessary work. For most organ kinds a coarser band is the
 * finer one with organs culled and the survivors rescaled: the survivors sit
 * at exactly the placements they occupied at the finest band, carrying exactly
 * the colours they carried. Such a kind can allocate **once**, for the finest
 * band, and make a band change a survivor mask plus a level override — which
 * is how wood already works.
 *
 * ## What this module does, and does not, decide
 *
 * It reports the relation and nothing else. It allocates nothing, uploads
 * nothing, and holds no reference the caller does not already hold. A field
 * decides what to do with the answer.
 *
 * ## The relation does not always hold
 *
 * A plant is free to **substitute** at a coarse band rather than cull, folding
 * a dropped kind's work into a surviving one. Four kinds in this library once
 * did -- echinacea's heads absorbed the stem its coarse bands dropped,
 * lavender re-seated each spike as a leaf card, and both grasses walked their
 * culms with a wider stride onto new chords -- and every one of them was
 * changed, because each was buying a draw call with memory it turned out not
 * to have. A kind that still substitutes is reported as not compositional,
 * with a reason, and a field refuses to build it rather than guess.
 *
 * Three findings shape the result, and each cost a design that assumed
 * otherwise:
 *
 *   - **The rescale is per axis, not a scalar.** Hydrangea's and miscanthus'
 *     panicles use a coarse geometry narrower than the fine one and widen it
 *     back with the instance scale, leaving the height alone. The factor is
 *     constant across the band but differs between axes.
 *   - **The relation is a property of the bake, not of the species.** Lavender
 *     leaves were a clean subset out of flower and substituted while there
 *     were spikes to stand in for. A caller asks per prototype.
 *   - **An axis with no geometry is not an axis with no meaning.** See
 *     `DATA_AXIS_EXTENT`.
 *
 * `test/organ-lod-composition.test.js` records what every organ kind in the
 * library does, and reconstructs each band from the result to prove the
 * relation is exact.
 */

/**
 * Radians. Two placements this close are the same placement.
 *
 * A coarse band re-derives a placement rather than copying it, so a survivor
 * lands a few ulps from the finest band's matrix. Measured drift across the
 * library is under 5e-4; this is a tenth of a degree.
 */
const ROTATION_TOLERANCE = 2e-3;

/** Decimal places a position is quantized to before placements are matched. */
const POSITION_PLACES = 4;

/** Relative spread allowed across one band's per-organ scale ratios. */
const RATIO_TOLERANCE = 1e-3;

const POSITION = new THREE.Vector3();
const QUATERNION = new THREE.Quaternion();
const SCALE = new THREE.Vector3();
const MATRIX = new THREE.Matrix4();

function decompose(matrices, index) {
  MATRIX.fromArray(matrices, index * 16);
  MATRIX.decompose(POSITION, QUATERNION, SCALE);
  // q and -q are the same rotation. `angleTo` copes either way; canonicalizing
  // keeps the numbers readable when something reports them.
  if (QUATERNION.w < 0) {
    QUATERNION.set(-QUATERNION.x, -QUATERNION.y, -QUATERNION.z, -QUATERNION.w);
  }
  return {
    position: POSITION.clone(),
    quaternion: QUATERNION.clone(),
    scale: SCALE.clone(),
  };
}

const positionKey = (placement) =>
  [placement.position.x, placement.position.y, placement.position.z]
    .map((value) => value.toFixed(POSITION_PLACES))
    .join(',');

/**
 * Fraction of a geometry's largest extent below which an axis has no geometry.
 *
 * Such an axis is not ignorable, and treating it as ignorable is a mistake
 * this module made once. A scale there moves no vertex, which is exactly why
 * it is the one safe place to carry per-instance *data*: a thuja spray is a
 * flat plate, and its wind metadata rides in the ratio of its Z scale to its X
 * scale. Averaging a band's ratios on that axis rewrote a channel the renderer
 * reads back out, which produced wrong metadata at one band and threw at the
 * next.
 *
 * So the axis is neither judged nor rescaled: the survivor keeps the base
 * band's value there, untouched. Nothing moves, and whatever the value meant
 * still means it.
 */
const DATA_AXIS_EXTENT = 1e-6;

/** Which local axes of a geometry have no extent, and so may carry data. */
function dataAxes(geometry) {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (largest === 0) return [true, true, true];
  return [size.x, size.y, size.z].map(
    (extent) => extent / largest < DATA_AXIS_EXTENT,
  );
}

function colorsAgree(coarse, coarseIndex, base, baseIndex) {
  if (!coarse.colors || !base.colors) {
    return Boolean(coarse.colors) === Boolean(base.colors);
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const a = coarse.colors[coarseIndex * 3 + channel];
    const b = base.colors[baseIndex * 3 + channel];
    if (Math.abs(a - b) > 1e-4) return false;
  }
  return true;
}

/** Index the base band's placements by position, keeping ties together. */
function indexPlacements(base) {
  const placements = Array.from({ length: base.count }, (_, index) =>
    decompose(base.matrices, index),
  );
  const byPosition = new Map();
  placements.forEach((placement, index) => {
    const at = positionKey(placement);
    if (!byPosition.has(at)) byPosition.set(at, []);
    byPosition.get(at).push(index);
  });
  return { placements, byPosition };
}

/**
 * Match one band's organs to the base band's, and derive the rescale.
 *
 * Placements are matched on position **and** rotation together. Matching on
 * position alone mispairs organs that share a node — an opposite leaf pair, of
 * which a forsythia has some 1500 — and a mispaired organ then yields a
 * meaningless scale ratio, which is enough to lose an otherwise sound kind.
 *
 * @returns {{ survivors: Uint32Array, scale: THREE.Vector3, spread: number }
 *   | { reason: string }}
 */
function matchBand(base, index, coarse) {
  if (coarse.count > base.count) {
    return {
      reason: `band draws ${coarse.count} organs, more than the ${base.count} of the base band, so it cannot be a subset of it`,
    };
  }

  const survivors = new Uint32Array(coarse.count);
  const claimed = new Set();
  const ratios = [[], [], []];

  for (let instance = 0; instance < coarse.count; instance += 1) {
    const placement = decompose(coarse.matrices, instance);
    const candidates = index.byPosition.get(positionKey(placement)) ?? [];

    const hit = candidates.find(
      (candidate) =>
        !claimed.has(candidate) &&
        index.placements[candidate].quaternion.angleTo(placement.quaternion) <=
          ROTATION_TOLERANCE,
    );
    if (hit === undefined) {
      return {
        reason: candidates.some((candidate) => !claimed.has(candidate))
          ? 'the band re-orients organs it keeps rather than only culling them'
          : 'the band draws organs at placements the base band does not occupy',
      };
    }
    claimed.add(hit);
    survivors[instance] = hit;

    const survivor = index.placements[hit];
    ratios[0].push(placement.scale.x / survivor.scale.x);
    ratios[1].push(placement.scale.y / survivor.scale.y);
    ratios[2].push(placement.scale.z / survivor.scale.z);

    if (!colorsAgree(coarse, instance, base, hit)) {
      return {
        reason:
          'a survivor changes colour between bands, so one colour buffer cannot serve both',
      };
    }
  }

  const carriesData = dataAxes(coarse.geometry);
  const scale = new THREE.Vector3(1, 1, 1);
  let spread = 0;
  let geometryFactor = null;
  for (const axis of [0, 1, 2]) {
    if (carriesData[axis]) continue;
    const values = ratios[axis];
    const mean = values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : 1;
    scale.setComponent(axis, mean);
    geometryFactor ??= mean;
    if (values.length === 0) continue;

    const magnitude = Math.max(...values.map(Math.abs));
    const axisSpread =
      magnitude === 0
        ? 0
        : (Math.max(...values) - Math.min(...values)) / magnitude;
    spread = Math.max(spread, axisSpread);
  }

  // A data axis takes the same factor its geometry axes took, so the *ratio*
  // between them -- which is where the data actually lives -- comes through
  // untouched. Leaving it at one would be just as destructive as averaging it:
  // a thuja spray's metadata is scale.z / scale.x, so rescaling x alone
  // rewrites it exactly as surely as rescaling z would.
  for (const axis of [0, 1, 2]) {
    if (carriesData[axis]) scale.setComponent(axis, geometryFactor ?? 1);
  }
  if (spread > RATIO_TOLERANCE) {
    return {
      reason: `the rescale differs per organ rather than per band (relative spread ${spread.toFixed(4)})`,
    };
  }

  return { survivors, scale, spread };
}

/**
 * Express every band of one organ kind as a subset of the finest band.
 *
 * @param {readonly object[]} bakes One bake per band, finest first — a
 *   prototype's `bands[].baked`.
 * @param {string} kind Organ kind, as the bake names it.
 * @returns {{
 *   kind: string,
 *   compositional: boolean,
 *   reason: string | null,
 *   base: object | null,
 *   capacity: number,
 *   bands: Array<{
 *     drawn: boolean,
 *     organ: object | null,
 *     survivors: Uint32Array | null,
 *     scale: THREE.Vector3 | null,
 *   }>,
 * }} `compositional` says whether a field may allocate this kind once, for
 *   `capacity` instances, and switch bands with `survivors` and `scale`.
 *   `reason` says why not, when it may not. `bands` is indexed by band, and
 *   `survivors` indexes into the base band.
 */
export function analyzeOrganComposition(bakes, kind) {
  const notCompositional = (reason) => ({
    kind,
    compositional: false,
    reason,
    base: null,
    capacity: 0,
    bands: [],
  });

  if (!Array.isArray(bakes) || bakes.length === 0) {
    throw new TypeError('Composition needs at least one baked band.');
  }

  const organAt = (band) =>
    bakes[band].organs.find((organ) => organ.kind === kind) ?? null;

  const base = organAt(0);
  if (!base || base.count === 0) {
    // Not merely empty: a coarser band may still draw this kind, which is
    // exactly what echinacea does out of flower. Then the finest band is not
    // the superset and there is nothing to be a subset of.
    const drawnLater = bakes.some(
      (_, band) => band > 0 && organAt(band)?.count,
    );
    return notCompositional(
      drawnLater
        ? 'the finest band draws none of this kind while a coarser band does, so the finest band is not the superset'
        : 'the kind is never drawn',
    );
  }

  const index = indexPlacements(base);
  const bands = [
    {
      drawn: true,
      organ: base,
      // The base band is the identity subset. Spelling it out keeps a caller
      // from special-casing band 0.
      survivors: Uint32Array.from({ length: base.count }, (_, i) => i),
      scale: new THREE.Vector3(1, 1, 1),
    },
  ];

  for (let band = 1; band < bakes.length; band += 1) {
    const organ = organAt(band);
    if (!organ || organ.count === 0) {
      bands.push({ drawn: false, organ: null, survivors: null, scale: null });
      continue;
    }

    const matched = matchBand(base, index, organ);
    if (matched.reason) {
      return notCompositional(`band ${band}: ${matched.reason}`);
    }
    bands.push({
      drawn: true,
      organ,
      survivors: matched.survivors,
      scale: matched.scale,
    });
  }

  return {
    kind,
    compositional: true,
    reason: null,
    base,
    // Every other band is a subset of the base band, so the base band is the
    // high-water mark and capacity is known before a single instance exists.
    capacity: base.count,
    bands,
  };
}

/**
 * The matrix a survivor is drawn with at one band.
 *
 * A band rescales in the organ's own local frame, and `M = T·R·S` means a
 * right-multiplied scale multiplies exactly the scale component — so this is
 * the base matrix times a diagonal, with no decompose and no recompose. It is
 * what a field applies when a plant crosses a band boundary.
 *
 * @param {THREE.Matrix4} target
 * @param {Float32Array} baseMatrices The base band's matrices.
 * @param {number} baseIndex Which base organ, from a band's `survivors`.
 * @param {THREE.Vector3} scale That band's rescale.
 * @returns {THREE.Matrix4} `target`
 */
export function composeSurvivorMatrix(target, baseMatrices, baseIndex, scale) {
  target.fromArray(baseMatrices, baseIndex * 16);
  return target.scale(scale);
}

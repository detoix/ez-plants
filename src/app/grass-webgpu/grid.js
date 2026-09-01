/**
 * CPU-side control plane for the camera-centred grass grids.
 *
 * These values describe persistent GPU allocations. Camera movement changes
 * only each grid's integer world-cell origin; it never changes a capacity and
 * never replaces a buffer. The shader uses the same integer cells as seeds, so
 * returning to a place returns the same grass.
 */

const RAW_RINGS = [
  {
    id: 'near',
    inner: 0,
    outer: 8,
    spacing: 0.025,
    segments: 3,
    densityNear: 1600,
    densityFar: 1 / 0.075 ** 2,
  },
  {
    id: 'mid',
    inner: 8,
    outer: 24,
    spacing: 0.075,
    segments: 2,
    densityNear: 1 / 0.075 ** 2,
    densityFar: 1 / 0.2 ** 2,
  },
  {
    id: 'far',
    inner: 24,
    outer: 52,
    spacing: 0.2,
    segments: 1,
    densityNear: 1 / 0.2 ** 2,
    densityFar: 0,
  },
];

export const WORLD_CELL_BIAS = 1_048_576;

function coveredSide(outer, spacing) {
  // Two spare rows cover the sub-cell remainder while the centre is snapped.
  const side = Math.ceil((outer * 2) / spacing) + 2;
  return side % 2 === 0 ? side : side + 1;
}

export const GRASS_RINGS = Object.freeze(
  RAW_RINGS.map((ring, index) => {
    const side = coveredSide(ring.outer, ring.spacing);
    return Object.freeze({
      ...ring,
      index,
      side,
      capacity: side * side,
      candidateDensity: 1 / ring.spacing ** 2,
    });
  }),
);

export const TOTAL_GRASS_CANDIDATES = GRASS_RINGS.reduce(
  (total, ring) => total + ring.capacity,
  0,
);

export function gridCellAt(value, spacing) {
  return Math.floor(value / spacing);
}

export function createRingState(ring) {
  return {
    ring,
    centreCellX: Number.NaN,
    centreCellZ: Number.NaN,
    originCellX: 0,
    originCellZ: 0,
  };
}

/** Mutates an allocation's small control object, never the allocation itself. */
export function snapRingState(state, worldX, worldZ) {
  const { ring } = state;
  const centreCellX = gridCellAt(worldX, ring.spacing);
  const centreCellZ = gridCellAt(worldZ, ring.spacing);
  if (centreCellX === state.centreCellX && centreCellZ === state.centreCellZ) {
    return false;
  }

  state.centreCellX = centreCellX;
  state.centreCellZ = centreCellZ;
  state.originCellX = centreCellX - ring.side / 2;
  state.originCellZ = centreCellZ - ring.side / 2;
  return true;
}

export function worldCellForSlot(state, slot, target = {}) {
  const column = slot % state.ring.side;
  const row = Math.floor(slot / state.ring.side);
  target.x = state.originCellX + column;
  target.z = state.originCellZ + row;
  return target;
}

export function ringDistance(x, z) {
  return Math.hypot(x, z);
}

export function ringOwnsDistance(ring, distance) {
  return distance >= ring.inner && distance < ring.outer;
}

export function ringForDistance(distance) {
  return GRASS_RINGS.find((ring) => ringOwnsDistance(ring, distance)) ?? null;
}

export function targetDensityAt(ring, distance) {
  const span = ring.outer - ring.inner;
  const linear = span > 0 ? (distance - ring.inner) / span : 0;
  const t = Math.min(1, Math.max(0, linear));
  const smooth = t * t * (3 - 2 * t);
  return ring.densityNear + (ring.densityFar - ring.densityNear) * smooth;
}

export function retentionAt(ring, distance) {
  return Math.min(
    1,
    Math.max(0, targetDensityAt(ring, distance) / ring.candidateDensity),
  );
}

/**
 * The same 32-bit composition and PCG hash used by Three's TSL `hash()` node.
 * It is intentionally based on signed world cells converted to uint32.
 */
export function worldCellSeed(cellX, cellZ, salt = 0) {
  return (
    (Math.imul(cellX + WORLD_CELL_BIAS, 1_664_525) +
      Math.imul(cellZ + WORLD_CELL_BIAS, 1_013_904_223) +
      salt) >>>
    0
  );
}

export function hashUint(seed) {
  const state = (Math.imul(seed >>> 0, 747_796_405) + 2_891_336_453) >>> 0;
  const word = Math.imul(
    ((state >>> ((state >>> 28) + 4)) ^ state) >>> 0,
    277_803_737,
  );
  const result = ((word >>> 22) ^ word) >>> 0;
  return result / 4_294_967_296;
}

export function worldCellRandom(cellX, cellZ, salt = 0) {
  return hashUint(worldCellSeed(cellX, cellZ, salt));
}

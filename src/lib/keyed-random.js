function hashString(hash, value) {
  const text = String(value);
  let result = hash;
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  result ^= 255;
  return Math.imul(result, 16777619);
}

/**
 * Stateless keyed random number in [0, 1).
 *
 * This is the blackcurrant model's existing hash algorithm, preserved exactly
 * so moving it into shared code does not change any generated organ.
 */
export function keyedRandom(seed, ...keys) {
  let hash = hashString(2166136261, seed);
  for (const key of keys) hash = hashString(hash, key);
  return (hash >>> 0) / 4294967296;
}

/** Map a keyed random sample into [min, max). */
export function keyedRange(seed, keys, min, max) {
  return min + (max - min) * keyedRandom(seed, ...keys);
}

/** Return a keyed integer in the inclusive range [min, max]. */
export function keyedInteger(seed, keys, min, max) {
  return Math.floor(keyedRange(seed, keys, min, max + 1));
}

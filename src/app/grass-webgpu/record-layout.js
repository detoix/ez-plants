const UINT32_BYTES = Uint32Array.BYTES_PER_ELEMENT;

/** Six 32-bit words: exact world X/Z bits plus four packed attribute words. */
export const GRASS_RECORD_WORDS = 6;
export const GRASS_RECORD_BYTES = GRASS_RECORD_WORDS * UINT32_BYTES;
export const GRASS_VISIBLE_ID_BYTES = UINT32_BYTES;

export function grassStorageFootprint(candidateCount) {
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 0) {
    throw new RangeError(
      'Grass candidate count must be a non-negative integer.',
    );
  }

  const recordBytes = candidateCount * GRASS_RECORD_BYTES;
  const visibleIdBytes = candidateCount * GRASS_VISIBLE_ID_BYTES;
  return Object.freeze({
    recordBytes,
    visibleIdBytes,
    totalBytes: recordBytes + visibleIdBytes,
  });
}

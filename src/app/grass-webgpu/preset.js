/**
 * The maintained lawn's scalar dimensions and colours, in one place.
 *
 * The target is a mown residential lawn, which is a much smaller thing than the
 * meadow most procedural examples target: blades a few centimetres tall,
 * narrow, and close together.
 */
export const LAWN = Object.freeze({
  /** Blades per square metre of ground. Lawn territory starts around 150.
   *
   *  This and `radius` multiply, and between them they are what the page costs:
   *  at these defaults there are about half a million blades, which on a
   *  mid-range GPU is roughly as much grass as can be drawn while the mixed
   *  plant field is still on screen.
   *
   *  It is worth knowing what that buys: 110 blades per square metre is one
   *  every 9.5 cm, and a real lawn is nearer ten thousand. At a standing eye
   *  height you are looking at ground a metre and a half away, and the gap
   *  shows. Turning `grassdensity` up fixes the near ground and costs the far
   *  ground you will never look closely at -- which is the case for a
   *  distance-graded density used by the persistent WebGPU rings. */
  density: 110,
  /** Metres. A mown lawn is 4-8 cm; the spread is narrow on purpose. */
  minHeight: 0.04,
  maxHeight: 0.08,
  /** Metres across at the base. Real turf grass is 2-4 mm; 8-14 reads better
   *  at a walking distance, where a 3 mm blade is thinner than a pixel and
   *  aliases into noise. */
  minWidth: 0.008,
  maxWidth: 0.014,
  /** Half-width, in metres, of the square patch grass is grown on. See
   *  `createLawnPatch`: this is the draw-distance dial, because density is per
   *  unit area. Sized to cover the planting -- the default garden is about 50 m
   *  across -- and the camera starts a few metres outside it, so the opening
   *  frame is grass rather than the bare strip in front of it. */
  radius: 34,
  shadows: true,
});

/** Lawn green, shared so the candidates are compared on shading, not on hue. */
export const LAWN_COLORS = Object.freeze({
  bottom: '#2f4a15',
  top: '#6d9a35',
  backlight: '#9ec756',
  /** What the terrain under the blades is painted, so bald spots read as turf
   *  seen edge-on rather than as bare earth. */
  ground: '#3c5a1d',
});

/**
 * How many blades a patch of this area wants, with a caller-selected ceiling.
 */
export function bladeCountFor(area, density, ceiling = Infinity) {
  return Math.max(1, Math.min(Math.floor(area * density), ceiling));
}

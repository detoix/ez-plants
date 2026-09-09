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
  /** Metres across at the base. Real turf grass is 2-4 mm, and these are it.
   *
   *  They used to be 8-14 -- three to four times life size -- because a 3 mm
   *  blade is thinner than a pixel at walking distance and aliases into noise.
   *  That bought stability with silhouette, and it is what made the lawn read
   *  as fat spikes. `minBladePixels` buys the same stability on screen
   *  instead, so the blade can be the width it actually is. */
  minWidth: 0.003,
  maxWidth: 0.005,
  /** Exponent of the blade's width falloff: `(1 - y) ** taper`.
   *
   *  Grass holds its width up the sheath and narrows over the last third. A
   *  linear falloff (taper 1) narrows from the root instead, and because it
   *  has the same outline however many segments sample it, it made every
   *  blade at every band one isosceles triangle -- a field of spikes. 0 is a
   *  rectangle. */
  taper: 0.35,
  /** Floor on a blade's *projected* width, in physical pixels.
   *
   *  A blade thinner than about a pixel does not shrink, it flickers: it
   *  catches some frames and misses others as the camera moves. Rather than
   *  drawing every blade too wide everywhere to avoid it, widen only the
   *  blades that would fall under this, only by as much as they fall short --
   *  the trick Ghost of Tsushima uses for blades turned edge-on. It covers
   *  both ways a blade goes sub-pixel: distance, and turning its edge to the
   *  camera. Costs fill, not geometry. */
  minBladePixels: 1.5,
  /** Ceiling on that widening, as a multiple of a blade's true width.
   *
   *  Load-bearing, not taste. The culling sphere is sized from the blade's
   *  true width, and a blade widened past this leaves the sphere that decides
   *  whether to draw it -- which is invisible until something at the frame
   *  edge starts winking. `test/field-webgpu-blade-bounds.test.js` holds the
   *  widest thickened blade inside the sphere across the whole size range. */
  maxThicken: 4,
  /** Radians the tip leans from upright at rest, drawn per blade.
   *
   *  Posture, not wind. Every blade used to share one baked 0.14 rad curve,
   *  which is why the lawn stood to attention: yaw only spins a blade about
   *  its own axis, so nothing in the field leaned.
   *
   *  `maxBend` is load-bearing beyond looks. The culling pass bounds a blade
   *  with a sphere half way up it, and a leaning tip is further from that
   *  centre than an upright one -- 0.527 of the blade's height at 0.55 rad,
   *  against the 0.58 the radius allows. Raise this and that margin is what
   *  runs out, which shows up as blades winking out at the frame edge rather
   *  than as anything the tests would catch on their own.
   *  `test/field-webgpu-blade-bend.test.js` holds the two together. */
  /** Blades grown from each placed crown.
   *
   *  A candidate is a crown, not a blade. Turf grass tillers -- one plant puts
   *  up several blades from one crown -- so this is what the plant does, and
   *  it is also the cheapest density there is: candidate slots, placement
   *  work, culling work and the 30 MiB of storage are all per crown and none
   *  of them move. Only the vertex stage and fill grow.
   *
   *  It multiplies every ring equally on purpose. The rings hand over to each
   *  other at matched densities, and tillering one band harder than its
   *  neighbour would put a visible step at 8 m or 24 m where today there is
   *  none. */
  /** Metres across a clump of crowns that share traits.
   *
   *  Tillering clumps at the centimetre of a single crown. This is the other
   *  scale: Ghost of Tsushima's grass picks the nearest of a scattered set of
   *  clump points and takes that clump's height and facing, so a field grows
   *  in patches -- some short, some leaning a different way -- instead of
   *  every plant being statistically identical to its neighbour. Set at a
   *  lawn's scale rather than a meadow's. */
  clumpSize: 0.45,
  /** Shortest a clump may be as a fraction of the crowns' own height.
   *
   *  Only ever shortens, for the same reason `tillerShortest` does: the
   *  culling sphere is measured from a crown's full height, and grass that
   *  grows past it is culled while still on screen. */
  clumpShortest: 0.75,
  /** How hard a clump's facing pulls its crowns round to it.
   *
   *  A weight on the clump's heading against each crown's own, so 0 leaves
   *  every crown independent and large values march them in lockstep. It is
   *  added rather than interpolated so the sum can never cancel to a zero
   *  vector, which has no direction to normalize. */
  clumpPull: 1.2,
  tillers: 3,
  /** Metres across the crown a tiller may stand from its neighbours.
   *
   *  Folded into the culling sphere, which is centred on the crown and must
   *  still contain the blade furthest from it. */
  tillerSpread: 0.012,
  /** Radians of yaw a tiller may fan from the crown's own facing, either way.
   *  Zero makes each crown a stack of parallel blades, which reads as one fat
   *  blade rather than several thin ones. */
  tillerFan: 0.7,
  /** Shortest a tiller may be as a fraction of its crown's blade height.
   *  Real tillers are not all the same age; equal heights read as a mown
   *  bristle rather than a growing tuft. Never above 1, or a tiller outgrows
   *  the culling sphere its crown was measured for. */
  tillerShortest: 0.7,
  minBend: 0.1,
  maxBend: 0.55,
  /** Radians the shading normal splays out at a blade's edge.
   *
   *  A blade is two vertices wide, so it is flat, and shading it by its true
   *  facing makes every blade a solid wedge of one colour -- the cutout look.
   *  Real blades are curved in section and catch light across their width, so
   *  the normal is splayed toward each edge and interpolated between them.
   *  This is a lighting fiction over flat geometry, and it is the cheapest
   *  thing in the lawn that reads as roundness. */
  normalSpread: 0.8,
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

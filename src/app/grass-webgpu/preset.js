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
  /** Blades grown from each placed crown. See the block comment above.
   *
   *  The near ring places 1,600 crowns a square metre, so this is 6,400
   *  blades/m2 at four and 4,800 at three, against the ten thousand real turf
   *  carries. Tillering is the only lever that moves that number without
   *  touching a candidate slot.
   *
   *  Half of the cost claim above is now measured and exact. At 1280x720 on an
   *  Intel Iris Xe, every tiller count culled to the same 67,082 visible
   *  crowns and held the same 87.5 MiB, while submitted triangles scaled
   *  precisely with it: 208,170 at one, 624,510 at three, 832,680 at four,
   *  1,249,020 at six. Placement, culling and storage really are per crown.
   *
   *  The other half -- what a tiller costs in *time* -- is not measured, and
   *  the attempt is worth recording so it is not repeated carelessly. On that
   *  machine the same configuration spread 42 to 56 fps across runs, and in
   *  some runs a heavier setting beat a lighter one. An integrated GPU
   *  throttling under sustained load, on a machine in use, cannot resolve a
   *  difference this size. Direction is certain; magnitude is not.
   *
   *  So this number is a judgement, not a result, and it is a dial for exactly
   *  that reason: `?tillers=` on `/field`, 1 to 12. Measure it on the hardware
   *  you care about before moving it, with `?count=0` to take the plants out
   *  and against vsync rather than an unlocked frame rate. */
  tillers: 4,
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
  /** Radians the tip leans from upright at rest, drawn per blade across this
   *  range. Posture, not wind.
   *
   *  The floor was 0.1 -- 5.7 degrees, which is upright. Whatever the ceiling
   *  is, a share of every crown's blades were drawn from the bottom of this
   *  range and stood to attention, and that is what a lawn of spikes is made
   *  of. 0.2 is 11.5 degrees and no blade is vertical any more.
   *
   *  Set by eye, and worth saying why: a pixel comparison could not see it.
   *  Raising this floor by 2.5x moved the dark 5th percentile of the lawn --
   *  the gaps -- by 0.0, and the vertical-to-horizontal gradient ratio by
   *  1.2%, which is nothing. That measurement was right about what it
   *  measured: leaning a blade redistributes a 3-5 mm sliver, it does not add
   *  any, so lean cannot close a gap. Coverage is count x width x length.
   *  Character is not coverage, and this is a character change.
   *
   *  `?bendmin=0.5` on `/field` restores the old floor.
   *
   *  `maxBend` is the load-bearing half. The culling pass bounds a blade with
   *  a sphere half way up it, and a leaning tip is further from that centre
   *  than an upright one. That radius is no longer a constant -- see
   *  `bladeCullRadiusFactor` in `blade-arc.js`, which derives it from this
   *  value, so raising the ceiling grows the sphere instead of quietly
   *  pushing blades outside it. `test/field-webgpu-blade-bounds.test.js`
   *  holds the two together across the whole dial range. */
  minBend: 0.2,
  maxBend: 0.55,
  /** How dark a blade's root goes, as a multiplier on its own colour.
   *
   *  A blade in turf is not lit from the soil up: it stands in a few
   *  centimetres of its neighbours, and the light reaching the bottom third of
   *  it has been through several of them. Nothing in this lawn models that --
   *  blades cast no shadow-map silhouette on purpose, at 4-8 cm it costs more
   *  than it returns -- so without this the field is a plane of evenly lit
   *  strips and reads flat from above, which is the angle a walking camera
   *  sees it from.
   *
   *  It multiplies albedo rather than arriving through `aoNode`, which in a
   *  standard material only attenuates indirect light: the occlusion being
   *  faked here takes the sun out too. It compounds with the existing
   *  bottom-to-top colour gradient, which is why it is 0.55 and not the 0.45
   *  a blade in isolation would want. */
  rootOcclusion: 0.55,
  /** Fraction of a blade's length the root occlusion fades out over.
   *
   *  Measured up the blade, not up the world, so a short blade is shaded like
   *  a tall one. That is the approximation: real occlusion is deepest at a
   *  fixed height above the soil, so a short blade should be darker over more
   *  of itself than a tall one. Carrying blade height into the fragment stage
   *  to model that costs a varying for a difference across a 4-8 cm spread. */
  rootOcclusionHeight: 0.38,
  /** Where a dry patch starts and where it is fully dry, on the inverted
   *  world health signal.
   *
   *  Lawn is not one green. It is greener where the ground holds water and
   *  straw-coloured where it does not, and those places are metres across, not
   *  blades across -- a lawn with 10% of its blades independently yellow is
   *  television static, which is the trap the obvious implementation falls
   *  into. `surface.healthAt()` is the patch, sampled at a 161.3 m world tile
   *  so a whole view holds a handful of them, and the *ground under the
   *  blades reads the same signal through the same function*, so a dry patch
   *  is dry all the way down instead of green turf standing on straw. */
  dryOnset: 0.35,
  dryFull: 0.9,
  /** How far a blade may differ from its patch, either way.
   *
   *  Without it a patch is a flat wash of one colour with a hard-edged
   *  neighbour. This is the only place the dry signal is allowed to be per
   *  blade, and it is a modulation of the patch rather than a probability of
   *  its own: outside a patch it multiplies zero. */
  dryScatter: 0.55,
  /** How far towards straw a fully dry blade goes. Under 1 on purpose -- a
   *  maintained lawn browns, it does not turn to hay. */
  dryStrength: 0.6,
  /** The same, for the terrain underlay. Lower, because the underlay already
   *  carries its own variation from the Grass004 albedo and is the far-field
   *  lawn: pushing it as hard as the blades makes the horizon two-tone. */
  groundDryStrength: 0.42,
  /** How much light a blade passes through itself, into the eye.
   *
   *  A blade is a fraction of a millimetre of translucent tissue: lit from
   *  behind it lights up rather than going dark, and that is most of what a
   *  lawn looks like into the sun. No roughness value produces it, because it
   *  is not a reflection -- see `blade-lighting.js`, which adds it as a real
   *  directional, shadow-gated term rather than as emissive green.
   *
   *  Kept under 1: at these values a backlit tip brightens, it does not turn
   *  into a light source. `LAWN_COLORS.backlight` is the colour it carries,
   *  which is the green the blade has taken out of the light on the way
   *  through. */
  backscatter: 0.55,
  /** Exponent on the light-through-blade alignment.
   *
   *  This is what keeps it a *rim*. At 1 the term is a wash over everything
   *  facing vaguely away from the sun; high values pull it into the narrow
   *  band where the sun is genuinely behind the blade, which is where you see
   *  it in a photograph. It is the dial to reach for first if the lawn looks
   *  hazy rather than backlit. */
  backscatterPower: 4,
  /** Where along a blade transmission starts, as a fraction of its length.
   *
   *  Load-bearing against `rootOcclusion`, not taste. A blade thickens toward
   *  the sheath and stands in more of its neighbours down there, so it passes
   *  almost nothing through its base -- and the base is exactly where root
   *  occlusion is darkest. Let this reach below `rootOcclusionHeight` and the
   *  two fight: the blade glows brightest at the point the other term just
   *  darkened. `test/field-webgpu-blade-bounds.test.js` holds them apart. */
  backscatterTip: 0.45,
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

import * as THREE from 'three';

import {
  finishGeometry,
  validatePositiveInteger,
} from '../../organ-geometry.js';

/**
 * How much of the spike plate's width the painted head occupies.
 *
 * The tile is drawn at the spike's own proportions -- a 4 cm head 1.1 cm
 * across -- so the head spans this share of it and a card has to be
 * `width / SPIKE_PLATE_FILL` wide for the paint to land at the model's real
 * dimensions. It must move with `HALF_FILL` in
 * `scripts/make-spike-texture.mjs`, which is this number halved. Get it wrong
 * and 'Hidcote' comes out either as a bottlebrush or as a violet thread.
 */
export const SPIKE_PLATE_FILL = 0.27;

const UP = new THREE.Vector3(0, 1, 0);
const SIDE = new THREE.Vector3(1, 0, 0);

/**
 * One lavender flower spike, as a crossed pair of textured cards.
 *
 * Rule 9's fuzz clause, applied to the organ this whole plant exists for. A
 * 'Hidcote' spike is five to nine whorls of tiny two-lipped corollas standing
 * out of a column of woolly calyces — several hundred separate parts on a
 * body four centimetres long, and a mature plant carries a hundred and fifty
 * of them at once. Meshed even coarsely that is tens of thousands of
 * triangles for something that is a violet smudge at two metres. As alpha it
 * is **eight triangles**, and mipmapping does exactly the right thing to it
 * as the plant recedes.
 *
 * Crossed rather than flat for the same reason the miscanthus head is: a
 * lavender in flower is a stand of a hundred spikes pointing in every
 * direction, so whichever way it is seen a third of them are edge on, and a
 * flat card at that angle disappears. Two ribbons keep every spike a solid
 * body from any azimuth, which is the entire reason to draw one.
 *
 * The unit frame is rooted at y = 0 and one unit tall, so the instance matrix
 * carries the spike's length in Y and its width in X and Z. `uv.y` runs from
 * the base to the tip and is therefore also the shared leaf wind's bend
 * weight: a spike stays put where its stem holds it and nods at the top,
 * which is what a real one does on a stiff square peduncle.
 *
 * The normals are **cylindrical, not flat**, for the same reason
 * `createLeafCardGeometry` rounds its own: a card is a stand-in for a body,
 * and it only reads as that body if it is shaded like one. Here the body is a
 * column. A ribbon given one constant normal is lit as the flat plate it
 * literally is — and because both of this card's ribbons stand vertically,
 * that constant faces sideways, so a spike gathers almost nothing from the
 * sky and the whole stand renders as a dark bar whatever hue it is tinted.
 * Measured on the review page, that one detail was worth more of the plant's
 * missing violet than the tint constants were: the cards were not too purple,
 * they were unlit.
 *
 * Bending each vertex normal outward across the ribbon's width fixes the
 * silhouette as well as the value. A real spike is round, so it carries a lit
 * side, a terminator and a shaded side; a flat one flips between fully lit
 * and fully dark as the camera swings, which on a hundred and fifty spikes is
 * a stand that visibly strobes. `roundedNormals` is spelled and defaulted the
 * way the leaf card spells it, so the two cards read as one idea.
 *
 * The bend has two parts and they do different jobs. `WRAP` turns each edge
 * away from its face and buys the *form*. `CANOPY_LIFT` tips the whole normal
 * skyward and buys the *value* -- it is worth about 30% of the plant's
 * rendered brightness on its own, which is more than every colour constant in
 * the renderer put together, and its comment carries the measurement.
 *
 * @param {object} [options]
 * @param {number} [options.segments=2] Rows along the spike.
 * @param {boolean} [options.crossed=true] Two ribbons rather than one.
 * @param {number} [options.taper=0.42] How far the head narrows at its tip.
 * @param {number} [options.shoulder=0.16] Height of the widest point.
 * @param {boolean} [options.roundedNormals=true] Shade as a column, not a plate.
 */
export function createSpikeCardGeometry({
  segments = 2,
  crossed = true,
  taper = 0.42,
  shoulder = 0.16,
  roundedNormals = true,
} = {}) {
  validatePositiveInteger(segments, 'segments');
  if (!Number.isFinite(taper) || taper < 0 || taper >= 1) {
    throw new RangeError('taper must be a finite number from 0 to 1.');
  }
  if (!Number.isFinite(shoulder) || shoulder < 0 || shoulder >= 1) {
    throw new RangeError('shoulder must be a finite number from 0 to 1.');
  }

  const positions = [];
  const colors = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  // A spike is slightly narrower at the base than at its shoulder and drawn
  // out to a point above it. Half a unit is full width, so the card matches
  // the plate's own proportions once `SPIKE_PLATE_FILL` is applied.
  const halfWidthAt = (t) => {
    if (t <= shoulder)
      return 0.5 * (0.78 + 0.22 * (t / Math.max(1e-6, shoulder)));
    const above = (t - shoulder) / (1 - shoulder);
    return 0.5 * (1 - taper * above * above);
  };

  // How far the edge of a ribbon turns away from its face. A full 90 degrees
  // would be geometrically honest for a cylinder and is wrong here: the two
  // ribbons already cover the round silhouette between them, so wrapping each
  // one all the way leaves the seam where they cross reading as a crease. This
  // is the leaf card's own compromise, at a column's proportions.
  const WRAP = 0.75;
  // A column of calyces is not a mirror-symmetric tube either — it is drawn to
  // a point, so its surface leans in toward the tip and picks up sky along the
  // way. Without this the top of every spike is as sidelit as its middle and
  // the head loses the taper the plate worked to draw.
  const TIP_LEAN = 0.3;
  /**
   * How far every normal is tipped toward the sky, before the two terms above
   * are added. This is the one that governs the plant's colour.
   *
   * `HemisphereLight` blends its sky and ground colours on `0.5 * normal.y +
   * 0.5`, and the review rig's ground colour is 0x4b493d -- near black. Two
   * crossed ribbons that both stand vertically have normals pointing sideways,
   * so before this constant existed a spike sat at mean `normal.y` of 0.118:
   * 44% lit by a near-black hemisphere, whatever colour it was tinted. That,
   * and not the tint, was why 'Hidcote' rendered as a dark bar. Raising the
   * albedo could not fix it and only bleached the hue.
   *
   * The value is measured, not chosen. Rendered against the six Commons
   * photographs `HIDCOTE_SOURCES.datedObservations` cites, sampling violet
   * pixels only, the five true *L. angustifolia* 'Hidcote' plants average a
   * luminance of 96. On identical geometry, with only this constant moved:
   *
   *     0.0  ->  mean normal.y 0.118  ->  luminance  76   (79%)
   *     0.6  ->  mean normal.y 0.511  ->  luminance  97  (101%)
   *     1.2  ->  mean normal.y 0.720  ->  luminance 105  (109%)
   *
   * So 0.6 lands on the photographs, and its rendered #6c5b84 sits beside the
   * Vilnius plant's #695c96 in hue as well as in value.
   *
   * Tipping a normal off its surface is not a cheat here, it is the standard
   * treatment for exactly this geometry: SpeedTree points grass normals
   * straight up for uniform lighting on thin vertical cards and "puffs" bush
   * clusters outward from their centre for form. A lavender spike is both, so
   * it gets both -- `WRAP` for the form, this for the light. It is also what
   * `keepAuthoredNormalsOnBackFaces` already asks for one level up: author the
   * normal the card would have as part of the convex surface it approximates.
   * For a spike that surface is not its own column, it is the flowering
   * canopy the whole stand makes, and a canopy faces the sky.
   */
  const CANOPY_LIFT = 0.6;

  const ribbon = (across, facing) => {
    const base = positions.length / 3;
    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments;
      for (const side of [-1, 1]) {
        const point = across
          .clone()
          .multiplyScalar(side * halfWidthAt(t))
          .setY(t);
        positions.push(point.x, point.y, point.z);
        // Neutral. Every trace of hue belongs to the instance colour, or a
        // dry August head would keep July's violet baked into its own plate.
        colors.push(1, 1, 1);
        const normal = roundedNormals
          ? facing
              .clone()
              .addScaledVector(across, side * WRAP)
              .addScaledVector(UP, CANOPY_LIFT + TIP_LEAN * t)
              .normalize()
          : facing;
        normals.push(normal.x, normal.y, normal.z);
        uvs.push((side + 1) / 2, t);
      }
    }
    for (let step = 0; step < segments; step += 1) {
      const a = base + step * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };

  const axisA = SIDE.clone();
  const axisB = new THREE.Vector3(0, 0, 1);
  ribbon(axisA, axisB);
  if (crossed) ribbon(axisB, axisA);

  return finishGeometry({
    positions,
    colors,
    indices,
    normals,
    uvs,
    userData: { organ: 'spike', crossed, segments, roundedNormals },
  });
}

export { UP as SPIKE_UP };

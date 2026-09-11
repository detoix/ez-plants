import * as THREE from 'three/webgpu';

import { LAWN, LAWN_COLORS } from './preset.js';

const { color, float, positionViewDirection } = THREE.TSL;

/**
 * The lawn's lighting, which is the standard one plus the light that comes
 * *through* a blade.
 *
 * A grass blade is a fraction of a millimetre of translucent tissue. Lit from
 * behind it does not go dark, it lights up -- that is most of what a lawn
 * looks like into the sun, and a purely reflective model cannot produce it at
 * any roughness. This adds the missing term and nothing else: everything
 * reflective is still `PhysicalLightingModel`'s.
 *
 * Three things make it a transmission term rather than green paint:
 *
 * - **It is directional.** The strength is `dot(-lightDirection, viewDirection)`
 *   raised to a power, so it appears only where the light is behind the blade
 *   relative to the eye and falls off as you walk around it. Both vectors are
 *   already in view space here, and `lightDirection` points from the surface
 *   toward the light, so negating it is the direction the transmitted light
 *   carries on in.
 * - **It is strongest at the tip.** A blade thickens towards the sheath and
 *   stands in more of its neighbours down there, so the bottom transmits
 *   almost nothing. That is also where `LAWN.rootOcclusion` is darkest, and
 *   the two have to agree or the blade glows exactly where it was occluded.
 * - **It is shadow-aware, and gets that for free.** `lightColor` arriving at
 *   `direct()` has already been multiplied by the light's shadow node --
 *   `AnalyticLightNode.setupShadow()` does it before the lighting model ever
 *   runs -- so multiplying by it suppresses the term inside shadow with no
 *   shadow lookup of this material's own. That is the whole reason this is a
 *   lighting model and not an `emissiveNode`: an emissive term would keep
 *   glowing under a tree, at night, and on the shadowed side of a hill.
 */
export class GrassLightingModel extends THREE.PhysicalLightingModel {
  /**
   * @param {Node} bladeGradient Blade-local height, 0 at the root and 1 at the
   *   tip. Per ring, because each ring's material carries its own varying.
   */
  constructor(bladeGradient) {
    super();
    this.bladeGradient = bladeGradient;
  }

  direct(lightData, builder) {
    super.direct(lightData, builder);

    const { lightDirection, lightColor, reflectedLight } = lightData;

    // How much of this light is travelling towards the eye after passing
    // through the blade. Negated because `lightDirection` points at the light.
    const throughBlade = lightDirection
      .negate()
      .dot(positionViewDirection)
      .clamp(0, 1)
      .pow(float(LAWN.backscatterPower));

    // Thin tissue only. Held to zero across the base, where the blade is thick
    // and `rootOcclusion` is darkest.
    const thinness = this.bladeGradient
      .clamp(0, 1)
      .smoothstep(LAWN.backscatterTip, 1);

    reflectedLight.directDiffuse.addAssign(
      lightColor
        .mul(color(LAWN_COLORS.backlight))
        .mul(throughBlade)
        .mul(thinness)
        .mul(float(LAWN.backscatter)),
    );
  }
}

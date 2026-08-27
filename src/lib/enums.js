export const Billboard = {
  Single: 'single',
  Double: 'double',
};

export const TreeType = {
  Deciduous: 'deciduous',
  Evergreen: 'evergreen',
};

/**
 * How much of a plant is worth rendering into the shadow map at one LOD band.
 *
 * An ordered ladder, coarsening with distance. Casting a shadow costs a whole
 * extra draw per shadow-casting light, and a leaf's contribution to a distant
 * silhouette is close to nothing, so the organs drop out first and the trunk
 * outline survives longest.
 */
export const ShadowCast = {
  /** Wood and every organ cast. Correct up close. */
  All: 'all',
  /** Only the woody architecture casts; organs stop paying for a shadow. */
  Wood: 'wood',
  /** Nothing casts. For bands where the plant is a few pixels tall. */
  None: 'none',
};

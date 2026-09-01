export const LAWN_UNDERLAY = Object.freeze({
  solid: 'solid',
  lawn: 'lawn',
});

export const LAWN_PBR_WORLD_SIZE = 1.4;
export const LAWN_PBR_SECONDARY_UV_SCALE = 0.931;
export const LAWN_MACRO_WORLD_SIZE = 31.7;
export const LAWN_MACRO_SAMPLE_LEVEL = 5;

export const LAWN_PBR_ASSET = Object.freeze({
  id: 'Grass004',
  title: 'Grass 004',
  creator: 'ambientCG',
  source: 'https://ambientcg.com/a/Grass004',
  license: 'CC0 1.0 Universal',
  licenseURL: 'https://docs.ambientcg.com/license/',
  worldWidth: LAWN_PBR_WORLD_SIZE,
  encodedBytes: 615_023,
  maps: Object.freeze({
    albedoRoughness: Object.freeze({
      url: new URL(
        './assets/grass004/lawn-albedo-roughness.webp',
        import.meta.url,
      ).href,
      width: 1024,
      height: 1024,
      channels: 4,
      encodedBytes: 339_200,
      sha256:
        'f125db0beb05752da57bb29ae9bc37432247618b1bf2bb21a93cc51251085401',
    }),
    normal: Object.freeze({
      url: new URL('./assets/grass004/lawn-normal-gl.jpg', import.meta.url)
        .href,
      width: 512,
      height: 512,
      channels: 4,
      encodedBytes: 275_823,
      sha256:
        '91c5ca235c06129211944635955d94d01d19b5b3faa561b0fa2dfae1eb20f335',
    }),
  }),
});

export function normalizeLawnUnderlay(value) {
  return value === LAWN_UNDERLAY.solid
    ? LAWN_UNDERLAY.solid
    : LAWN_UNDERLAY.lawn;
}

export function mipmappedTextureBytes(width, height = width, channels = 4) {
  let mipWidth = width;
  let mipHeight = height;
  let bytes = 0;
  while (true) {
    bytes += mipWidth * mipHeight * channels;
    if (mipWidth === 1 && mipHeight === 1) break;
    mipWidth = Math.max(1, Math.floor(mipWidth / 2));
    mipHeight = Math.max(1, Math.floor(mipHeight / 2));
  }
  return bytes;
}

export function lawnPBRGPUBytes() {
  return Object.values(LAWN_PBR_ASSET.maps).reduce(
    (total, map) =>
      total + mipmappedTextureBytes(map.width, map.height, map.channels),
    0,
  );
}

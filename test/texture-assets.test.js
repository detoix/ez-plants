import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

const TEXTURE_ROOT = new URL('../src/app/public/textures/', import.meta.url);
const LEAF_ROOT = new URL('leaves/', TEXTURE_ROOT);
const BARK_ROOT = new URL('bark/', TEXTURE_ROOT);
const GROUND_ROOT = new URL('ground/', TEXTURE_ROOT);

const LEAF_FILES = [
  'ash.webp',
  'aspen.webp',
  'blackcurrant-tisel.webp',
  'forsythia-lynwood.webp',
  'hydrangea-limelight.webp',
  'oak.webp',
  'pine.webp',
];

const BARK_IDS = [
  'Bark001',
  'Bark002',
  'Bark003',
  'Bark004',
  'Bark006',
  'Bark007',
  'Bark008',
  'Bark012',
  'Bark013',
  'Bark014',
  'Bark015',
];
const BARK_MAPS = ['color.webp', 'normal.webp', 'roughness.webp'];
const GROUND_FILES = ['dirt_color.jpg', 'dirt_normal.jpg', 'grass.jpg'];
const BARK_DIMENSIONS = {
  Bark001: { width: 512, height: 1024 },
  Bark008: { width: 512, height: 1024 },
};

function readWebp(url) {
  const bytes = readFileSync(url);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length);

  const chunks = [];
  let offset = 12;
  while (offset < bytes.length) {
    assert.ok(offset + 8 <= bytes.length, 'WebP ended inside a chunk header');
    const type = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    offset = dataOffset + length + (length & 1);
    assert.ok(offset <= bytes.length, `WebP ended inside ${type} chunk data`);
    chunks.push({ type, dataOffset, length });
  }
  assert.equal(offset, bytes.length);

  return { bytes, chunks };
}

function dimensions({ bytes, chunks }) {
  const extended = chunks.find(({ type }) => type === 'VP8X');
  if (extended) {
    const uint24 = (offset) =>
      bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
    return {
      width: uint24(extended.dataOffset + 4) + 1,
      height: uint24(extended.dataOffset + 7) + 1,
    };
  }

  const lossy = chunks.find(({ type }) => type === 'VP8 ');
  if (lossy) {
    assert.deepEqual(
      Array.from(bytes.subarray(lossy.dataOffset + 3, lossy.dataOffset + 6)),
      [0x9d, 0x01, 0x2a],
    );
    return {
      width: bytes.readUInt16LE(lossy.dataOffset + 6) & 0x3fff,
      height: bytes.readUInt16LE(lossy.dataOffset + 8) & 0x3fff,
    };
  }

  const lossless = chunks.find(({ type }) => type === 'VP8L');
  assert.ok(lossless, 'expected a VP8, VP8L or VP8X image header');
  assert.equal(bytes[lossless.dataOffset], 0x2f);
  const packedDimensions = bytes.readUInt32LE(lossless.dataOffset + 1);
  return {
    width: (packedDimensions & 0x3fff) + 1,
    height: ((packedDimensions >>> 14) & 0x3fff) + 1,
  };
}

test('leaf plates are compact 1024px WebP assets with alpha', () => {
  assert.deepEqual(readdirSync(LEAF_ROOT).sort(), LEAF_FILES);

  for (const name of LEAF_FILES) {
    const url = new URL(name, LEAF_ROOT);
    const webp = readWebp(url);
    assert.deepEqual(dimensions(webp), { width: 1024, height: 1024 }, name);
    assert.ok(
      webp.chunks.some(({ type }) => type === 'ALPH'),
      `${name} must retain transparency`,
    );
    assert.ok(statSync(url).size < 300_000, `${name} should stay below 300 KB`);
  }
});

test('bark maps use the compact WebP directory contract', () => {
  assert.deepEqual(readdirSync(BARK_ROOT).sort(), BARK_IDS);

  for (const bark of BARK_IDS) {
    const directory = new URL(`${bark}/`, BARK_ROOT);
    assert.deepEqual(readdirSync(directory).sort(), BARK_MAPS);

    for (const map of BARK_MAPS) {
      const url = new URL(map, directory);
      const webp = readWebp(url);
      assert.deepEqual(
        dimensions(webp),
        BARK_DIMENSIONS[bark] ?? { width: 1024, height: 1024 },
      );
      if (map === 'normal.webp') {
        assert.ok(
          webp.chunks.some(({ type }) => type === 'VP8L'),
          `${bark}/${map} must avoid lossy chroma subsampling`,
        );
      }
      assert.ok(
        statSync(url).size < 1_000_000,
        `${bark}/${map} should stay below 1 MB`,
      );
    }
  }
});

test('ground maps are ordinary JPEG assets rather than Git LFS pointers', () => {
  assert.deepEqual(readdirSync(GROUND_ROOT).sort(), GROUND_FILES);

  for (const name of GROUND_FILES) {
    const bytes = readFileSync(new URL(name, GROUND_ROOT));
    assert.deepEqual(
      Array.from(bytes.subarray(0, 3)),
      [0xff, 0xd8, 0xff],
      `${name} must contain JPEG data`,
    );
    assert.ok(bytes.length < 500_000, `${name} should stay below 500 KB`);
  }
});

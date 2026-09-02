/**
 * Build the Prunus laurocerasus leaf plate from a real leaf photograph.
 *
 * Source: Daniel Herndler, "Kirschlorbeer-blatt.jpeg", CC BY-SA 3.0.
 * https://commons.wikimedia.org/wiki/File:Kirschlorbeer-blatt.jpeg
 *
 * The source is photographed on a pale, low-chroma background. This pipeline
 * extracts the green blade, closes small highlight gaps in that mask, crops
 * away the petiole, rotates the blade upright, and writes the compact
 * transparent WebP used at runtime. The pinned digest prevents a
 * silently changed upstream file from altering the checked-in asset.
 *
 *   node scripts/make-cherrylaurel-leaf-texture.mjs
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SOURCE_URL =
  'https://upload.wikimedia.org/wikipedia/commons/a/a8/Kirschlorbeer-blatt.jpeg';
const SOURCE_SHA256 =
  '4dcab21a6d554bc7715be98df1af1bf5ea140a7ae0f5b1ef571c47df52febaa1';
const OUT = path.join(process.cwd(), 'src/lib/plants/cherrylaurel/leaf.webp');

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'ez-plants-cherrylaurel-'),
);
const sourcePath = path.join(temporaryDirectory, 'source.jpeg');

try {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Unable to download leaf source: HTTP ${response.status}`);
  }
  const source = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(source).digest('hex');
  if (digest !== SOURCE_SHA256) {
    throw new Error(
      `Leaf source digest changed: expected ${SOURCE_SHA256}, received ${digest}`,
    );
  }
  fs.writeFileSync(sourcePath, source);

  const filters = [
    '[0:v]crop=1030:600:120:150,format=gbrap,split=2[color][masksrc]',
    // Close holes caused by nearly neutral specular highlights, then trim the
    // matte slightly inside the photographed edge to avoid a pale fringe.
    "[masksrc]geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(g(X,Y)-r(X,Y),2),255,0)',alphaextract,boxblur=20:1,lut=y='if(gt(val,1),255,0)',boxblur=20:1,lut=y='if(gte(val,254),255,0)',boxblur=2:1,lut=y='if(gte(val,252),255,0)',boxblur=0.7:1[mask]",
    "[color]eq=gamma=1.3:brightness=0.04:saturation=0.92,curves=master='0/0 0.5/0.5 0.75/0.68 1/0.82'[graded]",
    '[graded][mask]alphamerge,transpose=1,scale=-1:1024:flags=lanczos[leaf]',
    'color=c=black@0.0:s=1024x1024,format=gbrap[background]',
    '[background][leaf]overlay=(W-w)/2:0:format=auto',
  ].join(';');

  const encoded = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      sourcePath,
      '-filter_complex',
      filters,
      '-c:v',
      'libwebp',
      '-preset',
      'photo',
      '-quality',
      '80',
      '-compression_level',
      '6',
      '-pix_fmt',
      'yuva420p',
      '-frames:v',
      '1',
      OUT,
    ],
    { stdio: 'inherit' },
  );

  if (encoded.error) {
    throw new Error(`Unable to run ffmpeg: ${encoded.error.message}`, {
      cause: encoded.error,
    });
  }
  if (encoded.status !== 0) {
    throw new Error(`ffmpeg failed with status ${encoded.status ?? 'unknown'}`);
  }

  const bytes = fs.statSync(OUT).size;
  if (bytes >= 100 * 1024) {
    throw new Error(`Leaf plate is ${bytes} bytes; expected less than 100 KB`);
  }
  console.log(`Wrote ${OUT} (${bytes} bytes)`);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

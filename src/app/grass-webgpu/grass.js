import * as THREE from 'three/webgpu';

const {
  Fn,
  If,
  atomicAdd,
  atomicStore,
  color,
  cos,
  cross,
  float,
  floatBitsToUint,
  hash,
  instanceIndex,
  mix,
  negateOnBackSide,
  normalize,
  packSnorm2x16,
  packUnorm2x16,
  positionLocal,
  sin,
  storage,
  struct,
  textureLevel,
  transformNormalToView,
  uint,
  uintBitsToFloat,
  uniform,
  unpackSnorm2x16,
  unpackUnorm2x16,
  varyingProperty,
  vec2,
  vec3,
  vec4,
  vertexIndex,
} = THREE.TSL;

import { BLADE_CULL_CENTRE, bladeCullRadiusFactor } from './blade-arc.js';
import {
  GRASS_BACKLIGHT,
  GrassLightingModel,
  normalizeBacklight,
} from './blade-lighting.js';
import { CLUMP_PULL_MARGIN, LAWN, LAWN_COLORS } from './preset.js';
import {
  GRASS_RINGS,
  TOTAL_GRASS_CANDIDATES,
  WORLD_CELL_BIAS,
  bladeVertexCount,
  createRingState,
  grassTriangleCount,
  snapRingState,
} from './grid.js';
import { GRASS_RECORD_WORDS, grassStorageFootprint } from './record-layout.js';

const RING_SEED_STRIDE = 97_531;
const DRAW_UINTS = 4;
const DRAW_BYTES = DRAW_UINTS * Uint32Array.BYTES_PER_ELEMENT;

const GrassRecord = struct(
  {
    // X/Z retain their exact f32 bits. The remaining bounded values use
    // normalized integers, giving this struct a 28-byte array stride.
    //
    // X and Z are two scalar words and not the `uvec2` they read as, and that
    // is the whole reason this struct fits in seven. A `uvec2` aligns to eight
    // bytes, and WGSL rounds an array's stride up to its element's alignment:
    // with the pair in it, six words of fields occupy six words but *seven*
    // occupy eight. The padding word is invisible -- `getLength()` reports it
    // and nothing else does -- so the clump word would have cost 8.4 MiB
    // across the three rings rather than 4.2. Two `uint`s align to four, and
    // seven words stride at seven.
    worldXBits: 'uint',
    worldZBits: 'uint',
    groundBlade: 'uint',
    normalXZ: 'uint',
    yawWidth: 'uint',
    appearance: 'uint',
    clumpHealth: 'uint',
  },
  'EzPackedGrassRecord',
);
if (GrassRecord.getLength() !== GRASS_RECORD_WORDS) {
  throw new Error(
    'Packed grass record layout must remain exactly seven words.',
  );
}

const DrawIndirect = struct(
  {
    vertexCount: 'uint',
    instanceCount: { type: 'uint', atomic: true },
    firstVertex: 'uint',
    firstInstance: 'uint',
  },
  'EzGrassDrawIndirect',
);

/**
 * Frees the GPU buffer behind a storage attribute.
 *
 * `BufferAttribute.dispose()` only dispatches an event, and in the WebGPU path
 * the sole listener is registered by `Geometries` on a *geometry*. These
 * attributes are not geometry attributes -- the records and visible IDs are
 * bound as `storage()` nodes, and the draw commands arrive through
 * `setIndirect()`, which `Geometries.onDispose` also skips -- so nothing hears
 * it and the buffers outlive the lawn. Three r185 exposes no public way to
 * release one; `Attributes.delete()` is the same path `Geometries` takes, and
 * it both destroys the buffer and corrects `renderer.info.memory`. It no-ops
 * for an attribute the renderer never uploaded.
 */
function releaseStorageBuffer(renderer, attribute) {
  renderer._attributes?.delete(attribute);
}

function packAppearance(tint, retention, macro) {
  const tintByte = uint(tint.clamp(0, 1).mul(255).add(0.5));
  const macroByte = uint(macro.clamp(0, 1).mul(255).add(0.5));
  // Midpoint decoding deliberately excludes zero. Otherwise the lowest
  // quantized retention cohort would survive even when target density is 0.
  const retentionWord = uint(retention.clamp(0, 1).mul(65_536)).min(
    uint(65_535),
  );
  return tintByte
    .bitOr(macroByte.shiftLeft(uint(8)))
    .bitOr(retentionWord.shiftLeft(uint(16)));
}

function unpackAppearance(packed) {
  const tint = float(packed.bitAnd(uint(255))).div(255);
  const macro = float(packed.shiftRight(uint(8)).bitAnd(uint(255))).div(255);
  const retention = float(packed.shiftRight(uint(16)))
    .add(0.5)
    .div(65_536);
  return vec3(tint, retention, macro);
}

/**
 * The crown's clump and the health of the ground it stands in.
 *
 * Sixteen bits of clump heading, eight of clump shortening, eight of health.
 * The heading gets the wide field because it is an angle every crown in a
 * clump shares: quantize it to a byte and the lawn's headings fall into 256
 * directions, which at this clump size is a visible grain across open ground.
 * The other two are a fraction of a 4-8 cm blade and a signal that is fed
 * straight into a smoothstep, and neither can spend more than a byte usefully.
 */
function packClumpHealth(angleUnit, shortenUnit, health) {
  const angleWord = uint(angleUnit.clamp(0, 1).mul(65_535).add(0.5));
  const shortenByte = uint(shortenUnit.clamp(0, 1).mul(255).add(0.5));
  const healthByte = uint(health.clamp(0, 1).mul(255).add(0.5));
  return angleWord
    .bitOr(shortenByte.shiftLeft(uint(16)))
    .bitOr(healthByte.shiftLeft(uint(24)));
}

function unpackClumpHealth(packed) {
  const angle = float(packed.bitAnd(uint(65_535))).div(65_535);
  const shorten = float(packed.shiftRight(uint(16)).bitAnd(uint(255))).div(255);
  const health = float(packed.shiftRight(uint(24))).div(255);
  return vec3(angle, shorten, health);
}

function unpackGroundNormal(packed) {
  const xz = unpackSnorm2x16(packed).toVar('packedNormalXZ');
  const y = float(1).sub(xz.dot(xz)).max(0).sqrt();
  return normalize(vec3(xz.x, y, xz.y));
}

/** A blade's half-width at height `y`, as a fraction of its base width. */
function bladeHalfWidth(y) {
  return (1 - y) ** LAWN.taper * 0.5;
}

/**
 * Which clump a point belongs to: the nearest of a jittered lattice of clump
 * points, returned as its integer cell in `xy` and the squared distance to it
 * in `z`.
 *
 * This is the Voronoi scheme Ghost of Tsushima's grass uses, at a lawn's
 * scale. It has to search the full 3x3 neighbourhood: a clump point is jittered
 * anywhere inside its own cell, so the nearest one to a crown sitting near a
 * corner can be in any of the eight cells around it, and a cheaper 2x2 search
 * picks the wrong clump along two of the four edges.
 *
 * It runs once per crown, in placement, and the result is packed into the
 * record's seventh word. It used to run in `material.positionNode`, which put
 * a nine-cell search on every vertex of every blade for a value that is the
 * same at all of them: 45 vertices a near crown, nine neighbours each, 405
 * repeated hash-and-compare sequences to learn one angle and one scale. The
 * four bytes that hold it instead are the cheapest trade in this file.
 *
 * Placement is the right stage for it and not merely a cheaper one: a crown's
 * clump depends on nothing but where the crown is, and where the crown is, is
 * decided here and then never changes.
 *
 * Note what this seed does *not* carry, against the habit of every other seed
 * in this file: a ring salt. It must not. A crown either side of the 8 m
 * handover has to land in the same clump whichever ring draws it, and salting
 * per ring gives the near and mid grids different clumps for the same ground
 * -- a seam ring at 8 m and another at 24 m, exactly where the density
 * contract promises there is no step.
 */
function clumpAt(worldXZ) {
  const cell = worldXZ.div(LAWN.clumpSize).floor().toVar('clumpCell');
  const nearest = vec3(0, 0, 1e9).toVar('clumpNearest');
  for (let stepZ = -1; stepZ <= 1; stepZ += 1) {
    for (let stepX = -1; stepX <= 1; stepX += 1) {
      const neighbour = cell.add(vec2(stepX, stepZ));
      const seed = uint(neighbour.x.add(WORLD_CELL_BIAS))
        .mul(uint(1_664_525))
        .add(uint(neighbour.y.add(WORLD_CELL_BIAS)).mul(uint(1_013_904_223)));
      const point = neighbour
        .add(vec2(hash(seed.add(uint(31))), hash(seed.add(uint(37)))))
        .mul(LAWN.clumpSize);
      const offset = point.sub(worldXZ);
      const reach = offset.dot(offset);
      If(reach.lessThan(nearest.z), () => {
        nearest.assign(vec3(neighbour.x, neighbour.y, reach));
      });
    }
  }
  return nearest;
}

function pushBlade(positions, segments) {
  for (let segment = 0; segment < segments; segment += 1) {
    const y0 = segment / segments;
    const y1 = (segment + 1) / segments;
    const half0 = bladeHalfWidth(y0);
    const half1 = bladeHalfWidth(y1);
    // Flat in local space. The resting bend is per blade and lives in the
    // vertex stage, because a curve baked here is the same curve on all of
    // them -- see LAWN.minBend/maxBend.
    positions.push(-half0, y0, 0, half0, y0, 0, -half1, y1, 0);
    if (segment < segments - 1) {
      positions.push(half0, y0, 0, half1, y1, 0, -half1, y1, 0);
    }
  }
}

function createBladeGeometry(segments, tillers) {
  const positions = [];
  for (let tiller = 0; tiller < tillers; tiller += 1) {
    pushBlade(positions, segments);
  }

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createRingResources({
  ring,
  heightMap,
  drawAttribute,
  drawStorage,
  cameraWorld,
  pixelScale,
  frustumPlanes,
  shadows,
  surface,
  keepAt,
  tillers,
  backlight,
  bend,
  posture,
  greens,
}) {
  const state = createRingState(ring);
  const originCell = uniform(new THREE.Vector2());

  const recordAttribute = new THREE.StorageBufferAttribute(
    ring.capacity,
    GRASS_RECORD_WORDS,
    Uint32Array,
  );
  recordAttribute.name = `Grass ${ring.id} records`;
  const recordsWrite = storage(
    recordAttribute,
    GrassRecord,
    recordAttribute.count,
  );
  const recordsRead = storage(
    recordAttribute,
    GrassRecord,
    recordAttribute.count,
  ).toReadOnly();

  const visibleAttribute = new THREE.StorageBufferAttribute(
    ring.capacity,
    1,
    Uint32Array,
  );
  visibleAttribute.name = `Grass ${ring.id} visible IDs`;
  const visibleWrite = storage(
    visibleAttribute,
    'uint',
    visibleAttribute.count,
  );
  const visibleRead = storage(
    visibleAttribute,
    'uint',
    visibleAttribute.count,
  ).toReadOnly();

  const groundHeightAt = Fn(([worldXZ]) => {
    const uv = worldXZ
      .div(heightMap.extent * 2)
      .add(0.5)
      .clamp(0, 1);
    return textureLevel(heightMap.texture, uv, float(0))
      .r.mul(heightMap.scale)
      .add(heightMap.minimum);
  });

  const placementCompute = Fn(() => {
    const column = instanceIndex.mod(uint(ring.side));
    const row = instanceIndex.div(uint(ring.side));
    const cell = originCell
      .add(vec2(float(column), float(row)))
      .toVar('worldCell');
    // The bias keeps signed cells positive before the WGSL float→uint cast.
    const seed = uint(cell.x.add(WORLD_CELL_BIAS))
      .mul(uint(1_664_525))
      .add(uint(cell.y.add(WORLD_CELL_BIAS)).mul(uint(1_013_904_223)))
      .add(uint(ring.index * RING_SEED_STRIDE))
      .toVar('cellSeed');
    const jitter = vec2(hash(seed.add(11)), hash(seed.add(23)))
      .sub(0.5)
      .mul(0.8);
    const worldXZ = cell
      .add(0.5)
      .add(jitter)
      .mul(ring.spacing)
      .toVar('worldXZ');
    const height = groundHeightAt(worldXZ).toVar('groundHeight');
    const normalStep = heightMap.texelWorldSize;
    const heightLeft = groundHeightAt(worldXZ.sub(vec2(normalStep, 0)));
    const heightRight = groundHeightAt(worldXZ.add(vec2(normalStep, 0)));
    const heightDown = groundHeightAt(worldXZ.sub(vec2(0, normalStep)));
    const heightUp = groundHeightAt(worldXZ.add(vec2(0, normalStep)));
    const normal = normalize(
      vec3(
        heightLeft.sub(heightRight),
        normalStep * 2,
        heightDown.sub(heightUp),
      ),
    ).toVar('groundNormal');

    const bladeHeightUnit = hash(seed.add(41));
    const bladeWidthUnit = hash(seed.add(53));
    const yawUnit = hash(seed.add(67));
    const tint = hash(seed.add(79));
    const retention = hash(seed.add(97));
    const macro = surface.macroAt(worldXZ);
    // The two scales of world signal this crown answers to: the metre-scale
    // macro that varies its density and tint, and the patch-scale health that
    // decides whether it is standing in a dry part of the lawn. The ground
    // under it reads that second one through the same `healthAt`.
    const health = surface.healthAt(worldXZ);
    const clump = clumpAt(worldXZ).toVar('crownClump');
    const clumpSeed = uint(clump.x.add(WORLD_CELL_BIAS))
      .mul(uint(1_664_525))
      .add(uint(clump.y.add(WORLD_CELL_BIAS)).mul(uint(1_013_904_223)))
      .toVar('clumpSeed');
    const record = recordsWrite.element(instanceIndex);
    record.get('worldXBits').assign(floatBitsToUint(worldXZ.x));
    record.get('worldZBits').assign(floatBitsToUint(worldXZ.y));
    record
      .get('groundBlade')
      .assign(
        packUnorm2x16(
          vec2(
            height.sub(heightMap.packingMinimum).div(heightMap.packingRange),
            bladeHeightUnit,
          ),
        ),
      );
    record.get('normalXZ').assign(packSnorm2x16(normal.xz));
    record.get('yawWidth').assign(packUnorm2x16(vec2(yawUnit, bladeWidthUnit)));
    record.get('appearance').assign(packAppearance(tint, retention, macro));
    record
      .get('clumpHealth')
      .assign(
        packClumpHealth(
          hash(clumpSeed.add(uint(59))),
          hash(clumpSeed.add(uint(43))),
          health,
        ),
      );
  })()
    .compute(ring.capacity, [64])
    .setName(`Place ${ring.id} grass`);

  const cullCompute = Fn(() => {
    const record = recordsRead.element(instanceIndex);
    const worldXZ = vec2(
      uintBitsToFloat(record.get('worldXBits')),
      uintBitsToFloat(record.get('worldZBits')),
    );
    const groundBlade = unpackUnorm2x16(record.get('groundBlade')).toVar(
      'packedGroundBlade',
    );
    const groundHeight = groundBlade.x
      .mul(heightMap.packingRange)
      .add(heightMap.packingMinimum);
    const bladeHeight = mix(LAWN.minHeight, LAWN.maxHeight, groundBlade.y);
    const normal = unpackGroundNormal(record.get('normalXZ'));
    const yawWidth = unpackUnorm2x16(record.get('yawWidth'));
    const bladeWidth = mix(LAWN.minWidth, LAWN.maxWidth, yawWidth.y);
    const appearance = unpackAppearance(record.get('appearance')).toVar(
      'packedAppearance',
    );
    const base = vec3(worldXZ.x, groundHeight, worldXZ.y);
    const delta = base.xz.sub(cameraWorld.xz);
    const distance = delta.length().toVar('ringDistance');
    const t = distance
      .sub(ring.inner)
      .div(ring.outer - ring.inner)
      .clamp(0, 1);
    const smooth = t.mul(t).mul(float(3).sub(t.mul(2)));
    const density = mix(ring.densityNear, ring.densityFar, smooth).mul(
      surface.densityFrom(appearance.z),
    );
    const retained = appearance.y.lessThanEqual(
      density.div(ring.candidateDensity).clamp(0, 1),
    );
    const owned = distance
      .greaterThanEqual(ring.inner)
      .and(distance.lessThan(ring.outer));

    // Test a conservative sphere against normalized world-space frustum
    // planes. Centreline point tests miss a strip that crosses the edge while
    // all sampled centres are outside. The extra 8% covers the resting bend --
    // a tip at LAWN.maxBend sits 0.527 of the blade's height from this centre,
    // so the margin is real but finite. The width term covers the widest pair
    // of vertices at their most thickened, because the vertex stage widens a
    // sub-pixel blade and this pass never learns by how much.
    const sphereCentre = base.add(
      normal.mul(bladeHeight.mul(BLADE_CULL_CENTRE)),
    );
    const sphereRadius = bladeHeight
      .mul(bladeCullRadiusFactor(bend.max))
      .add(bladeWidth.mul(0.5 * LAWN.maxThicken))
      .add(LAWN.tillerSpread * 0.5);
    let inFrustum = frustumPlanes[0].xyz
      .dot(sphereCentre)
      .add(frustumPlanes[0].w)
      .greaterThanEqual(sphereRadius.negate());
    for (let index = 1; index < frustumPlanes.length; index += 1) {
      const plane = frustumPlanes[index];
      inFrustum = inFrustum.and(
        plane.xyz
          .dot(sphereCentre)
          .add(plane.w)
          .greaterThanEqual(sphereRadius.negate()),
      );
    }

    // An optional world-space keep-out, tested here rather than baked into a
    // placement record: the six record words are full, and stealing precision
    // from the blade-width channel to store one bit would change a packing
    // contract the whole field depends on. A caller that passes no mask builds
    // no node, so `/field` generates the shader it always did.
    let keep = owned.and(retained).and(inFrustum);
    if (keepAt) keep = keep.and(keepAt(worldXZ));

    If(keep, () => {
      const draw = drawStorage.element(uint(ring.index));
      const outputIndex = atomicAdd(draw.get('instanceCount'), uint(1));
      visibleWrite.element(outputIndex).assign(instanceIndex);
    });
  })()
    .compute(ring.capacity, [64])
    .setName(`Cull ${ring.id} grass`);

  const geometry = createBladeGeometry(ring.segments, tillers);
  geometry.instanceCount = ring.capacity;
  geometry.setIndirect(drawAttribute, ring.index * DRAW_BYTES);

  const bladeNormal = varyingProperty('vec3', `vEzGrassNormal${ring.index}`);
  const bladeTint = varyingProperty('float', `vEzGrassTint${ring.index}`);
  const bladeGradient = varyingProperty(
    'float',
    `vEzGrassGradient${ring.index}`,
  );
  const bladeMacro = varyingProperty('float', `vEzGrassMacro${ring.index}`);
  const bladeDry = varyingProperty('float', `vEzGrassDry${ring.index}`);
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
    forceSinglePass: true,
    roughness: 0.92,
    metalness: 0,
  });
  material.positionNode = Fn(() => {
    const candidate = visibleRead.element(instanceIndex);
    const record = recordsRead.element(candidate);
    const worldXZ = vec2(
      uintBitsToFloat(record.get('worldXBits')),
      uintBitsToFloat(record.get('worldZBits')),
    );
    const groundBlade = unpackUnorm2x16(record.get('groundBlade')).toVar(
      'packedGroundBlade',
    );
    const groundHeight = groundBlade.x
      .mul(heightMap.packingRange)
      .add(heightMap.packingMinimum);
    const crownHeight = mix(LAWN.minHeight, LAWN.maxHeight, groundBlade.y);
    const groundNormal = unpackGroundNormal(record.get('normalXZ'));
    const yawWidth = unpackUnorm2x16(record.get('yawWidth')).toVar(
      'packedYawWidth',
    );
    // Which blade of this crown's tuft the vertex belongs to. The geometry is
    // one blade repeated, so this index is the only thing telling them apart --
    // and reading it off the vertex costs no attribute and no memory.
    const tiller = vertexIndex
      .div(uint(bladeVertexCount(ring.segments)))
      .toVar('tillerIndex');
    // Its own seed, composed from where the blade stands the way the placement
    // pass composes cells. The record's six words are full, and a tiller is
    // cheaper to re-derive here than a packing contract is to change.
    const tillerSeed = record
      .get('worldXBits')
      .mul(uint(1_664_525))
      .add(record.get('worldZBits').mul(uint(1_013_904_223)))
      .add(tiller.mul(uint(2_654_435_761)))
      .toVar('tillerSeed');
    // Read, not searched for. Placement did the nine-cell Voronoi once for
    // this crown and packed the answer; all that is left here is the range
    // mapping, which stays beside `LAWN` for the same reason the blade's
    // height and width do.
    const clumpHealth = unpackClumpHealth(record.get('clumpHealth')).toVar(
      'packedClumpHealth',
    );
    const clumpAngle = clumpHealth.x.mul(Math.PI * 2);
    const clumpShorten = mix(
      float(LAWN.clumpShortest),
      float(1),
      clumpHealth.y,
    );

    const crownYaw = yawWidth.x.mul(Math.PI * 2);
    const bladeWidth = mix(LAWN.minWidth, LAWN.maxWidth, yawWidth.y);
    const appearance = unpackAppearance(record.get('appearance')).toVar(
      'packedAppearance',
    );
    // The crown's own facing, pulled round towards its clump's. Added, not
    // mixed: a mix of two opposed headings cancels to a vector with no
    // direction, and this sum cannot fall below `clumpPull - 1`.
    const crownHeading = vec3(cos(crownYaw), 0, sin(crownYaw)).add(
      vec3(cos(clumpAngle), 0, sin(clumpAngle)).mul(posture.clumpPull),
    );
    // The crown's tangent frame. Both the tuft's spread and each blade's fan
    // are rotations inside it, so a slope tilts the whole crown once.
    const crownForward = normalize(
      crownHeading.sub(groundNormal.mul(crownHeading.dot(groundNormal))),
    );
    const crownSide = normalize(cross(groundNormal, crownForward));
    // Fan each blade off the crown's facing and stand it off the crown centre.
    // Unfanned, a tuft is parallel blades stacked in one place, which reads as
    // one fat blade rather than several thin ones.
    const fan = hash(tillerSeed.add(uint(149)))
      .sub(0.5)
      .mul(posture.tillerFan)
      .toVar('tillerFan');
    const forward = crownForward
      .mul(cos(fan))
      .add(crownSide.mul(sin(fan)))
      .toVar('bladeForward');
    const side = crownSide
      .mul(cos(fan))
      .sub(crownForward.mul(sin(fan)))
      .toVar('bladeSide');
    const crownAngle = float(tiller)
      .mul((2 * Math.PI) / tillers)
      .add(crownYaw);
    const crownOffset = crownSide
      .mul(cos(crownAngle))
      .add(crownForward.mul(sin(crownAngle)))
      .mul(hash(tillerSeed.add(uint(167))).mul(LAWN.tillerSpread * 0.5));
    bladeTint.assign(appearance.x);
    bladeGradient.assign(positionLocal.y);
    bladeMacro.assign(appearance.z);
    // How dry this blade is: its patch, modulated by its own hash. The patch
    // is what makes the variation read as ground rather than as noise, and
    // the modulation is what stops the patch being a flat wash -- it is a
    // multiplier on the patch and not a signal of its own, so a blade in
    // green turf multiplies zero and stays green however its hash fell.
    bladeDry.assign(
      surface
        .dryAt(clumpHealth.z)
        .mul(
          mix(
            float(1 - LAWN.dryScatter),
            float(1 + LAWN.dryScatter),
            hash(tillerSeed.add(uint(193))),
          ),
        )
        .clamp(0, 1)
        .mul(LAWN.dryStrength),
    );

    // Tillers of one crown are not all the same age. Equal heights read as a
    // mown bristle; this only ever shortens a blade, so the crown's culling
    // sphere -- measured from its full height -- still contains every one.
    const bladeHeight = crownHeight
      .mul(clumpShorten)
      .mul(
        mix(
          float(LAWN.tillerShortest),
          float(1),
          hash(tillerSeed.add(uint(181))),
        ),
      )
      .toVar('bladeHeight');
    const bendUnit = hash(tillerSeed.add(uint(131)));
    const bladeBend = mix(float(bend.min), float(bend.max), bendUnit).toVar(
      'bladeBend',
    );
    // A constant-curvature arc to second order: the tip reaches forward by
    // bend/2 of the blade's length and the blade loses the height it spends
    // doing it, so leaning bends a blade over rather than stretching it.
    const along = positionLocal.y.toVar('bladeAlong');
    const rise = along.sub(
      bladeBend.mul(bladeBend).mul(along).mul(along).mul(along).div(6),
    );
    const reach = bladeBend.mul(along).mul(along).mul(0.5);

    // Two normals over flat geometry. Along the blade, the arc's own tangent:
    // a blade tipped forward by `lean` faces that much further down, which is
    // what makes the resting bend visible in light rather than in silhouette
    // alone. Across it, a splay toward each edge, interpolated between the two
    // sides to shade a two-vertex strip as the curved section it stands for.
    const lean = bladeBend.mul(along).toVar('bladeLean');
    const splay = positionLocal.x
      .mul(2 * LAWN.normalSpread)
      .toVar('bladeSplay');
    bladeNormal.assign(
      forward
        .mul(cos(lean))
        .sub(groundNormal.mul(sin(lean)))
        .mul(cos(splay))
        .add(side.mul(sin(splay))),
    );

    // Widen a blade only as far as it falls under `minBladePixels` on screen.
    // `facing` is how much of the blade's width survives projection: 1 face-on,
    // towards 0 as it turns its edge to the camera, which is the other way a
    // blade goes sub-pixel besides distance. Capped, because the culling
    // sphere is sized from the true width -- see LAWN.maxThicken.
    const base = vec3(worldXZ.x, groundHeight, worldXZ.y)
      .add(crownOffset)
      .toVar('bladeBase');
    const toCamera = cameraWorld.sub(base).toVar('bladeToCamera');
    const viewDistance = toCamera.length().toVar('bladeViewDistance');
    const viewDir = toCamera.div(viewDistance.max(1e-4));
    const alignment = side.dot(viewDir);
    const facing = float(1).sub(alignment.mul(alignment)).max(0).sqrt();
    const shown = bladeWidth.mul(facing).max(1e-6);
    const wanted = viewDistance.mul(pixelScale).mul(LAWN.minBladePixels);
    const thicken = wanted.div(shown).clamp(1, LAWN.maxThicken);

    return base
      .add(side.mul(positionLocal.x.mul(bladeWidth).mul(thicken)))
      .add(groundNormal.mul(rise.mul(bladeHeight)))
      .add(forward.mul(reach.mul(bladeHeight)));
  })();
  material.normalNode = negateOnBackSide(
    transformNormalToView(bladeNormal).normalize(),
  );
  // The light that comes *through* a blade. It is a lighting model rather than
  // an emissive term because only the lighting model is handed a `lightColor`
  // the shadow has already been applied to -- an emissive rim would glow in
  // shade, which is the mistake this is avoiding. One per ring, because it
  // reads that ring's own blade-height varying.
  // `?backlight=off` leaves the stock `PhysicalLightingModel` in place, which
  // is the A/B control: same geometry, same records, same draws, one term
  // gone. It is also the only way to see what the term contributes, because
  // both pages open looking away from their own sun.
  if (backlight !== GRASS_BACKLIGHT.off) {
    const lightingModel = new GrassLightingModel(bladeGradient, {
      mode: backlight,
      backlightColor: greens.backlight,
    });
    material.setupLightingModel = () => lightingModel;
  }
  // A blade stands in a few centimetres of its neighbours and its root sees
  // very little of the sky. Nothing here draws that -- these blades cast no
  // shadow-map silhouette on purpose -- so the occlusion is asserted: darken
  // the bottom `rootOcclusionHeight` of every blade towards `rootOcclusion`.
  // It is the cheapest thing in this material that gives a plane of lit
  // strips a floor to sit on.
  const rootOcclusion = mix(
    float(LAWN.rootOcclusion),
    float(1),
    bladeGradient.clamp(0, 1).smoothstep(0, LAWN.rootOcclusionHeight),
  );
  material.colorNode = mix(
    color(greens.bottom),
    color(greens.top),
    bladeGradient.clamp(0, 1),
  )
    .mul(bladeTint.mul(0.18).add(0.91))
    .mul(surface.tintFrom(bladeMacro))
    .mul(surface.dryTintFrom(bladeDry))
    .mul(rootOcclusion);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `GPU lawn · ${ring.id}`;
  mesh.frustumCulled = false;
  // Short lawn blades do not cast a useful shadow-map silhouette, but they do
  // receive the terrain/sun shadow. This is real lit geometry, not a splat.
  mesh.castShadow = false;
  mesh.receiveShadow = shadows;

  return {
    ring,
    state,
    originCell,
    recordAttribute,
    visibleAttribute,
    placementCompute,
    cullCompute,
    geometry,
    material,
    mesh,
  };
}

/**
 * @param {object} options
 * @param {number} [options.tillers] Blades grown from each crown. Per crown,
 *   so slots, placement, culling and storage are all unchanged by it and only
 *   the vertex stage and fill grow. Uniform across the three rings on purpose:
 *   the bands hand over at matched densities, and tillering one harder than
 *   its neighbour puts a step at 8 m or 24 m.
 * @param {{min: number, max: number}} [options.bend] Radians the tip leans
 *   from upright at rest, drawn per blade across this range. The culling
 *   sphere is sized from `max` rather than from a constant, so widening it
 *   cannot quietly push blades outside the bound that decides whether to draw
 *   them -- it grows the sphere, and more blades survive the cull.
 * @param {boolean|'blade'|'view'|'off'} [options.backlight] Light transmitted
 *   through a blade. `blade` gates it on the blade's own normal; `view` is the
 *   shipped view-only lobe and `off` the stock physical lighting model, both
 *   kept as A/B controls.
 * @param {object} [options.greens] The lawn palette, from `lawnColorsFor()`.
 *   Drawn around `LAWN_TARGET_HUE`; `/field` rotates it with `?lawnhue=`.
 * @param {{clumpPull: number, tillerFan: number}} [options.posture] How much
 *   of a crown's facing its clump dictates, and the radians of yaw its blades
 *   are fanned across. Both are how correlated neighbouring blades are, which
 *   is what decides whether a patch of lawn shades as a sheet or as a canopy,
 *   so they are dialled together. Neither moves the culling sphere: the pull
 *   normalizes a heading and the fan is yaw inside the crown's own frame.
 * @param {Function} [options.keepAt] Optional world-space mask,
 *   `(worldXZ) => booleanNode`, returning false where no blade may stand. Used
 *   by `/bed` to cut the lawn out of the planting; `/field` passes none.
 */
export function createGPUDrivenGrass({
  renderer,
  heightMap,
  surface,
  shadows = true,
  keepAt = null,
  tillers = LAWN.tillers,
  backlight = GRASS_BACKLIGHT.blade,
  bend = { min: LAWN.minBend, max: LAWN.maxBend },
  posture = { clumpPull: LAWN.clumpPull, tillerFan: LAWN.tillerFan },
  greens = LAWN_COLORS,
}) {
  if (!surface) throw new TypeError('GPU grass needs the shared lawn surface.');
  if (!Number.isInteger(tillers) || tillers < 1) {
    throw new RangeError('A crown grows a whole number of blades, at least 1.');
  }
  if (!(bend.min >= 0) || !(bend.max >= bend.min)) {
    throw new RangeError('Blade bend needs an ordered, non-negative range.');
  }
  // A crown's heading is its own unit vector plus the clump's times the pull,
  // so a pull of exactly 1 can cancel two opposed headings to a zero vector
  // and hand `normalize()` no direction at all. The same bound is asserted on
  // the preset in `test/field-webgpu-blade-bounds.test.js`.
  if (
    !(posture.clumpPull >= 0) ||
    Math.abs(posture.clumpPull - 1) < CLUMP_PULL_MARGIN
  ) {
    throw new RangeError(
      'A clump pull must be non-negative and a tenth clear of 1, where an ' +
        'opposed crown and clump heading cancel to nothing to normalize.',
    );
  }
  if (!(posture.tillerFan >= 0)) {
    throw new RangeError('A negative tiller fan is a mirrored blade.');
  }
  const backlightMode = normalizeBacklight(backlight);
  const cameraWorld = uniform(new THREE.Vector3());
  // Metres one physical pixel covers per metre of distance, so a blade can be
  // measured in pixels without the shader knowing the projection.
  const pixelScale = uniform(0);
  const drawingBuffer = new THREE.Vector2();
  const viewProjection = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const frustumPlanes = Array.from({ length: 6 }, () =>
    uniform(new THREE.Vector4()),
  );
  const drawData = new Uint32Array(GRASS_RINGS.length * DRAW_UINTS);
  for (const ring of GRASS_RINGS) {
    drawData[ring.index * DRAW_UINTS] =
      bladeVertexCount(ring.segments) * tillers;
  }

  const drawAttribute = new THREE.IndirectStorageBufferAttribute(
    drawData,
    DRAW_UINTS,
  );
  drawAttribute.name = 'Grass indirect draw commands';
  const drawStorage = storage(drawAttribute, DrawIndirect, drawAttribute.count);
  const resetCompute = Fn(() => {
    atomicStore(
      drawStorage.element(instanceIndex).get('instanceCount'),
      uint(0),
    );
  })()
    .compute(GRASS_RINGS.length, [64])
    .setName('Reset grass indirect draws');

  const rings = GRASS_RINGS.map((ring) =>
    createRingResources({
      ring,
      heightMap,
      drawAttribute,
      drawStorage,
      cameraWorld,
      pixelScale,
      frustumPlanes,
      shadows,
      surface,
      keepAt,
      tillers,
      backlight: backlightMode,
      bend,
      posture,
      greens,
    }),
  );
  const group = new THREE.Group();
  group.name = 'Persistent GPU lawn grids';
  for (const ring of rings) group.add(ring.mesh);

  const readback = new THREE.ReadbackBuffer(drawData.byteLength);
  readback.name = 'Grass visible-count readback';
  const visible = new Uint32Array(GRASS_RINGS.length);
  let placements = 0;
  let readPending = false;
  const grassStats = {
    candidates: TOTAL_GRASS_CANDIDATES,
    tillers,
    storage: grassStorageFootprint(TOTAL_GRASS_CANDIDATES),
    visible,
    // Reported here rather than re-derived by the HUD, because the HUD's own
    // arithmetic drifted from the draw command it was meant to describe.
    triangles: 0,
    placements: 0,
    drawCalls: GRASS_RINGS.length,
    computeCalls: GRASS_RINGS.length + 1,
  };

  function update(camera) {
    cameraWorld.value.copy(camera.position);
    // Element 5 is 1/tan(fovY/2) for any perspective projection, so this stays
    // right through a pixelratio change or a resize without reading either.
    renderer.getDrawingBufferSize(drawingBuffer);
    pixelScale.value =
      2 / (camera.projectionMatrix.elements[5] * Math.max(drawingBuffer.y, 1));
    viewProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    frustum.setFromProjectionMatrix(viewProjection, camera.coordinateSystem);
    for (let index = 0; index < frustum.planes.length; index += 1) {
      const plane = frustum.planes[index];
      frustumPlanes[index].value.set(
        plane.normal.x,
        plane.normal.y,
        plane.normal.z,
        plane.constant,
      );
    }

    let placementDispatches = 0;
    for (const resources of rings) {
      if (
        snapRingState(resources.state, camera.position.x, camera.position.z)
      ) {
        resources.originCell.value.set(
          resources.state.originCellX,
          resources.state.originCellZ,
        );
        renderer.compute(resources.placementCompute);
        placements += 1;
        placementDispatches += 1;
      }
    }

    renderer.compute(resetCompute);
    for (const resources of rings) renderer.compute(resources.cullCompute);
    grassStats.placements = placements;
    grassStats.computeCalls = GRASS_RINGS.length + 1 + placementDispatches;
  }

  async function sampleVisibleCounts() {
    if (readPending) return false;
    readPending = true;
    try {
      const result = await renderer.getArrayBufferAsync(
        drawAttribute,
        readback,
        0,
        drawData.byteLength,
      );
      const commands = new Uint32Array(result.buffer);
      for (const ring of GRASS_RINGS) {
        visible[ring.index] = commands[ring.index * DRAW_UINTS + 1] ?? 0;
      }
      grassStats.triangles = grassTriangleCount(visible, tillers);
      result.release();
      return true;
    } catch (error) {
      // r185 marks a reusable ReadbackBuffer mapped before awaiting mapAsync.
      // Release that state after a device/readback failure so one failed HUD
      // sample does not make every later sample fail synchronously.
      if (readback._mapped) readback.release();
      throw error;
    } finally {
      readPending = false;
    }
  }

  return {
    group,
    update,
    sampleVisibleCounts,
    stats() {
      return grassStats;
    },
    dispose() {
      readback.dispose();
      resetCompute.dispose();
      releaseStorageBuffer(renderer, drawAttribute);
      for (const resources of rings) {
        resources.placementCompute.dispose();
        resources.cullCompute.dispose();
        releaseStorageBuffer(renderer, resources.recordAttribute);
        releaseStorageBuffer(renderer, resources.visibleAttribute);
        resources.geometry.dispose();
        resources.material.dispose();
      }
    },
  };
}

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

import { LAWN, LAWN_COLORS } from './preset.js';
import {
  GRASS_RINGS,
  TOTAL_GRASS_CANDIDATES,
  WORLD_CELL_BIAS,
  createRingState,
  snapRingState,
} from './grid.js';
import { GRASS_RECORD_WORDS, grassStorageFootprint } from './record-layout.js';

const RING_SEED_STRIDE = 97_531;
const DRAW_UINTS = 4;
const DRAW_BYTES = DRAW_UINTS * Uint32Array.BYTES_PER_ELEMENT;

const GrassRecord = struct(
  {
    // X/Z retain their exact f32 bits. The remaining bounded values use
    // normalized integers, giving this struct a 24-byte array stride.
    worldXZBits: 'uvec2',
    groundBlade: 'uint',
    normalXZ: 'uint',
    yawWidth: 'uint',
    appearance: 'uint',
  },
  'EzPackedGrassRecord',
);
if (GrassRecord.getLength() !== GRASS_RECORD_WORDS) {
  throw new Error('Packed grass record layout must remain exactly six words.');
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
 * Vertices one blade submits, which is what the indirect command carries.
 *
 * The tip closes to a point, so the topmost segment is a triangle and not a
 * quad: a quad there spends a second triangle whose two upper vertices
 * coincide, and a zero-area triangle rasterises nothing at any distance.
 */
function bladeVertexCount(segments) {
  return segments * 6 - 3;
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
 * It runs per vertex, because a crown's clump depends only on where the crown
 * is and there is nowhere left in the six-word record to keep it. That is
 * nine hashes of redundancy per blade; it is also one block to delete.
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
    const record = recordsWrite.element(instanceIndex);
    record.get('worldXZBits').assign(floatBitsToUint(worldXZ));
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
  })()
    .compute(ring.capacity, [64])
    .setName(`Place ${ring.id} grass`);

  const cullCompute = Fn(() => {
    const record = recordsRead.element(instanceIndex);
    const worldXZ = uintBitsToFloat(record.get('worldXZBits'));
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
    const sphereCentre = base.add(normal.mul(bladeHeight.mul(0.5)));
    const sphereRadius = bladeHeight
      .mul(0.58)
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

  const geometry = createBladeGeometry(ring.segments, LAWN.tillers);
  geometry.instanceCount = ring.capacity;
  geometry.setIndirect(drawAttribute, ring.index * DRAW_BYTES);

  const bladeNormal = varyingProperty('vec3', `vEzGrassNormal${ring.index}`);
  const bladeTint = varyingProperty('float', `vEzGrassTint${ring.index}`);
  const bladeGradient = varyingProperty(
    'float',
    `vEzGrassGradient${ring.index}`,
  );
  const bladeMacro = varyingProperty('float', `vEzGrassMacro${ring.index}`);
  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
    forceSinglePass: true,
    roughness: 0.92,
    metalness: 0,
  });
  material.positionNode = Fn(() => {
    const candidate = visibleRead.element(instanceIndex);
    const record = recordsRead.element(candidate);
    const worldXZ = uintBitsToFloat(record.get('worldXZBits'));
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
      .get('worldXZBits')
      .x.mul(uint(1_664_525))
      .add(record.get('worldXZBits').y.mul(uint(1_013_904_223)))
      .add(tiller.mul(uint(2_654_435_761)))
      .toVar('tillerSeed');
    const clump = clumpAt(worldXZ).toVar('crownClump');
    const clumpSeed = uint(clump.x.add(WORLD_CELL_BIAS))
      .mul(uint(1_664_525))
      .add(uint(clump.y.add(WORLD_CELL_BIAS)).mul(uint(1_013_904_223)))
      .toVar('clumpSeed');
    const clumpShorten = mix(
      float(LAWN.clumpShortest),
      float(1),
      hash(clumpSeed.add(uint(43))),
    );
    const clumpAngle = hash(clumpSeed.add(uint(59))).mul(Math.PI * 2);

    const crownYaw = yawWidth.x.mul(Math.PI * 2);
    const bladeWidth = mix(LAWN.minWidth, LAWN.maxWidth, yawWidth.y);
    const appearance = unpackAppearance(record.get('appearance')).toVar(
      'packedAppearance',
    );
    // The crown's own facing, pulled round towards its clump's. Added, not
    // mixed: a mix of two opposed headings cancels to a vector with no
    // direction, and this sum cannot fall below `clumpPull - 1`.
    const crownHeading = vec3(cos(crownYaw), 0, sin(crownYaw)).add(
      vec3(cos(clumpAngle), 0, sin(clumpAngle)).mul(LAWN.clumpPull),
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
      .mul(LAWN.tillerFan)
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
      .mul((2 * Math.PI) / LAWN.tillers)
      .add(crownYaw);
    const crownOffset = crownSide
      .mul(cos(crownAngle))
      .add(crownForward.mul(sin(crownAngle)))
      .mul(hash(tillerSeed.add(uint(167))).mul(LAWN.tillerSpread * 0.5));
    bladeTint.assign(appearance.x);
    bladeGradient.assign(positionLocal.y);
    bladeMacro.assign(appearance.z);

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
    const bend = mix(
      float(LAWN.minBend),
      float(LAWN.maxBend),
      bendUnit,
    ).toVar('bladeBend');
    // A constant-curvature arc to second order: the tip reaches forward by
    // bend/2 of the blade's length and the blade loses the height it spends
    // doing it, so leaning bends a blade over rather than stretching it.
    const along = positionLocal.y.toVar('bladeAlong');
    const rise = along.sub(
      bend.mul(bend).mul(along).mul(along).mul(along).div(6),
    );
    const reach = bend.mul(along).mul(along).mul(0.5);

    // Two normals over flat geometry. Along the blade, the arc's own tangent:
    // a blade tipped forward by `lean` faces that much further down, which is
    // what makes the resting bend visible in light rather than in silhouette
    // alone. Across it, a splay toward each edge, interpolated between the two
    // sides to shade a two-vertex strip as the curved section it stands for.
    const lean = bend.mul(along).toVar('bladeLean');
    const splay = positionLocal.x.mul(2 * LAWN.normalSpread).toVar('bladeSplay');
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
  material.colorNode = mix(
    color(LAWN_COLORS.bottom),
    color(LAWN_COLORS.top),
    bladeGradient.clamp(0, 1),
  )
    .mul(bladeTint.mul(0.18).add(0.91))
    .mul(surface.tintFrom(bladeMacro));

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
}) {
  if (!surface) throw new TypeError('GPU grass needs the shared lawn surface.');
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
      bladeVertexCount(ring.segments) * LAWN.tillers;
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
    storage: grassStorageFootprint(TOTAL_GRASS_CANDIDATES),
    visible,
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

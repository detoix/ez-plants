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

function createBladeGeometry(segments) {
  const positions = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const y0 = segment / segments;
    const y1 = (segment + 1) / segments;
    const half0 = (1 - y0) * 0.5;
    const half1 = (1 - y1) * 0.5;
    // A fixed resting curve, not wind. On a 4–8 cm lawn its total lean is only
    // a few millimetres, but it keeps the strip from reading as a rectangle.
    const z0 = y0 * y0 * 0.07;
    const z1 = y1 * y1 * 0.07;
    positions.push(
      -half0,
      y0,
      z0,
      half0,
      y0,
      z0,
      -half1,
      y1,
      z1,
      half0,
      y0,
      z0,
      half1,
      y1,
      z1,
      -half1,
      y1,
      z1,
    );
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
  cameraXZ,
  frustumPlanes,
  shadows,
  surface,
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
    const delta = base.xz.sub(cameraXZ);
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
    // all sampled centres are outside. The extra 8% covers its fixed resting
    // curve; half its base width covers the widest pair of vertices.
    const sphereCentre = base.add(normal.mul(bladeHeight.mul(0.5)));
    const sphereRadius = bladeHeight.mul(0.58).add(bladeWidth.mul(0.5));
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

    If(owned.and(retained).and(inFrustum), () => {
      const draw = drawStorage.element(uint(ring.index));
      const outputIndex = atomicAdd(draw.get('instanceCount'), uint(1));
      visibleWrite.element(outputIndex).assign(instanceIndex);
    });
  })()
    .compute(ring.capacity, [64])
    .setName(`Cull ${ring.id} grass`);

  const geometry = createBladeGeometry(ring.segments);
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
    const bladeHeight = mix(LAWN.minHeight, LAWN.maxHeight, groundBlade.y);
    const groundNormal = unpackGroundNormal(record.get('normalXZ'));
    const yawWidth = unpackUnorm2x16(record.get('yawWidth')).toVar(
      'packedYawWidth',
    );
    const yaw = yawWidth.x.mul(Math.PI * 2);
    const bladeWidth = mix(LAWN.minWidth, LAWN.maxWidth, yawWidth.y);
    const appearance = unpackAppearance(record.get('appearance')).toVar(
      'packedAppearance',
    );
    const heading = vec3(cos(yaw), 0, sin(yaw));
    const forward = normalize(
      heading.sub(groundNormal.mul(heading.dot(groundNormal))),
    );
    const side = normalize(cross(groundNormal, forward));
    bladeNormal.assign(forward);
    bladeTint.assign(appearance.x);
    bladeGradient.assign(positionLocal.y);
    bladeMacro.assign(appearance.z);

    return vec3(worldXZ.x, groundHeight, worldXZ.y)
      .add(side.mul(positionLocal.x.mul(bladeWidth)))
      .add(groundNormal.mul(positionLocal.y.mul(bladeHeight)))
      .add(forward.mul(positionLocal.z.mul(bladeHeight)));
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

export function createGPUDrivenGrass({
  renderer,
  heightMap,
  surface,
  shadows = true,
}) {
  if (!surface) throw new TypeError('GPU grass needs the shared lawn surface.');
  const cameraXZ = uniform(new THREE.Vector2());
  const viewProjection = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const frustumPlanes = Array.from({ length: 6 }, () =>
    uniform(new THREE.Vector4()),
  );
  const drawData = new Uint32Array(GRASS_RINGS.length * DRAW_UINTS);
  for (const ring of GRASS_RINGS) {
    drawData[ring.index * DRAW_UINTS] = ring.segments * 6;
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
      cameraXZ,
      frustumPlanes,
      shadows,
      surface,
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
    cameraXZ.value.set(camera.position.x, camera.position.z);
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
      drawAttribute.dispose();
      for (const resources of rings) {
        resources.placementCompute.dispose();
        resources.cullCompute.dispose();
        resources.recordAttribute.dispose();
        resources.visibleAttribute.dispose();
        resources.geometry.dispose();
        resources.material.dispose();
      }
    },
  };
}

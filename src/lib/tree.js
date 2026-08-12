import * as THREE from 'three';
import RNG from './rng.js';
import { Branch } from './branch.js';
import { Billboard, TreeType } from './enums.js';
import TreeOptions from './options.js';
import { loadPreset } from './presets/index.js';
import { Trellis } from './trellis.js';
import {
  appendLeafCard,
  createLeafBufferGeometry,
  createLeafGeometryData,
} from './leaf-geometry.js';
import { createLeafMaterialSet } from './leaf-material.js';
import { LeafWind } from './leaf-wind.js';
import {
  normalizePlantDetail,
  samplePlantDetailSections,
} from './plant-detail.js';
import {
  appendBranchTube,
  BranchCap,
  createBranchBufferGeometry,
  createBranchGeometryData,
} from './woody-geometry.js';
import {
  calculateBarkTextureWraps,
  createBarkMaterial,
} from './woody-material.js';

export class Tree extends THREE.Group {
  /**
   * @type {RNG}
   */
  rng;

  /**
   * @type {TreeOptions}
   */
  options;

  /**
   * @type {Branch[]}
   */
  branchQueue = [];

  #leafWind;

  /**
   * @param {TreeOptions} params
   */
  constructor(options = new TreeOptions()) {
    super();
    this.name = 'Tree';
    this.branchesMesh = new THREE.Mesh();
    this.leavesMesh = new THREE.Mesh();
    this.trellisMesh = null;
    this.lod = null;
    this.skeleton = null;
    this.#leafWind = new LeafWind();
    this.add(this.branchesMesh);
    this.add(this.leavesMesh);
    this.options = options;
  }

  update(elapsedTime) {
    this.#leafWind.setTime(elapsedTime);
  }

  /**
   * Loads a preset tree from JSON
   * @param {string} preset
   */
  loadPreset(name) {
    const json = loadPreset(name);
    this.loadFromJson(json);
  }

  /**
   * Loads a tree from JSON
   * @param {TreeOptions} json
   */
  loadFromJson(json) {
    this.options.copy(json);
    this.generate();
  }

  /**
   * @typedef {Object} LODDetail
   * @property {number} [sectionStride=1] Sample every Nth section ring; the
   *   first and last rings are always kept so branch endpoints stay put
   * @property {number} [segmentFactor=1] Radial segment multiplier;
   *   segments = max(3, round(segmentCount * segmentFactor))
   * @property {number} [leafStride=1] Keep every Nth leaf
   * @property {number} [leafScale=1] Size multiplier for the kept leaves,
   *   typically 1/sqrt(kept fraction) to preserve canopy coverage
   * @property {string} [billboard] Billboard mode override for this level
   *   ('single' or 'double'); defaults to options.leaves.billboard
   */

  /**
   * @typedef {Object} LODLevel
   * @property {number} distance Camera distance at which this level activates
   * @property {number} [hysteresis] Switch hysteresis as a fraction of distance
   * @property {LODDetail} [detail] Meshing detail for this level
   */

  /**
   * Default levels for generateLODs(). LOD1 is roughly 40% of the full
   * triangle count, LOD2 roughly 20%.
   * @type {LODLevel[]}
   */
  static defaultLODLevels = [
    { distance: 0, detail: {} },
    {
      distance: 100,
      hysteresis: 0.05,
      detail: {
        sectionStride: 3,
        segmentFactor: 0.75,
        leafStride: 2,
        // Slightly under the area-preserving sqrt(2): individual leaves are
        // still resolvable at this distance, so a full compensation reads as
        // "bigger leaves" rather than "same canopy".
        leafScale: 1.25,
      },
    },
    {
      distance: 250,
      hysteresis: 0.05,
      detail: {
        sectionStride: 6,
        segmentFactor: 0.4,
        leafStride: 2,
        // Deliberately under-compensated: full coverage compensation for the
        // thinning + single billboard would need 2x scale, which reads as
        // balloon leaves. A slightly sparser canopy with natural-size leaves
        // looks better at this distance (fogged, 250+ units in the demo).
        leafScale: 1.3,
        billboard: Billboard.Single,
      },
    },
  ];

  /**
   * Generate a new tree
   */
  generate() {
    this.#clearLOD();
    this.#generateSkeleton();

    const buffers = this.#meshSkeleton();
    this.branches = buffers.branches;
    this.leaves = buffers.leaves;

    this.createBranchesGeometry();
    this.createLeavesGeometry();
    this.createTrellis();
  }

  /**
   * Generates the tree as a set of levels of detail hosted in a THREE.LOD
   * object inside this group. The renderer switches levels automatically
   * based on camera distance. All levels share one bark and one leaf
   * material, so update() animates wind at every level.
   * @param {LODLevel[]} levels Level descriptors, in any order
   */
  generateLODs(levels = Tree.defaultLODLevels) {
    this.#clearLOD();
    this.#generateSkeleton();

    const barkMaterial = this.#createBarkMaterial();
    const leafMaterials = this.#createLeafMaterials();

    this.lod = new THREE.LOD();
    this.lod.name = 'TreeLOD';

    // THREE.LOD sorts its levels by distance internally, so sort here too and
    // let the nearest level own the reused meshes regardless of input order.
    const ordered = [...levels].sort(
      (a, b) => (a.distance ?? 0) - (b.distance ?? 0),
    );

    ordered.forEach((level, index) => {
      const buffers = this.#meshSkeleton(level.detail ?? {});

      let branchesMesh, leavesMesh;
      if (index === 0) {
        // Reuse the existing meshes for the closest level so update(),
        // traversal and the vertex/triangle count getters keep working.
        this.branches = buffers.branches;
        this.leaves = buffers.leaves;
        branchesMesh = this.branchesMesh;
        leavesMesh = this.leavesMesh;
        branchesMesh.geometry.dispose();
        branchesMesh.material.dispose();
        leavesMesh.geometry.dispose();
        this.#disposeLeafMaterials(leavesMesh);
      } else {
        branchesMesh = new THREE.Mesh();
        leavesMesh = new THREE.Mesh();
      }

      branchesMesh.geometry = createBranchBufferGeometry(buffers.branches);
      branchesMesh.material = barkMaterial;
      leavesMesh.geometry = createLeafBufferGeometry(buffers.leaves);
      this.#assignLeafMaterials(leavesMesh, leafMaterials);

      for (const mesh of [branchesMesh, leavesMesh]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }

      const group = new THREE.Group();
      group.add(branchesMesh, leavesMesh);
      this.lod.addLevel(group, level.distance ?? 0, level.hysteresis ?? 0);
    });

    this.add(this.lod);
    this.createTrellis();
  }

  /**
   * Builds branch and leaf geometry at the given detail level without
   * modifying the tree's own meshes. Useful for external instancing or
   * custom LOD systems. Reuses the current skeleton, generating one first
   * if none exists.
   * @param {LODDetail} detail
   * @returns {{ branches: THREE.BufferGeometry, leaves: THREE.BufferGeometry }}
   */
  createGeometry(detail = {}) {
    if (!this.skeleton) {
      this.#generateSkeleton();
    }
    const buffers = this.#meshSkeleton(detail);
    return {
      branches: createBranchBufferGeometry(buffers.branches),
      leaves: createLeafBufferGeometry(buffers.leaves),
    };
  }

  /**
   * Tears down any LOD state and restores the flat branches/leaves meshes
   * as direct children, so generate() behaves as if LODs never existed.
   */
  #clearLOD() {
    if (!this.lod) return;

    this.lod.levels.forEach((level) => {
      for (const mesh of level.object.children) {
        // One level reuses branchesMesh/leavesMesh; their geometry and the
        // shared materials are disposed by whichever generate path runs next.
        if (mesh === this.branchesMesh || mesh === this.leavesMesh) continue;
        mesh.geometry.dispose();
      }
    });

    this.remove(this.lod);
    this.lod = null;
    this.add(this.branchesMesh, this.leavesMesh);
  }

  /**
   * Grows the tree skeleton: the section frames of every branch and the
   * placement of every leaf. All RNG consumption happens here, so any
   * number of meshing passes can run against one skeleton without changing
   * the tree's shape.
   */
  #generateSkeleton() {
    this.skeleton = {
      branches: [],
      leaves: [],
    };

    this.rng = new RNG(this.options.seed);

    // Create the trunk of the tree first
    this.branchQueue.push(
      new Branch(
        new THREE.Vector3(),
        new THREE.Euler(),
        this.options.branch.length[0],
        this.options.branch.radius[0],
        0,
        this.options.branch.sections[0],
        this.options.branch.segments[0],
      ),
    );

    while (this.branchQueue.length > 0) {
      const branch = this.branchQueue.shift();
      this.#growBranch(branch);
    }
  }

  /**
   * Meshes the current skeleton into geometry buffers at the given detail.
   * Consumes no RNG, so it can run repeatedly with different detail specs.
   * @param {LODDetail} detail
   */
  #meshSkeleton(detail = {}) {
    const resolved = normalizePlantDetail(detail, {
      billboard: this.options.leaves.billboard,
    });
    const branches = createBranchGeometryData();
    const leaves = createLeafGeometryData();

    for (const skeletonBranch of this.skeleton.branches) {
      this.#meshBranch(
        branches,
        skeletonBranch,
        resolved.sectionStride,
        resolved.segmentFactor,
      );
    }

    for (
      let index = 0;
      index < this.skeleton.leaves.length;
      index += resolved.leafStride
    ) {
      this.#meshLeaf(
        leaves,
        this.skeleton.leaves[index],
        resolved.leafScale,
        resolved.billboard,
      );
    }

    return { branches, leaves };
  }

  /**
   * Grows a branch's skeleton, queueing child branches and recording leaf
   * placements. Consumes RNG in the exact order of the original interleaved
   * generator so seeds keep producing identical trees.
   * @param {Branch} branch
   * @returns
   */
  #growBranch(branch) {
    let sectionOrientation = branch.orientation.clone();
    let sectionOrigin = branch.origin.clone();
    // Branch.length already contains the level-specific length. Keeping the
    // section step independent of the total level count preserves v2's
    // bit-identical skeleton while avoiding its unreachable case-sensitive
    // "Deciduous" branch (and a latent division by zero at levels === 1).
    const sectionLength = branch.length / branch.sectionCount;

    // This information is used for generating child branches after the branch
    // geometry has been constructed
    let sections = [];

    for (let i = 0; i <= branch.sectionCount; i++) {
      let sectionRadius = branch.radius;

      // If final section of final level, set radius to effecively zero
      if (
        i === branch.sectionCount &&
        branch.level === this.options.branch.levels
      ) {
        sectionRadius = 0.001;
      } else if (this.options.type === TreeType.Deciduous) {
        sectionRadius *=
          1 -
          this.options.branch.taper[branch.level] * (i / branch.sectionCount);
      } else if (this.options.type === TreeType.Evergreen) {
        // Evergreens do not have a terminal branch so they have a taper of 1
        sectionRadius *= 1 - i / branch.sectionCount;
      }

      // Use this information later on when generating child branches
      sections.push({
        origin: sectionOrigin.clone(),
        orientation: sectionOrientation.clone(),
        radius: sectionRadius,
      });

      sectionOrigin.add(
        new THREE.Vector3(0, sectionLength, 0).applyEuler(sectionOrientation),
      );

      // Perturb the orientation of the next section randomly. The higher the
      // gnarliness, the larger potential perturbation
      const gnarliness =
        Math.max(1, 1 / Math.sqrt(sectionRadius)) *
        this.options.branch.gnarliness[branch.level];

      sectionOrientation.x += this.rng.random(gnarliness, -gnarliness);
      sectionOrientation.z += this.rng.random(gnarliness, -gnarliness);

      // Apply growth force to the branch
      const qSection = new THREE.Quaternion().setFromEuler(sectionOrientation);

      const qTwist = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        this.options.branch.twist[branch.level],
      );

      qSection.multiply(qTwist);

      // Rotate the section's growth direction toward force.direction (positive
      // strength) or away from it (negative). The (sectionUp × target) axis
      // makes force.direction behave as a real world axis: when sectionUp is
      // already aligned with target the rotation is zero, so a vertical trunk
      // with force=(0,1,0) doesn't get gnarliness drift amplified — the old
      // slerp form was degenerate at qForce=identity and pushed branches in
      // whatever random direction the section had drifted.
      const sectionUp = new THREE.Vector3(0, 1, 0).applyQuaternion(qSection);
      const target = new THREE.Vector3()
        .copy(this.options.branch.force.direction)
        .normalize();
      const axis = new THREE.Vector3().crossVectors(sectionUp, target);
      const sinFull = axis.length();
      if (sinFull > 1e-6) {
        axis.divideScalar(sinFull);
        const fullAngle = Math.atan2(sinFull, sectionUp.dot(target));
        const step = this.options.branch.force.strength / sectionRadius;
        const clamped = Math.max(-fullAngle, Math.min(fullAngle, step));
        qSection.premultiply(
          new THREE.Quaternion().setFromAxisAngle(axis, clamped),
        );
      }

      // Apply trellis force if enabled
      if (this.options.trellis.enabled) {
        const trellisResult = this.calculateTrellisForce(
          sectionOrigin,
          sectionRadius,
        );
        if (trellisResult) {
          const qTrellis = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            trellisResult.direction,
          );
          qSection.rotateTowards(qTrellis, trellisResult.strength);
        }
      }

      sectionOrientation.setFromQuaternion(qSection);
    }

    this.skeleton.branches.push({
      sections,
      segmentCount: branch.segmentCount,
      baseRadius: branch.radius,
    });

    // Deciduous trees have a terminal branch that grows out of the
    // end of the parent branch
    if (this.options.type === 'deciduous') {
      const lastSection = sections[sections.length - 1];

      if (branch.level < this.options.branch.levels) {
        this.branchQueue.push(
          new Branch(
            lastSection.origin,
            lastSection.orientation,
            this.options.branch.length[branch.level + 1],
            lastSection.radius,
            branch.level + 1,
            // Section count and segment count must be same as parent branch
            // since the child branch is growing from the end of the parent branch
            branch.sectionCount,
            branch.segmentCount,
          ),
        );
      } else {
        this.#recordLeaf(lastSection.origin, lastSection.orientation);
      }
    }

    // If we are on the last branch level, generate leaves
    if (branch.level === this.options.branch.levels) {
      this.generateLeaves(sections);
    } else if (branch.level < this.options.branch.levels) {
      this.generateChildBranches(
        this.options.branch.children[branch.level],
        branch.level + 1,
        sections,
      );
    }
  }

  /**
   * Generate branches from a parent branch
   * @param {number} count The number of child branches to generate
   * @param {number} level The level of the child branches
   * @param {{
   *  origin: THREE.Vector3,
   *  orientation: THREE.Euler,
   *  radius: number
   * }[]} sections The parent branch's sections
   * @returns
   */
  generateChildBranches(count, level, sections) {
    const radialOffset = this.rng.random();
    const startMin = this.options.branch.start[level];
    const heightStep = (1.0 - startMin) / count;
    const angleSlots = this.shuffledIndices(count);

    for (let i = 0; i < count; i++) {
      // Stratified sampling along the parent's length: jitter within slot [i, i+1]
      // so children are spread evenly but not perfectly periodic.
      let childBranchStart = startMin + (i + this.rng.random()) * heightStep;

      // Find which sections are on either side of the child branch origin point
      // so we can determine the origin, orientation and radius of the branch
      const sectionIndex = Math.floor(childBranchStart * (sections.length - 1));
      let sectionA, sectionB;
      sectionA = sections[sectionIndex];
      if (sectionIndex === sections.length - 1) {
        sectionB = sectionA;
      } else {
        sectionB = sections[sectionIndex + 1];
      }

      // Find normalized distance from section A to section B (0 to 1)
      const alpha =
        (childBranchStart - sectionIndex / (sections.length - 1)) /
        (1 / (sections.length - 1));

      // Linearly interpolate origin from section A to section B
      const childBranchOrigin = new THREE.Vector3().lerpVectors(
        sectionA.origin,
        sectionB.origin,
        alpha,
      );

      // Linearly interpolate radius
      const childBranchRadius =
        this.options.branch.radius[level] *
        ((1 - alpha) * sectionA.radius + alpha * sectionB.radius);

      // Linearlly interpolate the orientation
      const qA = new THREE.Quaternion().setFromEuler(sectionA.orientation);
      const qB = new THREE.Quaternion().setFromEuler(sectionB.orientation);
      const parentOrientation = new THREE.Euler().setFromQuaternion(
        qB.slerp(qA, alpha),
      );

      // Stratified radial angle: each child gets a 2π/count slot, jittered ±½ slot.
      // angleSlots[i] randomly permutes slot assignment so that the height slot
      // and angle slot are uncorrelated — otherwise evergreens (where branch
      // length depends on height) spiral their longest branches to a fixed side.
      const radialJitter = this.rng.random(0.5, -0.5);
      const radialAngle =
        2.0 * Math.PI * (radialOffset + (angleSlots[i] + radialJitter) / count);
      const q1 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        this.options.branch.angle[level] / (180 / Math.PI),
      );
      const q2 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        radialAngle,
      );
      const q3 = new THREE.Quaternion().setFromEuler(parentOrientation);

      const childBranchOrientation = new THREE.Euler().setFromQuaternion(
        q3.multiply(q2.multiply(q1)),
      );

      let childBranchLength =
        this.options.branch.length[level] *
        (this.options.type === TreeType.Evergreen
          ? 1.0 - childBranchStart
          : 1.0);

      this.branchQueue.push(
        new Branch(
          childBranchOrigin,
          childBranchOrientation,
          childBranchLength,
          childBranchRadius,
          level,
          this.options.branch.sections[level],
          this.options.branch.segments[level],
        ),
      );
    }
  }

  /**
   * Logic for spawning child branches from a parent branch's section
   * @param {{
   *  origin: THREE.Vector3,
   *  orientation: THREE.Euler,
   *  radius: number
   * }[]} sections The parent branch's sections
   * @returns
   */
  generateLeaves(sections) {
    const radialOffset = this.rng.random();
    const count = this.options.leaves.count;
    const startMin = this.options.leaves.start;
    const heightStep = (1.0 - startMin) / count;
    const angleSlots = this.shuffledIndices(count);

    for (let i = 0; i < count; i++) {
      // Stratified sampling along the parent's length.
      let leafStart = startMin + (i + this.rng.random()) * heightStep;

      // Find which sections are on either side of the child branch origin point
      // so we can determine the origin, orientation and radius of the branch
      const sectionIndex = Math.floor(leafStart * (sections.length - 1));
      let sectionA, sectionB;
      sectionA = sections[sectionIndex];
      if (sectionIndex === sections.length - 1) {
        sectionB = sectionA;
      } else {
        sectionB = sections[sectionIndex + 1];
      }

      // Find normalized distance from section A to section B (0 to 1)
      const alpha =
        (leafStart - sectionIndex / (sections.length - 1)) /
        (1 / (sections.length - 1));

      // Linearly interpolate origin from section A to section B
      const leafOrigin = new THREE.Vector3().lerpVectors(
        sectionA.origin,
        sectionB.origin,
        alpha,
      );

      // Linearlly interpolate the orientation
      const qA = new THREE.Quaternion().setFromEuler(sectionA.orientation);
      const qB = new THREE.Quaternion().setFromEuler(sectionB.orientation);
      const parentOrientation = new THREE.Euler().setFromQuaternion(
        qB.slerp(qA, alpha),
      );

      // Stratified radial angle with permuted slot assignment.
      // See generateChildBranches for rationale.
      const radialJitter = this.rng.random(0.5, -0.5);
      const radialAngle =
        2.0 * Math.PI * (radialOffset + (angleSlots[i] + radialJitter) / count);
      const q1 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        this.options.leaves.angle / (180 / Math.PI),
      );
      const q2 = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        radialAngle,
      );
      const q3 = new THREE.Quaternion().setFromEuler(parentOrientation);

      const leafOrientation = new THREE.Euler().setFromQuaternion(
        q3.multiply(q2.multiply(q1)),
      );

      this.#recordLeaf(leafOrigin, leafOrientation);
    }
  }

  /**
   * Records a leaf placement in the skeleton. The size variance is sampled
   * here so the meshing passes stay RNG-free.
   * @param {THREE.Vector3} origin The starting point of the leaf
   * @param {THREE.Euler} orientation The orientation of the leaf
   */
  #recordLeaf(origin, orientation) {
    const size =
      this.options.leaves.size *
      (1 +
        this.rng.random(
          this.options.leaves.sizeVariance,
          -this.options.leaves.sizeVariance,
        ));

    this.skeleton.leaves.push({
      origin: origin.clone(),
      orientation: orientation.clone(),
      size,
    });
  }

  /**
   * Emits the quad geometry for one skeleton leaf into the buffers
   * @param {{verts: number[], normals: number[], indices: number[], uvs: number[]}} buffers
   * @param {{origin: THREE.Vector3, orientation: THREE.Euler, size: number}} leaf
   * @param {number} scale Size multiplier for this detail level
   * @param {string} billboard Billboard mode for this detail level
   */
  #meshLeaf(buffers, leaf, scale, billboard) {
    const { origin, orientation } = leaf;
    const leafSize = leaf.size * scale;
    appendLeafCard(buffers, {
      origin,
      orientation,
      width: leafSize,
      length: leafSize,
      billboard,
      roundedNormals: this.options.leaves.roundedNormals,
    });
  }

  /**
   * Fisher-Yates shuffle of [0..count-1] using the tree's RNG so results stay
   * seed-reproducible.
   * @param {number} count
   * @returns {number[]}
   */
  shuffledIndices(count) {
    const arr = Array.from({ length: count }, (_, k) => k);
    for (let k = count - 1; k > 0; k--) {
      const r = Math.floor(this.rng.random() * (k + 1));
      [arr[k], arr[r]] = [arr[r], arr[k]];
    }
    return arr;
  }

  /**
   * Emits the ring geometry and indices for one skeleton branch
   * @param {{verts: number[], normals: number[], indices: number[], uvs: number[]}} buffers
   * @param {{sections: {origin: THREE.Vector3, orientation: THREE.Euler, radius: number}[], segmentCount: number, baseRadius: number}} skeletonBranch
   * @param {number} sectionStride Sample every Nth section ring
   * @param {number} segmentFactor Radial segment multiplier
   */
  #meshBranch(buffers, skeletonBranch, sectionStride, segmentFactor) {
    const { sections, segmentCount, baseRadius } = skeletonBranch;
    const segments = Math.max(3, Math.round(segmentCount * segmentFactor));
    const wrapsX = calculateBarkTextureWraps(
      baseRadius,
      this.options.bark.textureScale.x,
    );
    const sampled = samplePlantDetailSections(sections, sectionStride).sections;

    appendBranchTube(buffers, sampled, {
      radialSegments: segments,
      textureWraps: wrapsX,
      caps: BranchCap.None,
    });
  }

  /**
   * Creates the bark material from the current options
   * @returns {THREE.MeshStandardMaterial}
   */
  #createBarkMaterial() {
    return createBarkMaterial(this.options.bark);
  }

  /**
   * Generates the geometry for the branches
   */
  createBranchesGeometry() {
    this.branchesMesh.geometry.dispose();
    this.branchesMesh.geometry = createBranchBufferGeometry(this.branches);
    this.branchesMesh.material.dispose();
    this.branchesMesh.material = this.#createBarkMaterial();
    this.branchesMesh.castShadow = true;
    this.branchesMesh.receiveShadow = true;
  }

  /**
   * Creates the leaf material, including the wind sway vertex shader, from
   * the current options
   * @returns {THREE.MeshStandardMaterial}
   */
  #createLeafMaterials() {
    return createLeafMaterialSet({
      map: this.options.leaves.map ?? null,
      tint: this.options.leaves.tint,
      alphaTest: this.options.leaves.alphaTest,
      roundedNormals: this.options.leaves.roundedNormals,
      wind: this.#leafWind,
      windVariant: 'tree-leaves',
    });
  }

  #disposeLeafMaterials(mesh) {
    const materials = new Set([
      mesh.material,
      mesh.customDepthMaterial,
      mesh.customDistanceMaterial,
    ]);
    for (const material of materials) {
      if (material?.isMaterial) material.dispose();
    }
    mesh.customDepthMaterial = null;
    mesh.customDistanceMaterial = null;
  }

  #assignLeafMaterials(mesh, { surface, depth, distance }) {
    mesh.material = surface;
    mesh.customDepthMaterial = depth;
    mesh.customDistanceMaterial = distance;
  }

  /**
   * Generates the geometry for the leaves
   */
  createLeavesGeometry() {
    this.leavesMesh.geometry.dispose();
    this.leavesMesh.geometry = createLeafBufferGeometry(this.leaves);
    this.#disposeLeafMaterials(this.leavesMesh);
    this.#assignLeafMaterials(this.leavesMesh, this.#createLeafMaterials());
    this.leavesMesh.castShadow = true;
    this.leavesMesh.receiveShadow = true;
  }

  /**
   * Create or update the trellis geometry
   */
  createTrellis() {
    // Remove old trellis if exists
    if (this.trellisMesh) {
      this.remove(this.trellisMesh);
      this.trellisMesh.dispose();
      this.trellisMesh = null;
    }

    // Create new trellis if enabled and visible
    if (this.options.trellis.enabled && this.options.trellis.visible) {
      this.trellisMesh = new Trellis(this.options.trellis);
      this.trellisMesh.generate();
      this.add(this.trellisMesh);
    }
  }

  /**
   * Find the nearest point on the trellis grid to a given position
   * @param {THREE.Vector3} position
   * @returns {THREE.Vector3}
   */
  getNearestTrellisPoint(position) {
    const t = this.options.trellis;
    const trellisX = t.position.x;
    const trellisY = t.position.y;
    const trellisZ = t.position.z;

    // Trellis bounds
    const minX = trellisX - t.width / 2;
    const maxX = trellisX + t.width / 2;
    const minY = trellisY;
    const maxY = trellisY + t.height;

    // Clamp position to trellis bounds for projection
    const clampedX = Math.max(minX, Math.min(maxX, position.x));
    const clampedY = Math.max(minY, Math.min(maxY, position.y));

    // Find nearest horizontal line (Y = constant)
    const nearestHLineY =
      Math.round((clampedY - minY) / t.spacing) * t.spacing + minY;
    const finalHLineY = Math.max(minY, Math.min(maxY, nearestHLineY));

    // Find nearest vertical line (X = constant)
    const nearestVLineX =
      Math.round((clampedX - minX) / t.spacing) * t.spacing + minX;
    const finalVLineX = Math.max(minX, Math.min(maxX, nearestVLineX));

    // Point on nearest horizontal line (X can vary along the line)
    const pointOnHLine = new THREE.Vector3(clampedX, finalHLineY, trellisZ);

    // Point on nearest vertical line (Y can vary along the line)
    const pointOnVLine = new THREE.Vector3(finalVLineX, clampedY, trellisZ);

    // Return whichever is closer
    const distH = position.distanceTo(pointOnHLine);
    const distV = position.distanceTo(pointOnVLine);

    return distH < distV ? pointOnHLine : pointOnVLine;
  }

  /**
   * Calculate the force vector toward the nearest trellis point
   * @param {THREE.Vector3} position Current section position
   * @param {number} radius Current section radius
   * @returns {{ direction: THREE.Vector3, strength: number } | null}
   */
  calculateTrellisForce(position, radius) {
    const trellis = this.options.trellis;
    const nearestPoint = this.getNearestTrellisPoint(position);

    const distance = position.distanceTo(nearestPoint);

    // Only apply force within max distance
    if (distance > trellis.force.maxDistance) return null;
    if (distance < 0.001) return null; // Avoid division by zero

    // Calculate direction toward trellis
    const direction = new THREE.Vector3()
      .subVectors(nearestPoint, position)
      .normalize();

    // Calculate strength with distance falloff
    // Closer = stronger force, scaled by inverse radius (like existing force)
    const distanceFactor =
      1 - Math.pow(distance / trellis.force.maxDistance, trellis.force.falloff);
    const strength = (trellis.force.strength * distanceFactor) / radius;

    return { direction, strength };
  }

  get vertexCount() {
    return (this.branches.verts.length + this.leaves.verts.length) / 3;
  }

  get triangleCount() {
    return (this.branches.indices.length + this.leaves.indices.length) / 3;
  }
}

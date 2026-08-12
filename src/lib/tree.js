import * as THREE from 'three';
import RNG from './rng.js';
import { Branch } from './branch.js';
import { Billboard, TreeType } from './enums.js';
import TreeOptions from './options.js';
import {
  normalizePlantDetail,
  samplePlantDetailSections,
} from './plant-detail.js';
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
  appendBranchTube,
  BranchCap,
  createBranchBufferGeometry,
  createBranchGeometryData,
  sampleBranchSection,
} from './woody-geometry.js';
import { createBarkMaterial } from './woody-material.js';

function normalizeLODLevels(levels) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new TypeError('generateLODs requires at least one LOD level.');
  }

  return levels
    .map((level, index) => {
      if (level == null || typeof level !== 'object' || Array.isArray(level)) {
        throw new TypeError(`LOD level ${index} must be an object.`);
      }
      const distance = level.distance ?? 0;
      const hysteresis = level.hysteresis ?? 0;
      if (!Number.isFinite(distance) || distance < 0) {
        throw new RangeError(
          `LOD level ${index} distance must be non-negative.`,
        );
      }
      if (!Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis > 1) {
        throw new RangeError(
          `LOD level ${index} hysteresis must be between 0 and 1.`,
        );
      }
      return {
        distance,
        hysteresis,
        detail: level.detail ?? {},
      };
    })
    .sort((a, b) => a.distance - b.distance);
}

export class Tree extends THREE.Group {
  /** Default EZ-Tree v2 mesh reductions for large tree scenes. */
  static defaultLODLevels = [
    { distance: 0, detail: {} },
    {
      distance: 100,
      hysteresis: 0.05,
      detail: {
        sectionStride: 3,
        segmentFactor: 0.75,
        leafStride: 2,
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
        leafScale: 1.3,
        billboard: Billboard.Single,
      },
    },
  ];

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
    this.branches = createBranchGeometryData();
    this.leaves = createLeafGeometryData();
    this._leafWind = new LeafWind();
    this.add(this.branchesMesh);
    this.add(this.leavesMesh);
    this.options = options;
  }

  update(elapsedTime) {
    this._leafWind.setTime(elapsedTime);
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
   * Generate a new tree
   */
  generate() {
    this._clearLOD();
    this._generateSkeleton();
    const buffers = this._meshSkeleton();
    this.branches = buffers.branches;
    this.leaves = buffers.leaves;
    this.createBranchesGeometry();
    this.createLeavesGeometry();
    this.createTrellis();
    return this;
  }

  /**
   * Build multiple detail levels from one RNG-stable skeleton.
   * @param {{distance: number, hysteresis?: number, detail?: object}[]} levels
   */
  generateLODs(levels = Tree.defaultLODLevels) {
    const orderedLevels = normalizeLODLevels(levels);
    this._clearLOD();
    this._generateSkeleton();

    const barkMaterial = this._createBarkMaterial();
    const leafMaterials = this._createLeafMaterials();
    const lod = new THREE.LOD();
    lod.name = 'TreeLOD';

    orderedLevels.forEach((level, index) => {
      const buffers = this._meshSkeleton(level.detail);
      let branchesMesh;
      let leavesMesh;

      if (index === 0) {
        this.branches = buffers.branches;
        this.leaves = buffers.leaves;
        branchesMesh = this.branchesMesh;
        leavesMesh = this.leavesMesh;

        branchesMesh.geometry.dispose();
        branchesMesh.material.dispose();
        leavesMesh.geometry.dispose();
        leavesMesh.material.dispose();
        leavesMesh.customDepthMaterial?.dispose();
        leavesMesh.customDistanceMaterial?.dispose();
      } else {
        branchesMesh = new THREE.Mesh();
        leavesMesh = new THREE.Mesh();
      }

      branchesMesh.geometry = createBranchBufferGeometry(buffers.branches);
      branchesMesh.material = barkMaterial;
      branchesMesh.castShadow = true;
      branchesMesh.receiveShadow = true;

      leavesMesh.geometry = createLeafBufferGeometry(buffers.leaves);
      leavesMesh.material = leafMaterials.surface;
      leavesMesh.customDepthMaterial = leafMaterials.depth;
      leavesMesh.customDistanceMaterial = leafMaterials.distance;
      leavesMesh.castShadow = true;
      leavesMesh.receiveShadow = true;

      const group = new THREE.Group();
      group.name = `TreeLOD_${index}`;
      group.add(branchesMesh, leavesMesh);
      lod.addLevel(group, level.distance, level.hysteresis);
    });

    this.lod = lod;
    this.add(lod);
    this.createTrellis();
    return this;
  }

  /**
   * Build raw branch and leaf geometries without replacing the live meshes.
   * The current skeleton is reused, so repeated detail passes consume no RNG.
   */
  createGeometry(detail = {}) {
    if (!this.skeleton) this._generateSkeleton();
    const buffers = this._meshSkeleton(detail);
    return {
      branches: createBranchBufferGeometry(buffers.branches),
      leaves: createLeafBufferGeometry(buffers.leaves),
    };
  }

  /** Remove generated LOD levels while preserving the primary mesh pair. */
  _clearLOD() {
    if (!this.lod) return;

    for (const level of this.lod.levels) {
      for (const mesh of level.object.children) {
        if (mesh === this.branchesMesh || mesh === this.leavesMesh) continue;
        mesh.geometry?.dispose();
      }
    }

    this.remove(this.lod);
    this.lod = null;
    this.add(this.branchesMesh, this.leavesMesh);
  }

  /**
   * Grow branch section frames and leaf placements. All RNG consumption is
   * confined to this pass, so every later mesh pass sees the same tree.
   */
  _generateSkeleton() {
    this.skeleton = {
      branches: [],
      leaves: [],
    };
    this.branchQueue.length = 0;
    this.rng = new RNG(this.options.seed);

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
      this._growBranch(this.branchQueue.shift());
    }
  }

  /** Emit one geometry-buffer pair from the current skeleton. */
  _meshSkeleton(detail = {}) {
    const resolved = normalizePlantDetail(detail, {
      billboard: this.options.leaves.billboard,
    });
    const branches = createBranchGeometryData();
    const leaves = createLeafGeometryData();

    for (const skeletonBranch of this.skeleton.branches) {
      const sampled = samplePlantDetailSections(
        skeletonBranch.sections,
        resolved.sectionStride,
      ).sections;

      const radialSegments = Math.max(
        3,
        Math.round(skeletonBranch.segmentCount * resolved.segmentFactor),
      );
      const textureWraps = Math.max(
        1,
        Math.round(
          skeletonBranch.baseRadius * this.options.bark.textureScale.x,
        ),
      );
      appendBranchTube(branches, sampled, {
        radialSegments,
        textureWraps,
        caps: BranchCap.None,
      });
    }

    for (
      let leafIndex = 0;
      leafIndex < this.skeleton.leaves.length;
      leafIndex += resolved.leafStride
    ) {
      const leaf = this.skeleton.leaves[leafIndex];
      const leafSize = leaf.size * resolved.leafScale;
      appendLeafCard(leaves, {
        origin: leaf.origin,
        orientation: leaf.orientation,
        width: leafSize,
        length: leafSize,
        billboard: resolved.billboard,
        roundedNormals: this.options.leaves.roundedNormals,
      });
    }

    return { branches, leaves };
  }

  /**
   * Generates a new branch
   * @param {Branch} branch
   * @returns
   */
  _growBranch(branch) {
    let sectionOrientation = branch.orientation.clone();
    let sectionOrigin = branch.origin.clone();
    const deciduousLengthFactor =
      this.options.type === TreeType.Deciduous
        ? Math.max(1, this.options.branch.levels - 1)
        : 1;
    let sectionLength =
      branch.length / branch.sectionCount / deciduousLengthFactor;

    // These section frames are retained for child growth and later mesh passes.
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
    if (this.options.type === TreeType.Deciduous) {
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
        this._recordLeaf(lastSection.origin, lastSection.orientation);
      }
    }

    // If we are on the last branch level, generate leaves
    if (branch.level === this.options.branch.levels) {
      this._generateLeaves(sections);
    } else if (branch.level < this.options.branch.levels) {
      this._generateChildBranches(
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
  _generateChildBranches(count, level, sections) {
    const radialOffset = this.rng.random();
    const startMin = this.options.branch.start[level];
    const heightStep = (1.0 - startMin) / count;
    const angleSlots = this._shuffledIndices(count);

    for (let i = 0; i < count; i++) {
      // Stratified sampling along the parent's length: jitter within slot [i, i+1]
      // so children are spread evenly but not perfectly periodic.
      let childBranchStart = startMin + (i + this.rng.random()) * heightStep;

      const parentSection = sampleBranchSection(
        sections,
        childBranchStart,
        this.options.branch.radius[level],
      );
      const childBranchOrigin = parentSection.origin;
      const childBranchRadius = parentSection.radius;
      const parentOrientation = parentSection.orientation;

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
  _generateLeaves(sections) {
    const radialOffset = this.rng.random();
    const count = this.options.leaves.count;
    const startMin = this.options.leaves.start;
    const heightStep = (1.0 - startMin) / count;
    const angleSlots = this._shuffledIndices(count);

    for (let i = 0; i < count; i++) {
      // Stratified sampling along the parent's length.
      let leafStart = startMin + (i + this.rng.random()) * heightStep;

      const parentSection = sampleBranchSection(sections, leafStart);
      const leafOrigin = parentSection.origin;
      const parentOrientation = parentSection.orientation;

      // Stratified radial angle with permuted slot assignment.
      // See _generateChildBranches for rationale.
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

      this._recordLeaf(leafOrigin, leafOrientation);
    }
  }

  /** Record one randomized leaf placement in the skeleton. */
  _recordLeaf(origin, orientation) {
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
   * Fisher-Yates shuffle of [0..count-1] using the tree's RNG so results stay
   * seed-reproducible.
   * @param {number} count
   * @returns {number[]}
   */
  _shuffledIndices(count) {
    const arr = Array.from({ length: count }, (_, k) => k);
    for (let k = count - 1; k > 0; k--) {
      const r = Math.floor(this.rng.random() * (k + 1));
      [arr[k], arr[r]] = [arr[r], arr[k]];
    }
    return arr;
  }

  /**
   * Build the PBR bark material through the shared woody-material contract.
   */
  _createBarkMaterial() {
    return createBarkMaterial({
      name: 'branches',
      flatShading: this.options.bark.flatShading,
      tint: this.options.bark.tint,
      textured: this.options.bark.textured,
      textureScale: this.options.bark.textureScale,
      maps: this.options.bark.maps,
    });
  }

  /** Generates the geometry for the branches. */
  createBranchesGeometry() {
    const geometry = createBranchBufferGeometry(this.branches);
    const material = this._createBarkMaterial();

    this.branchesMesh.geometry.dispose();
    this.branchesMesh.geometry = geometry;
    this.branchesMesh.material.dispose();
    this.branchesMesh.material = material;
    this.branchesMesh.castShadow = true;
    this.branchesMesh.receiveShadow = true;
  }

  /** Build the shared surface and shadow materials for every leaf LOD. */
  _createLeafMaterials() {
    return createLeafMaterialSet({
      name: 'leaves',
      map: this.options.leaves.map ?? null,
      tint: this.options.leaves.tint,
      alphaTest: this.options.leaves.alphaTest,
      roundedNormals: this.options.leaves.roundedNormals,
      wind: this._leafWind,
      surfaceWindVariant: 'tree-rounded-normals',
      shadowWindVariant: 'tree-leaves',
    });
  }

  /** Generates the geometry for the leaves. */
  createLeavesGeometry() {
    const geometry = createLeafBufferGeometry(this.leaves);
    const materials = this._createLeafMaterials();

    this.leavesMesh.geometry.dispose();
    this.leavesMesh.geometry = geometry;
    this.leavesMesh.material.dispose();
    this.leavesMesh.customDepthMaterial?.dispose();
    this.leavesMesh.customDistanceMaterial?.dispose();

    this.leavesMesh.material = materials.surface;
    this.leavesMesh.customDepthMaterial = materials.depth;
    this.leavesMesh.customDistanceMaterial = materials.distance;

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

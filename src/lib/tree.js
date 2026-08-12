import * as THREE from 'three';
import RNG from './rng.js';
import { Branch } from './branch.js';
import { TreeType } from './enums.js';
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
  appendBranchTube,
  BranchCap,
  createBranchBufferGeometry,
  createBranchGeometryData,
} from './woody-geometry.js';

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

  /**
   * @param {TreeOptions} params
   */
  constructor(options = new TreeOptions()) {
    super();
    this.name = 'Tree';
    this.branchesMesh = new THREE.Mesh();
    this.leavesMesh = new THREE.Mesh();
    this.trellisMesh = null;
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
    this.branches = createBranchGeometryData();
    this.leaves = createLeafGeometryData();
    this.branchQueue.length = 0;
    this.rng = new RNG(this.options.seed);

    // Create the trunk of the tree first.
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
      this.generateBranch(this.branchQueue.shift());
    }

    this.createBranchesGeometry();
    this.createLeavesGeometry();
    this.createTrellis();
  }

  /**
   * Generates a new branch
   * @param {Branch} branch
   * @returns
   */
  generateBranch(branch) {
    const indexOffset = this.branches.verts.length / 3;
    let sectionOrientation = branch.orientation.clone();
    let sectionOrigin = branch.origin.clone();
    // The committed renderer always used one branch-length divisor. Keep that
    // baseline explicitly instead of preserving its unreachable case typo.
    const baselineLengthDivisor = 1;
    const sectionLength =
      branch.length / branch.sectionCount / baselineLengthDivisor;

    const sections = [];

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

    const emitted = createBranchGeometryData();
    appendBranchTube(emitted, sections, {
      radialSegments: branch.segmentCount,
      textureWraps: Math.max(
        1,
        Math.round(branch.radius * this.options.bark.textureScale.x),
      ),
      caps: BranchCap.None,
    });
    this.branches.verts.push(...emitted.verts);
    this.branches.normals.push(...emitted.normals);
    this.branches.uvs.push(...emitted.uvs);
    this.generateBranchIndices(indexOffset, branch, emitted.indices);

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
        this.generateLeaf(lastSection.origin, lastSection.orientation);
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

      const sectionIndex = Math.floor(childBranchStart * (sections.length - 1));
      const sectionA = sections[sectionIndex];
      const sectionB = sections[sectionIndex + 1] ?? sectionA;
      const alpha =
        (childBranchStart - sectionIndex / (sections.length - 1)) /
        (1 / (sections.length - 1));
      const childBranchOrigin = new THREE.Vector3().lerpVectors(
        sectionA.origin,
        sectionB.origin,
        alpha,
      );
      const childBranchRadius =
        this.options.branch.radius[level] *
        ((1 - alpha) * sectionA.radius + alpha * sectionB.radius);
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

      const sectionIndex = Math.floor(leafStart * (sections.length - 1));
      const sectionA = sections[sectionIndex];
      const sectionB = sections[sectionIndex + 1] ?? sectionA;
      const alpha =
        (leafStart - sectionIndex / (sections.length - 1)) /
        (1 / (sections.length - 1));
      const leafOrigin = new THREE.Vector3().lerpVectors(
        sectionA.origin,
        sectionB.origin,
        alpha,
      );
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

      this.generateLeaf(leafOrigin, leafOrientation);
    }
  }

  /**
   * Generates a leaf.
   * @param {THREE.Vector3} origin The starting point of the leaf
   * @param {THREE.Euler} orientation The starting orientation of the leaf
   */
  generateLeaf(origin, orientation) {
    const leafSize =
      this.options.leaves.size *
      (1 +
        this.rng.random(
          this.options.leaves.sizeVariance,
          -this.options.leaves.sizeVariance,
        ));
    appendLeafCard(this.leaves, {
      origin,
      orientation,
      width: leafSize,
      length: leafSize,
      billboard: this.options.leaves.billboard,
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
   * Retained for public API compatibility. Branch indices are emitted by the
   * shared tube kernel during generateBranch().
   * @param {number} indexOffset
   * @param {Branch} branch
   */
  generateBranchIndices(indexOffset, branch, emittedIndices) {
    if (emittedIndices) {
      this.branches.indices.push(
        ...emittedIndices.map((index) => indexOffset + index),
      );
      return;
    }

    const ringStride = branch.segmentCount + 1;
    for (let section = 0; section < branch.sectionCount; section++) {
      for (let segment = 0; segment < branch.segmentCount; segment++) {
        const v1 = indexOffset + section * ringStride + segment;
        const v2 = v1 + 1;
        const v3 = v1 + ringStride;
        const v4 = v2 + ringStride;
        this.branches.indices.push(v1, v3, v2, v2, v3, v4);
      }
    }
  }

  /** Create the original EZ-Tree Phong bark material. */
  _createBarkMaterial() {
    const material = new THREE.MeshPhongMaterial({
      name: 'branches',
      flatShading: this.options.bark.flatShading,
      color: new THREE.Color(this.options.bark.tint),
    });

    if (this.options.bark.textured) {
      const scale = this.options.bark.textureScale;
      const maps = this.options.bark.maps;
      const apply = (texture) => {
        if (!texture) return null;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1 / scale.y);
        return texture;
      };
      if (maps.color) material.map = apply(maps.color);
      if (maps.ao) material.aoMap = apply(maps.ao);
      if (maps.normal) material.normalMap = apply(maps.normal);
      if (maps.roughness) material.roughnessMap = apply(maps.roughness);
    }

    return material;
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

  /** Build the shared EZ-Tree leaf surface and matching shadow materials. */
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

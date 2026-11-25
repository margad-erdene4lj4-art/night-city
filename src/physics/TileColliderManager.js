import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const COLLIDER_ADD_RADIUS = 185;
const COLLIDER_REMOVE_RADIUS = 250;
const MAX_COLLIDERS_PER_FRAME = 3;

export class TileColliderManager {
  constructor() {
    this.world = null;
    this.collidersByMesh = new Map();
    this.safetyFloorCollider = null;
    this.raycaster = new THREE.Raycaster();
    this._tempSphere = new THREE.Sphere();
    this._tempVec = new THREE.Vector3();
    this._down = new THREE.Vector3(0, -1, 0);
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });

    // Emergency deep safety plane far below Tokyo street level so the car can
    // never fall infinitely if tiles are still streaming.
    const floorBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -45, 0)
    );
    const floorDesc = RAPIER.ColliderDesc.cuboid(4000, 1, 4000).setFriction(0.9);
    this.safetyFloorCollider = this.world.createCollider(floorDesc, floorBody);
    return this.world;
  }

  /**
   * Streams Rapier trimesh colliders for visible Three.js meshes near the car.
   */
  updateNearCar(collisionRoot, carPosition) {
    if (!this.world || !collisionRoot) return;

    collisionRoot.updateMatrixWorld(true);

    const visibleNearby = new Set();
    const pendingMeshes = [];

    collisionRoot.traverseVisible((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      const geo = obj.geometry;
      if (!geo.attributes?.position || geo.attributes.position.count < 3) return;

      if (!geo.boundingSphere) geo.computeBoundingSphere();
      this._tempSphere.copy(geo.boundingSphere).applyMatrix4(obj.matrixWorld);

      const dist = this._tempSphere.center.distanceTo(carPosition) - this._tempSphere.radius;
      if (dist <= COLLIDER_REMOVE_RADIUS) {
        visibleNearby.add(obj);
      }
      if (dist <= COLLIDER_ADD_RADIUS && !this.collidersByMesh.has(obj)) {
        pendingMeshes.push({ mesh: obj, dist });
      }
    });

    // Remove stale / out-of-range colliders
    for (const [mesh, entry] of this.collidersByMesh.entries()) {
      if (!visibleNearby.has(mesh)) {
        this._removeEntry(mesh, entry);
      }
    }

    // Build closest colliders within per-frame budget to avoid frame spikes
    if (pendingMeshes.length > 0) {
      pendingMeshes.sort((a, b) => a.dist - b.dist);
      const count = Math.min(pendingMeshes.length, MAX_COLLIDERS_PER_FRAME);
      for (let i = 0; i < count; i++) {
        this._buildTrimeshForMesh(pendingMeshes[i].mesh);
      }
    }
  }

  _buildTrimeshForMesh(mesh) {
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    const vertexCount = posAttr.count;
    const vertices = new Float32Array(vertexCount * 3);

    for (let i = 0; i < vertexCount; i++) {
      this._tempVec.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      vertices[i * 3] = this._tempVec.x;
      vertices[i * 3 + 1] = this._tempVec.y;
      vertices[i * 3 + 2] = this._tempVec.z;
    }

    let indices;
    if (geo.index) {
      indices = new Uint32Array(geo.index.array);
    } else {
      indices = new Uint32Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) indices[i] = i;
    }

    if (indices.length < 3) return;

    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setFriction(0.95)
      .setRestitution(0.02);
    const collider = this.world.createCollider(colliderDesc, body);

    this.collidersByMesh.set(mesh, { body, collider });
  }

  _removeEntry(mesh, entry) {
    if (this.world) {
      this.world.removeRigidBody(entry.body);
    }
    this.collidersByMesh.delete(mesh);
  }

  disposeTileScene(tileScene) {
    tileScene.traverse((obj) => {
      if (obj.isMesh && this.collidersByMesh.has(obj)) {
        this._removeEntry(obj, this.collidersByMesh.get(obj));
      }
    });
  }

  clearAll() {
    for (const [mesh, entry] of this.collidersByMesh.entries()) {
      this._removeEntry(mesh, entry);
    }
  }

  /**
   * Raycasts downward against loaded 3D tiles to find street elevation at (x, z).
   */
  findGroundY(collisionRoot, x, z, fromY = 220) {
    if (!collisionRoot) return null;
    collisionRoot.updateMatrixWorld(true);
    this.raycaster.set(new THREE.Vector3(x, fromY, z), this._down);
    this.raycaster.far = 500;
    const hits = this.raycaster.intersectObject(collisionRoot, true);
    return hits.length > 0 ? hits[0].point.y : null;
  }

  step() {
    if (this.world) {
      this.world.step();
    }
  }
}

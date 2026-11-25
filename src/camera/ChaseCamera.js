import * as THREE from 'three';

/**
 * GTA-style third-person chase camera:
 * - Smooth follow lag behind car heading
 * - Speed-based FOV & pullback
 * - Mouse drag orbit look-around with auto-recenter while driving
 * - Raycast collision against buildings/ground so camera never clips inside tiles
 */
export class ChaseCamera {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.yawOffset = 0;
    this.pitchOffset = 0.24;
    this.isDragging = false;
    this.lastOrbitTime = -999;

    this.currentPos = new THREE.Vector3(0, 8, -12);
    this.currentLookAt = new THREE.Vector3(0, 1.5, 0);
    this.raycaster = new THREE.Raycaster();

    this._bindEvents();
  }

  _bindEvents() {
    this.domElement.addEventListener('pointerdown', (e) => {
      if (e.button === 0 || e.button === 2) {
        this.isDragging = true;
      }
    });

    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      this.yawOffset -= e.movementX * 0.0045;
      this.pitchOffset = THREE.MathUtils.clamp(
        this.pitchOffset + e.movementY * 0.0035,
        0.04,
        1.05
      );
      this.lastOrbitTime = performance.now() * 0.001;
    });

    this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  snapBehind(carPos, carHeading) {
    this.yawOffset = 0;
    this.pitchOffset = 0.24;
    const dist = 7.4;
    const desired = new THREE.Vector3(
      carPos.x - Math.sin(carHeading) * dist,
      carPos.y + 2.8,
      carPos.z - Math.cos(carHeading) * dist
    );
    this.currentPos.copy(desired);
    this.currentLookAt.set(carPos.x, carPos.y + 1.15, carPos.z);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }

  update(dt, carPos, carHeading, speedKmH, collisionRoot) {
    const now = performance.now() * 0.001;

    // Auto-recenter behind car after 1.8s of no mouse dragging while driving
    if (!this.isDragging && speedKmH > 8 && now - this.lastOrbitTime > 1.8) {
      this.yawOffset = THREE.MathUtils.lerp(this.yawOffset, 0, Math.min(1, dt * 2.2));
      this.pitchOffset = THREE.MathUtils.lerp(this.pitchOffset, 0.24, Math.min(1, dt * 2.0));
    }

    const speedRatio = THREE.MathUtils.clamp(speedKmH / 180, 0, 1);
    const targetFov = THREE.MathUtils.lerp(60, 75, speedRatio);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 6));
    this.camera.updateProjectionMatrix();

    const orbitAngle = carHeading + this.yawOffset;
    const distance = THREE.MathUtils.lerp(7.2, 8.6, speedRatio);
    const height = Math.sin(this.pitchOffset) * distance + 1.4;
    const horizDist = Math.cos(this.pitchOffset) * distance;

    const targetLookAt = new THREE.Vector3(
      carPos.x + Math.sin(carHeading) * 1.4,
      carPos.y + 1.25,
      carPos.z + Math.cos(carHeading) * 1.4
    );

    const desiredPos = new THREE.Vector3(
      carPos.x - Math.sin(orbitAngle) * horizDist,
      carPos.y + height,
      carPos.z - Math.cos(orbitAngle) * horizDist
    );

    // Occlusion check so camera stays in front of skyscrapers/terrain
    if (collisionRoot) {
      const dir = desiredPos.clone().sub(targetLookAt);
      const maxLen = dir.length();
      if (maxLen > 0.5) {
        this.raycaster.set(targetLookAt, dir.normalize());
        this.raycaster.far = maxLen;
        const hits = this.raycaster.intersectObject(collisionRoot, true);
        if (hits.length > 0 && hits[0].distance > 1.6) {
          desiredPos.copy(targetLookAt).addScaledVector(dir, hits[0].distance - 0.5);
        }
      }
    }

    const posLag = 1 - Math.exp(-8.5 * dt);
    const lookLag = 1 - Math.exp(-13.0 * dt);
    this.currentPos.lerp(desiredPos, posLag);
    this.currentLookAt.lerp(targetLookAt, lookLag);

    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLookAt);
  }
}

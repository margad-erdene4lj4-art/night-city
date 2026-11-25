import * as THREE from 'three';

/**
 * Procedural 3D JDM Sports Coupe (Silvia / RX-7 inspired) with:
 * - Sculpted body, cabin glass, hood vent, front splitter, GT rear wing
 * - Dynamic brake/tail lights
 * - Real Three.js SpotLight headlights that illuminate Tokyo streets at night
 * - 4 independently steering and spinning 6-spoke wheels
 */
export class JdmCar {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'JdmCar';
    scene.add(this.group);

    this.chassisGroup = new THREE.Group();
    this.group.add(this.chassisGroup);

    this.wheelPivots = [];
    this.wheelSpinners = [];
    this.headlights = [];
    this.headlightMeshes = [];
    this.brakeLightMat = null;
    this.underglowLight = null;
    this.headlightsEnabled = true;

    this._buildBody();
    this._buildWheels();
    this._buildLights();
  }

  _buildBody() {
    const paintMat = new THREE.MeshPhysicalMaterial({
      color: 0xe63946, // JDM Midnight Crimson
      metalness: 0.45,
      roughness: 0.22,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    });

    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x161922,
      metalness: 0.35,
      roughness: 0.45,
    });

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b1220,
      metalness: 0.1,
      roughness: 0.05,
      transparent: true,
      opacity: 0.86,
      clearcoat: 1.0,
    });

    // Main lower chassis
    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.52, 4.35), paintMat);
    lowerBody.position.set(0, 0.46, 0);
    lowerBody.castShadow = true;
    lowerBody.receiveShadow = true;
    this.chassisGroup.add(lowerBody);

    // Tapered front hood slope
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.16, 1.55), paintMat);
    hood.position.set(0, 0.72, 1.25);
    hood.rotation.x = 0.08;
    hood.castShadow = true;
    this.chassisGroup.add(hood);

    // Carbon hood vent
    const hoodVent = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.05, 0.38), carbonMat);
    hoodVent.position.set(0, 0.8, 1.18);
    hoodVent.rotation.x = 0.08;
    this.chassisGroup.add(hoodVent);

    // Cabin / Greenhouse
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.46, 1.85), glassMat);
    cabin.position.set(0, 0.94, -0.22);
    cabin.castShadow = true;
    this.chassisGroup.add(cabin);

    // Roof cap
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.06, 1.35), carbonMat);
    roof.position.set(0, 1.18, -0.25);
    roof.castShadow = true;
    this.chassisGroup.add(roof);

    // Front splitter & side skirts
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.07, 0.45), carbonMat);
    splitter.position.set(0, 0.21, 2.08);
    this.chassisGroup.add(splitter);

    const rearDiffuser = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.14, 0.3), carbonMat);
    rearDiffuser.position.set(0, 0.24, -2.14);
    this.chassisGroup.add(rearDiffuser);

    // JDM GT Wing
    const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.05, 0.34), carbonMat);
    wingBlade.position.set(0, 1.07, -1.96);
    wingBlade.rotation.x = -0.1;
    wingBlade.castShadow = true;
    this.chassisGroup.add(wingBlade);

    for (const xSign of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.18), carbonMat);
      strut.position.set(xSign * 0.56, 0.89, -1.94);
      this.chassisGroup.add(strut);
    }

    // Twin titanium exhaust tips
    const exhaustMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.9,
      roughness: 0.2,
    });
    for (const xOffset of [-0.52, -0.36]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.22, 12), exhaustMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(xOffset, 0.22, -2.22);
      this.chassisGroup.add(pipe);
    }

    // Tail / Brake light bar
    this.brakeLightMat = new THREE.MeshStandardMaterial({
      color: 0xff1e38,
      emissive: 0xff1e38,
      emissiveIntensity: 0.8,
      roughness: 0.2,
    });
    for (const xSign of [-1, 1]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.11, 0.06), this.brakeLightMat);
      tail.position.set(xSign * 0.62, 0.58, -2.17);
      this.chassisGroup.add(tail);
    }
  }

  _buildWheels() {
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x111317,
      roughness: 0.85,
      metalness: 0.05,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xd4a359, // Bronze TE37-style JDM rims
      metalness: 0.78,
      roughness: 0.26,
    });
    const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 24);
    tireGeo.rotateZ(Math.PI / 2);

    const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.27, 16);
    rimGeo.rotateZ(Math.PI / 2);

    const spokeGeo = new THREE.BoxGeometry(0.28, 0.045, 0.39);

    for (let i = 0; i < 4; i++) {
      const steerPivot = new THREE.Group();
      const spinGroup = new THREE.Group();

      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      spinGroup.add(tire);

      const rim = new THREE.Mesh(rimGeo, rimMat);
      spinGroup.add(rim);

      for (let s = 0; s < 3; s++) {
        const spoke = new THREE.Mesh(spokeGeo, rimMat);
        spoke.rotation.x = (s * Math.PI) / 3;
        spinGroup.add(spoke);
      }

      steerPivot.add(spinGroup);
      this.group.add(steerPivot);
      this.wheelPivots.push(steerPivot);
      this.wheelSpinners.push(spinGroup);
    }
  }

  _buildLights() {
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xe0f7ff,
      emissive: 0xcbeeff,
      emissiveIntensity: 3.0,
    });

    for (const xSign of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.08), bulbMat);
      lamp.position.set(xSign * 0.64, 0.54, 2.16);
      this.chassisGroup.add(lamp);
      this.headlightMeshes.push(lamp);

      const spot = new THREE.SpotLight(0xeef7ff, 120, 95, Math.PI / 4.2, 0.45, 1.4);
      spot.position.set(xSign * 0.64, 0.56, 2.15);
      spot.castShadow = false;

      const target = new THREE.Object3D();
      target.position.set(xSign * 1.4, -0.8, 28);
      this.chassisGroup.add(target);
      spot.target = target;

      this.chassisGroup.add(spot);
      this.headlights.push(spot);
    }

    // Subtle JDM cyan underglow
    this.underglowLight = new THREE.PointLight(0x00e5ff, 3.5, 6.5, 1.8);
    this.underglowLight.position.set(0, 0.25, 0);
    this.chassisGroup.add(this.underglowLight);
  }

  setHeadlightsEnabled(enabled, nightFactor = 1.0) {
    this.headlightsEnabled = enabled;
    const beamStrength = enabled ? THREE.MathUtils.lerp(22, 165, nightFactor) : 0;
    for (const spot of this.headlights) {
      spot.intensity = beamStrength;
    }
    for (const lamp of this.headlightMeshes) {
      lamp.material.emissiveIntensity = enabled ? 3.2 : 0.15;
    }
    if (this.underglowLight) {
      this.underglowLight.intensity = enabled ? nightFactor * 5.0 : 0.0;
    }
  }

  setBraking(isBraking) {
    if (this.brakeLightMat) {
      this.brakeLightMat.emissiveIntensity = isBraking ? 4.2 : 0.85;
    }
  }

  syncChassisTransform(position, quaternion) {
    this.chassisGroup.position.copy(position);
    this.chassisGroup.quaternion.copy(quaternion);
  }

  syncWheelTransform(index, worldPos, chassisQuat, steerAngle, spinAngle) {
    const pivot = this.wheelPivots[index];
    const spinner = this.wheelSpinners[index];
    if (!pivot || !spinner) return;

    pivot.position.copy(worldPos);
    pivot.quaternion.copy(chassisQuat);
    pivot.rotateY(steerAngle);
    spinner.rotation.x = spinAngle;
  }
}

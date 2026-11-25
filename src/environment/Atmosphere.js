import * as THREE from 'three';

/**
 * Manages Tokyo's 24-hour day/night cycle:
 * - Sun/Moon directional light with dynamic shadow frustum centered on the car
 * - Hemisphere bounce lighting
 * - Procedural gradient sky dome & atmospheric exponential fog
 */
export class Atmosphere {
  constructor(scene) {
    this.scene = scene;
    this.timeHours = 18.5; // Start at dramatic Tokyo dusk
    this.autoCycle = true;
    this.cycleSpeedHoursPerSec = 0.08;
    this.nightFactor = 0.5;

    this.scene.fog = new THREE.FogExp2(0x1b2238, 0.0014);

    this.hemiLight = new THREE.HemisphereLight(0x8ecae6, 0x1e293b, 0.9);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 260;
    const d = 75;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this._buildSkyDome();
    this.update(0, new THREE.Vector3());
  }

  _buildSkyDome() {
    const geo = new THREE.SphereGeometry(2800, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x0b132b) },
        horizonColor: { value: new THREE.Color(0xff7b54) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos - cameraPosition).y;
          float t = pow(max(h, 0.0), 0.55);
          gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
        }
      `,
    });
    this.skyDome = new THREE.Mesh(geo, this.skyMat);
    this.scene.add(this.skyDome);
  }

  setTimeHours(hours) {
    this.timeHours = ((hours % 24) + 24) % 24;
  }

  update(dt, carPos) {
    if (this.autoCycle) {
      this.timeHours = (this.timeHours + dt * this.cycleSpeedHoursPerSec) % 24;
    }

    this.skyDome.position.copy(carPos);

    // Sun angle: 6:00 = sunrise (0), 12:00 = zenith (PI/2), 18:00 = sunset (PI)
    const sunAngle = ((this.timeHours - 6) / 24) * Math.PI * 2;
    const sunElev = Math.sin(sunAngle);
    const sunHoriz = Math.cos(sunAngle);

    // 0 = bright day, 1 = deep night
    this.nightFactor = THREE.MathUtils.clamp(1 - (sunElev + 0.15) / 0.45, 0, 1);

    const sunDir = new THREE.Vector3(sunHoriz * 0.7, Math.max(sunElev, -0.35), 0.45).normalize();
    if (sunElev > -0.1) {
      this.sunLight.position.copy(carPos).addScaledVector(sunDir, 120);
      this.sunLight.intensity = THREE.MathUtils.lerp(0.15, 2.6, Math.max(0, sunElev));
      this.sunLight.color.setHSL(0.09, THREE.MathUtils.lerp(0.85, 0.15, Math.max(0, sunElev)), 0.72);
    } else {
      // Cool Tokyo moonlight from opposite arc
      this.sunLight.position.copy(carPos).add(new THREE.Vector3(-40, 95, -50));
      this.sunLight.intensity = 0.32;
      this.sunLight.color.setHex(0x6488ea);
    }
    this.sunLight.target.position.copy(carPos);
    this.sunLight.target.updateMatrixWorld();

    // Sky & fog palette transitions
    const dayTop = new THREE.Color(0x2563eb);
    const dayHorizon = new THREE.Color(0xbfe4ff);
    const duskTop = new THREE.Color(0x1e1b4b);
    const duskHorizon = new THREE.Color(0xf97316);
    const nightTop = new THREE.Color(0x030712);
    const nightHorizon = new THREE.Color(0x0f172a);

    const duskWeight = Math.exp(-Math.pow((sunElev - 0.05) / 0.16, 2));
    const top = dayTop.clone().lerp(nightTop, this.nightFactor).lerp(duskTop, duskWeight * 0.75);
    const horizon = dayHorizon
      .clone()
      .lerp(nightHorizon, this.nightFactor)
      .lerp(duskHorizon, duskWeight * 0.85);

    this.skyMat.uniforms.topColor.value.copy(top);
    this.skyMat.uniforms.horizonColor.value.copy(horizon);
    this.scene.fog.color.copy(horizon);
    this.scene.fog.density = THREE.MathUtils.lerp(0.0009, 0.0022, this.nightFactor);

    this.hemiLight.intensity = THREE.MathUtils.lerp(1.15, 0.24, this.nightFactor);
    this.hemiLight.color.copy(horizon);
  }
}

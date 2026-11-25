import * as THREE from 'three';
import { TOKYO_LOCATIONS } from './config/locations.js';
import { TokyoTilesWorld } from './world/TokyoTilesWorld.js';
import { TileColliderManager } from './physics/TileColliderManager.js';
import { JdmCar } from './vehicle/JdmCar.js';
import { VehiclePhysics } from './vehicle/VehiclePhysics.js';
import { ChaseCamera } from './camera/ChaseCamera.js';
import { Atmosphere } from './environment/Atmosphere.js';
import { Hud } from './ui/Hud.js';

const FIXED_DT = 1 / 60;

class TokyoDrivingSimulator {
  constructor() {
    this.input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      handbrake: false,
    };
    this.headlightsOn = true;
    this.awaitingGroundSpawn = false;
    this.pendingSpawnHeading = TOKYO_LOCATIONS.shibuya.heading;
    this.spawnTimer = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.2,
      4500
    );

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    document.getElementById('app').appendChild(this.renderer.domElement);

    this.atmosphere = new Atmosphere(this.scene);
    this.chaseCamera = new ChaseCamera(this.camera, this.renderer.domElement);
    this.colliderManager = new TileColliderManager();
    this.jdmCar = new JdmCar(this.scene);

    this.hud = new Hud({
      onTeleport: (key) => this.teleportTo(key),
      onTimeChange: (hours) => {
        this.atmosphere.autoCycle = false;
        this.hud.btnCycle.classList.remove('active');
        this.atmosphere.setTimeHours(hours);
      },
      onToggleCycle: (enabled) => {
        this.atmosphere.autoCycle = enabled;
      },
      onToggleLights: () => this.toggleHeadlights(),
    });
  }

  async start() {
    const { apiKey } = await this.hud.promptForStart('');

    const rapierWorld = await this.colliderManager.init();
    this.vehicle = new VehiclePhysics(rapierWorld, this.jdmCar);

    const startLoc = TOKYO_LOCATIONS.shibuya;
    this.tilesWorld = new TokyoTilesWorld(this.scene, this.camera, this.renderer, startLoc, {
      apiKey,
      onTileDispose: (tileScene) => this.colliderManager.disposeTileScene(tileScene),
    });

    this._bindControls();
    this._beginGroundSpawn(startLoc.heading);

    this._lastTime = performance.now();
    this._accumulator = 0;
    this._colliderSyncElapsed = 0;
    this._animate();
  }

  _beginGroundSpawn(heading) {
    this.awaitingGroundSpawn = true;
    this.pendingSpawnHeading = heading;
    this.spawnTimer = 0;
    this.vehicle.setStreamingHold(true);
    this.vehicle.placeAt(0, 35, 0, heading);
    this.chaseCamera.snapBehind(new THREE.Vector3(0, 35, 0), heading);
    this.hud.setStreamingBanner(true, `Streaming ${this.tilesWorld.currentLocation.name}...`);
  }

  teleportTo(locationKey) {
    const loc = TOKYO_LOCATIONS[locationKey];
    if (!loc || !this.tilesWorld) return;
    this.colliderManager.clearAll();
    this.tilesWorld.teleportTo(loc);
    this._beginGroundSpawn(loc.heading);
  }

  resetCarOnRoad() {
    if (!this.vehicle) return;
    const pos = this.vehicle.getPosition();
    const groundY = this.colliderManager.findGroundY(
      this.tilesWorld.getCollisionTarget(),
      pos.x,
      pos.z,
      pos.y + 80
    );

    if (groundY !== null) {
      this.vehicle.placeAt(pos.x, groundY + 1.3, pos.z, this.vehicle.getHeading());
    } else {
      const safe = this.vehicle.lastSafePosition;
      this.vehicle.placeAt(safe.x, safe.y + 1.5, safe.z, this.vehicle.lastSafeHeading);
    }
  }

  toggleHeadlights() {
    this.headlightsOn = !this.headlightsOn;
    this.hud.setLightsActive(this.headlightsOn);
  }

  _bindControls() {
    const setKey = (code, pressed) => {
      switch (code) {
        case 'KeyW':
        case 'ArrowUp':
          this.input.forward = pressed;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.input.backward = pressed;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.input.left = pressed;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.input.right = pressed;
          break;
        case 'Space':
          this.input.handbrake = pressed;
          break;
        case 'KeyR':
          if (pressed) this.resetCarOnRoad();
          break;
        case 'KeyL':
          if (pressed) this.toggleHeadlights();
          break;
      }
    };

    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      setKey(e.code, true);
    });

    window.addEventListener('keyup', (e) => setKey(e.code, false));

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.tilesWorld?.onResize();
    });
  }

  _animate = () => {
    requestAnimationFrame(this._animate);

    const now = performance.now();
    const dt = Math.min((now - this._lastTime) * 0.001, 0.05);
    this._lastTime = now;

    // 1. Stream 3D tiles around the current camera
    this.tilesWorld.update();
    const collisionRoot = this.tilesWorld.getCollisionTarget();

    // 2. Wait briefly on startup/teleport until road geometry under (0,0) has streamed in
    if (this.awaitingGroundSpawn) {
      this.spawnTimer += dt;
      const groundY = this.colliderManager.findGroundY(collisionRoot, 0, 0, 260);
      if (groundY !== null || this.spawnTimer > 5.0) {
        const dropY = groundY !== null ? groundY + 1.35 : 5.0;
        this.colliderManager.updateNearCar(collisionRoot, new THREE.Vector3(0, dropY, 0));
        this.vehicle.placeAt(0, dropY, 0, this.pendingSpawnHeading);
        this.vehicle.setStreamingHold(false);
        this.chaseCamera.snapBehind(new THREE.Vector3(0, dropY, 0), this.pendingSpawnHeading);
        this.awaitingGroundSpawn = false;
        this.hud.setStreamingBanner(false);
      }
    }

    // 3. Periodically sync nearby Rapier trimesh colliders from streamed 3D tiles
    this._colliderSyncElapsed += dt;
    if (!this.awaitingGroundSpawn && this._colliderSyncElapsed >= 0.08) {
      this._colliderSyncElapsed = 0;
      this.colliderManager.updateNearCar(collisionRoot, this.vehicle.getPosition());
    }

    // 4. Fixed-timestep physics simulation
    this._accumulator += dt;
    while (this._accumulator >= FIXED_DT) {
      this.vehicle.update(FIXED_DT, this.input);
      this.colliderManager.step();
      this._accumulator -= FIXED_DT;
    }
    this.vehicle.syncVisuals();

    const carPos = this.vehicle.getPosition();
    const carHeading = this.vehicle.getHeading();

    // Safety net if car clips below unstreamed edge
    if (!this.awaitingGroundSpawn && carPos.y < -35) {
      this.resetCarOnRoad();
    }

    // 5. Atmosphere, headlights & GTA chase camera
    this.atmosphere.update(dt, carPos);
    this.jdmCar.setHeadlightsEnabled(this.headlightsOn, this.atmosphere.nightFactor);
    this.chaseCamera.update(dt, carPos, carHeading, this.vehicle.speedKmH, collisionRoot);

    // 6. Update HUD
    this.hud.update({
      speedKmH: this.vehicle.speedKmH,
      forwardSpeedMs: this.vehicle.forwardSpeedMs,
      isDrifting: this.vehicle.isDrifting,
      carPos,
      carHeading,
      originLocation: this.tilesWorld.currentLocation,
      timeHours: this.atmosphere.timeHours,
      autoCycle: this.atmosphere.autoCycle,
      tileCount: this.tilesWorld.getActiveMeshCount(),
      attribution: this.tilesWorld.getAttributionText(),
    });

    this.renderer.render(this.scene, this.camera);
  };
}

const sim = new TokyoDrivingSimulator();
sim.start();

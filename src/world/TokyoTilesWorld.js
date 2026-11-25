import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import {
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin,
  ReorientationPlugin,
} from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const GOOGLE_3D_TILES_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';
const DRACO_DECODER_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';

export class TokyoTilesWorld {
  constructor(scene, camera, renderer, initialLocation, options = {}) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.currentLocation = initialLocation;
    this.isOfflineMode = !options.apiKey;
    this.onTileDispose = options.onTileDispose || (() => {});
    this.onTilesLoadedCount = 0;

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'TokyoWorldGroup';
    this.scene.add(this.rootGroup);

    this.tilesRenderer = null;
    this.reorientationPlugin = null;

    if (this.isOfflineMode) {
      this._buildOfflinePracticeGrid();
    } else {
      this._initGoogleTiles(options.apiKey, initialLocation);
    }
  }

  _initGoogleTiles(apiKey, location) {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_URL);

    const tilesRenderer = new TilesRenderer(GOOGLE_3D_TILES_URL);
    tilesRenderer.errorTarget = 8;
    tilesRenderer.maxDepth = 16;
    tilesRenderer.lruCache.minSize = 600;
    tilesRenderer.lruCache.maxSize = 900;

    tilesRenderer.registerPlugin(
      new GoogleCloudAuthPlugin({
        apiToken: apiKey,
        autoRefreshToken: true,
      })
    );

    this.reorientationPlugin = new ReorientationPlugin({
      lat: THREE.MathUtils.degToRad(location.lat),
      lon: THREE.MathUtils.degToRad(location.lon),
      height: location.height,
    });
    tilesRenderer.registerPlugin(this.reorientationPlugin);

    tilesRenderer.registerPlugin(
      new GLTFExtensionsPlugin({
        dracoLoader,
      })
    );

    tilesRenderer.setCamera(this.camera);
    tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);

    // Upgrade unlit MeshBasicMaterial from Google Photorealistic 3D Tiles to
    // MeshStandardMaterial so dynamic sun/moon lighting and car headlights work.
    tilesRenderer.addEventListener('load-model', ({ scene: tileScene }) => {
      this.onTilesLoadedCount++;
      tileScene.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;

        const mat = obj.material;
        if (mat && mat.isMeshBasicMaterial) {
          const litMat = new THREE.MeshStandardMaterial({
            map: mat.map || null,
            color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
            roughness: 0.88,
            metalness: 0.06,
          });
          mat.dispose();
          obj.material = litMat;
        } else if (mat && mat.isMeshStandardMaterial) {
          mat.roughness = Math.max(mat.roughness ?? 0.85, 0.75);
          mat.metalness = Math.min(mat.metalness ?? 0.1, 0.15);
        }
      });
    });

    tilesRenderer.addEventListener('dispose-model', ({ scene: tileScene }) => {
      this.onTilesLoadedCount = Math.max(0, this.onTilesLoadedCount - 1);
      this.onTileDispose(tileScene);
      tileScene.traverse((obj) => {
        if (!obj.isMesh) return;
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    });

    this.tilesRenderer = tilesRenderer;
    this.rootGroup.add(tilesRenderer.group);
  }

  /**
   * Stylized Shibuya-inspired fallback city block when running without an API key.
   */
  _buildOfflinePracticeGrid() {
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x20242c,
      roughness: 0.82,
      metalness: 0.08,
    });
    const ground = new THREE.Mesh(new THREE.BoxGeometry(700, 1, 700), roadMat);
    ground.position.set(0, -0.5, 0);
    ground.receiveShadow = true;
    this.rootGroup.add(ground);

    // Shibuya scramble crosswalk stripes
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.7,
    });
    for (let i = -5; i <= 5; i++) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 18), stripeMat);
      stripe.position.set(i * 4, 0.02, 0);
      stripe.receiveShadow = true;
      this.rootGroup.add(stripe);
    }

    // Surrounding Tokyo-style skyscraper blocks with glowing windows
    const buildingMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.55,
      metalness: 0.25,
    });
    const neonColors = [0x00e5ff, 0xff2e63, 0xfbbf24, 0x38bdf8];

    const blocks = [
      [-45, -45, 28, 52, 28],
      [45, -45, 30, 68, 26],
      [-48, 48, 32, 44, 30],
      [48, 48, 26, 58, 32],
      [-110, 0, 36, 75, 80],
      [110, 0, 36, 62, 80],
      [0, -110, 80, 48, 36],
      [0, 110, 80, 72, 36],
    ];

    blocks.forEach(([x, z, w, h, d], idx) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), buildingMat);
      b.position.set(x, h / 2, z);
      b.castShadow = true;
      b.receiveShadow = true;
      this.rootGroup.add(b);

      const signMat = new THREE.MeshStandardMaterial({
        color: neonColors[idx % neonColors.length],
        emissive: neonColors[idx % neonColors.length],
        emissiveIntensity: 1.6,
      });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.65, 2.4, 0.4), signMat);
      sign.position.set(x, 12 + (idx % 3) * 4, z + (z < 0 ? d / 2 + 0.25 : -d / 2 - 0.25));
      this.rootGroup.add(sign);
    });

    // Drift ramp for testing suspension & gravity
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(10, 1.5, 18),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 })
    );
    ramp.position.set(22, 0.5, -24);
    ramp.rotation.x = 0.14;
    ramp.receiveShadow = true;
    ramp.castShadow = true;
    this.rootGroup.add(ramp);
  }

  teleportTo(location) {
    this.currentLocation = location;
    if (this.reorientationPlugin) {
      this.reorientationPlugin.transformLatLonHeightToOrigin(
        THREE.MathUtils.degToRad(location.lat),
        THREE.MathUtils.degToRad(location.lon),
        location.height
      );
    }
  }

  update() {
    if (this.tilesRenderer) {
      this.tilesRenderer.setCamera(this.camera);
      this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);
      this.tilesRenderer.update();
    }
  }

  getCollisionTarget() {
    return this.tilesRenderer ? this.tilesRenderer.group : this.rootGroup;
  }

  getActiveMeshCount() {
    if (this.isOfflineMode) return this.rootGroup.children.length;
    return this.tilesRenderer?.activeTiles?.size ?? this.onTilesLoadedCount;
  }

  getAttributionText() {
    if (this.isOfflineMode) {
      return 'Offline Practice Grid · Enter Google Maps API Key for Real Tokyo';
    }
    if (!this.tilesRenderer) return 'Map data © Google';
    const attrs = this.tilesRenderer.getAttributions?.() || [];
    const values = attrs.map((a) => a.value).filter(Boolean);
    return values.length > 0 ? `Google 3D Tiles · ${values.join(' | ')}` : 'Map data © Google';
  }

  onResize() {
    if (this.tilesRenderer) {
      this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);
    }
  }
}

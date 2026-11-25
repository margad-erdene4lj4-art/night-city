import { TOKYO_LOCATIONS, latLonToLocalEnu, localEnuToLatLon } from '../config/locations.js';

export class Hud {
  constructor(callbacks) {
    this.callbacks = callbacks;

    this.hudRoot = document.getElementById('hud');
    this.modal = document.getElementById('setup-modal');
    this.apiKeyInput = document.getElementById('api-key-input');
    this.btnLaunchTiles = document.getElementById('btn-launch-tiles');
    this.btnLaunchOffline = document.getElementById('btn-launch-offline');

    this.speedEl = document.getElementById('speed-value');
    this.rpmFillEl = document.getElementById('rpm-bar-fill');
    this.gearEl = document.getElementById('gear-value');
    this.driftBadgeEl = document.getElementById('drift-badge');
    this.locationEl = document.getElementById('location-readout');
    this.timeSlider = document.getElementById('time-slider');
    this.timeReadout = document.getElementById('time-readout');
    this.btnCycle = document.getElementById('btn-cycle');
    this.btnLights = document.getElementById('btn-lights');
    this.streamStatus = document.getElementById('stream-status');
    this.streamText = document.getElementById('stream-text');
    this.compassEl = document.getElementById('compass-readout');
    this.tileCountEl = document.getElementById('tile-count-readout');
    this.attributionEl = document.getElementById('google-attribution');

    this.minimapCanvas = document.getElementById('minimap-canvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');
    this.teleportButtons = Array.from(document.querySelectorAll('[data-teleport]'));

    this._bindEvents();
  }

  _bindEvents() {
    this.teleportButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.teleport;
        this.setActiveTeleport(key);
        this.callbacks.onTeleport?.(key);
      });
    });

    this.timeSlider.addEventListener('input', (e) => {
      const hours = parseFloat(e.target.value);
      this.callbacks.onTimeChange?.(hours);
    });

    this.btnCycle.addEventListener('click', () => {
      const active = this.btnCycle.classList.toggle('active');
      this.callbacks.onToggleCycle?.(active);
    });

    this.btnLights.addEventListener('click', () => {
      this.callbacks.onToggleLights?.();
    });
  }

  promptForStart(envApiKey) {
    const savedKey = localStorage.getItem('tokyo3d_google_api_key') || '';
    const initialKey = envApiKey && envApiKey !== 'your_google_maps_api_key_here' ? envApiKey : savedKey;

    if (initialKey && envApiKey && envApiKey !== 'your_google_maps_api_key_here') {
      this.hideModal();
      return Promise.resolve({ apiKey: initialKey });
    }

    if (savedKey) {
      this.apiKeyInput.value = savedKey;
    }

    return new Promise((resolve) => {
      this.btnLaunchTiles.addEventListener('click', () => {
        const key = this.apiKeyInput.value.trim();
        if (!key) {
          this.apiKeyInput.focus();
          return;
        }
        localStorage.setItem('tokyo3d_google_api_key', key);
        this.hideModal();
        resolve({ apiKey: key });
      });

      this.btnLaunchOffline.addEventListener('click', () => {
        this.hideModal();
        resolve({ apiKey: null });
      });
    });
  }

  hideModal() {
    this.modal.classList.add('hidden');
    this.hudRoot.classList.remove('hidden');
  }

  setActiveTeleport(locationKey) {
    this.teleportButtons.forEach((b) => {
      b.classList.toggle('active', b.dataset.teleport === locationKey);
    });
  }

  setLightsActive(enabled) {
    this.btnLights.classList.toggle('active', enabled);
  }

  setStreamingBanner(visible, text = 'Streaming Tokyo 3D Tiles...') {
    this.streamStatus.classList.toggle('hidden', !visible);
    this.streamText.textContent = text;
  }

  update(state) {
    const {
      speedKmH,
      forwardSpeedMs,
      isDrifting,
      carPos,
      carHeading,
      originLocation,
      timeHours,
      autoCycle,
      tileCount,
      attribution,
    } = state;

    const kmh = Math.round(speedKmH);
    this.speedEl.textContent = String(kmh);

    // Simulated 6-speed gearbox & RPM bar
    let gear = 'N';
    let rpmRatio = 0.12;
    if (forwardSpeedMs < -0.5) {
      gear = 'R';
      rpmRatio = Math.min(1, 0.25 + speedKmH / 55);
    } else if (kmh > 1) {
      const thresholds = [0, 32, 65, 98, 132, 165, 210];
      let gearNum = 1;
      for (let i = 1; i < thresholds.length; i++) {
        if (kmh >= thresholds[i]) gearNum = Math.min(6, i + 1);
      }
      gear = String(gearNum);
      const low = thresholds[gearNum - 1];
      const high = thresholds[gearNum];
      rpmRatio = 0.28 + 0.72 * Math.min(1, Math.max(0, (kmh - low) / (high - low)));
    }

    this.gearEl.textContent = gear;
    this.rpmFillEl.style.width = `${Math.round(rpmRatio * 100)}%`;
    this.driftBadgeEl.classList.toggle('active', isDrifting);

    // Coordinates readout
    const geo = localEnuToLatLon(originLocation.lat, originLocation.lon, carPos.x, carPos.z);
    this.locationEl.textContent = `${geo.lat.toFixed(4)}° N, ${geo.lon.toFixed(4)}° E · ${originLocation.name}`;

    // Time slider & readout
    if (autoCycle) {
      this.timeSlider.value = timeHours.toFixed(2);
    }
    const hh = Math.floor(timeHours) % 24;
    const mm = Math.floor((timeHours - Math.floor(timeHours)) * 60);
    this.timeReadout.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

    // Compass (0 deg = North = -Z)
    const bearingDeg = (((Math.atan2(Math.sin(carHeading), -Math.cos(carHeading)) * 180) / Math.PI) + 360) % 360;
    this.compassEl.textContent = `HDG ${String(Math.round(bearingDeg)).padStart(3, '0')}°`;
    this.tileCountEl.textContent = `Tiles: ${tileCount}`;
    this.attributionEl.textContent = attribution;

    this._drawMinimap(carPos, carHeading, originLocation);
  }

  _drawMinimap(carPos, carHeading, originLocation) {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const mapRadiusMeters = 350;
    const scale = (w * 0.44) / mapRadiusMeters;

    ctx.clearRect(0, 0, w, h);

    // Radar rings & crosshairs
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.14)';
    ctx.lineWidth = 1;
    [0.33, 0.66, 1.0].forEach((r) => {
      ctx.beginPath();
      ctx.arc(cx, cy, (w * 0.44) * r, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Subtle local street grid scrolling with the car
    const gridStepMeters = 50;
    const gridPx = gridStepMeters * scale;
    const offsetX = ((-carPos.x * scale) % gridPx + gridPx) % gridPx;
    const offsetY = ((-carPos.z * scale) % gridPx + gridPx) % gridPx;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    for (let x = offsetX; x < w; x += gridPx) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = offsetY; y < h; y += gridPx) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Tokyo landmark pins (clamped to radar edge if far away)
    Object.values(TOKYO_LOCATIONS).forEach((loc) => {
      const enu = latLonToLocalEnu(originLocation.lat, originLocation.lon, loc.lat, loc.lon);
      let dx = (enu.x - carPos.x) * scale;
      let dy = (enu.z - carPos.z) * scale;
      const dist = Math.hypot(dx, dy);
      const maxR = w * 0.42;
      if (dist > maxR) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }

      ctx.fillStyle = loc.id === originLocation.id ? '#00e5ff' : '#fbbf24';
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '9px Inter, sans-serif';
      ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
      ctx.fillText(loc.name.split(' ')[0], cx + dx + 5, cy + dy + 3);
    });

    // Player heading arrow
    ctx.save();
    ctx.translate(cx, cy);
    // In canvas, -Y is North (-Z in world), +X is East (+X in world)
    // carHeading = atan2(forward.x, forward.z): 0 => +Z (South, down on canvas), PI => -Z (North, up)
    ctx.rotate(-carHeading + Math.PI);
    ctx.fillStyle = '#ff2e63';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // North indicator
    ctx.fillStyle = '#00e5ff';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('N', cx - 3, 12);
  }
}

export const TOKYO_LOCATIONS = {
  shibuya: {
    id: 'shibuya',
    name: 'Shibuya Crossing',
    lat: 35.6595,
    lon: 139.7004,
    height: 40,
    heading: 0.45,
  },
  shinjuku: {
    id: 'shinjuku',
    name: 'Shinjuku',
    lat: 35.6938,
    lon: 139.7034,
    height: 45,
    heading: -0.25,
  },
  tokyoTower: {
    id: 'tokyoTower',
    name: 'Tokyo Tower',
    lat: 35.6586,
    lon: 139.7454,
    height: 42,
    heading: 1.05,
  },
};

const METERS_PER_DEG_LAT = 111132.95;

/**
 * Converts local Three.js ENU offsets (x = East, z = South) back to WGS84 lat/lon.
 */
export function localEnuToLatLon(originLat, originLon, xMeters, zMeters) {
  const latRad = (originLat * Math.PI) / 180;
  const metersPerDegLon = 111412.84 * Math.cos(latRad);
  return {
    lat: originLat + -zMeters / METERS_PER_DEG_LAT,
    lon: originLon + xMeters / metersPerDegLon,
  };
}

/**
 * Converts a target lat/lon to local ENU offsets relative to the current origin.
 */
export function latLonToLocalEnu(originLat, originLon, targetLat, targetLon) {
  const latRad = (originLat * Math.PI) / 180;
  const metersPerDegLon = 111412.84 * Math.cos(latRad);
  return {
    x: (targetLon - originLon) * metersPerDegLon,
    z: -(targetLat - originLat) * METERS_PER_DEG_LAT,
  };
}

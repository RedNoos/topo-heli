import type { GeoData } from './maps/types';

const R = 6371; // earth radius, km
const RAD = Math.PI / 180;

/**
 * Projects lon/lat to kilometres (x to the east, y to the south).
 * Country maps use an equirectangular projection centred on the map; large
 * regions use Lambert azimuthal equal-area, which keeps shapes and distances
 * reasonable over a whole continent.
 */
export class Projection {
  readonly project: (lon: number, lat: number) => { x: number; y: number };

  constructor(geo: GeoData) {
    const p = geo.projection;
    if (p?.type === 'laea') {
      const sin0 = Math.sin(p.lat0 * RAD);
      const cos0 = Math.cos(p.lat0 * RAD);
      this.project = (lon, lat) => {
        const phi = lat * RAD;
        const dl = (lon - p.lon0) * RAD;
        const cosc = Math.cos(phi) * Math.cos(dl);
        const k = Math.sqrt(2 / (1 + sin0 * Math.sin(phi) + cos0 * cosc));
        return { x: R * k * Math.cos(phi) * Math.sin(dl), y: -R * k * (cos0 * Math.sin(phi) - sin0 * cosc) };
      };
    } else {
      const [minLon, minLat, maxLon, maxLat] = geo.bbox;
      const lon0 = (minLon + maxLon) / 2;
      const lat0 = (minLat + maxLat) / 2;
      const ky = RAD * R;
      const kx = ky * Math.cos(lat0 * RAD);
      this.project = (lon, lat) => ({ x: (lon - lon0) * kx, y: -(lat - lat0) * ky });
    }
  }
}

export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

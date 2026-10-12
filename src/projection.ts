import type { GeoData } from './maps/types';

const R = 6371; // earth radius, km

/**
 * Equirectangular projection centred on the map, in kilometres
 * (x to the east, y to the south). Accurate enough for country-sized maps.
 */
export class Projection {
  private readonly lon0: number;
  private readonly lat0: number;
  private readonly kx: number;
  private readonly ky = (Math.PI / 180) * R;

  constructor(geo: GeoData) {
    const [minLon, minLat, maxLon, maxLat] = geo.bbox;
    this.lon0 = (minLon + maxLon) / 2;
    this.lat0 = (minLat + maxLat) / 2;
    this.kx = this.ky * Math.cos((this.lat0 * Math.PI) / 180);
  }

  project(lon: number, lat: number): { x: number; y: number } {
    return { x: (lon - this.lon0) * this.kx, y: -(lat - this.lat0) * this.ky };
  }
}

export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

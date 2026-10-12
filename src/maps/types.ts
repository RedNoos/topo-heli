type LonLat = [number, number];

/** Geometry produced by scripts/build-map.mjs (all coordinates lon/lat). */
export interface GeoData {
  bbox: [number, number, number, number];
  /** Polygons (lists of rings) of the playable country/region. */
  home: LonLat[][][];
  neighbours: LonLat[][][];
  /** Internal administrative borders as lines. */
  districts: LonLat[][];
  /** r = Natural Earth scalerank (lower = bigger river), l = line. */
  rivers: { r: number; l: LonLat[] }[];
  lakes: LonLat[][][];
  /** Default: equirectangular around the bbox centre. */
  projection?: { type: 'laea'; lon0: number; lat0: number; /** [minX, minY, maxX, maxY] km, y up. */ rect: number[] };
  /** Multi-country maps: each country with a colour index (neighbours differ). */
  countries?: { c: number; p: LonLat[][][] }[];
  /** Borders between the countries above. */
  borders?: LonLat[][];
}

export interface City {
  name: string;
  lat: number;
  lon: number;
  /** Approximate population; used to rank how well-known a city is. */
  pop: number;
  /** Optional: in play from this level on, regardless of population (e.g. capitals). */
  level?: number;
}

export interface MapData {
  geo: GeoData;
  cities: City[];
}

export interface MapDefinition {
  id: string;
  name: string;
  /** Kilometres visible across the smaller side of the screen. Bigger regions want a bigger view. */
  viewKm: number;
  /** Lazily loaded so adding maps does not grow the initial bundle. */
  load: () => Promise<MapData>;
}

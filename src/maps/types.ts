import type { StringKey } from '../i18n';

export type LonLat = [number, number];

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
  /** Base-map water outside the playable area (drawn muted). Inside: rivers/lakes. */
  riversOutside: { r: number; l: LonLat[] }[];
  lakesOutside: LonLat[][][];
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

/** Optional physical-geography targets (scripts/build-physical.mjs). */
export interface PhysicalData {
  rivers: { name: string; level: number; lines: LonLat[][] }[];
  lakes: { name: string; level: number; rings: LonLat[][] }[];
  /** Located at the range's main peak. */
  mountains: { name: string; level: number; lat: number; lon: number; ele: number | null }[];
  /**
   * Drawing layers, pre-clipped to the country: rivers by level (1..3), background
   * waterways never asked (e.g. Nieuwe Waterweg) and water areas (lakes, river banks, harbours).
   */
  draw: { rivers: LonLat[][][]; lines: LonLat[][]; water: LonLat[][][] };
}

export interface MapData {
  geo: GeoData;
  cities: City[];
  /** Present when the map supports the mountains/rivers/lakes mode. */
  physical?: PhysicalData;
}

export interface MapDefinition {
  id: string;
  /** Translated map name (see i18n.ts). */
  nameKey: StringKey;
  /**
   * Place names: 'sr-Latn' = written in Serbian Latin (transliterated for Cyrillic);
   * 'native' = shown as-is, or via loadSerbianNames when Serbian is selected.
   */
  placeNames: 'sr-Latn' | 'native';
  /** Serbian (Cyrillic) names by place name, for maps whose names are not Serbian. */
  loadSerbianNames?: () => Promise<Record<string, string>>;
  /** Dutch names by place name, where they differ (e.g. Vienna -> Wenen). */
  loadDutchNames?: () => Promise<Record<string, string>>;
  /** Kilometres visible across the smaller side of the screen. Bigger regions want a bigger view. */
  viewKm: number;
  /** Lazily loaded so adding maps does not grow the initial bundle. */
  load: () => Promise<MapData>;
  /** Mountains, rivers and lakes as extra targets (optional mode). */
  loadPhysical?: () => Promise<PhysicalData>;
  /** Only rivers in the physical data: the option is then called "Rivers". */
  physicalRiversOnly?: boolean;
}

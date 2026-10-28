import type { Flag, StringKey } from '../i18n';

export type LonLat = [number, number];

/** Geometry produced by scripts/build-map.mjs (all coordinates lon/lat). */
export interface GeoData {
  bbox: [number, number, number, number];
  /** Polygons (lists of rings) of the playable country/region. */
  home: LonLat[][][];
  neighbours: LonLat[][][];
  /** Internal administrative borders as lines. */
  districts: LonLat[][];
  /** Borders between the sub-maps (Dutch provinces, Serbian regions) as lines. */
  regions?: LonLat[][];
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
  /** Optional: not before this level, even if its population ranks it earlier. */
  minLevel?: number;
  /** On the Dutch basislijst topografie. */
  core?: boolean;
  /** In the Basislijst mode's list (basislijst, plus well-known places on province maps): asked first. */
  listed?: boolean;
}

/** Optional physical-geography targets (scripts/build-physical.mjs). */
export interface PhysicalData {
  /** type 'canal': shown as a canal (e.g. Noordzeekanaal); 'dike': a dam to follow (Afsluitdijk). */
  rivers: { name: string; level: number; type?: 'canal' | 'dike'; core?: boolean; lines: LonLat[][] }[];
  /** type 'water': a sea or estuary (Waddenzee, Westerschelde); holes: islands in it. */
  lakes: { name: string; level: number; type?: 'water'; core?: boolean; rings: LonLat[][]; holes?: LonLat[][] }[];
  /** Located at the range's main peak. */
  mountains: { name: string; level: number; core?: boolean; lat: number; lon: number; ele: number | null }[];
  /** Regions found by flying into them (provinces, German states, Finnish regions, islands, Veluwe, ...). */
  areas?: { name: string; level: number; type?: 'province' | 'state' | 'region' | 'island'; core?: boolean; rings: LonLat[][]; holes?: LonLat[][] }[];
  /** Point features other than mountains (Schiphol). */
  landmarks?: { name: string; level: number; type: 'airport'; core?: boolean; lat: number; lon: number }[];
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
  /** Translated map name (see i18n.ts); or a fixed `name` (e.g. a province). */
  nameKey?: StringKey;
  name?: string;
  /** Flag on the map's button in the menu (top-level maps). */
  flag?: Flag;
  /** Name of the whole map in the list of its sub-maps (e.g. "All of the Netherlands"). */
  allKey?: StringKey;
  /** Sub-map of another map (a province of 'netherlands', a region of 'serbia'): chosen in that map's list. */
  parent?: string;
  /** Cities in play per level: first + step × (level − 1), best known first. Default: CONFIG.poolSize. */
  pool?: { first: number; step: number };
  /** Offers the Basislijst mode: only the listed places and the basislijst waters and areas. */
  practice?: boolean;
  /**
   * Which names the Basislijst mode asks: the basislijst (default), 'selection' = a list of our own
   * (whole Serbia), 'all' = every place and physical feature of the map (Serbian regions).
   */
  practiceList?: 'basislijst' | 'selection' | 'all';
  /** Factor on the helicopter speed, for long maps (Finland) whose zoom should stay. Default 1. */
  speed?: number;
  /** Factor on CONFIG.revealRadius: < 1 shows targets later (dense province maps). Default 1. */
  reveal?: number;
  /** Start time and extra time per level in seconds. Default: CONFIG.startTime / levelTimeBonus. */
  time?: { start: number; levelBonus: number };
  /**
   * Place names: 'sr-Latn' = written in Serbian Latin (transliterated for Cyrillic);
   * 'native' = shown as-is, or via loadSerbianNames / loadDutchNames / loadGermanNames / loadEnglishNames.
   */
  placeNames: 'sr-Latn' | 'native';
  /** Serbian (Cyrillic) names by place name, for maps whose names are not Serbian. */
  loadSerbianNames?: () => Promise<Record<string, string>>;
  /** Dutch names by place name, where they differ (e.g. Vienna -> Wenen). */
  loadDutchNames?: () => Promise<Record<string, string>>;
  /** German names by place name, where they differ (e.g. Vienna -> Wien). */
  loadGermanNames?: () => Promise<Record<string, string>>;
  /** English names by place name, for maps whose names are not English (e.g. München -> Munich). */
  loadEnglishNames?: () => Promise<Record<string, string>>;
  /** Kilometres visible across the smaller side of the screen. Bigger regions want a bigger view. */
  viewKm: number;
  /** Lazily loaded so adding maps does not grow the initial bundle. */
  load: () => Promise<MapData>;
  /** Mountains, rivers and lakes as extra targets (optional mode). */
  loadPhysical?: () => Promise<PhysicalData>;
  /**
   * What the physical data holds, for the option's name: 'waters' (rivers, canals, lakes,
   * seas), 'watersAreas' (also regions and landmarks) or 'all' (also mountains). Default:
   * mountains, rivers & lakes.
   */
  physicalKind?: 'waters' | 'watersAreas' | 'all';
}

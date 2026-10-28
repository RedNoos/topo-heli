import provinces from './nl-provinces.json';
import regions from './rs-regions.json';
import germanRegions from './de-regions.json';
import type { StringKey } from '../i18n';
import type { MapDefinition, MapData, PhysicalData } from './types';

// Province and region maps (built by scripts/build-map.mjs, build-places.mjs and build-physical.mjs).
const provinceGeo = import.meta.glob(['./nl-*/geo.json', './rs-*/geo.json', './de-*/geo.json']);
const provinceCities = import.meta.glob(['./nl-*/cities.json', './rs-*/cities.json', './de-*/cities.json']);
const provincePhysical = import.meta.glob(['./nl-*/physical.json', './rs-*/physical.json', './de-*/physical.json']);
/** Place names of the German maps (data/germany.json, OSM). */
const germanNames = {
  placeNames: 'native',
  loadEnglishNames: async () => (await import('./germany/names.en.json')).default,
  loadDutchNames: async () => (await import('./germany/names.nl.json')).default,
  loadSerbianNames: async () => (await import('./germany/names.sr.json')).default,
} satisfies Partial<MapDefinition>;
const json = async <T>(load: () => Promise<unknown>) => ((await load()) as { default: T }).default;

// To add a map: add its id + settings to MAPS in scripts/build-map.mjs, run
// `npm run build:map -- <id>`, add a cities.json next to the generated geo.json
// and register it here.
export const MAPS: MapDefinition[] = [
  {
    id: 'serbia',
    flag: 'rs',
    nameKey: 'mapSerbia',
    allKey: 'regionAllSerbia',
    placeNames: 'sr-Latn',
    viewKm: 260,
    load: async () => ({
      geo: (await import('./serbia/geo.json')).default as never,
      cities: (await import('./serbia/cities.json')).default,
    }),
    loadPhysical: async () => (await import('./serbia/physical.json')).default as never,
    // No official list: our own selection of 100 names (64 places, 36 waters and mountains).
    practice: true,
    practiceList: 'selection',
  },
  {
    id: 'netherlands',
    flag: 'nl',
    nameKey: 'mapNetherlands',
    allKey: 'regionAllNetherlands',
    // Dutch names are kept in every language.
    placeNames: 'native',
    viewKm: 160,
    load: async () => ({
      geo: (await import('./netherlands/geo.json')).default as never,
      cities: (await import('./netherlands/cities.json')).default,
    }),
    loadPhysical: async () => (await import('./netherlands/physical.json')).default as never,
    physicalKind: 'watersAreas',
    practice: true,
  },
  {
    id: 'germany',
    flag: 'de',
    nameKey: 'mapGermany',
    allKey: 'regionAllGermany',
    // German names, translated where English, Dutch or Serbian has its own (Köln: Cologne, Keulen, Keln).
    ...germanNames,
    viewKm: 440,
    load: async () => ({
      geo: (await import('./germany/geo.json')).default as never,
      cities: (await import('./germany/cities.json')).default,
    }),
    loadPhysical: async () => (await import('./germany/physical.json')).default as never,
    physicalKind: 'all',
    // No official list: our own selection of 100 names (60 places, 40 waters, mountains and areas).
    practice: true,
    practiceList: 'selection',
  },
  {
    id: 'finland',
    flag: 'fi',
    nameKey: 'mapFinland',
    // Finnish names (Åland: Swedish), translated where a language has its own (Lappi: Lapland).
    placeNames: 'native',
    loadEnglishNames: async () => (await import('./finland/names.en.json')).default,
    loadDutchNames: async () => (await import('./finland/names.nl.json')).default,
    loadGermanNames: async () => (await import('./finland/names.de.json')).default,
    loadSerbianNames: async () => (await import('./finland/names.sr.json')).default,
    viewKm: 460,
    // 1270 km north to south: a faster helicopter instead of zooming out, so the towns stay readable.
    speed: 1.35,
    load: async () => ({
      geo: (await import('./finland/geo.json')).default as never,
      cities: (await import('./finland/cities.json')).default,
    }),
    loadPhysical: async () => (await import('./finland/physical.json')).default as never,
    physicalKind: 'all',
    // No official list: our own selection of 100 names (60 places, 40 waters, mountains and areas).
    practice: true,
    practiceList: 'selection',
  },
  {
    id: 'europe',
    flag: 'eu',
    nameKey: 'mapEurope',
    placeNames: 'native',
    loadSerbianNames: async () => (await import('./europe/names.sr.json')).default,
    loadDutchNames: async () => (await import('./europe/names.nl.json')).default,
    loadGermanNames: async () => (await import('./europe/names.de.json')).default,
    viewKm: 1300,
    load: async () => ({
      geo: (await import('./europe/geo.json')).default as never,
      cities: (await import('./europe/cities.json')).default,
    }),
  },
  // Netherlands per province: only that province's places, its capital always in level 1.
  ...provinces.map((p): MapDefinition => {
    const physical = provincePhysical[`./${p.id}/physical.json`];
    return {
      id: p.id,
      name: p.name,
      parent: 'netherlands',
      placeNames: 'native',
      viewKm: p.viewKm,
      pool: { first: 10, step: 10 },
      // Places lie close together on the screen: show them a bit later.
      reveal: 0.75,
      practice: true,
      time: 'time' in p ? (p.time as MapDefinition['time']) : undefined,
      load: async () => ({
        geo: await json<MapData['geo']>(provinceGeo[`./${p.id}/geo.json`]),
        cities: await json<MapData['cities']>(provinceCities[`./${p.id}/cities.json`]),
      }),
      loadPhysical: physical ? () => json<PhysicalData>(physical) : undefined,
      physicalKind: 'areas' in p && p.areas ? 'watersAreas' : 'waters',
    };
  }),
  // Serbia per region: only that region's places, its main city always in level 1.
  ...regions.map((r): MapDefinition => {
    const physical = provincePhysical[`./${r.id}/physical.json`];
    return {
      id: r.id,
      nameKey: r.nameKey as StringKey,
      parent: 'serbia',
      placeNames: 'sr-Latn',
      viewKm: r.viewKm,
      pool: { first: 8, step: 6 },
      reveal: 0.75,
      // No official list for Serbia: "Find them all" asks all of the region's places and features.
      practice: true,
      practiceList: 'all',
      load: async () => ({
        geo: await json<MapData['geo']>(provinceGeo[`./${r.id}/geo.json`]),
        cities: await json<MapData['cities']>(provinceCities[`./${r.id}/cities.json`]),
      }),
      loadPhysical: physical ? () => json<PhysicalData>(physical) : undefined,
    };
  }),
  // Germany per region (a Land, with the city state inside it): its places, capital in level 1.
  ...germanRegions.map((r): MapDefinition => {
    const physical = provincePhysical[`./${r.id}/physical.json`];
    return {
      id: r.id,
      nameKey: r.nameKey as StringKey,
      parent: 'germany',
      ...germanNames,
      viewKm: r.viewKm,
      pool: { first: 8, step: 8 },
      reveal: 0.75,
      // Find them all: the region's names of the 100, topped up with its biggest places.
      practice: true,
      practiceList: 'selection',
      load: async () => ({
        geo: await json<MapData['geo']>(provinceGeo[`./${r.id}/geo.json`]),
        cities: await json<MapData['cities']>(provinceCities[`./${r.id}/cities.json`]),
      }),
      loadPhysical: physical ? () => json<PhysicalData>(physical) : undefined,
      physicalKind: 'all',
    };
  }),
];

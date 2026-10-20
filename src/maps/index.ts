import provinces from './nl-provinces.json';
import type { MapDefinition, MapData, PhysicalData } from './types';

// Province maps (built by scripts/build-map.mjs, build-places.mjs and build-physical.mjs).
const provinceGeo = import.meta.glob('./nl-*/geo.json');
const provinceCities = import.meta.glob('./nl-*/cities.json');
const provincePhysical = import.meta.glob('./nl-*/physical.json');
const json = async <T>(load: () => Promise<unknown>) => ((await load()) as { default: T }).default;

// To add a map: add its id + settings to MAPS in scripts/build-map.mjs, run
// `npm run build:map -- <id>`, add a cities.json next to the generated geo.json
// and register it here.
export const MAPS: MapDefinition[] = [
  {
    id: 'serbia',
    nameKey: 'mapSerbia',
    placeNames: 'sr-Latn',
    viewKm: 260,
    load: async () => ({
      geo: (await import('./serbia/geo.json')).default as never,
      cities: (await import('./serbia/cities.json')).default,
    }),
    loadPhysical: async () => (await import('./serbia/physical.json')).default as never,
  },
  {
    id: 'netherlands',
    nameKey: 'mapNetherlands',
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
    id: 'europe',
    nameKey: 'mapEurope',
    placeNames: 'native',
    loadSerbianNames: async () => (await import('./europe/names.sr.json')).default,
    loadDutchNames: async () => (await import('./europe/names.nl.json')).default,
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
];

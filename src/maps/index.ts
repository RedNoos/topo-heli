import type { MapDefinition } from './types';

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
  },
  {
    id: 'europe',
    nameKey: 'mapEurope',
    placeNames: 'native',
    loadSerbianNames: async () => (await import('./europe/names.sr.json')).default,
    viewKm: 1300,
    load: async () => ({
      geo: (await import('./europe/geo.json')).default as never,
      cities: (await import('./europe/cities.json')).default,
    }),
  },
];

import type { MapDefinition } from './types';

// To add a map: add its id + settings to MAPS in scripts/build-map.mjs, run
// `npm run build:map -- <id>`, add a cities.json next to the generated geo.json
// and register it here.
export const MAPS: MapDefinition[] = [
  {
    id: 'serbia',
    name: 'Srbija',
    viewKm: 260,
    load: async () => ({
      geo: (await import('./serbia/geo.json')).default as never,
      cities: (await import('./serbia/cities.json')).default,
    }),
  },
];

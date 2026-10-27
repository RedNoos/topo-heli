/** Test build (`npm run build:test`, served at topoheli.com/test/): no stats, own storage. */
export const IS_TEST = import.meta.env.MODE === 'test';

/** Prefix of all localStorage keys; the test site shares the live site's origin. */
export const STORAGE_PREFIX = IS_TEST ? 'topo-heli-test:' : 'topo-heli:';

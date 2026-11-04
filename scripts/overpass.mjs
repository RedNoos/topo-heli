// Overpass client for the data builds (build-places, build-physical): public servers tried in
// turn, answers cached in .cache/ (git-ignored).
//
// The cache is `overpass-<name>.json` with the query beside it (`.query`): a changed query is
// asked again, so a name added to a list needs no new cache key.

import fs from 'node:fs/promises';
import path from 'node:path';

const CACHE = path.resolve(import.meta.dirname, '..', '.cache');
// Public Overpass instances, tried in order (the main one is often busy).
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
/** Rounds over all servers, with a pause in between. */
const ROUNDS = 3;
const PAUSE_MS = 15000;

/** Overpass answer (parsed) for `query`, cached as `.cache/overpass-<name>.json`. */
export async function overpass(name, query) {
  const file = path.join(CACHE, `overpass-${name}.json`);
  const queryFile = file.replace(/\.json$/, '.query');
  const [cached, cachedQuery] = await Promise.all([read(file), read(queryFile)]);
  if (cached !== null) {
    // A cache from before the queries were stored: taken as made by this query.
    if (cachedQuery === null) await fs.writeFile(queryFile, query);
    if (cachedQuery === null || cachedQuery === query) return JSON.parse(cached);
    console.log(`  query changed for ${name}`);
  }
  const text = await ask(name, query);
  await fs.mkdir(CACHE, { recursive: true });
  await fs.writeFile(file, text);
  await fs.writeFile(queryFile, query);
  return JSON.parse(text);
}

async function read(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Raw answer text; every failure (no answer, error status, no JSON, an error remark, no elements) tries the next server. */
async function ask(name, query) {
  let last = '';
  for (let round = 0; round < ROUNDS; round++) {
    if (round > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
    for (const url of SERVERS) {
      console.log(`  querying ${new URL(url).host} (${name})...`);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
            'User-Agent': 'topo-heli-map-builder/0.1 (hobby geography game)',
          },
          body: new URLSearchParams({ data: query }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(`no JSON: ${text.slice(0, 200)}`);
        }
        // A timeout or out-of-memory comes as a 200 with a remark and partial (or no) elements.
        if (data.remark) throw new Error(`remark: ${data.remark}`);
        // An empty answer is usually a server hiccup: not cached.
        if (!data.elements?.length) throw new Error('empty answer');
        return text;
      } catch (e) {
        last = e.cause?.code ?? e.message;
        console.warn(`  ! ${last}, trying next server`);
      }
    }
  }
  throw new Error(`Overpass failed for ${name}: ${last}`);
}

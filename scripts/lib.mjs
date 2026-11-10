// Shared helpers of the data builds (build-map, build-places, build-physical): paths, cached
// downloads, mapshaper runs and small geometry tests. Overpass has its own client (overpass.mjs).

import fs from 'node:fs/promises';
import path from 'node:path';
import mapshaper from 'mapshaper';

export const ROOT = path.resolve(import.meta.dirname, '..');
/** Downloads and intermediate results (git-ignored). */
export const CACHE = path.join(ROOT, '.cache');

/** Mainland New Zealand and Stewart Island [minLon, minLat, maxLon, maxLat]; the Chatham Islands come from their inset (insets.mjs). */
export const NZ_BBOX = [165, -47.9, 179.9, -33.6];

/** Simplification (m) of the CBS land of the whole Netherlands (province maps use a finer one). */
export const CBS_COUNTRY_INTERVAL = 150;
/** CBS land per province, simplified to `interval` m: made by build-map, read by build-physical. */
export const cbsLandFile = (interval) => path.join(CACHE, `cbs-province-land-${interval}.json`);

/** Contents of `.cache/<file>` (a Buffer), downloaded from `url` the first time. */
export async function cachedDownload(file, url) {
  const p = path.join(CACHE, file);
  try {
    return await fs.readFile(p);
  } catch {
    console.log(`  downloading ${file}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    const data = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(p, data);
    return data;
  }
}

/** Parsed JSON of `.cache/<file>`, downloaded from `url` the first time. */
export const cachedJson = async (file, url) => JSON.parse((await cachedDownload(file, url)).toString('utf8'));

/** mapshaper output as a FeatureCollection: without attributes it writes a GeometryCollection. */
export const asFeatures = (json) =>
  json.type === 'FeatureCollection'
    ? json
    : { type: 'FeatureCollection', features: (json.geometries ?? []).map((geometry) => ({ type: 'Feature', properties: {}, geometry })) };

/**
 * Runs mapshaper `commands` (starting with `-i <file>`) on `inputs` ({ file: GeoJSON }) and
 * returns the result as a FeatureCollection.
 */
export async function mapshaperRun(commands, inputs) {
  const out = await mapshaper.applyCommands(`${commands} -o out.json format=geojson`, inputs);
  return asFeatures(JSON.parse(out['out.json']));
}

const geometriesOf = (fc) => (fc.features ?? []).map((f) => f.geometry).filter(Boolean);
/** Polygon coordinates of a FeatureCollection, MultiPolygons split up. */
export const polygonsOf = (fc) =>
  geometriesOf(fc).flatMap((g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []));
/** LineString coordinates of a FeatureCollection, MultiLineStrings split up. */
export const linesOf = (fc) =>
  geometriesOf(fc).flatMap((g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []));

/** Even-odd test: is the point [x, y] inside the ring ([x, y] points)? */
export function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

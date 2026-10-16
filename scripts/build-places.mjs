// Builds the Dutch place lists: the curated list for the whole country plus municipality seats
// (OpenStreetMap) and larger villages (GeoNames, >= MIN_POP inhabitants), and one list per
// province. Run after `npm run build:map` (it uses the province shapes from geo.json).
//
//   npm run build:places
//
// Writes src/maps/netherlands/cities.json, src/maps/nl-<province>/cities.json and the province
// manifest src/maps/nl-provinces.json. Downloads are cached in .cache/.

import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { PROVINCES } from './provinces.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const MIN_POP = 2000;
/** In the whole-country map the added places only come up from this level on. */
const EXTRA_MIN_LEVEL = 6;
/** Places closer than this to an already listed place are taken to be the same place. */
const SAME_PLACE_KM = 2;

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function cached(file, fetcher) {
  const p = path.join(CACHE, file);
  try {
    return await fs.readFile(p);
  } catch {
    const data = await fetcher();
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(p, data);
    return data;
  }
}

/** GeoNames country dump for the Netherlands (populated places with population). */
async function geonames() {
  const zip = await cached('geonames-NL.zip', async () => {
    console.log('  downloading GeoNames NL...');
    const res = await fetch('https://download.geonames.org/export/dump/NL.zip');
    if (!res.ok) throw new Error(`GeoNames download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  });
  const text = strFromU8(unzipSync(new Uint8Array(zip))['NL.txt']);
  return text
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((c) => c[6] === 'P' && c[7] !== 'PPLX' && +c[14] >= MIN_POP)
    .map((c) => ({ name: c[1], lat: +c[4], lon: +c[5], pop: +c[14], source: 'geonames' }));
}

/** Municipality seats ("admin_centre" of every gemeente) from OpenStreetMap. */
async function seats() {
  const query = `[out:json][timeout:300];
area["ISO3166-1"="NL"]["admin_level"="2"]->.a;
rel(area.a)["boundary"="administrative"]["admin_level"="8"]->.g;
node(r.g:"admin_centre");
out;`;
  const raw = await cached('overpass-netherlands-seats.json', async () => {
    console.log('  querying Overpass for municipality seats...');
    for (const [i, url] of [...OVERPASS, ...OVERPASS].entries()) {
      if (i === OVERPASS.length) await new Promise((r) => setTimeout(r, 15000));
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'topo-heli-map-builder/0.1 (hobby geography game)' },
        body: new URLSearchParams({ data: query }),
      });
      if (res.ok) {
        const text = await res.text();
        if (JSON.parse(text).elements?.length) return text;
      }
    }
    throw new Error('Overpass failed for municipality seats');
  });
  return JSON.parse(raw)
    .elements.filter((e) => e.type === 'node' && e.tags?.name && e.lon > 3) // not the Caribbean
    .map((e) => ({ name: e.tags.name, lat: e.lat, lon: e.lon, pop: parseInt(e.tags.population, 10) || 1500, source: 'seat' }));
}

// ---------- geometry ----------

const R = 6371;
const D = Math.PI / 180;
const km = (a, b) => R * Math.hypot((b.lon - a.lon) * D * Math.cos(((a.lat + b.lat) / 2) * D), (b.lat - a.lat) * D);

function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const insidePolys = (pt, polys) => polys.some((poly) => insideRing(pt, poly[0]) && !poly.slice(1).some((h) => insideRing(pt, h)));
/** Distance (km) from a point to the nearest vertex of the polygons: fallback for coastal places. */
const nearDistance = (p, polys) => Math.min(...polys.flat(2).map(([lon, lat]) => km(p, { lon, lat })));

// ---------- build ----------

const curated = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'netherlands-cities.json'), 'utf8'));
const provinces = [];
for (const p of PROVINCES) {
  const geo = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', p.id, 'geo.json'), 'utf8'));
  provinces.push({ ...p, home: geo.home, bbox: geo.bbox });
}
/** Province of a place: the one containing it, else (coast, islands) the nearest one. */
function provinceOf(place) {
  const pt = [place.lon, place.lat];
  const hit = provinces.find((p) => insidePolys(pt, p.home));
  if (hit) return hit;
  return provinces.reduce((best, p) => (nearDistance(place, p.home) < nearDistance(place, best.home) ? p : best));
}

console.log('Building Dutch place lists');
const all = curated.map((c) => ({ ...c, source: 'curated' }));
let added = 0;
for (const cand of [...(await seats()), ...(await geonames())]) {
  // Same place already listed (curated names win: "Den Haag" over "The Hague")?
  const dup = all.some((c) => km(c, cand) < SAME_PLACE_KM || (c.name === cand.name && km(c, cand) < 6));
  // A district of a nearby place ("Almere Duin", "Leusden-Zuid"), not a place of its own.
  const district = all.some((c) => (cand.name.startsWith(c.name + ' ') || cand.name.startsWith(c.name + '-')) && km(c, cand) < 10);
  if (district) continue;
  if (dup) continue;
  all.push({ ...cand, extra: true });
  added++;
}
for (const c of all) c.province = provinceOf(c);
console.log(`  ${curated.length} curated + ${added} added = ${all.length} places`);

const round4 = (v) => +v.toFixed(4);
const out = (c, name = c.name) => ({
  name,
  lat: round4(c.lat),
  lon: round4(c.lon),
  pop: c.pop,
  ...(c.level ? { level: c.level } : {}),
});

// Whole country: added places only from EXTRA_MIN_LEVEL; same names get the province, e.g. "Hengelo (O)".
const nameCount = {};
for (const c of all) nameCount[c.name] = (nameCount[c.name] || 0) + 1;
const nl = all.map((c) => {
  const name = c.extra && nameCount[c.name] > 1 ? `${c.name} (${c.province.abbr})` : c.name;
  return { ...out(c, name), ...(c.extra ? { minLevel: EXTRA_MIN_LEVEL } : {}) };
});
await fs.writeFile(path.join(ROOT, 'src', 'maps', 'netherlands', 'cities.json'), '[\n' + nl.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n');

// Per province: every place in it; the capital is always in level 1.
const manifest = [];
for (const p of provinces) {
  const list = all.filter((c) => c.province === p);
  const capital = list.find((c) => c.name === p.capital);
  if (!capital) throw new Error(`Capital ${p.capital} not found in ${p.name}`);
  const seen = new Set();
  const cities = [];
  for (const c of list.sort((a, b) => b.pop - a.pop)) {
    if (seen.has(c.name)) continue; // same name twice in one province: keep the bigger one
    seen.add(c.name);
    cities.push({ ...out(c), ...(c === capital ? { level: 1 } : {}) });
  }
  await fs.writeFile(path.join(ROOT, 'src', 'maps', p.id, 'cities.json'), '[\n' + cities.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n');

  // Zoom: show ~3/4 of the province's larger side, within limits.
  const [w, s, e, n] = p.bbox;
  const widthKm = (e - w) * 111 * Math.cos(((s + n) / 2) * D);
  const heightKm = (n - s) * 111;
  const viewKm = Math.round(Math.min(110, Math.max(55, 0.6 * Math.max(widthKm, heightKm))));
  manifest.push({ id: p.id, name: p.name, viewKm });
  console.log(`  ${p.name.padEnd(14)} ${String(cities.length).padStart(3)} places (capital ${p.capital}), view ${viewKm} km`);
}
await fs.writeFile(path.join(ROOT, 'src', 'maps', 'nl-provinces.json'), JSON.stringify(manifest, null, 2) + '\n');

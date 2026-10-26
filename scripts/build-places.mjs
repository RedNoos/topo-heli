// Builds the Dutch place lists: the curated list for the whole country plus municipality seats
// (OpenStreetMap) and larger villages (GeoNames, >= MIN_POP inhabitants), and one list per
// province. Run after `npm run build:map` (it uses the province shapes from geo.json).
//
//   npm run build:places
//
// Writes src/maps/netherlands/cities.json, src/maps/nl-<province>/cities.json and the province
// manifest src/maps/nl-provinces.json. Downloads are cached in .cache/.
// Also splits the Serbian places (src/maps/serbia/cities.json) into the Serbian regions:
// src/maps/rs-<region>/cities.json and the manifest src/maps/rs-regions.json.
// Germany: towns and cities from OpenStreetMap (population from GeoNames where OSM has none)
// into src/maps/germany/ and src/maps/de-<region>/, the name translations into
// src/maps/germany/names.{en,nl,sr}.json and the manifest src/maps/de-regions.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { PROVINCES, SERBIA_REGIONS, GERMANY_REGIONS } from './provinces.mjs';
import { toCyrillic } from './serbian.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const MIN_POP = 2000;
/** In the whole-country map the added places only come up from this level on. */
const EXTRA_MIN_LEVEL = 6;
/** Places closer than this to an already listed place are taken to be the same place. */
const SAME_PLACE_KM = 2;
/** Listed as a populated place in GeoNames, but not a town or village. */
const NOT_A_PLACE = new Set(['Oostvaardersdiep']);
/** Municipality seats tagged with the population of the whole municipality. */
const POP_FIX = { 'Velsen-Zuid': 1500, Borssele: 1500 };

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

/** GeoNames country dump (populated places with population), default the Netherlands. */
async function geonames(minPop = MIN_POP, country = 'NL') {
  const zip = await cached(`geonames-${country}.zip`, async () => {
    console.log(`  downloading GeoNames ${country}...`);
    const res = await fetch(`https://download.geonames.org/export/dump/${country}.zip`);
    if (!res.ok) throw new Error(`GeoNames download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  });
  const text = strFromU8(unzipSync(new Uint8Array(zip))[`${country}.txt`]);
  return text
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((c) => c[6] === 'P' && c[7] !== 'PPLX' && +c[14] >= minPop)
    // Villages without a known population rank last.
    .map((c) => ({ name: c[1], lat: +c[4], lon: +c[5], pop: +c[14] || 100, source: 'geonames' }));
}

/** Cached Overpass query (tried on every server, twice). */
async function overpass(file, query, what) {
  return cached(file, async () => {
    console.log(`  querying Overpass for ${what}...`);
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
    throw new Error(`Overpass failed for ${what}`);
  });
}

/** Municipality seats ("admin_centre" of every gemeente) from OpenStreetMap. */
async function seats() {
  const query = `[out:json][timeout:300];
area["ISO3166-1"="NL"]["admin_level"="2"]->.a;
rel(area.a)["boundary"="administrative"]["admin_level"="8"]->.g;
node(r.g:"admin_centre");
out;`;
  const raw = await overpass('overpass-netherlands-seats.json', query, 'municipality seats');
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
/** Basislijst mode, province maps: well-known places added to the basislijst ones (see _about). */
const provinceLists = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'province-lists.json'), 'utf8'));
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
/** Adds a candidate unless it is already listed or is a district of a listed place. */
function addPlace(cand, extra) {
  if (NOT_A_PLACE.has(cand.name)) return false;
  if (POP_FIX[cand.name]) cand = { ...cand, pop: POP_FIX[cand.name] };
  // Same place already listed (curated names win: "Den Haag" over "The Hague")?
  if (all.some((c) => km(c, cand) < SAME_PLACE_KM || (c.name === cand.name && km(c, cand) < 6))) return false;
  // A district of a nearby place ("Almere Duin", "Leusden-Zuid"), not a place of its own.
  if (all.some((c) => (cand.name.startsWith(c.name + ' ') || cand.name.startsWith(c.name + '-')) && km(c, cand) < 10)) return false;
  all.push({ ...cand, ...extra });
  return true;
}
for (const cand of [...(await seats()), ...(await geonames())]) {
  if (addPlace(cand, { extra: true })) added++;
}
for (const c of all) c.province = provinceOf(c);

// Small provinces: also smaller villages, in the province's own list only (not the whole country).
let small = 0;
const lowPop = provinces.filter((p) => p.minPop !== undefined && p.minPop < MIN_POP);
if (lowPop.length) {
  for (const cand of await geonames(Math.min(...lowPop.map((p) => p.minPop)))) {
    if (cand.pop >= MIN_POP) continue;
    const p = provinceOf(cand);
    if (!lowPop.includes(p) || cand.pop < p.minPop) continue;
    // Small villages close together are often parts of one place: be stricter than for towns.
    if (all.some((c) => km(c, cand) < 1.2)) continue;
    if (addPlace(cand, { extra: true, provinceOnly: true, province: p })) small++;
  }
}
console.log(`  ${curated.length} curated + ${added} added${small ? ` + ${small} small villages (province maps only)` : ''} = ${all.length} places`);

const round4 = (v) => +v.toFixed(4);
const out = (c, name = c.name) => ({
  name,
  lat: round4(c.lat),
  lon: round4(c.lon),
  pop: c.pop,
  ...(c.level ? { level: c.level } : {}),
  // The curated places in levels 1-2 are the basislijst topografie: asked first.
  ...(c.level && c.level <= 2 ? { core: true, listed: true } : {}),
});

// Whole country: added places only from EXTRA_MIN_LEVEL; same names get the province, e.g. "Hengelo (O)".
const nameCount = {};
for (const c of all) if (!c.provinceOnly) nameCount[c.name] = (nameCount[c.name] || 0) + 1;
const nl = all.filter((c) => !c.provinceOnly).map((c) => {
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
    cities.push({ ...out(c), ...(c === capital ? { level: 1 } : {}), ...(provinceLists[p.id]?.includes(c.name) ? { listed: true } : {}) });
  }
  const missing = (provinceLists[p.id] ?? []).filter((n) => !cities.some((c) => c.name === n));
  if (missing.length) throw new Error(`${p.name}: practice list names not found: ${missing.join(', ')}`);
  await fs.writeFile(path.join(ROOT, 'src', 'maps', p.id, 'cities.json'), '[\n' + cities.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n');

  // Zoom: show under half of the province's larger side (within limits), so you have to fly.
  const [w, s, e, n] = p.bbox;
  const widthKm = (e - w) * 111 * Math.cos(((s + n) / 2) * D);
  const heightKm = (n - s) * 111;
  const viewKm = Math.round(Math.min(80, Math.max(40, 0.45 * Math.max(widthKm, heightKm))));
  manifest.push({ id: p.id, name: p.name, viewKm, ...(p.time ? { time: p.time } : {}) });
  console.log(`  ${p.name.padEnd(14)} ${String(cities.length).padStart(3)} places (capital ${p.capital}), view ${viewKm} km`);
}
await fs.writeFile(path.join(ROOT, 'src', 'maps', 'nl-provinces.json'), JSON.stringify(manifest, null, 2) + '\n');

// ---------- Serbian regions ----------

const serbiaCities = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', 'serbia', 'cities.json'), 'utf8'));
const regions = [];
for (const r of SERBIA_REGIONS) {
  const geo = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', r.id, 'geo.json'), 'utf8'));
  regions.push({ ...r, home: geo.home, bbox: geo.bbox });
}
const regionOf = (c) => {
  const pt = [c.lon, c.lat];
  return regions.find((r) => insidePolys(pt, r.home)) ?? regions.reduce((best, r) => (nearDistance(c, r.home) < nearDistance(c, best.home) ? r : best));
};
const regionCities = new Map(regions.map((r) => [r, []]));
for (const c of serbiaCities) regionCities.get(regionOf(c)).push(c);
const regionManifest = [];
for (const r of regions) {
  const list = regionCities.get(r).sort((a, b) => b.pop - a.pop);
  if (!list.some((c) => c.name === r.capital)) throw new Error(`Capital ${r.capital} not found in ${r.name}`);
  const cities = list.map((c) => ({ ...c, ...(c.name === r.capital ? { level: 1 } : {}) }));
  await fs.writeFile(path.join(ROOT, 'src', 'maps', r.id, 'cities.json'), '[\n' + cities.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n');
  // Zoom: about half of the region's larger side (within limits), so you have to fly.
  const [w, s, e, n] = r.bbox;
  const widthKm = (e - w) * 111 * Math.cos(((s + n) / 2) * D);
  const heightKm = (n - s) * 111;
  const viewKm = Math.round(Math.min(130, Math.max(70, 0.5 * Math.max(widthKm, heightKm))));
  regionManifest.push({ id: r.id, nameKey: r.nameKey, viewKm });
  console.log(`  ${r.name.padEnd(18)} ${String(cities.length).padStart(3)} places (capital ${r.capital}), view ${viewKm} km`);
}
await fs.writeFile(path.join(ROOT, 'src', 'maps', 'rs-regions.json'), JSON.stringify(regionManifest, null, 2) + '\n');

// ---------- Germany ----------

/** Whole Germany: towns from this size; region maps also smaller towns. */
const DE_MIN_POP = 20000;
const DE_REGION_MIN_POP = 10000;
/** Region maps, Find them all: the listed places of the region, topped up with the biggest. */
const DE_REGION_LIST = 20;

const germany = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'germany.json'), 'utf8'));
const deQuery = `[out:json][timeout:300];
area["ISO3166-1"="DE"]["admin_level"="2"]->.a;
node["place"~"^(city|town)$"](area.a);
out;`;
const deGeonames = await geonames(1, 'DE');
/** OSM population, or GeoNames' for the same place (OSM misses some, and has a few typos). */
function dePop(name, lat, lon, tag) {
  const osm = parseInt((tag ?? '').replace(/\D/g, ''), 10) || 0;
  const gn = deGeonames
    .filter((g) => g.name === name && km(g, { lat, lon }) < 8)
    .sort((a, b) => km(a, { lat, lon }) - km(b, { lat, lon }))[0]?.pop;
  if (!osm) return gn ?? 0;
  return gn && (osm > 3 * gn || gn > 3 * osm) ? gn : osm;
}
const deAll = JSON.parse(await overpass('overpass-germany-places.json', deQuery, 'German towns'))
  .elements.filter((e) => e.tags?.name)
  .map((e) => {
    // name:de leaves out the Sorbian part ("Cottbus - Chóśebuz").
    const osmName = e.tags['name:de'] ?? e.tags.name;
    return { name: germany.rename[osmName] ?? osmName, lat: e.lat, lon: e.lon, pop: dePop(osmName, e.lat, e.lon, e.tags.population), sr: e.tags['name:sr'] };
  })
  .filter((c) => c.pop >= DE_REGION_MIN_POP)
  .sort((a, b) => b.pop - a.pop);

const deRegions = [];
for (const r of GERMANY_REGIONS) {
  const geo = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', r.id, 'geo.json'), 'utf8'));
  deRegions.push({ ...r, home: geo.home, bbox: geo.bbox });
}
for (const c of deAll) {
  const pt = [c.lon, c.lat];
  c.region = deRegions.find((r) => insidePolys(pt, r.home)) ?? deRegions.reduce((best, r) => (nearDistance(c, r.home) < nearDistance(c, best.home) ? r : best));
}
const missingDe = germany.listed.filter((n) => !deAll.some((c) => c.name === n));
if (missingDe.length) throw new Error(`Germany: listed places not found: ${missingDe.join(', ')}`);
const deOut = (c, name = c.name) => ({ name, lat: round4(c.lat), lon: round4(c.lon), pop: c.pop, ...(germany.listed.includes(c.name) ? { listed: true } : {}) });

console.log('Building German place lists');
// Whole country: same names get the region, e.g. "Friedberg (BY)".
const deCountry = deAll.filter((c) => c.pop >= DE_MIN_POP);
const deCount = {};
for (const c of deCountry) deCount[c.name] = (deCount[c.name] || 0) + 1;
const deCities = deCountry.map((c) => deOut(c, deCount[c.name] > 1 ? `${c.name} (${c.region.abbr})` : c.name));
await fs.writeFile(path.join(ROOT, 'src', 'maps', 'germany', 'cities.json'), '[\n' + deCities.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n');
console.log(`  Germany ${deCities.length} places (${deCities.filter((c) => c.listed).length} listed)`);

const deManifest = [];
for (const r of deRegions) {
  const seen = new Set();
  const cities = [];
  for (const c of deAll.filter((x) => x.region === r)) {
    if (seen.has(c.name)) continue; // same name twice in one region: keep the bigger one
    seen.add(c.name);
    cities.push({ ...deOut(c), ...(c.name === r.capital ? { level: 1 } : {}) });
  }
  if (!cities.some((c) => c.name === r.capital)) throw new Error(`Capital ${r.capital} not found in ${r.name}`);
  for (const c of cities) if (cities.filter((x) => x.listed).length < DE_REGION_LIST) c.listed = true;
  await fs.writeFile(path.join(ROOT, 'src', 'maps', r.id, 'cities.json'), '[\n' + cities.map((c) => JSON.stringify(c)).join(',\n') + '\n]\n');
  const [w, s, e, n] = r.bbox;
  const widthKm = (e - w) * 111 * Math.cos(((s + n) / 2) * D);
  const heightKm = (n - s) * 111;
  const viewKm = Math.round(Math.min(180, Math.max(60, 0.5 * Math.max(widthKm, heightKm))));
  deManifest.push({ id: r.id, nameKey: r.nameKey, viewKm });
  console.log(`  ${r.name.padEnd(24)} ${String(cities.length).padStart(3)} places (capital ${r.capital}), view ${viewKm} km`);
}
await fs.writeFile(path.join(ROOT, 'src', 'maps', 'de-regions.json'), JSON.stringify(deManifest, null, 2) + '\n');

// Translations: curated (data/germany.json), Serbian place names also from OSM.
const names = { en: {}, nl: {}, sr: {} };
for (const c of deAll) if (c.sr) names.sr[c.name] = c.sr;
for (const [name, tr] of Object.entries(germany.names)) {
  if (tr.en) names.en[name] = tr.en;
  if (tr.nl) names.nl[name] = tr.nl;
  if (tr.sr) names.sr[name] = toCyrillic(tr.sr);
}
// Same-named places shown with their region ("Friedberg (BY)") keep that in every language.
for (const lang of Object.keys(names)) {
  const sorted = Object.fromEntries(Object.entries(names[lang]).sort(([a], [b]) => a.localeCompare(b, 'de')));
  await fs.writeFile(path.join(ROOT, 'src', 'maps', 'germany', `names.${lang}.json`), JSON.stringify(sorted, null, 2) + '\n');
}
console.log(`  names: ${Object.keys(names.en).length} en, ${Object.keys(names.nl).length} nl, ${Object.keys(names.sr).length} sr`);

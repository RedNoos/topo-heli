// Builds physical-geography targets (rivers, lakes, mountains) from OpenStreetMap.
//
//   npm run build:physical            -> every map in PHYSICAL
//   npm run build:physical -- serbia  -> one map
//
// Raw Overpass responses are cached in .cache/ (git-ignored). Output goes to
// src/maps/<id>/physical.json (lon/lat; simplified).

import fs from 'node:fs/promises';
import path from 'node:path';
import mapshaper from 'mapshaper';
import { PROVINCES } from './provinces.mjs';

/** Province maps: rivers with less than this inside the province are not asked. */
const MIN_PROVINCE_RIVER_KM = 8;

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
// Public Overpass instances, tried in order (the main one is often busy).
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// `level` is the game level from which the feature can be asked (1 = best known).
// Rivers: 'Name', ['Name', [minLon, minLat, maxLon, maxLat]] to keep only the parts in that
// box (for names shared by several rivers), or { name, osm: [OSM names], box? } when the shown
// river is made of differently named OSM rivers (e.g. Rijn = Bovenrijn + Nederrijn). Add
// `canals: true` when stretches of the river are tagged as canal in OSM, and `type: 'canal'`
// for canals (shown as "canal" in the game).
// Water areas (`waterAreas`): large waters played like lakes (fly over them), from an OSM
// relation and/or a rough outline; the land is cut out, so the shape follows the real coast and
// islands become holes. `type: 'water'` for seas/estuaries ("water" in the game). Lakes: 'Name' or ['Shown name', 'OSM name']. Mountains: ['Range', 'OSM peak name'] or
// ['Range', { lat, lon, ele }] where OSM has no usable peak tag (coordinates taken from OSM
// nodes for that summit/range).
const PHYSICAL = {
  serbia: {
    areas: ['RS', 'XK'],
    bbox: [18.1, 41.5, 23.6, 46.55],
    rivers: {
      1: ['Dunav', 'Sava', 'Tisa', 'Drina', 'Velika Morava', 'Zapadna Morava', 'Južna Morava', 'Ibar'],
      2: ['Timok', 'Nišava', 'Tamiš', 'Begej', 'Kolubara', 'Lim'],
      3: ['Mlava', 'Pek', ['Toplica', [20.8, 42.9, 22.0, 43.5]], 'Pčinja', 'Rasina', 'Uvac', 'Jadar', 'Studenica', 'Sitnica', 'Beli Drim'],
    },
    lakes: {
      1: ['Đerdapsko jezero', 'Vlasinsko jezero', 'Palićko jezero', 'Srebrno jezero'],
      2: [['Perućac', 'Jezero Perućac'], 'Zlatarsko jezero', ['Gazivode', 'Jezero Gazivode'], 'Uvačko jezero', 'Borsko jezero'],
      3: ['Bovansko jezero', 'Garaško jezero', 'Zaovinsko jezero', 'Gružansko jezero', 'Ludaško jezero', 'Savsko jezero'],
    },
    mountains: {
      1: [['Kopaonik', 'Pančićev vrh'], ['Zlatibor', { lat: 43.654, lon: 19.64, ele: 1496 }], ['Fruška gora', { lat: 45.157, lon: 19.709, ele: 540 }], ['Tara', 'Zborište'], ['Stara planina', { lat: 43.395, lon: 22.678, ele: 2169 }]],
      2: [['Rtanj', 'Šiljak'], ['Suva planina', 'Trem'], ['Golija', 'Jankov kamen'], ['Avala', 'Avala'], ['Rudnik', 'Cvijićev vrh'], ['Šar planina', 'Ljuboten'], ['Prokletije', 'Đeravica'], ['Besna Kobila', 'Besna Kobila']],
      3: [['Maljen', 'Kraljev sto'], ['Povlen', 'Mali Povlen'], ['Jastrebac', 'Velika Đulica'], ['Radan', 'Šopot'], ['Zlatar', 'Golo brdo'], ['Goč', 'Krnja jela'], ['Kosmaj', 'Kosmaj'], ['Cer', { lat: 44.606, lon: 19.488, ele: 687 }], ['Ozren', 'Leskovik'], ['Vidlič', { lat: 43.137, lon: 22.819, ele: null }], ['Ovčar', 'Ovčar'], ['Kablar', 'Kablar']],
    },
  },
  netherlands: {
    areas: ['NL'],
    bbox: [2.9, 50.6, 7.6, 53.75],
    rivers: {
      1: [
        // From the border at Lobith: Bovenrijn (part of the German-named Rhein relation),
        // Pannerdensch Kanaal, Nederrijn. The box keeps the Rhein relation to that stretch.
        { name: 'Rijn', osm: ['Rijn', 'Bovenrijn', 'Nederrijn', 'Pannerdensch Kanaal', 'Rhein'], box: [5.3, 51.82, 6.115, 52.0], canals: true },
        // The box leaves out a creek called Waal on IJsselmonde (Rotterdam).
        { name: 'Waal', osm: ['Waal'], box: [4.9, 51.75, 6.2, 51.95] },
        'Maas', 'IJssel', 'Lek',
      ],
      2: [
        'Amstel',
        ['Vecht', [4.85, 52.0, 5.15, 52.35]],
        // Old spelling on most ways; the river relation uses the German name.
        { name: 'Overijsselse Vecht', osm: ['Vecht', 'Overijsselse Vecht', 'Overijsselsche Vecht', 'Vechte'], box: [6.0, 52.45, 7.1, 52.7] },
        'Linge', 'Oude IJssel',
        // OSM uses the old spelling.
        { name: 'Hollandse IJssel', osm: ['Hollandsche IJssel', 'Gekanaliseerde Hollandsche IJssel'] },
        'Nieuwe Maas', 'Oude Maas',
        { name: 'Merwede', osm: ['Boven-Merwede', 'Beneden-Merwede', 'Nieuwe Merwede'] },
        'Zwarte Water',
        // Canals on the basislijst topografie.
        { name: 'Noordzeekanaal', type: 'canal', canals: true },
        { name: 'Amsterdam-Rijnkanaal', type: 'canal', canals: true },
        { name: 'Nieuwe Waterweg', osm: ['Nieuwe Waterweg', 'Scheur'], type: 'canal', canals: true },
        // Utrecht – Woerden – Leiden – Katwijk; not the Oude Rijn near Zevenaar. Partly canal.
        { name: 'Oude Rijn', osm: ['Oude Rijn', 'Leidsche Rijn', 'Leidse Rijn'], box: [4.3, 52.0, 5.15, 52.25], canals: true },
      ],
      3: ['Eem', 'Dommel', 'Roer', 'Berkel', 'Dinkel', 'Regge', 'Geul', 'Niers', 'Mark', 'Schipbeek', 'Reitdiep'],
    },
    lakes: {},
    mountains: {},
    waterAreas: {
      1: [
        { name: 'Waddenzee', relation: 5909370, type: 'water' }, // protected-area boundary: land is cut out
        { name: 'IJsselmeer', relation: 945096 },
        { name: 'Markermeer', relation: 49368 },
      ],
      2: [
        { name: 'Oosterschelde', relation: 6846427, type: 'water' },
        // Not a polygon in OSM (sea per the coastline): rough outline from the mouth
        // (Vlissingen - Breskens) to the Belgian border, with its edges on land.
        {
          name: 'Westerschelde',
          type: 'water',
          outline: [[3.5, 51.47], [3.6, 51.475], [3.8, 51.475], [3.95, 51.465], [4.05, 51.465], [4.15, 51.445], [4.24, 51.425], [4.25, 51.37], [4.2, 51.345], [4.0, 51.325], [3.8, 51.325], [3.6, 51.355], [3.5, 51.375]],
        },
      ],
    },
    // Background water, drawn but never asked: the connections that make the rivers reach the
    // sea (the base map draws these as part of its rivers, the detailed layer replaces it).
    context: {
      lines: [
        'Nieuwe Waterweg', 'Scheur', 'Het Scheur', 'Noord', 'Dordtsche Kil', 'Spui', 'Amer', 'Bergsche Maas',
        'Afgedamde Maas', 'Pannerdensch Kanaal', 'Noordzeekanaal', 'Lekkanaal',
      ],
      // Real water surfaces (river banks, harbours, lakes…) so wide water such as the delta
      // and the Rotterdam port is drawn at its true shape; pieces under minKm2 are dropped.
      // interval: simplification in metres (one screen pixel is ~200 m on this map).
      surfaces: { types: ['river', 'canal', 'lake', 'harbour', 'basin', 'lagoon'], minKm2: 0.2, interval: 150 },
      areas: ['Hollandsch Diep', 'Hollands Diep', 'Brielse Meer', 'Haringvliet', 'IJ', 'Ketelmeer', 'Zwarte Meer', 'Volkerak', 'Biesbosch'],
    },
  },
};

// ---------- helpers ----------

const LAT_CYR = [
  ['dž', 'џ'], ['lj', 'љ'], ['nj', 'њ'], ['a', 'а'], ['b', 'б'], ['c', 'ц'], ['č', 'ч'], ['ć', 'ћ'], ['d', 'д'],
  ['đ', 'ђ'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'], ['j', 'ј'], ['k', 'к'], ['l', 'л'],
  ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['š', 'ш'], ['t', 'т'], ['u', 'у'],
  ['v', 'в'], ['z', 'з'], ['ž', 'ж'],
];
/** Serbian Latin -> Cyrillic (OSM names in Serbia are Cyrillic). */
function toCyrillic(s) {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const lower = s.slice(i).toLowerCase();
    const hit = LAT_CYR.find(([l]) => lower.startsWith(l));
    if (!hit) {
      out += s[i++];
      continue;
    }
    const upper = s[i] !== s[i].toLowerCase();
    out += upper ? hit[1].toUpperCase() : hit[1];
    i += hit[0].length;
  }
  return out;
}

const norm = (s) => s.normalize('NFC').toLowerCase();

async function overpass(key, query) {
  const file = path.join(CACHE, `overpass-${key}.json`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    let res;
    // Public servers are flaky: up to three rounds over all servers, pausing in between.
    const attempts = [...OVERPASS, ...OVERPASS, ...OVERPASS];
    for (const [i, url] of attempts.entries()) {
      if (i > 0 && i % OVERPASS.length === 0) await new Promise((r) => setTimeout(r, 15000));
      console.log(`  querying ${new URL(url).host} (${key})...`);
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'topo-heli-map-builder/0.1 (hobby geography game)',
        },
        body: new URLSearchParams({ data: query }),
      });
      // An empty answer is usually a server hiccup: try the next server instead of caching it.
      if (res.ok) {
        const text = await res.clone().text();
        if (JSON.parse(text).elements?.length) break;
        console.warn(`  ! empty answer, trying next server`);
        res = { ok: false, status: 'empty', text: async () => text };
        continue;
      }
      console.warn(`  ! ${res.status}, trying next server`);
    }
    if (!res.ok) throw new Error(`Overpass failed (${res.status}): ${await res.text()}`);
    const text = await res.text();
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, text);
    return JSON.parse(text);
  }
}

/** Builds a regex alternation matching Latin and Cyrillic spellings. */
const nameRegex = (names) => `^(${names.flatMap((n) => [n, toCyrillic(n)]).join('|')})$`;

const NAME_KEYS = ['name', 'name:sr', 'name:sr-Latn'];
/** Finds which configured name an OSM element carries (any of the name keys). */
function matchName(tags, names) {
  for (const key of NAME_KEYS) {
    const v = tags?.[key];
    if (!v) continue;
    const hit = names.find((n) => norm(n) === norm(v) || norm(toCyrillic(n)) === norm(v));
    if (hit) return hit;
  }
  return null;
}

function areaQuery(cfg) {
  return cfg.areas.map((cc, i) => `area["ISO3166-1"="${cc}"]["admin_level"="2"]->.a${i};`).join('\n');
}
const inAreas = (cfg, filter, keys = NAME_KEYS) =>
  cfg.areas.map((_, i) => keys.map((k) => `${filter}["${k}"~"__RE__",i](area.a${i});`).join('\n')).join('\n');

/**
 * The playable country (from the map's geo.json) grown by `km`, as a clip layer: keeps
 * rivers inside the country, while border rivers (Danube, Drina…) are not chopped up.
 */
async function countryClip(id, km) {
  const geo = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', id, 'geo.json'), 'utf8'));
  const home = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: geo.home } }] };
  return simplifyGeo(home, `-buffer radius=${km}km`);
}

/** The playable country itself (no margin): drawing layers are clipped to exactly this. */
async function homeShape(id) {
  const geo = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', id, 'geo.json'), 'utf8'));
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: geo.home } }] };
}

/** Clips lon/lat lines or polygons to the country, for drawing without a per-frame clip. */
async function clipToHome(id, geometries, kind) {
  if (!geometries.length) return [];
  const features = geometries.map((coordinates) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: kind === 'line' ? 'LineString' : 'Polygon', coordinates },
  }));
  const out = await mapshaper.applyCommands('-i in.json -clip home.json -o out.json format=geojson', {
    'in.json': { type: 'FeatureCollection', features },
    'home.json': await homeShape(id),
  });
  const fc = JSON.parse(out['out.json']);
  const result = [];
  // Without attributes mapshaper writes a GeometryCollection instead of features.
  for (const g of fc.features?.map((f) => f.geometry) ?? fc.geometries ?? []) {
    if (!g) continue;
    if (g.type === 'LineString' || g.type === 'Polygon') result.push(g.coordinates);
    else if (g.type === 'MultiLineString' || g.type === 'MultiPolygon') result.push(...g.coordinates);
  }
  return round(result);
}

async function simplifyGeo(fc, cmd) {
  const out = await mapshaper.applyCommands(`-i in.json ${cmd} -o out.json format=geojson`, { 'in.json': fc });
  const res = JSON.parse(out['out.json']);
  return res.type === 'FeatureCollection' ? res : { type: 'FeatureCollection', features: (res.geometries ?? []).map((geometry) => ({ type: 'Feature', properties: {}, geometry })) };
}

const round = (c) => (typeof c[0] === 'number' ? [+c[0].toFixed(4), +c[1].toFixed(4)] : c.map(round));
const byLevel = (obj) => Object.entries(obj).flatMap(([level, list]) => list.map((item) => ({ level: +level, item })));

// ---------- builders ----------

async function buildRivers(id, cfg, key = 'rivers', waterways = 'river|canal') {
  const entries = byLevel(cfg.rivers).map(({ level, item }) => {
    if (typeof item === 'string') return { level, name: item, osm: [item] };
    if (Array.isArray(item)) return { level, name: item[0], osm: [item[0]], box: item[1] };
    return { level, name: item.name, osm: item.osm ?? [item.name], box: item.box, canals: item.canals, type: item.type };
  });
  if (!entries.length) return [];
  const osmNames = [...new Set(entries.flatMap((e) => e.osm))];
  const re = nameRegex(osmNames);
  const inBox = (box, [x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const [w, so, e, n] = cfg.bbox;
  const query = `[out:json][timeout:300];\n${areaQuery(cfg)}\n(\n${inAreas(cfg, `way["waterway"~"^(${waterways})$"]`).replaceAll('__RE__', re)}\n${inAreas(cfg, `relation["waterway"~"^(${waterways})$"]`).replaceAll('__RE__', re)}\n);\nout geom(${so},${w},${n},${e});`;
  const data = await overpass(`${id}-${key}-v4`, query);

  const features = [];
  // Way id -> { river, coords }. A way can come in directly and as a relation member: keep it once,
  // otherwise its length would count twice when following the river.
  const ways = new Map();
  const add = (wayId, osmName, geometry, waterway) => {
    const coords = (geometry ?? []).filter(Boolean).map((p) => [p.lon, p.lat]);
    if (coords.length < 2 || ways.has(wayId)) return;
    const entry = entries.find(
      (en) =>
        en.osm.includes(osmName) &&
        (!en.box || coords.some((c) => inBox(en.box, c))) &&
        (waterway !== 'canal' || en.canals || key !== 'rivers'),
    );
    if (entry) ways.set(wayId, { river: entry.name, coords });
  };
  // Named ways first, then relation members.
  for (const el of data.elements) {
    const osmName = matchName(el.tags, osmNames);
    if (osmName && el.type === 'way') add(el.id, osmName, el.geometry, el.tags.waterway);
  }
  for (const el of data.elements) {
    const osmName = matchName(el.tags, osmNames);
    if (!osmName || el.type !== 'relation') continue;
    // Side streams (e.g. unnamed side channels of the Rhein relation) are not the river itself.
    for (const m of el.members ?? []) if (m.type === 'way' && m.role !== 'side_stream') add(m.ref, osmName, m.geometry, el.tags.waterway);
  }
  if (!ways.size) {
    console.warn(`  ! no waterways found for ${key}`);
    return [];
  }
  for (const { river, coords } of ways.values()) {
    features.push({ type: 'Feature', properties: { feat: river }, geometry: { type: 'LineString', coordinates: coords } });
  }
  const clip = await countryClip(id, 2);
  const out = await mapshaper.applyCommands(
    '-i in.json -clip clip.json -dissolve feat -simplify interval=400 -o out.json format=geojson',
    { 'in.json': { type: 'FeatureCollection', features }, 'clip.json': clip },
  );
  const fc = JSON.parse(out['out.json']);
  const result = [];
  for (const { level, name, box, type } of entries) {
    const f = fc.features.find((x) => x.properties.feat === name);
    if (!f) {
      console.warn(`  ! river not found: ${name}`);
      continue;
    }
    const g = f.geometry;
    let lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    if (box) lines = lines.filter((l) => l.some((c) => inBox(box, c)));
    result.push({ name, level, ...(type ? { type } : {}), lines: round(lines) });
  }
  return result;
}

async function buildLakes(id, cfg, key = 'lakes') {
  const entries = byLevel(cfg.lakes).map(({ level, item }) =>
    Array.isArray(item) ? { level, item: item[1], shown: item[0] } : { level, item, shown: item },
  );
  if (!entries.length) return [];
  const names = entries.map((e) => e.item);
  const re = nameRegex(names);
  const query = `[out:json][timeout:300];\n${areaQuery(cfg)}\n(\n${inAreas(cfg, 'nwr["natural"="water"]', ['name', 'name:sr']).replaceAll('__RE__', re)}\n);\nout geom;`;
  const data = await overpass(`${id}-${key}`, query);

  const features = [];
  for (const el of data.elements) {
    const name = matchName(el.tags, names);
    if (!name) continue;
    if (el.type === 'way' && el.geometry) {
      features.push({ type: 'Feature', properties: { feat: name }, geometry: { type: 'Polygon', coordinates: [el.geometry.map((p) => [p.lon, p.lat])] } });
    } else if (el.type === 'relation') {
      // Outer members only; holes (islands) don't matter for the game.
      for (const m of el.members ?? []) {
        if (m.role === 'outer' && m.geometry) {
          features.push({ type: 'Feature', properties: { feat: name }, geometry: { type: 'LineString', coordinates: m.geometry.map((p) => [p.lon, p.lat]) } });
        }
      }
    }
  }
  // Relation outers come as pieces: -polygons stitches lines into rings.
  const lines = features.filter((f) => f.geometry.type === 'LineString');
  const polys = features.filter((f) => f.geometry.type === 'Polygon');
  let stitched = [];
  for (const name of new Set(lines.map((f) => f.properties.feat))) {
    const fc = await simplifyGeo({ type: 'FeatureCollection', features: lines.filter((f) => f.properties.feat === name) }, '-polygons gap-tolerance=0.001');
    stitched.push(...fc.features.map((f) => ({ ...f, properties: { feat: name } })));
  }
  const fc = await simplifyGeo({ type: 'FeatureCollection', features: [...polys, ...stitched] }, '-dissolve feat -simplify interval=150 keep-shapes');

  const result = [];
  for (const { level, item: osmName, shown } of entries) {
    const f = fc.features.find((x) => x.properties.feat === osmName);
    if (!f) {
      console.warn(`  ! lake not found: ${osmName}`);
      continue;
    }
    const g = f.geometry;
    const rings = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => p[0]);
    result.push({ name: shown, level, rings: round(rings) });
  }
  return result;
}

async function buildMountains(id, cfg) {
  const entries = byLevel(cfg.mountains);
  if (!entries.length) return [];
  const peaks = entries.map((e) => e.item[1]).filter((p) => typeof p === 'string');
  const re = nameRegex(peaks);
  const query = `[out:json][timeout:300];\n${areaQuery(cfg)}\n(\n${inAreas(cfg, 'node["natural"="peak"]').replaceAll('__RE__', re)}\n);\nout;`;
  const data = await overpass(`${id}-peaks`, query);

  const result = [];
  for (const { level, item: [name, peak] } of entries) {
    if (typeof peak === 'object') {
      result.push({ name, level, ...peak });
      continue;
    }
    // Several peaks can share a name: take the highest.
    const hits = data.elements
      .filter((el) => matchName(el.tags, [peak]))
      .sort((a, b) => (parseFloat(b.tags.ele) || 0) - (parseFloat(a.tags.ele) || 0));
    if (!hits.length) {
      console.warn(`  ! peak not found: ${peak} (${name})`);
      continue;
    }
    const h = hits[0];
    result.push({ name, level, lat: +h.lat.toFixed(4), lon: +h.lon.toFixed(4), ele: parseFloat(h.tags.ele) || null });
  }
  return result;
}

/**
 * Water surfaces of the given OSM water types: closed ways and multipolygons (outer rings minus
 * inner rings, so islands stay land), merged, small pieces dropped, clipped to the country.
 */
async function buildSurfaces(id, cfg) {
  const { types, minKm2, interval = 150 } = cfg.context.surfaces;
  const re = `^(${types.join('|')})$`;
  const query = `[out:json][timeout:600];\n${areaQuery(cfg)}\n(\n${cfg.areas
    .map((_, i) => `way["natural"="water"]["water"~"${re}"](area.a${i});\nrelation["natural"="water"]["water"~"${re}"](area.a${i});`)
    .join('\n')}\n);\nout geom;`;
  const data = await overpass(`${id}-surfaces`, query);

  const toCoords = (geometry) => (geometry ?? []).filter(Boolean).map((p) => [p.lon, p.lat]);
  const outer = [];
  const inner = [];
  const line = (coords) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  for (const el of data.elements) {
    if (el.type === 'way') {
      const c = toCoords(el.geometry);
      if (c.length >= 4) outer.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [c] } });
      continue;
    }
    // Multipolygon members come as pieces: stitch each relation's outer and inner rings separately.
    const pieces = { outer: [], inner: [] };
    for (const m of el.members ?? []) {
      if (m.type === 'way' && (m.role === 'outer' || m.role === 'inner')) pieces[m.role].push(line(toCoords(m.geometry)));
    }
    for (const role of ['outer', 'inner']) {
      if (!pieces[role].length) continue;
      const fc = await simplifyGeo({ type: 'FeatureCollection', features: pieces[role] }, '-polygons gap-tolerance=0.0005');
      (role === 'outer' ? outer : inner).push(...fc.features.map((f) => ({ ...f, properties: {} })));
    }
  }
  const clip = await countryClip(id, 0.5);
  const result = await mapshaper.applyCommands(
    `-i outer.json -dissolve2 -erase inner.json -explode -filter "this.area > ${minKm2 * 1e6}" -simplify interval=${interval} keep-shapes -clip clip.json -o out.json format=geojson`,
    {
      'outer.json': { type: 'FeatureCollection', features: outer },
      'inner.json': { type: 'FeatureCollection', features: inner },
      'clip.json': clip,
    },
  );
  const fc = JSON.parse(result['out.json']);
  const polys = [];
  for (const f of fc.features ?? fc.geometries?.map((geometry) => ({ geometry })) ?? []) {
    const g = f.geometry;
    if (g?.type === 'Polygon') polys.push(g.coordinates);
    else if (g?.type === 'MultiPolygon') polys.push(...g.coordinates);
  }
  console.log(`  water surfaces: ${outer.length} shapes, ${inner.length} islands -> ${polys.length} polygons`);
  return round(polys);
}

/** Large water areas (see `waterAreas` in the config), land cut out. */
async function buildWaterAreas(id, cfg) {
  const entries = byLevel(cfg.waterAreas ?? {});
  if (!entries.length) return [];
  const ids = entries.map((e) => e.item.relation).filter(Boolean);
  const data = ids.length
    ? await overpass(`${id}-waterareas-${ids.join('-')}`, `[out:json][timeout:300];\n(${ids.map((r) => `relation(${r});`).join('')});\nout geom;`)
    : { elements: [] };
  const geo = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', id, 'geo.json'), 'utf8'));
  const land = {
    type: 'FeatureCollection',
    features: [...geo.home, ...geo.neighbours].map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } })),
  };
  const line = (geometry) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geometry.filter(Boolean).map((p) => [p.lon, p.lat]) } });
  const result = [];
  for (const { level, item } of entries) {
    const shapes = [];
    if (item.relation) {
      const rel = data.elements.find((e) => e.type === 'relation' && e.id === item.relation);
      if (!rel) {
        console.warn(`  ! water area relation not found: ${item.name}`);
        continue;
      }
      const outer = (rel.members ?? []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => line(m.geometry));
      const inner = (rel.members ?? []).filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => line(m.geometry));
      const outerFc = await simplifyGeo({ type: 'FeatureCollection', features: outer }, '-polygons gap-tolerance=0.0005');
      shapes.push(...outerFc.features);
      if (inner.length) {
        const innerFc = await simplifyGeo({ type: 'FeatureCollection', features: inner }, '-polygons gap-tolerance=0.0005');
        land.features.push(...innerFc.features.map((f) => ({ ...f, properties: {} })));
      }
    }
    if (item.outline) shapes.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...item.outline, item.outline[0]]] } });
    const out = await mapshaper.applyCommands(
      '-i area.json -dissolve -erase land.json -simplify interval=150 keep-shapes -filter-slivers -o out.json format=geojson',
      { 'area.json': { type: 'FeatureCollection', features: shapes.map((f) => ({ ...f, properties: {} })) }, 'land.json': land },
    );
    const fc = JSON.parse(out['out.json']);
    const polys = [];
    for (const g of fc.features?.map((f) => f.geometry) ?? fc.geometries ?? []) {
      if (g?.type === 'Polygon') polys.push(g.coordinates);
      else if (g?.type === 'MultiPolygon') polys.push(...g.coordinates);
    }
    if (!polys.length) {
      console.warn(`  ! water area empty after cutting out land: ${item.name}`);
      continue;
    }
    // rings: outer rings; holes: islands (flying over an island is not over the water).
    result.push({ name: item.name, level, ...(item.type ? { type: item.type } : {}), rings: round(polys.map((p) => p[0])), holes: round(polys.flatMap((p) => p.slice(1))) });
  }
  return result;
}

async function build(id, cfg) {
  console.log(`Building physical features for ${id}`);
  const out = {
    rivers: await buildRivers(id, cfg),
    lakes: [...(await buildLakes(id, cfg)), ...(await buildWaterAreas(id, cfg))],
    mountains: await buildMountains(id, cfg),
  };

  // Background water (never asked): connections to the sea, river banks, harbours, …
  let contextLines = [];
  let contextAreas = [];
  if (cfg.context) {
    const lines = await buildRivers(id, { ...cfg, rivers: { 1: cfg.context.lines } }, 'context-lines');
    const areas = await buildLakes(id, { ...cfg, lakes: { 1: cfg.context.areas } }, 'context-areas');
    const surfaces = cfg.context.surfaces ? await buildSurfaces(id, cfg) : [];
    contextLines = lines.flatMap((r) => r.lines);
    contextAreas = [...areas.map((a) => a.rings), ...surfaces];
    console.log(`  background water: ${lines.length} waterways, ${areas.length} named areas, ${surfaces.length} surfaces`);
  }

  // Drawing layers, pre-clipped to the country so the game needs no per-frame clipping. The
  // targets above keep their full geometry (incl. a margin along border rivers) for finding them.
  const riversOfLevel = (lv) => out.rivers.filter((r) => Math.min(r.level, 3) === lv).flatMap((r) => r.lines);
  out.draw = {
    rivers: [await clipToHome(id, riversOfLevel(1), 'line'), await clipToHome(id, riversOfLevel(2), 'line'), await clipToHome(id, riversOfLevel(3), 'line')],
    lines: await clipToHome(id, contextLines, 'line'),
    // Water areas (holes = islands) lie outside the land: drawn from their own shape in the game.
    water: await clipToHome(id, [...out.lakes.filter((l) => !l.holes).map((l) => l.rings), ...contextAreas], 'polygon'),
  };

  const file = path.join(ROOT, 'src', 'maps', id, 'physical.json');
  await fs.writeFile(file, JSON.stringify(out));
  const kb = ((await fs.stat(file)).size / 1024).toFixed(0);
  console.log(`  ${out.rivers.length} rivers, ${out.lakes.length} lakes, ${out.mountains.length} mountains -> ${path.relative(ROOT, file)} (${kb} KB)`);
}


/**
 * Province maps reuse the country's data: rivers cut to the province (with the same margin as
 * the country), drawing layers clipped to it. No river long enough -> no physical file.
 */
async function buildDerived(id, fromId) {
  const from = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', fromId, 'physical.json'), 'utf8'));
  const clip = await countryClip(id, 2);
  const lengthKm = (lines) => {
    const d = Math.PI / 180;
    let L = 0;
    for (const l of lines) for (let i = 1; i < l.length; i++) {
      const [a, b] = [l[i - 1], l[i]];
      L += 6371 * Math.hypot((b[0] - a[0]) * d * Math.cos(((a[1] + b[1]) / 2) * d), (b[1] - a[1]) * d);
    }
    return L;
  };
  const rivers = [];
  for (const r of from.rivers) {
    const out = await mapshaper.applyCommands('-i in.json -clip clip.json -o out.json format=geojson', {
      'in.json': { type: 'FeatureCollection', features: r.lines.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) },
      'clip.json': clip,
    });
    const fc = JSON.parse(out['out.json']);
    const lines = [];
    for (const g of fc.features?.map((f) => f.geometry) ?? fc.geometries ?? []) {
      if (g?.type === 'LineString') lines.push(g.coordinates);
      else if (g?.type === 'MultiLineString') lines.push(...g.coordinates);
    }
    if (lengthKm(lines) >= MIN_PROVINCE_RIVER_KM) rivers.push({ ...r, lines: round(lines) });
  }
  const file = path.join(ROOT, 'src', 'maps', id, 'physical.json');

  // Water areas (IJsselmeer, Oosterschelde, …) next to the province: kept whole.
  const home = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'maps', id, 'geo.json'), 'utf8')).home;
  const homePts = home.flat(2);
  const near = (rings) =>
    rings.some((r) => r.some(([x, y]) => homePts.some(([hx, hy]) => Math.abs(hx - x) < 0.02 && Math.abs(hy - y) < 0.014)));
  const lakes = from.lakes.filter((l) => near(l.rings));
  if (!rivers.length && !lakes.length) {
    await fs.rm(path.join(ROOT, 'src', 'maps', id, 'physical.json'), { force: true });
    console.log(`  ${id}: no rivers of ${MIN_PROVINCE_RIVER_KM}+ km and no waters`);
    return;
  }
  const out = {
    rivers,
    lakes,
    mountains: [],
    draw: {
      rivers: await Promise.all(from.draw.rivers.map((lines) => clipToHome(id, lines, 'line'))),
      lines: await clipToHome(id, from.draw.lines, 'line'),
      water: await clipToHome(id, from.draw.water, 'polygon'),
    },
  };
  await fs.writeFile(file, JSON.stringify(out));
  const kb = ((await fs.stat(file)).size / 1024).toFixed(0);
  console.log(`  ${id}: ${rivers.length} rivers/canals, ${lakes.length} waters (${[...rivers, ...lakes].map((r) => r.name).join(', ')}) -> ${kb} KB`);
}

const only = process.argv[2];
for (const [id, cfg] of Object.entries(PHYSICAL)) {
  if (!only || only === id) await build(id, cfg);
}
// Provinces are derived from the Netherlands: `npm run build:physical -- provinces` (or no argument).
if (!only || only === 'netherlands' || only === 'provinces') {
  console.log('Deriving province rivers from netherlands');
  for (const p of PROVINCES) await buildDerived(p.id, 'netherlands');
}

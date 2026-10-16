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
// river is made of differently named OSM rivers (e.g. Rijn = Bovenrijn + Nederrijn). Lakes: 'Name' or ['Shown name', 'OSM name']. Mountains: ['Range', 'OSM peak name'] or
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
      1: [{ name: 'Rijn', osm: ['Rijn', 'Bovenrijn', 'Nederrijn'] }, 'Waal', 'Maas', 'IJssel', 'Lek'],
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
        'Zwarte Water', 'Oude Rijn',
      ],
      3: ['Eem', 'Dommel', 'Roer', 'Berkel', 'Dinkel', 'Regge', 'Geul', 'Niers', 'Mark', 'Schipbeek', 'Reitdiep'],
    },
    lakes: {},
    mountains: {},
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
      if (res.ok) break;
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

async function simplifyGeo(fc, cmd) {
  const out = await mapshaper.applyCommands(`-i in.json ${cmd} -o out.json format=geojson`, { 'in.json': fc });
  const res = JSON.parse(out['out.json']);
  return res.type === 'FeatureCollection' ? res : { type: 'FeatureCollection', features: (res.geometries ?? []).map((geometry) => ({ type: 'Feature', properties: {}, geometry })) };
}

const round = (c) => (typeof c[0] === 'number' ? [+c[0].toFixed(4), +c[1].toFixed(4)] : c.map(round));
const byLevel = (obj) => Object.entries(obj).flatMap(([level, list]) => list.map((item) => ({ level: +level, item })));

// ---------- builders ----------

async function buildRivers(id, cfg) {
  const entries = byLevel(cfg.rivers).map(({ level, item }) => {
    if (typeof item === 'string') return { level, name: item, osm: [item] };
    if (Array.isArray(item)) return { level, name: item[0], osm: [item[0]], box: item[1] };
    return { level, name: item.name, osm: item.osm ?? [item.name], box: item.box };
  });
  if (!entries.length) return [];
  const osmNames = [...new Set(entries.flatMap((e) => e.osm))];
  const re = nameRegex(osmNames);
  const inBox = (box, [x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const [w, so, e, n] = cfg.bbox;
  const query = `[out:json][timeout:300];\n${areaQuery(cfg)}\n(\n${inAreas(cfg, 'way["waterway"="river"]').replaceAll('__RE__', re)}\n${inAreas(cfg, 'relation["waterway"="river"]').replaceAll('__RE__', re)}\n);\nout geom(${so},${w},${n},${e});`;
  const data = await overpass(`${id}-rivers-v2`, query);

  const features = [];
  // Way id -> { river, coords }. A way can come in directly and as a relation member: keep it once,
  // otherwise its length would count twice when following the river.
  const ways = new Map();
  const add = (wayId, osmName, geometry) => {
    const coords = (geometry ?? []).filter(Boolean).map((p) => [p.lon, p.lat]);
    if (coords.length < 2 || ways.has(wayId)) return;
    const entry = entries.find((en) => en.osm.includes(osmName) && (!en.box || coords.some((c) => inBox(en.box, c))));
    if (entry) ways.set(wayId, { river: entry.name, coords });
  };
  // Named ways first, then relation members.
  for (const el of data.elements) {
    const osmName = matchName(el.tags, osmNames);
    if (osmName && el.type === 'way') add(el.id, osmName, el.geometry);
  }
  for (const el of data.elements) {
    const osmName = matchName(el.tags, osmNames);
    if (!osmName || el.type !== 'relation') continue;
    for (const m of el.members ?? []) if (m.type === 'way') add(m.ref, osmName, m.geometry);
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
  for (const { level, name, box } of entries) {
    const f = fc.features.find((x) => x.properties.feat === name);
    if (!f) {
      console.warn(`  ! river not found: ${name}`);
      continue;
    }
    const g = f.geometry;
    let lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    if (box) lines = lines.filter((l) => l.some((c) => inBox(box, c)));
    result.push({ name, level, lines: round(lines) });
  }
  return result;
}

async function buildLakes(id, cfg) {
  const entries = byLevel(cfg.lakes).map(({ level, item }) =>
    Array.isArray(item) ? { level, item: item[1], shown: item[0] } : { level, item, shown: item },
  );
  if (!entries.length) return [];
  const names = entries.map((e) => e.item);
  const re = nameRegex(names);
  const query = `[out:json][timeout:300];\n${areaQuery(cfg)}\n(\n${inAreas(cfg, 'nwr["natural"="water"]', ['name', 'name:sr']).replaceAll('__RE__', re)}\n);\nout geom;`;
  const data = await overpass(`${id}-lakes`, query);

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

async function build(id, cfg) {
  console.log(`Building physical features for ${id}`);
  const out = {
    rivers: await buildRivers(id, cfg),
    lakes: await buildLakes(id, cfg),
    mountains: await buildMountains(id, cfg),
  };
  const file = path.join(ROOT, 'src', 'maps', id, 'physical.json');
  await fs.writeFile(file, JSON.stringify(out));
  const kb = ((await fs.stat(file)).size / 1024).toFixed(0);
  console.log(`  ${out.rivers.length} rivers, ${out.lakes.length} lakes, ${out.mountains.length} mountains -> ${path.relative(ROOT, file)} (${kb} KB)`);
}

const only = process.argv[2];
for (const [id, cfg] of Object.entries(PHYSICAL)) {
  if (!only || only === id) await build(id, cfg);
}

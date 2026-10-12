// Builds compact map geometry for the game from Natural Earth data.
//
//   npm run build:map            -> builds every map in MAPS
//   npm run build:map -- serbia  -> builds one map
//
// Raw downloads are cached in .cache/ (git-ignored). Output goes to
// src/maps/<id>/geo.json as lon/lat arrays; projection happens at runtime.

import fs from 'node:fs/promises';
import path from 'node:path';
import mapshaper from 'mapshaper';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

const SOURCES = {
  countries: 'ne_10m_admin_0_countries',
  admin1: 'ne_10m_admin_1_states_provinces',
  rivers: 'ne_10m_rivers_lake_centerlines',
  riversEurope: 'ne_10m_rivers_europe',
  lakes: 'ne_10m_lakes',
  lakesEurope: 'ne_10m_lakes_europe',
};

// Kosovo municipalities (Natural Earth admin-1) grouped into the five
// Serbian districts (okruzi) they belong to.
const KOSOVO_DISTRICTS = {
  'Kosovski': ['Priština', 'Podujevo', 'Glogovac', 'Obilić', 'Kosovo Polje', 'Lipljan', 'Štimlje', 'Uroševac', 'Kačanik', 'Štrpce'],
  'Pećki': ['Peć', 'Dečani', 'Đakovica', 'Istok', 'Klina'],
  'Prizrenski': ['Prizren', 'Dragaš', 'Orahovac', 'Suva Reka', 'Mališevo'],
  'Kosovsko-Mitrovački': ['Kosovska Mitrovica', 'Zvečan', 'Zubin Potok', 'Leposavić', 'Vučitrn', 'Srbica'],
  'Kosovsko-Pomoravski': ['Gnjilane', 'Vitina', 'Kosovska Kamenica', 'Novo Brdo'],
};

const MAPS = {
  serbia: {
    // Countries (ADM0_A3) that together form the playable area.
    home: ['SRB', 'KOS'],
    // Area to keep around the playable country: [minLon, minLat, maxLon, maxLat].
    bbox: [18.1, 41.5, 23.6, 46.55],
    districtOf: (p) => {
      if (p.adm0_a3 !== 'KOS') return p.name;
      const d = Object.entries(KOSOVO_DISTRICTS).find(([, list]) => list.includes(p.name));
      if (!d) throw new Error(`Unmapped Kosovo municipality: ${p.name}`);
      return d[0];
    },
    simplify: '45%',
  },
};

async function source(name) {
  const file = path.join(CACHE, `${name}.geojson`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    console.log(`  downloading ${name}...`);
    const res = await fetch(`${NE}/${name}.geojson`);
    if (!res.ok) throw new Error(`Download failed: ${name} (${res.status})`);
    const text = await res.text();
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, text);
    return JSON.parse(text);
  }
}

async function shape(geojson, commands) {
  const out = await mapshaper.applyCommands(
    `-i in.json ${commands} -o out.json format=geojson`,
    { 'in.json': geojson },
  );
  const fc = JSON.parse(out['out.json']);
  return fc.type === 'FeatureCollection' ? fc : { type: 'FeatureCollection', features: fc.geometries?.map((geometry) => ({ geometry })) ?? [] };
}

const round = (c) => (typeof c[0] === 'number' ? [+c[0].toFixed(4), +c[1].toFixed(4)] : c.map(round));

/** Flattens (Multi)Polygon / (Multi)LineString features into a list of rings or lines. */
function parts(fc) {
  const list = [];
  for (const f of fc.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') list.push(g.coordinates);
    else if (g.type === 'MultiPolygon') list.push(...g.coordinates);
    else if (g.type === 'LineString') list.push(g.coordinates);
    else if (g.type === 'MultiLineString') list.push(...g.coordinates);
  }
  return round(list);
}

const filterFeatures = (fc, pred) => ({ type: 'FeatureCollection', features: fc.features.filter(pred) });

async function buildMap(id, cfg) {
  console.log(`Building ${id}`);
  const bbox = cfg.bbox.join(',');
  const clip = `-clip bbox=${bbox} -simplify ${cfg.simplify} keep-shapes -filter-slivers`;

  const countries = await source(SOURCES.countries);
  const isHome = (f) => cfg.home.includes(f.properties.ADM0_A3);

  const home = await shape(filterFeatures(countries, isHome), `-dissolve ${clip}`);
  const neighbours = await shape(filterFeatures(countries, (f) => !isHome(f)), clip);

  const admin1 = await source(SOURCES.admin1);
  const homeAdmin = filterFeatures(admin1, (f) => cfg.home.includes(f.properties.adm0_a3));
  for (const f of homeAdmin.features) f.properties = { district: cfg.districtOf(f.properties) };
  const districtLines = await shape(homeAdmin, `-dissolve district -simplify ${cfg.simplify} keep-shapes -innerlines`);

  const rivers = [];
  for (const src of [SOURCES.rivers, SOURCES.riversEurope]) {
    const fc = await shape(await source(src), `-clip bbox=${bbox} -simplify ${cfg.simplify}`);
    for (const f of fc.features ?? []) {
      // scalerank: lower = more important river -> drawn wider.
      const rank = f.properties.scalerank ?? 10;
      for (const line of parts({ features: [f] })) rivers.push({ r: rank, l: line });
    }
  }

  const lakes = [];
  for (const src of [SOURCES.lakes, SOURCES.lakesEurope]) {
    const fc = await shape(await source(src), `-clip bbox=${bbox} -simplify ${cfg.simplify} keep-shapes`);
    lakes.push(...parts(fc));
  }

  const out = {
    bbox: cfg.bbox,
    home: parts(home),
    neighbours: parts(neighbours),
    districts: parts(districtLines),
    rivers,
    lakes,
  };
  const file = path.join(ROOT, 'src', 'maps', id, 'geo.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(out));
  const kb = ((await fs.stat(file)).size / 1024).toFixed(0);
  console.log(`  -> ${path.relative(ROOT, file)} (${kb} KB)`);
}

const only = process.argv[2];
for (const [id, cfg] of Object.entries(MAPS)) {
  if (!only || only === id) await buildMap(id, cfg);
}

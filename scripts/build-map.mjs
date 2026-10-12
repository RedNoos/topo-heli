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
  netherlands: {
    home: ['NLD'],
    bbox: [2.9, 50.6, 7.6, 53.75],
    districtOf: (p) => p.name,
    // Small country: Natural Earth is coarse already, so keep every point.
    simplify: '100%',
  },
  europe: {
    // Germany's point of view: internationally recognised borders (Crimea in
    // Ukraine, Northern Cyprus in Cyprus). Kosovo is merged into Serbia below.
    countries: 'ne_10m_admin_0_countries_deu',
    home: (p) => p.CONTINENT === 'Europe' || ['TUR', 'CYP'].includes(p.ADM0_A3),
    // Territories drawn as part of another country.
    merge: { KOS: 'SRB', ALD: 'FIN', JEY: 'GBR', GGY: 'GBR', IMN: 'GBR', GIB: 'GBR', FRO: 'DNK' },
    bbox: [-30, 25, 60, 75],
    // Lambert azimuthal equal-area (like EPSG:3035), clipped to a rectangle in km.
    projection: { type: 'laea', lon0: 15, lat0: 52, rect: [-2350, -2000, 2450, 2300] },
    simplify: 'interval=2500',
    minIslandKm2: 60,
    colorCountries: true,
    riverMaxRank: 5,
    lakeMaxRank: 4,
    europeanRivers: false,
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

/** Gives every country one of `count` colours, different from its neighbours. */
function colorCountries(features, count) {
  const owners = new Map(); // vertex -> country indexes
  features.forEach((f, i) => {
    for (const poly of parts({ features: [f] })) {
      for (const ring of poly) {
        for (const [x, y] of ring) {
          const key = `${x},${y}`;
          if (!owners.has(key)) owners.set(key, new Set());
          owners.get(key).add(i);
        }
      }
    }
  });
  const adj = features.map(() => new Set());
  for (const set of owners.values()) {
    for (const a of set) for (const b of set) if (a !== b) adj[a].add(b);
  }
  const colors = new Array(features.length).fill(-1);
  const order = features.map((_, i) => i).sort((a, b) => adj[b].size - adj[a].size);
  for (const i of order) {
    const used = new Set([...adj[i]].map((j) => colors[j]));
    let c = 0;
    while (used.has(c) && c < count - 1) c++;
    colors[i] = c;
  }
  return colors;
}

async function buildMap(id, cfg) {
  console.log(`Building ${id}`);
  const bbox = cfg.bbox.join(',');
  const proj = cfg.projection;
  const projStr = proj && `+proj=laea +lat_0=${proj.lat0} +lon_0=${proj.lon0} +R=6371000`;
  const rectM = proj && proj.rect.map((v) => v * 1000).join(',');
  // Clip (and for projected maps: project, clip to the rectangle, unproject), then simplify.
  const area = (keepShapes = true) =>
    [
      `-clip bbox=${bbox}`,
      proj ? `-proj ${projStr} from=wgs84 -clip bbox=${rectM}` : '',
      `-simplify ${cfg.simplify}${keepShapes ? ' keep-shapes' : ''}`,
      cfg.minIslandKm2 ? `-filter-islands min-area=${cfg.minIslandKm2}km2` : '',
      proj ? '-proj wgs84' : '',
    ].join(' ');

  const countries = await source(cfg.countries ?? SOURCES.countries);
  const homeTest = Array.isArray(cfg.home) ? (p) => cfg.home.includes(p.ADM0_A3) : cfg.home;
  const isHome = (f) => homeTest(f.properties);
  for (const f of countries.features) {
    f.properties = { code: cfg.merge?.[f.properties.ADM0_A3] ?? f.properties.ADM0_A3, home: isHome(f) };
  }
  const homeFc = filterFeatures(countries, (f) => f.properties.home);

  const homeCountries = await shape(homeFc, `-dissolve code ${area()} -filter-slivers`);
  const home = await shape(homeFc, `-dissolve code ${area()} -filter-slivers -dissolve`);
  const neighbours = await shape(filterFeatures(countries, (f) => !f.properties.home), `${area()} -filter-slivers`);

  let districts = [];
  if (cfg.districtOf) {
    const admin1 = await source(SOURCES.admin1);
    const homeAdmin = filterFeatures(admin1, (f) => homeTest({ ADM0_A3: f.properties.adm0_a3 }));
    for (const f of homeAdmin.features) f.properties = { district: cfg.districtOf(f.properties) };
    districts = parts(await shape(homeAdmin, `-dissolve district ${area()} -innerlines`));
  }

  const rivers = [];
  const riverSources = [SOURCES.rivers, ...(cfg.europeanRivers === false ? [] : [SOURCES.riversEurope])];
  for (const src of riverSources) {
    const fc = await source(src);
    const kept = filterFeatures(fc, (f) => (f.properties.scalerank ?? 10) <= (cfg.riverMaxRank ?? 99));
    for (const f of (await shape(kept, area(false))).features ?? []) {
      // scalerank: lower = more important river -> drawn wider.
      const rank = f.properties.scalerank ?? 10;
      for (const line of parts({ features: [f] })) rivers.push({ r: rank, l: line });
    }
  }

  const lakes = [];
  const lakeSources = [SOURCES.lakes, ...(cfg.europeanRivers === false ? [] : [SOURCES.lakesEurope])];
  for (const src of lakeSources) {
    const fc = await source(src);
    const kept = filterFeatures(fc, (f) => (f.properties.scalerank ?? 10) <= (cfg.lakeMaxRank ?? 99));
    lakes.push(...parts(await shape(kept, area())));
  }

  const out = {
    bbox: cfg.bbox,
    ...(proj ? { projection: proj } : {}),
    home: parts(home),
    neighbours: parts(neighbours),
    districts,
    rivers,
    lakes,
  };
  if (cfg.colorCountries) {
    const features = homeCountries.features;
    const colors = colorCountries(features, 6);
    out.countries = features.map((f, i) => ({ c: colors[i], p: parts({ features: [f] }) }));
    out.borders = parts(await shape(homeFc, `-dissolve code ${area()} -filter-slivers -innerlines`));
    console.log(`  ${features.length} countries, colours used: ${new Set(colors).size}`);
  }

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

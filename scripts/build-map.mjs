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
import { PROVINCES } from './provinces.mjs';

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
  return fc.type === 'FeatureCollection' ? fc : { type: 'FeatureCollection', features: fc.geometries?.map((geometry) => ({ type: 'Feature', properties: {}, geometry })) ?? [] };
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

/**
 * Splits features into the part inside the playable area and the part outside it, so the
 * game can draw them (bright / muted) without clipping every frame.
 */
async function splitByHome(features, home) {
  const run = async (cmd) => {
    const out = await mapshaper.applyCommands(`-i in.json ${cmd} home.json -o out.json format=geojson`, {
      'in.json': { type: 'FeatureCollection', features },
      'home.json': home,
    });
    const fc = JSON.parse(out['out.json']);
    if (fc.type === 'FeatureCollection') return fc;
    // Without attributes mapshaper writes a GeometryCollection.
    return { type: 'FeatureCollection', features: (fc.geometries ?? []).map((geometry) => ({ type: 'Feature', properties: {}, geometry })) };
  };
  if (!features.length) return { inside: { features: [] }, outside: { features: [] } };
  return { inside: await run('-clip'), outside: await run('-erase') };
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

/** Province maps: the province's land, the other countries and the rest of the country. */
async function provinceShapes(cfg) {
  const countries = await source(cfg.countries ?? SOURCES.countries);
  const admin1 = await source(SOURCES.admin1);
  const country = filterFeatures(countries, (f) => f.properties.ADM0_A3 === cfg.province.country);
  const province = filterFeatures(admin1, (f) => f.properties.adm0_a3 === cfg.province.country && f.properties.name === cfg.province.ne);
  if (!province.features.length) throw new Error(`Province not found: ${cfg.province.ne}`);
  const run = async (cmd, a, b) => {
    const out = await mapshaper.applyCommands(`-i a.json ${cmd} b.json -o out.json format=geojson`, { 'a.json': a, 'b.json': b });
    const fc = JSON.parse(out['out.json']);
    const features = fc.type === 'FeatureCollection' ? fc.features : (fc.geometries ?? []).map((geometry) => ({ type: 'Feature', geometry }));
    return features.filter((f) => f.geometry);
  };
  // Admin-1 shapes include water (IJsselmeer, sea): keep only the province's land.
  const home = (await run('-clip', province, country)).map((f) => ({ ...f, properties: { code: 'HOME', home: true } }));
  const rest = (await run('-erase', country, province)).map((f) => ({ ...f, properties: { code: 'REST', home: false } }));
  const others = countries.features
    .filter((f) => f.properties.ADM0_A3 !== cfg.province.country)
    .map((f) => ({ ...f, properties: { code: f.properties.ADM0_A3, home: false } }));
  return { home, neighbours: [...rest, ...others] };
}

const boundsOf = (features) => {
  const pts = features.flatMap((f) => parts({ features: [f] }).flat(2));
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
};

async function buildMap(id, cfg) {
  console.log(`Building ${id}`);
  const prov = cfg.province ? await provinceShapes(cfg) : null;
  if (prov && !cfg.bbox) {
    // Province bbox plus a margin (~15 km) of surroundings.
    const [w, s, e, n] = boundsOf(prov.home);
    cfg.bbox = [w - 0.22, s - 0.14, e + 0.22, n + 0.14].map((v) => +v.toFixed(3));
  }
  const proj = cfg.projection;
  // Map data reaches a bit beyond the playable bbox: the camera may look past the edge (so
  // places near it are not hidden under the HUD), and that strip should still show the map.
  const DRAW_MARGIN = 0.35;
  const [bw, bs, be, bn] = cfg.bbox;
  const bbox = (proj ? cfg.bbox : [bw - DRAW_MARGIN, bs - DRAW_MARGIN, be + DRAW_MARGIN, bn + DRAW_MARGIN]).join(',');
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

  let homeFc;
  let neighbourFc;
  let homeTest = () => false;
  if (prov) {
    homeFc = { type: 'FeatureCollection', features: prov.home };
    neighbourFc = { type: 'FeatureCollection', features: prov.neighbours };
  } else {
    // Fresh copy: the cached source is shared between maps.
    const countries = structuredClone(await source(cfg.countries ?? SOURCES.countries));
    homeTest = Array.isArray(cfg.home) ? (p) => cfg.home.includes(p.ADM0_A3) : cfg.home;
    const isHome = (f) => homeTest(f.properties);
    for (const f of countries.features) {
      f.properties = { code: cfg.merge?.[f.properties.ADM0_A3] ?? f.properties.ADM0_A3, home: isHome(f) };
    }
    homeFc = filterFeatures(countries, (f) => f.properties.home);
    neighbourFc = filterFeatures(countries, (f) => !f.properties.home);
  }

  const homeCountries = await shape(homeFc, `-dissolve code ${area()} -filter-slivers`);
  const home = await shape(homeFc, `-dissolve code ${area()} -filter-slivers -dissolve`);
  const neighbours = await shape(neighbourFc, `${area()} -filter-slivers`);

  let districts = [];
  if (cfg.districtOf) {
    const admin1 = await source(SOURCES.admin1);
    const homeAdmin = filterFeatures(admin1, (f) => homeTest({ ADM0_A3: f.properties.adm0_a3 }));
    for (const f of homeAdmin.features) f.properties = { district: cfg.districtOf(f.properties) };
    districts = parts(await shape(homeAdmin, `-dissolve district ${area()} -innerlines`));
  }

  const riverFeatures = [];
  const riverSources = [SOURCES.rivers, ...(cfg.europeanRivers === false ? [] : [SOURCES.riversEurope])];
  for (const src of riverSources) {
    const fc = await source(src);
    const kept = filterFeatures(fc, (f) => (f.properties.scalerank ?? 10) <= (cfg.riverMaxRank ?? 99));
    for (const f of (await shape(kept, area(false))).features ?? []) {
      // scalerank: lower = more important river -> drawn wider.
      const rank = f.properties.scalerank ?? 10;
      riverFeatures.push({ type: 'Feature', properties: { r: rank }, geometry: f.geometry });
    }
  }

  const lakeFeatures = [];
  const lakeSources = [SOURCES.lakes, ...(cfg.europeanRivers === false ? [] : [SOURCES.lakesEurope])];
  for (const src of lakeSources) {
    const fc = await source(src);
    const kept = filterFeatures(fc, (f) => (f.properties.scalerank ?? 10) <= (cfg.lakeMaxRank ?? 99));
    lakeFeatures.push(...((await shape(kept, area())).features ?? []).filter((f) => f.geometry));
  }

  const riverSplit = await splitByHome(riverFeatures, home);
  const lakeSplit = await splitByHome(lakeFeatures, home);
  const riverList = (fc) =>
    (fc.features ?? []).flatMap((f) => parts({ features: [f] }).map((l) => ({ r: f.properties?.r ?? 10, l })));

  const out = {
    bbox: cfg.bbox,
    ...(proj ? { projection: proj } : {}),
    home: parts(home),
    neighbours: parts(neighbours),
    districts,
    // Inside the playable area (drawn bright) and outside it (drawn muted).
    rivers: riverList(riverSplit.inside),
    riversOutside: riverList(riverSplit.outside),
    lakes: parts(lakeSplit.inside),
    lakesOutside: parts(lakeSplit.outside),
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

// Dutch provinces: the province is the playable area, the rest of the Netherlands is shown
// like a neighbouring country. The bbox is derived from the province's shape.
for (const p of PROVINCES) {
  MAPS[p.id] = { province: { country: 'NLD', ne: p.ne }, simplify: '100%' };
}

const only = process.argv[2];
for (const [id, cfg] of Object.entries(MAPS)) {
  if (!only || only === id) await buildMap(id, cfg);
}

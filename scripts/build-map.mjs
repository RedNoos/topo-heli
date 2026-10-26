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
import { PROVINCES, SERBIA_REGIONS, GERMANY_REGIONS } from './provinces.mjs';

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
      // Natural Earth names Rasinski "Pomoravski" too.
      if (p.adm0_a3 !== 'KOS') return p.adm1_code === 'SRB-833' ? 'Rasinski' : p.name;
      const d = Object.entries(KOSOVO_DISTRICTS).find(([, list]) => list.includes(p.name));
      if (!d) throw new Error(`Unmapped Kosovo municipality: ${p.name}`);
      return d[0];
    },
    simplify: '45%',
    regions: SERBIA_REGIONS,
  },
  germany: {
    home: ['DEU'],
    bbox: [5.6, 47.1, 15.2, 55.1],
    // Districts are the Länder; the regions group the city states with the Land around them.
    districtOf: (p) => p.name,
    simplify: '45%',
    regions: GERMANY_REGIONS.map((r) => ({ id: r.id, districts: r.lands })),
  },
  netherlands: {
    // Land and province borders from CBS (see cbsLand); province borders drawn as districts.
    cbs: true,
    bbox: [2.9, 50.6, 7.6, 53.75],
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

const PDOK = 'https://service.pdok.nl/cbs';

/** Cached download of a PDOK (CBS) WFS layer as GeoJSON in lon/lat. */
async function pdok(file, url) {
  const p = path.join(CACHE, file);
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    console.log(`  downloading ${file}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`PDOK download failed (${res.status}): ${url}`);
    const text = await res.text();
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(p, text);
    return JSON.parse(text);
  }
}

/**
 * Dutch provinces as land only: CBS province borders minus the CBS "water" neighbourhoods
 * (Westerschelde, Haringvliet, Grevelingen, North Sea strip, …), so islands are separate.
 * Data: CBS / Kadaster via PDOK (CC BY 4.0).
 */
/** @param interval simplification in metres: finer for province maps (zoomed in) than for the country. */
async function cbsLand(interval) {
  const cachedFile = path.join(CACHE, `cbs-province-land-${interval}.json`);
  try {
    return JSON.parse(await fs.readFile(cachedFile, 'utf8'));
  } catch {
    /* build below */
  }
  const wfs = (service, layer, extra = '') =>
    `${PDOK}/${service}/2024/wfs/v1_0?service=WFS&version=2.0.0&request=GetFeature&typeNames=${layer}&outputFormat=application/json&srsName=EPSG:4326&count=5000${extra}`;
  const provinces = await pdok('cbs-provincie-2024.json', wfs('gebiedsindelingen', 'gebiedsindelingen:provincie_gegeneraliseerd'));
  const filter = encodeURIComponent('<Filter xmlns="http://www.opengis.net/fes/2.0"><PropertyIsEqualTo><ValueReference>water</ValueReference><Literal>JA</Literal></PropertyIsEqualTo></Filter>');
  const water = await pdok('cbs-waterbuurten-2024.json', wfs('wijkenbuurten', 'wijkenbuurten:buurten', `&filter=${filter}`));
  // (field 'prov': mapshaper reads 'name' as an option keyword)
  for (const f of provinces.features) f.properties = { prov: f.properties.statnaam };
  for (const f of water.features) f.properties = {};
  const out = await mapshaper.applyCommands(
    `-i prov.json -erase water.json -simplify interval=${interval} keep-shapes -filter-islands min-area=0.1km2 -filter-slivers -o out.json format=geojson`,
    { 'prov.json': provinces, 'water.json': water },
  );
  const land = JSON.parse(out['out.json']);
  await fs.writeFile(cachedFile, JSON.stringify(land));
  return land;
}

/**
 * Netherlands from CBS: the whole country, or one province with the other provinces shown as
 * surroundings. Neighbouring countries come from Natural Earth, grown by 1.5 km so they reach
 * under the (more precise) Dutch border instead of leaving gaps.
 */
async function cbsShapes(cfg) {
  // One screen pixel is ~200 m on the country map and ~115 m on a province map.
  const land = await cbsLand(cfg.province ? 80 : 150);
  const isHome = (f) => !cfg.province || f.properties.prov === cfg.province;
  const home = land.features.filter(isHome).map((f) => ({ ...f, properties: { code: 'HOME', home: true, prov: f.properties.prov } }));
  if (!home.length) throw new Error(`CBS province not found: ${cfg.province}`);
  const rest = land.features.filter((f) => !isHome(f)).map((f) => ({ ...f, properties: { code: 'REST', home: false } }));
  if (!cfg.bbox) {
    // Province bbox plus a margin (~15 km) of surroundings.
    const [w, s, e, n] = boundsOf(home);
    cfg.bbox = [w - 0.22, s - 0.14, e + 0.22, n + 0.14].map((v) => +v.toFixed(3));
  }
  const [w, s, e, n] = cfg.bbox;
  const countries = await source(SOURCES.countries);
  const others = filterFeatures(countries, (f) => f.properties.ADM0_A3 !== 'NLD');
  const grown = await shape(others, `-clip bbox=${[w - 0.6, s - 0.6, e + 0.6, n + 0.6].join(',')} -buffer radius=1.5km`);
  const neighbours = [...rest, ...(grown.features ?? []).map((f) => ({ ...f, properties: { code: 'OTHER', home: false } }))];
  return { home, neighbours, provinces: cfg.province ? null : land };
}

/**
 * A region (Serbian, German): its districts are the playable area, the rest of the country is
 * shown like a neighbouring country (as for the Dutch provinces).
 */
async function regionShapes(cfg) {
  const country = MAPS[cfg.parent];
  const admin1 = structuredClone(await source(SOURCES.admin1));
  const all = filterFeatures(admin1, (f) => country.home.includes(f.properties.adm0_a3));
  for (const f of all.features) f.properties = { district: country.districtOf(f.properties) };
  const unknown = cfg.districts.filter((d) => !all.features.some((f) => f.properties.district === d));
  if (unknown.length) throw new Error(`Unknown districts: ${unknown.join(', ')}`);
  const isHome = (f) => cfg.districts.includes(f.properties.district);
  const districts = filterFeatures(all, isHome);
  const home = districts.features.map((f) => ({ ...f, properties: { code: 'HOME', home: true } }));
  const rest = all.features.filter((f) => !isHome(f)).map((f) => ({ ...f, properties: { code: 'REST', home: false } }));
  if (!cfg.bbox) {
    // Region bbox plus a margin (~20 km) of surroundings.
    const [w, s, e, n] = boundsOf(home);
    cfg.bbox = [w - 0.25, s - 0.18, e + 0.25, n + 0.18].map((v) => +v.toFixed(3));
  }
  const countries = structuredClone(await source(SOURCES.countries));
  const others = countries.features
    .filter((f) => !country.home.includes(f.properties.ADM0_A3))
    .map((f) => ({ ...f, properties: { code: f.properties.ADM0_A3, home: false } }));
  return { home, neighbours: [...rest, ...others], districts };
}

const boundsOf = (features) => {
  const pts = features.flatMap((f) => parts({ features: [f] }).flat(2));
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
};

async function buildMap(id, cfg) {
  console.log(`Building ${id}`);
  const prov = cfg.cbs ? await cbsShapes(cfg) : cfg.districts ? await regionShapes(cfg) : null;
  const proj = cfg.projection;
  // Map data reaches a bit beyond the playable bbox: the camera may look past the edge (so
  // places near it are not hidden under the HUD), and that strip should still show the map.
  // Provinces are small: on wide screens the view is far wider than the province.
  const DRAW_MARGIN = cfg.province || cfg.districts ? 1.2 : 0.35;
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
  // Borders of the sub-maps (provinces, regions), drawn a bit clearer than districts.
  let regions = [];
  if (prov?.provinces) {
    // Whole Netherlands: province borders.
    regions = parts(await shape(prov.provinces, `-dissolve prov ${area()} -innerlines`));
  } else if (prov?.districts) {
    // Region: the borders of its districts (German regions: Berlin, Hamburg, Bremen).
    districts = parts(await shape(prov.districts, `-dissolve district ${area()} -innerlines`));
  } else if (cfg.districtOf) {
    const admin1 = await source(SOURCES.admin1);
    const homeAdmin = filterFeatures(admin1, (f) => homeTest({ ADM0_A3: f.properties.adm0_a3 }));
    for (const f of homeAdmin.features) f.properties = { district: cfg.districtOf(f.properties) };
    if (!cfg.regions) {
      districts = parts(await shape(homeAdmin, `-dissolve district ${area()} -innerlines`));
    } else {
      // Regions: their borders, and the district borders inside each region (not on top of a
      // region border). Simplified once, so the lines meet exactly.
      const simple = await shape(homeAdmin, `-dissolve district ${area()}`);
      for (const f of simple.features) {
        const r = cfg.regions.find((x) => x.districts.includes(f.properties.district));
        if (!r) throw new Error(`District in no region: ${f.properties.district}`);
        f.properties.region = r.id;
      }
      regions = parts(await shape(simple, '-dissolve region -innerlines'));
      for (const r of cfg.regions) {
        districts.push(...parts(await shape(filterFeatures(simple, (f) => f.properties.region === r.id), '-innerlines')));
      }
    }
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
    lakeFeatures.push(...((await shape(kept, area())).features ?? []).filter((f) => f.geometry).map((f) => ({ ...f, properties: { lid: lakeFeatures.length + Math.random() } })));
  }

  const riverSplit = await splitByHome(riverFeatures, home);
  const lakeSplit = await splitByHome(lakeFeatures, home);
  if (cfg.cbs) {
    // CBS land already leaves out lakes that lie outside it (IJsselmeer…); keep only lakes that
    // lie (almost) wholly inside the land, not the slivers of outside lakes along the shore.
    const area = (fc) => {
      const byLake = new Map();
      for (const f of fc.features ?? []) {
        let a = 0;
        for (const poly of parts({ features: [f] })) {
          for (const [i, ring] of poly.entries()) {
            let r = 0;
            for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) r += (ring[j][0] - ring[k][0]) * (ring[j][1] + ring[k][1]);
            a += (i === 0 ? 1 : -1) * Math.abs(r / 2);
          }
        }
        byLake.set(f.properties?.lid, (byLake.get(f.properties?.lid) ?? 0) + a);
      }
      return byLake;
    };
    const total = area({ features: lakeFeatures });
    const inside = area(lakeSplit.inside);
    lakeSplit.inside.features = lakeSplit.inside.features.filter((f) => (inside.get(f.properties?.lid) ?? 0) >= 0.8 * (total.get(f.properties?.lid) ?? Infinity));
  }
  const riverList = (fc) =>
    (fc.features ?? []).flatMap((f) => parts({ features: [f] }).map((l) => ({ r: f.properties?.r ?? 10, l })));

  const out = {
    bbox: cfg.bbox,
    ...(proj ? { projection: proj } : {}),
    home: parts(home),
    neighbours: parts(neighbours),
    districts,
    ...(regions.length ? { regions } : {}),
    // Inside the playable area (drawn bright) and outside it (drawn muted).
    rivers: riverList(riverSplit.inside),
    riversOutside: riverList(riverSplit.outside),
    lakes: parts(lakeSplit.inside),
    // CBS maps: the land shape already leaves out the big lakes (IJsselmeer…); Natural Earth's
    // coarser version on top would only blur the shoreline. Lakes inside the land stay.
    lakesOutside: cfg.cbs ? [] : parts(lakeSplit.outside),
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
  MAPS[p.id] = { cbs: true, province: p.cbs, simplify: '100%' };
}

// Serbian regions: a group of districts is the playable area, the rest of Serbia is shown
// like a neighbouring country.
for (const r of SERBIA_REGIONS) {
  MAPS[r.id] = { parent: 'serbia', districts: r.districts, simplify: '70%' };
}
// German regions: a Land (with a city state inside it), the rest of Germany around it.
for (const r of GERMANY_REGIONS) {
  MAPS[r.id] = { parent: 'germany', districts: r.lands, simplify: '70%' };
}

const only = process.argv[2];
for (const [id, cfg] of Object.entries(MAPS)) {
  if (!only || only === id) await buildMap(id, cfg);
}

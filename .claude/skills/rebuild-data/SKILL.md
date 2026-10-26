---
name: rebuild-data
description: Rebuild Topo Heli's generated map data (geo, places, physical features, province files) after changing data/, scripts/build-*.mjs or scripts/provinces.mjs, and verify the result.
---

1. Run only what the change needs, always in this order (later steps use earlier output):
   - `npm run build:map [-- <id>]`: map shapes (geo.json); rarely needed.
   - `npm run build:places`: Dutch place lists and `src/maps/nl-provinces.json` (it rewrites the
     manifest, so step 3 must follow), the Serbian region lists + `src/maps/rs-regions.json`, and
     the German places, regions (`src/maps/de-regions.json`) and names (`germany/names.*.json`).
   - `npm run build:physical [-- netherlands | provinces | serbia | regions | germany | de-regions]`:
     rivers, lakes, areas, ...; the province run also writes the `areas` flags into
     `nl-provinces.json`; `regions` / `de-regions` cut the Serbian / German regions from the
     country's data (`serbia` / `germany` rebuild both).
2. Read the summary lines the scripts print (per province: places, rivers, waters, areas) and
   compare them with before; `! ... not found` lines mean an Overpass name or query no longer matches.
3. Overpass results are cached in `.cache/` by name: when a query changes, bump the cache key
   version (or copy the old file if the query is identical); Overpass sometimes returns 500s,
   so retry later instead of changing the query.
4. `git diff --stat src/maps` should only touch the files you expected; then `npm run build`
   and `npm run playtest -- --map <affected map> --mode list` (or `physical`).

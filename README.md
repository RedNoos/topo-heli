# Topo Heli

A browser topography game: fly a helicopter over a map and find as many cities as you can before time runs out.

```sh
npm install
npm run dev      # http://localhost:5173
npm run dev:lan  # http://localhost:5180, also reachable from a phone on the same network
npm run build    # static site in dist/

# with dev:lan running (needs Google Chrome):
npm run playtest # plays a map through and reports problems
npm run shots    # screenshots of menu, game and end screen (desktop + phone) in .shots/
```

## How it plays

- Arrow keys / WASD to fly. On touch screens, drag anywhere to get a virtual joystick.
- Fly within range of the city and a flashing dot appears; fly over it to score.
- You start with 3:00. Every 10 cities: +1:00 and the next level. Each level adds smaller towns
  to the pool and the dot appears later (smaller reveal radius).
- `N` skips a city (−10 s), `P`/`Esc` pauses, `M` toggles sound.

**Mountains, rivers & lakes** (Serbia) / **Waters** (Netherlands and provinces: rivers, canals, lakes and seas from the basislijst topografie) / **Mountains, waters & areas** (Germany: also the Länder, landscapes and islands); switch on the start screen: physical features are mixed in
with the cities. Lakes and mountains are found by flying over them. Rivers are found by *following*
them: the bar fills with the length of river you have flown along (40 km, or 60% of a short river);
simply crossing a river covers only ~8 km. Best scores are kept per map and mode.

**Languages:** English, Dutch, Serbian Latin and Serbian Cyrillic (flag menu on the start screen;
the default follows the browser's language list, falling back to English). UI text
lives in [src/i18n.ts](src/i18n.ts); Serbian is written once in Latin script and transliterated to
Cyrillic. Place names: Serbia uses its (Serbian Latin) names, Europe has Serbian and Dutch names in
`src/maps/europe/names.sr.json` / `names.nl.json`, Dutch town names are kept as-is, Germany uses
German names with English, Dutch and Serbian ones in `src/maps/germany/names.{en,nl,sr}.json`.

Tuning lives in [src/config.ts](src/config.ts).

**Provinces** (Netherlands) / **regions** (Serbia, Germany): pick one in the list under the map
buttons to play only that part: its map, its places (capital always in level 1) and, where there
are any, its rivers. German regions are the Länder, with Hamburg, Bremen and Berlin inside the Land
around them.

## Adding a map

1. Add an entry to `MAPS` in [scripts/build-map.mjs](scripts/build-map.mjs): the Natural Earth
   country codes that form the playable area, a bounding box, and how to group the internal
   borders.
2. Run `npm run build:map -- <id>`. This downloads Natural Earth data into `.cache/` and writes
   `src/maps/<id>/geo.json`.
   Optional settings there: `projection` (equal-area, for large regions), `colorCountries`
   (a colour per country with clear borders) and `merge` (draw a territory as part of a country).
3. Add `src/maps/<id>/cities.json`: `{ name, lat, lon, pop, level? }`. Population decides which
   cities appear at which level; `level` puts a city in play from that level regardless of size
   (used for capitals).
4. Register the map in [src/maps/index.ts](src/maps/index.ts) (`viewKm` sets the zoom level:
   larger regions want a larger value).

## Physical features

Dutch places and provinces: the curated list is [data/netherlands-cities.json](data/netherlands-cities.json);
`npm run build:places` adds municipality seats (OpenStreetMap) and villages of 2,000+ inhabitants
(GeoNames) and writes the per-province lists. In the whole-country map the added places only come
up from level 6. Build order after changing map data: `build:map` → `build:places` → `build:physical`.
Province definitions: [scripts/provinces.mjs](scripts/provinces.mjs).

German places: towns and cities from OpenStreetMap (population from GeoNames where OSM has none),
20,000+ inhabitants on the whole map, 10,000+ on the region maps. The *Find them all* list (60
places, with 40 waters, mountains and areas: 100 names) and the translated names are in
[data/germany.json](data/germany.json); the places are based on the TopoSite list of Germany.



`npm run build:physical` queries OpenStreetMap (Overpass API) for the rivers, lakes and peaks
listed in [scripts/build-physical.mjs](scripts/build-physical.mjs) and writes
`src/maps/<id>/physical.json`. Each feature has a `level` that decides when it can be asked.

## Credits

Inspired by *Topografie Nederland* (Radarsoft, Commodore 64, 1984), whose helicopter game had
the same idea: fly to a named place before time runs out; it appears as a pulsing dot once you
are close.

## Data

- Borders, rivers and lakes: [Natural Earth](https://www.naturalearthdata.com/) (public domain).
  The Europe map uses the internationally recognised borders (Natural Earth's German point of
  view), with Kosovo drawn as part of Serbia on every map.
- Rivers, lakes and peaks, and the German towns and cities: [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors (ODbL).
- Dutch coastline and province borders: CBS / Kadaster via [PDOK](https://www.pdok.nl/) (CC BY 4.0):
  province areas minus the CBS "water" neighbourhoods, so islands and estuaries are separate.
- City coordinates: [GeoNames](https://www.geonames.org/) (CC BY 4.0); for Germany only the population
  where OSM has none. Populations are rounded approximations.

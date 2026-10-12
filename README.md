# Topo Heli

A browser topography game: fly a helicopter over a map and find as many cities as you can before time runs out.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## How it plays

- Arrow keys / WASD to fly. On touch screens, drag anywhere to get a virtual joystick.
- Fly within range of the city and a flashing dot appears; fly over it to score.
- You start with 3:00. Every 10 cities: +1:00 and the next level. Each level adds smaller towns
  to the pool and the dot appears later (smaller reveal radius).
- `N` skips a city (−10 s), `P`/`Esc` pauses, `M` toggles sound.

Tuning lives in [src/config.ts](src/config.ts).

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

## Data

- Borders, rivers and lakes: [Natural Earth](https://www.naturalearthdata.com/) (public domain).
  The Europe map uses the internationally recognised borders (Natural Earth's German point of
  view), with Kosovo drawn as part of Serbia on every map.
- City coordinates: [GeoNames](https://www.geonames.org/) (CC BY 4.0). Populations are rounded
  approximations.

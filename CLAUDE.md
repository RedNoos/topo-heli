# Topo Heli

Browser topography game: fly a helicopter to named places on a map. Vite 6 + TypeScript + Canvas 2D,
no framework. Maps: Serbia (Kosovo as part of Serbia; whole country + 6 region maps), the Netherlands
(whole country + 12 province maps) and Europe. UI in English, Dutch, Serbian Latin and Serbian Cyrillic.

Live at https://topoheli.com/ (custom domain, registered at Porkbun; public repo RedNoos/topo-heli;
the old https://rednoos.github.io/topo-heli/ redirects there). Every push to `main`
deploys via `.github/workflows/deploy.yml` (GitHub Pages).

## Working agreements

- **Test locally first; push only when the user says "push".** Commit locally after each finished
  change; after a push, wait for the Pages run (`gh run watch`) and report the result.
- Commits use the GitHub noreply address of RedNoos (already the repo's `user.email`); never a work email.
- The user tests on desktop and phone: dev server `npm run dev:lan` → http://localhost:5180/ and
  http://<LAN-IP>:5180/. Keep it running in the background.
- Every UI text in all four languages (see i18n below). Answer the user in the language they write in.
- Check UI changes on desktop and phone with `npm run shots` before reporting them done.

## Skills

`.claude/skills/`: `deploy` (push + Pages run), `check-ui` (screenshots + playtest), `add-text`
(texts in four languages), `rebuild-data` (data builds in the right order, with checks).

## Layout

- `src/main.ts`: menu, HUD, end screens, options (stored in localStorage `topo-heli:*`), stats.
- `src/game.ts`: game state, target picking (levels, "Alles vinden"/practice mode), found rules.
- `src/targets.ts`: target kinds (city, mountain, lake, river, area, landmark) and distances.
- `src/renderer.ts`: canvas drawing (map layers as Path2D in km coordinates, targets, minimap).
- `src/config.ts`: all gameplay tuning (times, radii, river follow length, area depth, ...).
- `src/i18n.ts`: UI texts. `en` defines the keys; `nl` and `srLatn` must have all of them.
  Serbian is written once in Latin and transliterated to Cyrillic (tags, `{params}` and `&entities;`
  are skipped, so pass untranslatable names such as *basislijst topografie* as a `{param}`).
- `src/feedback.ts`: Tally feedback forms, one per language (script loaded on first click).
- `src/stats.ts`: GoatCounter events (production only).
- `src/maps/index.ts`: map definitions (`MapDefinition` in `src/maps/types.ts`); province maps come
  from `src/maps/nl-provinces.json`, Serbian region maps from `src/maps/rs-regions.json`.
- Generated data (do not edit by hand): `src/maps/<id>/{geo,cities,physical}.json` (except
  `serbia/cities.json`, curated), `nl-provinces.json`, `rs-regions.json`.

## Data builds

Order: `npm run build:map` → `npm run build:places` → `npm run build:physical`
(`build:physical -- provinces` rebuilds only the province files; it also writes the `areas` flags
into `nl-provinces.json`, so always run it after `build:places`; `-- regions` rebuilds only the
Serbian region files).

- Sources: Natural Earth, CBS/PDOK (Dutch provinces, municipalities), OpenStreetMap via Overpass,
  GeoNames. Downloads are cached in `.cache/`. The Overpass cache is keyed by name: bump the key
  version when a query changes (or copy the old cache file if the query is identical).
- Curated input in `data/`:
  - `netherlands-cities.json`: Dutch places; `level` ≤ 2 = the 60 basislijst places (`core`).
  - `province-lists.json`: per province the well-known places added in "Alles vinden"
    (from TopoSite, up to 20 places, Flevoland 12).
- `scripts/provinces.mjs`: province settings (CBS name, capital, `minPop`, `time`, `skipPhysical`)
  and the Serbian regions (`SERBIA_REGIONS`: districts, capital, name key). Region places are
  split from `serbia/cities.json`, region physical data is cut from Serbia's.
- `scripts/build-physical.mjs`: per-map config of rivers, lakes, mountains, `zones` (areas),
  `landmarks`, `lines`, `waterAreas` and `core` (basislijst names). mapshaper gotchas: a field
  called `name` clashes with its `name=` option; attribute-less output is a GeometryCollection.

## Testing

- `npm run build` (tsc + vite) must pass.
- `npm run playtest -- --map <id> --mode free|physical|list`: plays a map through by teleporting to
  each target; reports targets that cannot be found and page errors.
- `npm run shots -- --map <id> --mode ... --lang nl|en|sr-Latn|sr-Cyrl`: menu, game and end
  screen on desktop and phone into `.shots/` (gitignored). Read the PNGs to check.
- In the dev build `window.__game()` and `window.__renderer()` expose the live game for scripts.

## Conventions

- LF line endings everywhere (`.gitattributes`, `.editorconfig`).
- Match the surrounding style: short doc comments on exported things, no framework, no new
  dependencies without asking. Physical data loads lazily (only when its mode is on).

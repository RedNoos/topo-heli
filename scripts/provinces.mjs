// Dutch provinces, used to build one map per province (build-map, build-places, build-physical).
// `cbs` is the CBS (statistics Netherlands) province name, `ne` the Natural Earth admin-1 name, `capital` the provincial capital (always in level 1),
// `abbr` the usual abbreviation used to tell same-named places apart, e.g. "Hengelo (O)".
// Optional: `minPop` = also villages from this size (default 2000; small provinces need more
// places), `time` = start time and time bonus per level in seconds (default 180 / 60).

export const PROVINCES = [
  { id: 'nl-groningen', name: 'Groningen', cbs: 'Groningen', ne: 'Groningen', capital: 'Groningen', abbr: 'Gr' },
  { id: 'nl-friesland', name: 'Friesland', cbs: 'Fryslân', ne: 'Friesland', capital: 'Leeuwarden', abbr: 'Fr' },
  { id: 'nl-drenthe', name: 'Drenthe', cbs: 'Drenthe', ne: 'Drenthe', capital: 'Assen', abbr: 'Dr' },
  { id: 'nl-overijssel', name: 'Overijssel', cbs: 'Overijssel', ne: 'Overijssel', capital: 'Zwolle', abbr: 'O' },
  { id: 'nl-flevoland', name: 'Flevoland', cbs: 'Flevoland', ne: 'Flevoland', capital: 'Lelystad', abbr: 'Fl', minPop: 0, time: { start: 120, levelBonus: 30 } },
  { id: 'nl-gelderland', name: 'Gelderland', cbs: 'Gelderland', ne: 'Gelderland', capital: 'Arnhem', abbr: 'Gld' },
  { id: 'nl-utrecht', name: 'Utrecht', cbs: 'Utrecht', ne: 'Utrecht', capital: 'Utrecht', abbr: 'U' },
  { id: 'nl-noord-holland', name: 'Noord-Holland', cbs: 'Noord-Holland', ne: 'Noord-Holland', capital: 'Haarlem', abbr: 'NH' },
  { id: 'nl-zuid-holland', name: 'Zuid-Holland', cbs: 'Zuid-Holland', ne: 'Zuid-Holland', capital: 'Den Haag', abbr: 'ZH' },
  { id: 'nl-zeeland', name: 'Zeeland', cbs: 'Zeeland', ne: 'Zeeland', capital: 'Middelburg', abbr: 'Z' },
  { id: 'nl-noord-brabant', name: 'Noord-Brabant', cbs: 'Noord-Brabant', ne: 'Noord-Brabant', capital: "'s-Hertogenbosch", abbr: 'NB', skipPhysical: ['Oosterschelde'] },
  { id: 'nl-limburg', name: 'Limburg', cbs: 'Limburg', ne: 'Limburg', capital: 'Maastricht', abbr: 'L' },
];

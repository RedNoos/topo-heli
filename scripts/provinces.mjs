// Dutch provinces, used to build one map per province (build-map, build-places, build-physical).
// `ne` is the Natural Earth admin-1 name, `capital` the provincial capital (always in level 1),
// `abbr` the usual abbreviation used to tell same-named places apart, e.g. "Hengelo (O)".

export const PROVINCES = [
  { id: 'nl-groningen', name: 'Groningen', ne: 'Groningen', capital: 'Groningen', abbr: 'Gr' },
  { id: 'nl-friesland', name: 'Friesland', ne: 'Friesland', capital: 'Leeuwarden', abbr: 'Fr' },
  { id: 'nl-drenthe', name: 'Drenthe', ne: 'Drenthe', capital: 'Assen', abbr: 'Dr' },
  { id: 'nl-overijssel', name: 'Overijssel', ne: 'Overijssel', capital: 'Zwolle', abbr: 'O' },
  { id: 'nl-flevoland', name: 'Flevoland', ne: 'Flevoland', capital: 'Lelystad', abbr: 'Fl' },
  { id: 'nl-gelderland', name: 'Gelderland', ne: 'Gelderland', capital: 'Arnhem', abbr: 'Gld' },
  { id: 'nl-utrecht', name: 'Utrecht', ne: 'Utrecht', capital: 'Utrecht', abbr: 'U' },
  { id: 'nl-noord-holland', name: 'Noord-Holland', ne: 'Noord-Holland', capital: 'Haarlem', abbr: 'NH' },
  { id: 'nl-zuid-holland', name: 'Zuid-Holland', ne: 'Zuid-Holland', capital: 'Den Haag', abbr: 'ZH' },
  { id: 'nl-zeeland', name: 'Zeeland', ne: 'Zeeland', capital: 'Middelburg', abbr: 'Z' },
  { id: 'nl-noord-brabant', name: 'Noord-Brabant', ne: 'Noord-Brabant', capital: "'s-Hertogenbosch", abbr: 'NB' },
  { id: 'nl-limburg', name: 'Limburg', ne: 'Limburg', capital: 'Maastricht', abbr: 'L' },
];

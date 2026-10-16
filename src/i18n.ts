/**
 * UI language: English, Dutch, Serbian Latin and Serbian Cyrillic.
 *
 * Serbian is written once, in Latin script; Cyrillic is derived by
 * transliteration (Serbian Latin <-> Cyrillic is one-to-one). Text inside
 * HTML tags and {placeholders} is never transliterated.
 */

export type Lang = 'en' | 'nl' | 'sr-Latn' | 'sr-Cyrl';

type Flag = 'gb' | 'nl' | 'rs';

export const LANGS: { id: Lang; short: string; label: string; flag: Flag }[] = [
  { id: 'en', short: 'EN', label: 'English', flag: 'gb' },
  { id: 'nl', short: 'NL', label: 'Nederlands', flag: 'nl' },
  { id: 'sr-Latn', short: 'SR', label: 'Srpski (latinica)', flag: 'rs' },
  { id: 'sr-Cyrl', short: 'СР', label: 'Српски (ћирилица)', flag: 'rs' },
];

const en = {
  subtitle: 'Fly your helicopter to as many cities as you can before time runs out.',
  physicalOption: 'Mountains, rivers &amp; lakes',
  physicalOptionRivers: 'Rivers',
  start: 'Start',
  howtoFly: '<b>Fly</b> with the arrow keys / {keys}, or drag anywhere on a touch screen.',
  howtoFlash: 'Get close and the city starts <b>flashing</b>. Fly right over it.',
  howtoLevels: 'Every <b>10 cities</b>: +1:00, but smaller towns and less help.',
  howtoPhysical: '<b>Rivers:</b> fly <i>along</i> the river until the bar is full. Lakes and mountains: fly over them.',
  howtoPhysicalRivers: '<b>Rivers:</b> fly <i>along</i> the river until the bar is full.',
  best: 'Best on {map}: {n} found',
  bestPhysical: 'Best on {map} (with mountains, rivers &amp; lakes): {n} found',
  bestPhysicalRivers: 'Best on {map} (with rivers): {n} found',
  flyTo: 'Fly to',
  flyToRiver: 'Fly to the river',
  flyToLake: 'Fly to the lake',
  flyToMountain: 'Fly to the mountain',
  kindRiver: 'river',
  kindLake: 'lake',
  kindMountain: 'mountain',
  found: 'found',
  level: 'Level',
  pause: 'Pause',
  skip: 'Skip −10s',
  soundOn: 'Sound on',
  soundOff: 'Sound off',
  hintCity: 'Close! Find the flashing dot',
  hintRiver: 'Close! Follow the glowing river',
  hintLake: 'Close! Fly over the flashing lake',
  hintMountain: 'Close! Find the flashing peak',
  followRiver: 'Follow the river: {p}%',
  levelUp: 'Level {n}! +{bonus}',
  levelUpDetail: 'Smaller towns, and the dot shows up later',
  levelUpDetailPhysical: 'Lesser-known places, and they show up later',
  paused: 'Paused',
  resume: 'Resume',
  quit: 'Quit to menu',
  timeUp: "Time's up!",
  placesFoundOne: 'place found',
  placesFoundFew: 'places found',
  placesFoundMany: 'places found',
  newBest: 'New best score!',
  bestShort: 'Best: {n}',
  lastOne: 'The last one was {name}.',
  playAgain: 'Play again',
  menu: 'Menu',
  language: 'Language',
  mapSerbia: 'Serbia',
  mapNetherlands: 'Netherlands',
  mapEurope: 'Europe',
  region: 'Province',
  regionAll: 'All of the Netherlands',
  credits: 'Map data: © {osm} contributors, {ne}, {gn}, {cbs}',
  inspiredBy: 'Inspired by {game} ({maker}, {platform}, 1984)',
  privacy: 'Anonymous visitor statistics via {goatcounter}, without cookies.',
};

export type StringKey = keyof typeof en;

const nl: Record<StringKey, string> = {
  subtitle: 'Vlieg met je helikopter naar zoveel mogelijk steden voordat de tijd om is.',
  physicalOption: 'Bergen, rivieren &amp; meren',
  physicalOptionRivers: 'Rivieren',
  start: 'Start',
  howtoFly: '<b>Vliegen</b> met de pijltjestoetsen / {keys}, of sleep met je vinger over het scherm.',
  howtoFlash: 'Kom je dichtbij, dan gaat de stad <b>knipperen</b>. Vlieg er precies overheen.',
  howtoLevels: 'Elke <b>10 steden</b>: +1:00, maar kleinere plaatsen en minder hulp.',
  howtoPhysical: '<b>Rivieren:</b> vlieg <i>langs</i> de rivier tot de balk vol is. Meren en bergen: vlieg eroverheen.',
  howtoPhysicalRivers: '<b>Rivieren:</b> vlieg <i>langs</i> de rivier tot de balk vol is.',
  best: 'Record op {map}: {n} gevonden',
  bestPhysical: 'Record op {map} (met bergen, rivieren &amp; meren): {n} gevonden',
  bestPhysicalRivers: 'Record op {map} (met rivieren): {n} gevonden',
  flyTo: 'Vlieg naar',
  flyToRiver: 'Vlieg naar de rivier',
  flyToLake: 'Vlieg naar het meer',
  flyToMountain: 'Vlieg naar de berg',
  kindRiver: 'rivier',
  kindLake: 'meer',
  kindMountain: 'berg',
  found: 'gevonden',
  level: 'Niveau',
  pause: 'Pauze',
  skip: 'Overslaan −10s',
  soundOn: 'Geluid aan',
  soundOff: 'Geluid uit',
  hintCity: 'Dichtbij! Zoek de knipperende stip',
  hintRiver: 'Dichtbij! Volg de oplichtende rivier',
  hintLake: 'Dichtbij! Vlieg over het knipperende meer',
  hintMountain: 'Dichtbij! Zoek de knipperende top',
  followRiver: 'Volg de rivier: {p}%',
  levelUp: 'Niveau {n}! +{bonus}',
  levelUpDetail: 'Kleinere plaatsen, en de stip verschijnt later',
  levelUpDetailPhysical: 'Minder bekende plaatsen, en ze verschijnen later',
  paused: 'Gepauzeerd',
  resume: 'Verder',
  quit: 'Naar het menu',
  timeUp: 'De tijd is om!',
  placesFoundOne: 'plaats gevonden',
  placesFoundFew: 'plaatsen gevonden',
  placesFoundMany: 'plaatsen gevonden',
  newBest: 'Nieuw record!',
  bestShort: 'Record: {n}',
  lastOne: 'De laatste was {name}.',
  playAgain: 'Opnieuw spelen',
  menu: 'Menu',
  language: 'Taal',
  mapSerbia: 'Servië',
  mapNetherlands: 'Nederland',
  mapEurope: 'Europa',
  region: 'Provincie',
  regionAll: 'Heel Nederland',
  credits: 'Kaartgegevens: © {osm}-bijdragers, {ne}, {gn}, {cbs}',
  inspiredBy: 'Geïnspireerd op {game} ({maker}, {platform}, 1984)',
  privacy: 'Anonieme bezoekersstatistieken via {goatcounter}, zonder cookies.',
};

const srLatn: Record<StringKey, string> = {
  subtitle: 'Leti helikopterom do što više gradova pre nego što istekne vreme.',
  physicalOption: 'Planine, reke i jezera',
  physicalOptionRivers: 'Reke',
  start: 'Počni',
  howtoFly: '<b>Letiš</b> strelicama / {keys}, ili prevlačenjem prsta po ekranu.',
  howtoFlash: 'Kad se približiš, grad počinje da <b>treperi</b>. Preleti tačno preko njega.',
  howtoLevels: 'Na svakih <b>10 gradova</b>: +1:00, ali manja mesta i manje pomoći.',
  howtoPhysical: '<b>Reke:</b> leti <i>duž</i> reke dok se traka ne napuni. Jezera i planine: preleti preko njih.',
  howtoPhysicalRivers: '<b>Reke:</b> leti <i>duž</i> reke dok se traka ne napuni.',
  best: 'Rekord ({map}): {n} pronađeno',
  bestPhysical: 'Rekord ({map}, sa planinama, rekama i jezerima): {n} pronađeno',
  bestPhysicalRivers: 'Rekord ({map}, sa rekama): {n} pronađeno',
  flyTo: 'Leti do',
  flyToRiver: 'Leti do reke',
  flyToLake: 'Leti do jezera',
  flyToMountain: 'Leti do planine',
  kindRiver: 'reka',
  kindLake: 'jezero',
  kindMountain: 'planina',
  found: 'pronađeno',
  level: 'Nivo',
  pause: 'Pauza',
  skip: 'Preskoči −10s',
  soundOn: 'Zvuk uključen',
  soundOff: 'Zvuk isključen',
  hintCity: 'Blizu si! Nađi tačku koja treperi',
  hintRiver: 'Blizu si! Prati reku koja svetli',
  hintLake: 'Blizu si! Preleti preko jezera koje treperi',
  hintMountain: 'Blizu si! Nađi vrh koji treperi',
  followRiver: 'Prati reku: {p}%',
  levelUp: 'Nivo {n}! +{bonus}',
  levelUpDetail: 'Manja mesta, a tačka se pojavljuje kasnije',
  levelUpDetailPhysical: 'Manje poznata mesta, koja se pojavljuju kasnije',
  paused: 'Pauza',
  resume: 'Nastavi',
  quit: 'Izlaz u meni',
  timeUp: 'Vreme je isteklo!',
  placesFoundOne: 'pronađeno mesto',
  placesFoundFew: 'pronađena mesta',
  placesFoundMany: 'pronađenih mesta',
  newBest: 'Novi rekord!',
  bestShort: 'Rekord: {n}',
  lastOne: 'Poslednje mesto: {name}.',
  playAgain: 'Igraj ponovo',
  menu: 'Meni',
  language: 'Jezik',
  mapSerbia: 'Srbija',
  mapNetherlands: 'Holandija',
  mapEurope: 'Evropa',
  region: 'Provincija',
  regionAll: 'Cela Holandija',
  credits: 'Podaci za mape: © saradnici {osm}, {ne}, {gn}, {cbs}',
  inspiredBy: 'Inspirisano igrom {game} ({maker}, {platform}, 1984)',
  privacy: 'Anonimna statistika poseta preko {goatcounter}, bez kolačića.',
};

// ---------- Transliteration ----------

const LAT_TO_CYR: [string, string][] = [
  ['dž', 'џ'], ['lj', 'љ'], ['nj', 'њ'], ['a', 'а'], ['b', 'б'], ['c', 'ц'], ['č', 'ч'], ['ć', 'ћ'], ['d', 'д'],
  ['đ', 'ђ'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'], ['j', 'ј'], ['k', 'к'], ['l', 'л'],
  ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['š', 'ш'], ['t', 'т'], ['u', 'у'],
  ['v', 'в'], ['z', 'з'], ['ž', 'ж'],
];
const CYR_TO_LAT = new Map(LAT_TO_CYR.map(([l, c]) => [c, l]));

/** Serbian Latin -> Cyrillic. Skips HTML tags, {placeholders} and &entities;. */
export function toCyrillic(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    const close = ch === '<' ? '>' : ch === '{' ? '}' : ch === '&' ? ';' : null;
    if (close) {
      const end = s.indexOf(close, i);
      if (end > i) {
        out += s.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    const rest = s.slice(i, i + 2).toLowerCase();
    const hit = LAT_TO_CYR.find(([l]) => rest.startsWith(l));
    if (!hit) {
      out += ch;
      i++;
      continue;
    }
    const upper = ch !== ch.toLowerCase();
    out += upper ? hit[1].toUpperCase() : hit[1];
    i += hit[0].length;
  }
  return out;
}

/** Serbian Cyrillic -> Latin. */
export function toLatin(s: string): string {
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const lat = CYR_TO_LAT.get(lower);
    if (!lat) out += ch;
    else if (ch === lower) out += lat;
    else out += lat[0].toUpperCase() + lat.slice(1); // Љ -> Lj
  }
  return out;
}

// ---------- State ----------

const STORAGE_KEY = 'topo-heli:lang';
let lang: Lang = detect();
const listeners: (() => void)[] = [];

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGS.some((l) => l.id === saved)) return saved as Lang;
  } catch {
    /* no storage */
  }
  return fromBrowser(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

/**
 * First supported language in the browser's preference list; English otherwise.
 * Serbian without a script (sr, sr-RS) is Cyrillic, the official script; sr-Latn is Latin.
 */
export function fromBrowser(prefs: readonly string[]): Lang {
  for (const raw of prefs) {
    const p = (raw || '').toLowerCase();
    if (p.startsWith('nl')) return 'nl';
    if (p.startsWith('sr')) return p.includes('latn') ? 'sr-Latn' : 'sr-Cyrl';
    if (p.startsWith('en')) return 'en';
  }
  return 'en';
}

export const getLang = () => lang;

export function setLang(next: Lang) {
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* not remembered */
  }
  document.documentElement.lang = next;
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void) {
  listeners.push(fn);
}

/** Translated string; {name} placeholders are filled from params (never transliterated). */
export function t(key: StringKey, params: Record<string, string | number> = {}): string {
  let s = lang === 'en' ? en[key] : lang === 'nl' ? nl[key] : srLatn[key];
  if (lang === 'sr-Cyrl') s = toCyrillic(s);
  return s.replace(/\{(\w+)\}/g, (m, p: string) => (p in params ? String(params[p]) : m));
}

/**
 * Plural form for a count. Serbian: 1, 21, 31… -> One; 2–4, 22–24… -> Few; others
 * (incl. 11–14) -> Many. English only distinguishes 1.
 */
export function plural(base: 'placesFound', n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const form =
    lang === 'en' || lang === 'nl'
      ? n === 1 ? 'One' : 'Many'
      : mod10 === 1 && mod100 !== 11
        ? 'One'
        : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
          ? 'Few'
          : 'Many';
  return t(`${base}${form}` as StringKey);
}

// ---------- Place names ----------

/**
 * How the current map's place names behave per language:
 * - 'sr-Latn': names are Serbian Latin (shown as-is, transliterated for Cyrillic);
 * - otherwise names are shown as-is, unless `serbian` gives a Serbian (Cyrillic) name.
 */
let nameScript: 'sr-Latn' | 'native' = 'native';
let serbianNames: Record<string, string> = {};
let dutchNames: Record<string, string> = {};

export function setPlaceNames(
  script: 'sr-Latn' | 'native',
  serbian: Record<string, string> = {},
  dutch: Record<string, string> = {},
) {
  nameScript = script;
  serbianNames = serbian;
  dutchNames = dutch;
}

export function placeName(name: string): string {
  if (lang === 'en') return name;
  if (nameScript === 'sr-Latn') return lang === 'sr-Cyrl' ? toCyrillic(name) : name;
  if (lang === 'nl') return dutchNames[name] ?? name;
  const sr = serbianNames[name];
  if (!sr) return name;
  return lang === 'sr-Cyrl' ? sr : toLatin(sr);
}

// ---------- Flags (SVG: flag emoji don't render on Windows) ----------

let flagId = 0;

/**
 * Serbian state flag: red-blue-white with the lesser coat of arms (crowned red shield with
 * a white double-headed eagle), shifted towards the hoist. Simplified to read at ~21×14 px.
 */
const SERBIA_FLAG = (() => {
  const x = 43; // emblem centre: 1/7 of the flag length towards the hoist
  const gold = '#e7b53c';
  return [
    '<svg class="flag" viewBox="0 0 120 80" aria-hidden="true">',
    '<rect width="120" height="80" fill="#fff"/>',
    '<rect width="120" height="53.33" fill="#0c4076"/>',
    '<rect width="120" height="26.67" fill="#c6363c"/>',
    // Crown.
    `<path d="M${x - 12} 20 L${x - 13.5} 11 L${x - 6} 15.5 L${x} 8 L${x + 6} 15.5 L${x + 13.5} 11 L${x + 12} 20 Z" fill="${gold}"/>`,
    `<circle cx="${x}" cy="6.5" r="2" fill="${gold}"/>`,
    // Shield.
    `<path d="M${x - 14} 22 H${x + 14} V46 Q${x + 14} 60 ${x} 67 Q${x - 14} 60 ${x - 14} 46 Z" fill="#c6363c" stroke="${gold}" stroke-width="2"/>`,
    // Double-headed eagle: two heads, spread wings, body and tail.
    `<circle cx="${x - 4}" cy="28.5" r="2.6" fill="#fff"/><circle cx="${x + 4}" cy="28.5" r="2.6" fill="#fff"/>`,
    `<path d="M${x - 11.5} 31 Q${x - 12.5} 41 ${x - 6} 46 L${x - 3} 42 L${x - 3} 53 L${x} 58 L${x + 3} 53 L${x + 3} 42 L${x + 6} 46 Q${x + 12.5} 41 ${x + 11.5} 31 L${x + 5} 35 L${x + 2.5} 30.5 L${x} 33 L${x - 2.5} 30.5 L${x - 5} 35 Z" fill="#fff"/>`,
    '</svg>',
  ].join('');
})();
export function flagSvg(flag: Flag): string {
  if (flag === 'rs') return SERBIA_FLAG;
  if (flag === 'nl') {
    return '<svg class="flag" viewBox="0 0 9 6" aria-hidden="true"><rect width="9" height="6" fill="#21468b"/><rect width="9" height="4" fill="#fff"/><rect width="9" height="2" fill="#ae1c28"/></svg>';
  }
  const id = `gb-clip-${flagId++}`;
  // Stretched to the same 3:2 box as the Serbian flag so the two line up.
  return `<svg class="flag" viewBox="0 0 60 30" preserveAspectRatio="none" aria-hidden="true"><clipPath id="${id}"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath><rect width="60" height="30" fill="#012169"/><path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0L60,30M60,0L0,30" clip-path="url(#${id})" stroke="#c8102e" stroke-width="4"/><path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/><path d="M30,0v30M0,15h60" stroke="#c8102e" stroke-width="6"/></svg>`;
}

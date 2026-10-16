/**
 * UI language: English, Serbian Latin and Serbian Cyrillic.
 *
 * Serbian is written once, in Latin script; Cyrillic is derived by
 * transliteration (Serbian Latin <-> Cyrillic is one-to-one). Text inside
 * HTML tags and {placeholders} is never transliterated.
 */

export type Lang = 'en' | 'sr-Latn' | 'sr-Cyrl';

export const LANGS: { id: Lang; short: string; label: string; flag: 'gb' | 'rs' }[] = [
  { id: 'en', short: 'EN', label: 'English', flag: 'gb' },
  { id: 'sr-Latn', short: 'SR', label: 'Srpski (latinica)', flag: 'rs' },
  { id: 'sr-Cyrl', short: 'СР', label: 'Српски (ћирилица)', flag: 'rs' },
];

const en = {
  subtitle: 'Fly your helicopter to as many cities as you can before time runs out.',
  physicalOption: 'Mountains, rivers &amp; lakes',
  start: 'Start',
  howtoFly: '<b>Fly</b> with the arrow keys / {keys}, or drag anywhere on a touch screen.',
  howtoFlash: 'Get close and the city starts <b>flashing</b>. Fly right over it.',
  howtoLevels: 'Every <b>10 cities</b>: +1:00, but smaller towns and less help.',
  howtoPhysical: '<b>Rivers:</b> fly <i>along</i> the river until the bar is full. Lakes and mountains: fly over them.',
  best: 'Best on {map}: {n} found',
  bestPhysical: 'Best on {map} (with mountains, rivers &amp; lakes): {n} found',
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
  credits: 'Map data: © {osm} contributors, {ne}, {gn}',
};

export type StringKey = keyof typeof en;

const srLatn: Record<StringKey, string> = {
  subtitle: 'Leti helikopterom do što više gradova pre nego što istekne vreme.',
  physicalOption: 'Planine, reke i jezera',
  start: 'Počni',
  howtoFly: '<b>Letiš</b> strelicama / {keys}, ili prevlačenjem prsta po ekranu.',
  howtoFlash: 'Kad se približiš, grad počinje da <b>treperi</b>. Preleti tačno preko njega.',
  howtoLevels: 'Na svakih <b>10 gradova</b>: +1:00, ali manja mesta i manje pomoći.',
  howtoPhysical: '<b>Reke:</b> leti <i>duž</i> reke dok se traka ne napuni. Jezera i planine: preleti preko njih.',
  best: 'Rekord ({map}): {n} pronađeno',
  bestPhysical: 'Rekord ({map}, sa planinama, rekama i jezerima): {n} pronađeno',
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
  credits: 'Podaci za mape: © saradnici {osm}, {ne}, {gn}',
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
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('sr')) return nav.includes('latn') ? 'sr-Latn' : 'sr-Cyrl';
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
  let s = lang === 'en' ? en[key] : srLatn[key];
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
    lang === 'en'
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

export function setPlaceNames(script: 'sr-Latn' | 'native', serbian: Record<string, string> = {}) {
  nameScript = script;
  serbianNames = serbian;
}

export function placeName(name: string): string {
  if (lang === 'en') return name;
  if (nameScript === 'sr-Latn') return lang === 'sr-Cyrl' ? toCyrillic(name) : name;
  const sr = serbianNames[name];
  if (!sr) return name;
  return lang === 'sr-Cyrl' ? sr : toLatin(sr);
}

// ---------- Flags (SVG: flag emoji don't render on Windows) ----------

let flagId = 0;
export function flagSvg(flag: 'gb' | 'rs'): string {
  if (flag === 'rs') {
    return '<svg class="flag" viewBox="0 0 3 2" aria-hidden="true"><rect width="3" height="2" fill="#fff"/><rect width="3" height="1.333" fill="#0c4076"/><rect width="3" height="0.667" fill="#c6363c"/></svg>';
  }
  const id = `gb-clip-${flagId++}`;
  return `<svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><clipPath id="${id}"><path d="M30,15h30v15zv15h-30zh-30v-15zv-15h30z"/></clipPath><rect width="60" height="30" fill="#012169"/><path d="M0,0L60,30M60,0L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0L60,30M60,0L0,30" clip-path="url(#${id})" stroke="#c8102e" stroke-width="4"/><path d="M30,0v30M0,15h60" stroke="#fff" stroke-width="10"/><path d="M30,0v30M0,15h60" stroke="#c8102e" stroke-width="6"/></svg>`;
}

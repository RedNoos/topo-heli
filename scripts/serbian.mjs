// Serbian Latin -> Cyrillic, for the build scripts (the game has its own in src/i18n.ts).

const LAT_CYR = [
  ['dž', 'џ'], ['lj', 'љ'], ['nj', 'њ'], ['a', 'а'], ['b', 'б'], ['c', 'ц'], ['č', 'ч'], ['ć', 'ћ'], ['d', 'д'],
  ['đ', 'ђ'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'], ['j', 'ј'], ['k', 'к'], ['l', 'л'],
  ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['š', 'ш'], ['t', 'т'], ['u', 'у'],
  ['v', 'в'], ['z', 'з'], ['ž', 'ж'],
];

/**
 * Serbian Latin -> Cyrillic. `digraphs: false` for names transcribed from languages where n+j,
 * l+j, d+ž are two sounds (Finnish Kokemäenjoki: Кокеменјоки, not Кокемењоки).
 */
export function toCyrillic(s, { digraphs = true } = {}) {
  const table = digraphs ? LAT_CYR : LAT_CYR.slice(3);
  let out = '';
  for (let i = 0; i < s.length; ) {
    const lower = s.slice(i).toLowerCase();
    const hit = table.find(([l]) => lower.startsWith(l));
    if (!hit) {
      out += s[i++];
      continue;
    }
    const upper = s[i] !== s[i].toLowerCase();
    out += upper ? hit[1].toUpperCase() : hit[1];
    i += hit[0].length;
  }
  return out;
}

/** Latin letters left in a Cyrillic name (a typo in the data, or a letter Serbian has no rule for). */
export const latinLeft = (s) => /[A-Za-zÀ-ɏ]/.test(s.replace(/ \([A-Z]{1,3}\)$/, ''));

/**
 * OSM name:sr without a qualifier the place's own name does not have ("Полковице (Пољска)",
 * "Срем (град)"); kept where the name has one too ("Wetter (Ruhr)": "Ветер (Рур)").
 */
export const osmSerbian = (tags, name) => {
  const sr = tags['name:sr'];
  return sr && !/\)$/.test(name) ? sr.replace(/ \([^)]*\)$/, '') : sr;
};

const FINNISH_LETTERS = { ä: 'e', ö: 'e', y: 'i', å: 'o', w: 'v', x: 'ks', q: 'k', c: 'k' };

/**
 * Finnish name -> Serbian Latin, as Serbian transcribes it: ä, ö -> e, y -> i, long vowels and
 * double consonants single, i after a vowel -> j (Jyväskylä: Jiveskile, Saimaa: Sajma).
 */
export function finnishToSerbian(name) {
  const single = (s) => s.replace(/(\p{L})\1+/giu, '$1');
  let s = [...name]
    .map((ch) => {
      const m = FINNISH_LETTERS[ch.toLowerCase()];
      if (m === undefined) return ch;
      return ch === ch.toLowerCase() ? m : m[0].toUpperCase() + m.slice(1);
    })
    .join('');
  s = single(s)
    .replace(/(?<=[bdfghjklmnprstvz])ie/gi, 'ije')
    .replace(/(?<=[aeiou])i(?![aeiou])/gi, 'j');
  return single(s);
}

/** A Māori name: every word made of open syllables (ng, wh or one consonant, then a vowel). */
export const isMaori = (name) => name.split(/[ -]/).every((w) => /^((ng|wh|[hkmnprtw])?[aeiouāēīōū])+$/i.test(w));

/**
 * Māori name -> Serbian Latin: macrons dropped, wh -> f, w -> v, i after a vowel -> j
 * (Whangārei: Fangarej, Waitara: Vajtara), ia -> ija after a consonant.
 */
export function maoriToSerbian(name) {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/wh/gi, (m) => (m[0] === 'W' ? 'F' : 'f'))
    .replace(/w/gi, (m) => (m === 'W' ? 'V' : 'v'))
    .replace(/(?<=[aeiou])i(?![aeiou])/gi, 'j')
    .replace(/(?<=[^aeiou\s-])ia/gi, 'ija');
}

const PL_VOWEL = '(?=[aąeęioóuy])';
/** [pattern, Serbian] in order: digraphs first, soft consonants before a vowel, nasal vowels last. */
const POLISH_RULES = [
  ['szcz', 'šč'], ['sz', 'š'], ['cz', 'č'], ['dż', 'dž'], [`dzi${PL_VOWEL}`, 'đ'], ['dzi', 'đi'], ['dź', 'đ'],
  ['(?<=[ptk]|ch)rz', 'š'], ['rz', 'ž'], ['ch', 'h'],
  [`ci${PL_VOWEL}`, 'ć'], ['ci', 'ći'], [`si${PL_VOWEL}`, 'š'], ['si', 'ši'], ['ś', 'š'],
  [`zi${PL_VOWEL}`, 'ž'], ['zi', 'ži'], ['[źż]', 'ž'], [`ni${PL_VOWEL}`, 'nj'], ['ń', 'nj'], [`li${PL_VOWEL}`, 'lj'],
  [`(?<=[bpmwfkgh])i${PL_VOWEL}`, 'j'],
  ['ą(?=[bp])', 'om'], ['ą', 'on'], ['ę(?=[bp])', 'em'], ['ę(?!\\p{L})', 'e'], ['ę', 'en'],
  ['ł', 'l'], ['w', 'v'], ['y', 'i'], ['ó', 'o'], ['x', 'ks'],
];

/**
 * Polish name -> Serbian Latin, as Serbian transcribes it: sz -> š, rz -> ž, ci/si/zi/ni before a
 * vowel -> ć/š/ž/nj, ą/ę -> on/en, i after a labial or k/g -> j (Białystok: Bjalistok,
 * Częstochowa: Čenstohova, Szczecin: Ščećin, Gniezno: Gnjezno).
 */
export function polishToSerbian(name) {
  let s = name;
  for (const [pattern, sr] of POLISH_RULES) {
    s = s.replace(new RegExp(pattern, 'giu'), (m) => (m[0] === m[0].toLowerCase() ? sr : sr[0].toUpperCase() + sr.slice(1)));
  }
  return s;
}

/** Start of a word. */
const DE_START = '(?<=^|[\\s-])';
/**
 * [pattern, Serbian] in order: c and z first (the s -> z below must stay z), long patterns
 * before short ones; ch -> ĥ until the h after a vowel is dropped.
 */
const GERMAN_RULES = [
  ['ck', 'k'], ['c(?![ehiy])', 'k'], ['tz', 'c'], ['z', 'c'],
  ['tsch', 'č'], ['dsch', 'dž'], ['sch', 'š'], ['chs', 'ks'], [`${DE_START}ch`, 'k'], ['ch', 'ĥ'],
  [`${DE_START}s(?=[pt])`, 'š'], [`${DE_START}s(?=[aeiouäöüy])`, 'z'], ['stadt', 'štat'], ['stein', 'štajn'],
  ['(?<=[aeiouäöüy])s(?=[aeiouäöüy])', 'z'],
  ['ei', 'aj'], ['ey', 'aj'], ['ai', 'aj'], ['ay', 'aj'], ['eu', 'oj'], ['äu', 'oj'], ['ie', 'i'],
  ['(?<=[aeiouäöü])h(?![aeiouäöü])', ''], ['ä', 'e'], ['ö', 'e'], ['ü', 'i'], ['ß', 's'],
  ['dt', 't'], ['th', 't'], ['ph', 'f'], ['qu', 'kv'],
  ['v', 'f'], ['w', 'v'], ['x', 'ks'], ['y', 'i'], ['ow(?!\\p{L})', 'ov'], ['ĥ', 'h'],
];

/**
 * German name -> Serbian Latin, as Serbian transcribes it: sch -> š, ei -> aj, eu -> oj, z -> c,
 * w -> v, v -> f, ü/ö/ä -> i/e/e, s before a vowel at the start and between vowels -> z, st/sp at
 * the start -> št/šp, double letters single (Wiesbaden: Vizbaden, Stuttgart: Štutgart).
 */
export function germanToSerbian(name) {
  let s = name;
  for (const [pattern, sr] of GERMAN_RULES) {
    s = s.replace(new RegExp(pattern, 'giu'), (m) => (!sr || m[0] === m[0].toLowerCase() ? sr : sr[0].toUpperCase() + sr.slice(1)));
  }
  return s.replace(/(\p{L})\1+/giu, '$1');
}

/**
 * Serbian names of the physical features, transcribed where the table has none (both
 * build-places and build-physical write names.sr.json, so both add them); `locale` sorts the tables.
 * New Zealand: only Māori names are transcribed (English ones are translated in data/).
 */
export const SERBIAN_FEATURE_NAMES = {
  finland: { transcribe: finnishToSerbian, digraphs: false, locale: 'fi' },
  'new-zealand': { transcribe: maoriToSerbian, only: isMaori, locale: 'en' },
  poland: { transcribe: polishToSerbian, locale: 'pl' },
  germany: { transcribe: germanToSerbian, digraphs: false, locale: 'de' },
};

/** Adds the transcribed names of the features in `physical` to `names`; returns the names still missing. */
export function addFeatureNames(id, names, physical) {
  const { transcribe, only = () => true, digraphs = true } = SERBIAN_FEATURE_NAMES[id];
  const all = [...physical.rivers, ...physical.lakes, ...physical.mountains, ...(physical.areas ?? [])];
  for (const x of all) if (!names[x.name] && only(x.name)) names[x.name] = toCyrillic(transcribe(x.name), { digraphs });
  return all.filter((x) => !names[x.name]).map((x) => x.name);
}

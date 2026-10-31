// Serbian Latin -> Cyrillic, for the build scripts (the game has its own in src/i18n.ts).

const LAT_CYR = [
  ['dž', 'џ'], ['lj', 'љ'], ['nj', 'њ'], ['a', 'а'], ['b', 'б'], ['c', 'ц'], ['č', 'ч'], ['ć', 'ћ'], ['d', 'д'],
  ['đ', 'ђ'], ['e', 'е'], ['f', 'ф'], ['g', 'г'], ['h', 'х'], ['i', 'и'], ['j', 'ј'], ['k', 'к'], ['l', 'л'],
  ['m', 'м'], ['n', 'н'], ['o', 'о'], ['p', 'п'], ['r', 'р'], ['s', 'с'], ['š', 'ш'], ['t', 'т'], ['u', 'у'],
  ['v', 'в'], ['z', 'з'], ['ž', 'ж'],
];

/** Serbian Latin -> Cyrillic. */
export function toCyrillic(s) {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const lower = s.slice(i).toLowerCase();
    const hit = LAT_CYR.find(([l]) => lower.startsWith(l));
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

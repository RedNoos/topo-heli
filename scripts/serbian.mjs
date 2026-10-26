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

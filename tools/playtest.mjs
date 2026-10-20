// Plays a map automatically and reports what happened: targets by kind, finds, targets that
// could not be found by flying to them, the end state and page errors.
//
//   npm run playtest                                 # netherlands, Alles vinden (all names)
//   npm run playtest -- --map nl-zeeland --mode physical --finds 40
//
// --mode list plays until everything is found; other modes stop after --finds targets.

import { args, findCurrent, launch, openGame, startGame } from './browser.mjs';

const opt = args({ map: 'netherlands', mode: 'list', lang: 'nl', finds: '40' });
const browser = await launch();
const page = await openGame(browser, opt);
await startGame(page);

const kinds = await page.evaluate(() => {
  const k = {};
  for (const t of window.__game().targets) {
    const key = t.kind + (t.sub ? '/' + t.sub : '');
    k[key] = (k[key] || 0) + 1;
  }
  return k;
});
const stuck = [];
const max = opt.mode === 'list' ? 1000 : +opt.finds;
for (let i = 0; i < max; i++) {
  if (await page.evaluate(() => window.__game().over)) break;
  if (!(await findCurrent(page))) {
    stuck.push(await page.evaluate(() => `${window.__game().target.name} (${window.__game().target.kind})`));
    await page.evaluate(() => window.__game().skip());
    if (stuck.length > 20) break;
  }
}
const end = await page.evaluate(() => {
  const g = window.__game();
  return { targets: g.targets.length, found: g.found.length, skipped: g.skipped.length, level: g.level, over: g.over, practice: g.practice };
});
await browser.close();

console.log(`map ${opt.map}, mode ${opt.mode}, lang ${opt.lang}`);
console.log('targets by kind:', JSON.stringify(kinds));
console.log('result:', JSON.stringify(end));
console.log(stuck.length ? `not found by flying there: ${stuck.join(', ')}` : 'every target was found by flying to it');
console.log(page.errors.length ? `page errors:\n${page.errors.join('\n')}` : 'no page errors');
process.exitCode = page.errors.length || stuck.length ? 1 : 0;

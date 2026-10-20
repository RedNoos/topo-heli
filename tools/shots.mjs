// Screenshots of the menu, a game in progress and the end screen, on desktop and phone.
//
//   npm run shots                                   # netherlands, free mode, Dutch
//   npm run shots -- --map nl-utrecht --mode list --lang sr-Cyrl
//
// Writes .shots/<map>-<mode>-<viewport>-{menu,game,end}.png and prints the paths.

import { args, findCurrent, launch, openGame, outFile, startGame, VIEWPORTS, wait } from './browser.mjs';

const opt = args({ map: 'netherlands', mode: 'free', lang: 'nl', finds: '12' });
const browser = await launch();
const files = [];
const errors = [];
for (const viewport of Object.keys(VIEWPORTS)) {
  const page = await openGame(browser, { ...opt, viewport });
  const name = (what) => outFile(`${opt.map}-${opt.mode}-${viewport}-${what}.png`);
  await page.screenshot({ path: name('menu'), fullPage: true });
  await startGame(page);
  await wait(1200);
  await page.screenshot({ path: name('game') });
  // Play a while: all names in 'list' mode, otherwise some finds, a skip, then time up.
  const list = opt.mode === 'list';
  for (let i = 0; i < (list ? 500 : +opt.finds); i++) {
    if (await page.evaluate(() => window.__game().over)) break;
    if (!(await findCurrent(page))) await page.evaluate(() => window.__game().skip());
  }
  if (!list) await page.evaluate(() => window.__game().skip());
  await page.evaluate(() => {
    const g = window.__game();
    if (!g.practice) g.timeLeft = 0.01;
  });
  await wait(1000);
  await page.screenshot({ path: name('end') });
  files.push(name('menu'), name('game'), name('end'));
  errors.push(...page.errors);
  await page.close();
}
await browser.close();
console.log(files.join('\n'));
console.log(errors.length ? `Page errors:\n${errors.join('\n')}` : 'No page errors.');
process.exitCode = errors.length ? 1 : 0;

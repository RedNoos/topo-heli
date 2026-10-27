// Shared helpers for the browser tools (shots.mjs, playtest.mjs): drive the running dev server
// with Puppeteer and the game's DEV-only `window.__game()` / `__renderer()` hooks.
//
// Needs the dev server: `npm run dev:lan` (http://localhost:5180). Chrome is found at the usual
// install paths, or set CHROME_PATH. Another server: TOPO_URL=http://... npm run shots.

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const URL = process.env.TOPO_URL ?? 'http://localhost:5180/';
export const OUT = path.join(ROOT, '.shots');

export const VIEWPORTS = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** `--map nl-utrecht --mode list` -> { map: 'nl-utrecht', mode: 'list' }. */
export function args(defaults) {
  const out = { ...defaults };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome not found: set CHROME_PATH');
  return found;
}

export async function launch() {
  return puppeteer.launch({ executablePath: chromePath(), headless: 'new' });
}

/**
 * Opens the game with a clean state. `map`: 'serbia', 'netherlands', 'europe' or a province/region id
 * ('nl-utrecht', 'rs-vojvodina'); `mode`: 'free' (default), 'physical' (waters/mountains on) or 'list' (Alles vinden).
 * Collects page errors in `page.errors`.
 */
export async function openGame(browser, { map = 'netherlands', mode = 'free', lang = 'nl', viewport = 'desktop' } = {}) {
  const page = await browser.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.setViewport(VIEWPORTS[viewport] ?? VIEWPORTS.desktop);
  try {
    await page.goto(URL, { waitUntil: 'networkidle0' });
  } catch {
    throw new Error(`Cannot open ${URL}: is the dev server running (npm run dev:lan)?`);
  }
  await page.evaluate(
    ({ lang, mode }) => {
      localStorage.clear();
      localStorage.setItem('topo-heli:lang', lang);
      localStorage.setItem('topo-heli:howto', 'closed');
      if (mode === 'physical') localStorage.setItem('topo-heli:physical', '1');
      if (mode === 'list') localStorage.setItem('topo-heli:practice', '1');
    },
    { lang, mode },
  );
  await page.reload({ waitUntil: 'networkidle0' });
  // Map buttons are the top-level maps in MAPS order; provinces are chosen in the area select.
  const top = map.startsWith('nl-') ? 'netherlands' : map.startsWith('rs-') ? 'serbia' : map.startsWith('de-') ? 'germany' : map;
  const index = { serbia: 0, netherlands: 1, germany: 2, finland: 3, europe: 4 }[top];
  await page.evaluate((i) => document.querySelectorAll('#map-select button')[i].click(), index);
  await wait(900);
  if (map !== top) {
    await page.select('#region', map);
    await wait(900);
  }
  await wait(600); // physical data loads lazily
  return page;
}

export async function startGame(page) {
  await page.click('#btn-start');
  await wait(400);
}

/**
 * Flies to the current target until it is found (teleporting the helicopter): points directly,
 * lakes at a point on the water, areas at their deepest point, rivers along their course.
 * Returns false if the target could not be found that way.
 */
export function findCurrent(page) {
  return page.evaluate(async () => {
    const g = window.__game();
    const t = g.target;
    if (!t) return false;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const n0 = g.found.length;
    if (t.samples) {
      for (const s of t.samples) {
        g.heli.x = s.x;
        g.heli.y = s.y;
        await frame();
        if (g.found.length > n0) return true;
      }
      return false;
    }
    if (t.kind === 'lake') {
      // Its centre may lie on an island or on land: look for a point on the water, within the
      // map (seas such as the Ostsee reach far beyond a region map).
      const pts = t.rings.flat();
      const b = g.bounds;
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      outer: for (let x = Math.max(b.minX, Math.min(...xs)); x < Math.min(b.maxX, Math.max(...xs)); x += 2)
        for (let y = Math.max(b.minY, Math.min(...ys)); y < Math.min(b.maxY, Math.max(...ys)); y += 2) {
          g.heli.x = x;
          g.heli.y = y;
          if (g.targetDistance === 0) break outer;
        }
    } else {
      g.heli.x = t.x;
      g.heli.y = t.y;
    }
    for (let i = 0; i < 6 && g.found.length === n0; i++) await frame();
    return g.found.length > n0;
  });
}

export function outFile(name) {
  fs.mkdirSync(OUT, { recursive: true });
  return path.join(OUT, name);
}

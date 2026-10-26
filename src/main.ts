import './style.css';
import { Sfx } from './audio';
import { CONFIG } from './config';
import { Game } from './game';
import { Input } from './input';
import { MAPS } from './maps';
import type { MapData, MapDefinition } from './maps/types';
import { openFeedback } from './feedback';
import { Renderer } from './renderer';
import { initStats, scoreBucket, track } from './stats';
import { flagSvg, getLang, LANGS, onLangChange, placeName, plural, setLang, setPlaceNames, t, type StringKey } from './i18n';
import type { Target } from './targets';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('game');
const minimap = $<HTMLCanvasElement>('minimap');
const ui = {
  hud: $('hud'),
  menu: $('menu'),
  pause: $('pause'),
  over: $('over'),
  timer: $('timer'),
  targetLabel: $('target-label'),
  targetName: $('target-name'),
  targetHint: $('target-hint'),
  progress: $('river-progress'),
  physicalToggle: $('physical-toggle'),
  physicalOption: $<HTMLInputElement>('opt-physical'),
  modeBox: $('mode-box'),
  modeFree: $('mode-free'),
  modeList: $<HTMLButtonElement>('mode-list'),
  score: $('score'),
  level: $('level'),
  toast: $('toast'),
  best: $('best'),
  mute: $('btn-mute'),
};

const input = new Input(canvas);
const sfx = new Sfx();

type State = 'menu' | 'playing' | 'paused' | 'over';
let state: State = 'menu';
let mapDef: MapDefinition = MAPS[0];
let mapData: MapData | null = null;
let game: Game | null = null;
let renderer: Renderer | null = null;
let lastFrame = performance.now();
let lastWholeSecond = 0;
let wasVisible = false;
let toastTimer = 0;
/** "Mountains, rivers & lakes" option, remembered per map. */
let physicalOn = false;
/** Basislijst mode (Dutch maps): one choice for all maps, like the physical option. */
let practiceOn = false;

// ---------- Best scores ----------

const bestKey = (id: string) => `topo-heli:best:${id}`;
/** Score key for the current map + mode. */
const scoreId = () => (practiceOn ? `${mapDef.id}+list` : physicalOn ? `${mapDef.id}+physical` : mapDef.id);

/** The options (physical features, Basislijst mode) are one choice for all maps. */
const OPTION_KEY = 'topo-heli:physical';
const PRACTICE_KEY = 'topo-heli:practice';
function loadOption(key = OPTION_KEY) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function saveOption(on: boolean, key = OPTION_KEY) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* not remembered */
  }
}
/** Basislijst mode: fastest time in seconds (0 = none yet). */
const bestTimeKey = (id: string) => `topo-heli:besttime:${id}`;
function getBestTime(id: string): number {
  try {
    return Number(localStorage.getItem(bestTimeKey(id))) || 0;
  } catch {
    return 0;
  }
}
function setBestTime(id: string, secs: number) {
  try {
    localStorage.setItem(bestTimeKey(id), String(secs));
  } catch {
    /* not remembered */
  }
}
/** Physical data is needed for the physical option and for the Basislijst mode (waters, areas). */
const wantsPhysical = () => physicalOn || practiceOn;
/** Number of names in the Basislijst mode for the loaded map. */
function practiceCount() {
  if (!mapData) return 0;
  const p = mapData.physical;
  const all = mapDef.practiceList === 'all';
  const physical = p ? [...p.rivers, ...p.lakes, ...p.mountains, ...(p.areas ?? []), ...(p.landmarks ?? [])].filter((x) => all || x.core).length : 0;
  return mapData.cities.filter((c) => all || c.listed).length + physical;
}
function getBest(id: string): number {
  try {
    return Number(localStorage.getItem(bestKey(id))) || 0;
  } catch {
    return 0;
  }
}
function setBest(id: string, score: number) {
  try {
    localStorage.setItem(bestKey(id), String(score));
  } catch {
    /* storage unavailable: best score just isn't remembered */
  }
}

// ---------- Screens ----------

function show(next: State) {
  state = next;
  ui.menu.hidden = next !== 'menu';
  ui.pause.hidden = next !== 'paused';
  ui.over.hidden = next !== 'over';
  ui.hud.hidden = next === 'menu';
  input.reset();
  updateInsets();
}

/** Tells the renderer how much of the screen the HUD bars cover. */
function updateInsets() {
  if (!renderer || ui.hud.hidden) return;
  const top = document.querySelector('.hud-top')!.getBoundingClientRect().bottom;
  const bottom = window.innerHeight - document.querySelector('.hud-bottom')!.getBoundingClientRect().top;
  renderer.setInsets(top + 8, bottom + 8);
}

/** Seconds as m:ss, e.g. 90 -> "1:30". */
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

const mapName = (m: MapDefinition) => (m.nameKey ? t(m.nameKey) : (m.name ?? m.id));
/** The top-level map a (sub-)map belongs to, e.g. the Netherlands for a province. */
const topMap = (m: MapDefinition) => MAPS.find((x) => x.id === m.parent) ?? m;

function renderMapSelect() {
  const box = $('map-select');
  box.innerHTML = '';
  for (const m of MAPS.filter((x) => !x.parent)) {
    const b = document.createElement('button');
    b.textContent = mapName(m);
    b.classList.toggle('active', m === topMap(mapDef));
    b.onclick = () => void selectMap(m);
    box.append(b);
  }
  // Sub-maps (provinces, regions) of the chosen map: a list with the whole map first.
  const top = topMap(mapDef);
  const subs = MAPS.filter((x) => x.parent === top.id);
  // Every settings row is always there (what does not apply is disabled), so the menu keeps
  // its layout when switching maps and modes.
  $('region-box').hidden = false;
  $('region-label').hidden = false;
  $('region-label').textContent = t('region');
  const select = $<HTMLSelectElement>('region');
  select.innerHTML = '';
  select.disabled = subs.length === 0;
  for (const m of [top, ...subs]) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m !== top ? mapName(m) : subs.length && top.allKey ? t(top.allKey) : mapName(m);
    o.selected = m === mapDef;
    select.append(o);
  }
  // Time bonus per level differs per map (e.g. Flevoland: +0:30).
  $('howto-levels').innerHTML = t('howtoLevels', { bonus: clock(mapDef.time?.levelBonus ?? CONFIG.levelTimeBonus) });
  // Game mode (Dutch maps): "Find them all" (Basislijst) always has its waters and areas, so
  // no physical switch then.
  ui.modeBox.hidden = false;
  $('mode-label').hidden = false;
  ui.modeList.disabled = !mapDef.practice;
  ui.modeList.title = mapDef.practice ? '' : t('modeListUnavailable');
  ui.modeFree.classList.toggle('active', !practiceOn);
  ui.modeList.classList.toggle('active', practiceOn);
  const list = '<i>basislijst topografie</i>';
  const n = practiceCount();
  $('mode-desc').innerHTML = !practiceOn
    ? t('modeFreeDesc')
    : !n
      ? ''
      : mapDef.practiceList === 'all'
        ? t('modeListDescAll', { n })
        : mapDef.practiceList === 'selection'
          ? t('modeListDescSelection', { n })
          : t('modeListDesc', { n, list, extra: mapDef.parent ? t('modeListExtra') : '' });
  $('howto-levels').hidden = practiceOn;
  $('btn-skip').textContent = t(practiceOn ? 'skipPractice' : 'skip');
  // Physical features: off for maps without them; always on (fixed) in "Find them all".
  ui.physicalToggle.hidden = false;
  $('physical-row').hidden = false;
  ui.physicalOption.disabled = !mapDef.loadPhysical || practiceOn;
  ui.physicalOption.checked = !!mapDef.loadPhysical && (physicalOn || practiceOn);
  // The Netherlands: "Waters" or "Waters & areas" instead of mountains, rivers & lakes.
  const kind = mapDef.physicalKind;
  $('physical-label').innerHTML = t(kind === 'all' ? 'physicalOptionAll' : kind === 'watersAreas' ? 'physicalOptionWatersAreas' : kind ? 'physicalOptionWaters' : 'physicalOption');
  $('howto-physical').innerHTML =
    kind === 'all' ? t('howtoPhysical') + ' ' + t('howtoPhysicalAreas') : kind ? t('howtoPhysicalWaters') + (kind === 'watersAreas' ? ' ' + t('howtoPhysicalAreas') : '') : t('howtoPhysical');
  $('howto-physical').hidden = !physicalOn && !(practiceOn && mapDef.loadPhysical);
  if (practiceOn) {
    $('howto-practice').innerHTML = !n
      ? ''
      : mapDef.practiceList === 'all'
        ? t('howtoPracticeAll', { n })
        : mapDef.practiceList === 'selection'
          ? t('howtoPracticeSelection', { n })
          : t('howtoPractice', { n, list, extra: mapDef.parent ? t('practiceExtra') : '' });
    const best = getBestTime(scoreId());
    ui.best.innerHTML = best > 0 ? t('bestPractice', { map: mapName(mapDef), t: clock(best) }) : '';
    $('howto-practice').hidden = false;
    return;
  }
  $('howto-practice').hidden = true;
  const best = getBest(scoreId());
  const params = { map: mapName(mapDef), n: best };
  const bestKey: StringKey = !physicalOn
    ? 'best'
    : kind === 'all'
      ? 'bestPhysicalAll'
      : kind === 'watersAreas'
        ? 'bestPhysicalWatersAreas'
        : kind
          ? 'bestPhysicalWaters'
          : 'bestPhysical';
  ui.best.innerHTML = best > 0 ? t(bestKey, params) : '';
}

async function selectMap(def: MapDefinition) {
  mapDef = def;
  mapData = null;
  physicalOn = !!def.loadPhysical && loadOption();
  practiceOn = !!def.practice && loadOption(PRACTICE_KEY);
  renderMapSelect();
  const [data, physical, serbianNames, dutchNames, englishNames] = await Promise.all([
    def.load(),
    wantsPhysical() ? def.loadPhysical?.() : undefined,
    def.loadSerbianNames?.(),
    def.loadDutchNames?.(),
    def.loadEnglishNames?.(),
  ]);
  setPlaceNames(def.placeNames, serbianNames, dutchNames, englishNames);
  mapData = { ...data, physical };
  renderMapSelect();
  // A non-started game gives the menu a live map in the background.
  newGame(false);
}

function newGame(start: boolean) {
  if (!mapData) return;
  const physical = wantsPhysical() ? mapData.physical : undefined;
  game = new Game(mapData, mapDef.viewKm, {
    physical: !!physical,
    pool: mapDef.pool,
    time: mapDef.time,
    reveal: mapDef.reveal,
    practice: practiceOn,
    practiceAll: mapDef.practiceList === 'all',
  });
  renderer = new Renderer(canvas, minimap, game, mapData.geo, mapDef.viewKm, physical);
  wasVisible = false;
  lastWholeSecond = Math.ceil(game.timeLeft);
  ui.toast.hidden = true;

  game.on((e) => {
    switch (e.type) {
      case 'target':
        setTargetLabel(e.target);
        ui.targetName.classList.remove('pop');
        void ui.targetName.offsetWidth; // restart animation
        ui.targetName.classList.add('pop');
        wasVisible = false;
        updateInsets(); // a long name may wrap and change the HUD height
        break;
      case 'found':
        renderer!.addFoundEffect(e.found);
        if (e.levelUp) {
          sfx.levelUp();
          showToast(
            t('levelUp', { n: game!.level, bonus: clock(game!.levelBonus) }),
            t(physicalOn ? 'levelUpDetailPhysical' : 'levelUpDetail'),
          );
        } else {
          sfx.found();
        }
        break;
      case 'skipped':
        sfx.skip();
        break;
      case 'over':
        endGame();
        break;
    }
  });

  if (start) {
    game.start();
    show('playing');
  }
}

/** Texts per kind of target; subkinds (canal, sea, province, ...) have their own words. */
const SUB = { canal: 'Canal', dike: 'Dike', water: 'Water', province: 'Province', state: 'State', island: 'Island', airport: 'Airport' } as const;
const KIND = { city: 'City', river: 'River', lake: 'Lake', mountain: 'Mountain', area: 'Area', landmark: 'Airport' } as const;
const word = (t: Target) => (t.sub ? SUB[t.sub] : KIND[t.kind]);
const flyToKey = (t: Target): StringKey => (t.kind === 'city' ? 'flyTo' : `flyTo${word(t)}`) as StringKey;
const kindKey = (t: Target): StringKey => `kind${word(t)}` as StringKey;
/** Provinces, states and islands share the area hint. */
const hintKey = (t: Target): StringKey => (t.kind === 'area' ? 'hintArea' : (`hint${word(t)}` as StringKey));

/** Target card: name plus, for physical features, what kind of place it is. */
function setTargetLabel(target: Target) {
  ui.targetLabel.textContent = t(flyToKey(target));
  const name = placeName(target.name);
  ui.targetName.textContent = name;
  if (target.kind !== 'city' && !name.toLowerCase().includes(t(kindKey(target)).toLowerCase())) {
    const tag = document.createElement('span');
    tag.className = `kind kind-${target.kind} kind-${target.sub ?? target.kind}`;
    tag.textContent = t(kindKey(target));
    ui.targetName.append(' ', tag);
  }
  ui.progress.hidden = target.kind !== 'river';
}

function showToast(title: string, detail: string) {
  ui.toast.innerHTML = '';
  ui.toast.append(title);
  const small = document.createElement('small');
  small.textContent = detail;
  ui.toast.append(small);
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (ui.toast.hidden = true), 2600);
}

/** End screen name groups; kept so a language switch can redraw them. */
let overGroups: { title: StringKey; names: string[]; cls: string; note?: StringKey }[] = [];
function renderOverGroups() {
  const box = $('over-groups');
  box.innerHTML = '';
  for (const g of overGroups) {
    if (g.names.length === 0 && !g.note) continue;
    const div = document.createElement('div');
    div.className = g.cls;
    const h = document.createElement('h3');
    h.textContent = t(g.title);
    const list = document.createElement('div');
    list.className = 'found-list';
    for (const n of g.names) {
      const s = document.createElement('span');
      s.className = g.cls;
      s.textContent = placeName(n);
      list.append(s);
    }
    if (g.note && g.names.length === 0) list.textContent = t(g.note);
    div.append(h, list);
    box.append(div);
  }
}

/** Basislijst mode: all names found. */
function endPractice(game: Game) {
  sfx.levelUp();
  const secs = Math.round(game.elapsed);
  track(`finish/${scoreId()}/${Math.floor(secs / 60)}m`);
  const prevBest = getBestTime(scoreId());
  if (!prevBest || secs < prevBest) setBestTime(scoreId(), secs);
  $('over-title').dataset.i18n = 'done';
  $('over-title').textContent = t('done');
  $('final-score').textContent = clock(secs);
  $('final-label').textContent = t('timeLabel');
  $('final-best').textContent = !prevBest || secs < prevBest ? t('newBestTime') : t('bestTime', { t: clock(prevBest) });
  // Worth practising: the skipped names and the three that took longest (if clearly long).
  const avg = game.elapsed / Math.max(1, game.found.length);
  const slow = [...game.found].sort((a, b) => b.secs - a.secs).slice(0, 3).filter((f) => f.secs > avg * 1.5).map((f) => f.target);
  const again = [...new Set([...game.skipped, ...slow])].map((c) => c.name);
  overGroups = [{ title: 'groupPractise', names: again, cls: 'practise', note: 'perfect' }];
  renderOverGroups();
  show('over');
}

function endGame() {
  if (!game) return;
  if (game.practice) return endPractice(game);
  $('over-title').dataset.i18n = 'timeUp';
  $('over-title').textContent = t('timeUp');
  sfx.over();
  const score = game.found.length;
  track(`finish/${scoreId()}/${scoreBucket(score)}`);
  const prevBest = getBest(scoreId());
  if (score > prevBest) setBest(scoreId(), score);

  $('final-score').textContent = String(score);
  $('final-label').textContent = plural('placesFound', score);
  $('final-best').textContent =
    score > prevBest && score > 0 ? t('newBest') : prevBest > 0 ? t('bestShort', { n: prevBest }) : '';
  // Not found: the skipped names and the one you were looking for when time ran out.
  const missed = [...new Set([...game.skipped, ...(game.target ? [game.target] : [])])].map((c) => c.name);
  overGroups = [
    { title: 'groupFound', names: game.found.map((f) => f.target.name), cls: 'found' },
    { title: 'groupMissed', names: missed, cls: 'missed' },
  ];
  renderOverGroups();
  show('over');
}

function start() {
  track(`start/${scoreId()}`);
  sfx.unlock();
  newGame(true);
}

function togglePause() {
  if (state === 'playing') show('paused');
  else if (state === 'paused') show('playing');
}

function toggleMute() {
  sfx.muted = !sfx.muted;
  updateMuteLabel();
}

function updateMuteLabel() {
  ui.mute.textContent = t(sfx.muted ? 'soundOff' : 'soundOn');
}

// ---------- Language ----------

/** Untranslated pieces used in static texts (names, links). */
const STATIC_PARAMS = {
  keys: 'WASD',
  osm: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  ne: '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>',
  gn: '<a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a>',
  cbs: '<a href="https://www.pdok.nl/" target="_blank" rel="noopener">CBS/Kadaster (PDOK)</a>',
  // The game Topo Heli is based on (names are never translated or transliterated).
  game: '<i>Topografie Nederland</i>',
  maker: 'Radarsoft',
  platform: 'Commodore 64',
  goatcounter: '<a href="https://www.goatcounter.com/" target="_blank" rel="noopener">GoatCounter</a>',
  tally: '<a href="https://tally.so/" target="_blank" rel="noopener">Tally</a>',
};

/** Fills every [data-i18n] element with its translation. */
function translateStatic() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.innerHTML = t(el.dataset.i18n as StringKey, STATIC_PARAMS);
  }
  updateMuteLabel();
  if (game?.target) setTargetLabel(game.target);
  if (game) $('final-label').textContent = game.practice ? t('timeLabel') : plural('placesFound', game.found.length);
  renderOverGroups();
  renderLangPicker();
  renderMapSelect();
  updateInsets();
}

/** Flag dropdown: current language as flag + abbreviation; opens a list of all languages. */
function renderLangPicker() {
  const box = $('lang');
  const current = LANGS.find((l) => l.id === getLang())!;
  box.innerHTML = '';
  const button = document.createElement('button');
  button.className = 'lang-current';
  button.type = 'button';
  button.title = t('language');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `${flagSvg(current.flag)}<span>${current.short}</span><span class="caret">▾</span>`;
  const list = document.createElement('ul');
  list.className = 'lang-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  for (const l of LANGS) {
    const item = document.createElement('li');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(l.id === current.id));
    item.tabIndex = 0;
    item.innerHTML = `${flagSvg(l.flag)}<b>${l.short}</b><span>${l.label}</span>`;
    const choose = () => {
      setLang(l.id);
      track(`language/${l.id}`);
    };
    item.onclick = choose;
    item.onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose());
    list.append(item);
  }
  button.onclick = (e) => {
    e.stopPropagation();
    list.hidden = !list.hidden;
    button.setAttribute('aria-expanded', String(!list.hidden));
  };
  box.append(button, list);
}
document.addEventListener('click', () => {
  const list = document.querySelector<HTMLElement>('.lang-list');
  if (list) list.hidden = true;
});
onLangChange(translateStatic);

// ---------- Controls ----------

$('btn-start').onclick = start;
$<HTMLSelectElement>('region').onchange = (e) => {
  const def = MAPS.find((m) => m.id === (e.target as HTMLSelectElement).value);
  if (def) void selectMap(def);
};
const setMode = (practice: boolean) => {
  if (practice === practiceOn) return;
  practiceOn = practice;
  saveOption(practiceOn, PRACTICE_KEY);
  void optionChanged();
};
ui.modeFree.onclick = () => setMode(false);
ui.modeList.onclick = () => setMode(true);
ui.physicalOption.onchange = () => {
  physicalOn = ui.physicalOption.checked;
  saveOption(physicalOn);
  void optionChanged();
};
async function optionChanged() {
  renderMapSelect();
  if (wantsPhysical() && mapData && !mapData.physical) {
    const def = mapDef;
    const physical = await def.loadPhysical?.();
    // Ignore if the player switched maps while it loaded.
    if (def !== mapDef || !mapData) return;
    mapData = { ...mapData, physical };
    renderMapSelect(); // the Basislijst count includes the waters and areas
  }
  newGame(false); // redraw the menu background with/without the detailed water
}
$('btn-again').onclick = start;
$('btn-menu').onclick = () => {
  newGame(false);
  renderMapSelect();
  show('menu');
};
$('btn-quit').onclick = $('btn-menu').onclick;
$('btn-resume').onclick = togglePause;
$('btn-pause').onclick = togglePause;
$('btn-skip').onclick = () => state === 'playing' && game?.skip();
ui.mute.onclick = toggleMute;
/** Feedback form, told which map and mode the player was on. */
const feedback = () => {
  track('feedback');
  const mode = practiceOn ? 'basislijst' : !physicalOn ? 'vrij' : mapDef.physicalKind === 'all' ? 'alles' : mapDef.physicalKind ? 'wateren' : 'bergen-rivieren';
  void openFeedback({ map: mapDef.id, mode, lang: getLang() });
};
$('btn-feedback').onclick = (e) => {
  e.preventDefault();
  feedback();
};
$('btn-feedback-over').onclick = feedback;

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  else if (e.code === 'KeyN' && state === 'playing') game?.skip();
  else if (e.code === 'KeyM') toggleMute();
  else if ((e.code === 'Enter' || e.code === 'Space') && (state === 'menu' || state === 'over')) {
    e.preventDefault();
    start();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') show('paused');
});
window.addEventListener('resize', () => {
  renderer?.resize();
  updateInsets();
});

// ---------- Main loop ----------

function updateHud() {
  if (!game) return;
  // Basislijst mode: the clock counts up and the score shows found / total.
  const secs = game.practice ? Math.floor(game.elapsed) : Math.ceil(game.timeLeft);
  ui.timer.textContent = clock(secs);
  ui.timer.classList.toggle('low', !game.practice && secs <= 15 && state === 'playing');
  ui.score.textContent = game.practice ? `${game.found.length}/${game.targets.length}` : String(game.found.length);
  ui.level.textContent = String(game.level);
  ui.level.parentElement!.hidden = game.practice;

  const visible = game.targetVisible;
  const kind = game.target?.kind;
  const progress = game.riverProgress;
  (ui.progress.firstElementChild as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
  const target = game.target;
  const follow: StringKey = target?.sub === 'canal' ? 'followCanal' : target?.sub === 'dike' ? 'followDike' : 'followRiver';
  ui.targetHint.textContent =
    kind === 'river' && progress > 0
      ? t(follow, { p: Math.round(progress * 100) })
      : game.areaTooShallow
        ? t('hintAreaDeeper')
        : visible && target
          ? t(hintKey(target))
          : '';
  if (visible && !wasVisible) sfx.reveal();
  wasVisible = visible;

  if (!game.practice && secs < lastWholeSecond && secs <= 10 && secs > 0) sfx.tick();
  lastWholeSecond = secs;
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (game && renderer) {
    if (state === 'playing') {
      game.update(dt, input.direction());
      updateHud();
    }
    renderer.render(state === 'paused' ? 0 : dt, state === 'playing' ? input.joystick : null);
  }
  requestAnimationFrame(frame);
}

// "How to play" is open until the player has seen it once, then stays as they leave it.
const HOWTO_KEY = 'topo-heli:howto';
const howtoBox = $<HTMLDetailsElement>('howto-box');
try {
  howtoBox.open = localStorage.getItem(HOWTO_KEY) !== 'closed';
  if (!localStorage.getItem(HOWTO_KEY)) localStorage.setItem(HOWTO_KEY, 'closed');
} catch {
  howtoBox.open = true;
}
howtoBox.ontoggle = () => {
  try {
    localStorage.setItem(HOWTO_KEY, howtoBox.open ? 'open' : 'closed');
  } catch {
    /* not remembered */
  }
};

document.documentElement.lang = getLang();
translateStatic();
initStats();
track(`language-on-load/${getLang()}`);
void selectMap(mapDef);
requestAnimationFrame(frame);

// Debug handle for automated tests / tinkering in the dev console.
if (import.meta.env.DEV) Object.assign(window, { __game: () => game, __renderer: () => renderer });

import './style.css';
import { Sfx } from './audio';
import { CONFIG } from './config';
import { Game } from './game';
import { Input } from './input';
import { MAPS } from './maps';
import type { MapData, MapDefinition } from './maps/types';
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

// ---------- Best scores ----------

const bestKey = (id: string) => `topo-heli:best:${id}`;
/** Score key for the current map + mode. */
const scoreId = () => (physicalOn ? `${mapDef.id}+physical` : mapDef.id);

/** The physical option (mountains/rivers, waters & areas) is one choice for all maps. */
const OPTION_KEY = 'topo-heli:physical';
function loadOption() {
  try {
    return localStorage.getItem(OPTION_KEY) === '1';
  } catch {
    return false;
  }
}
function saveOption(on: boolean) {
  try {
    localStorage.setItem(OPTION_KEY, on ? '1' : '0');
  } catch {
    /* not remembered */
  }
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
  // Sub-maps (provinces) of the chosen map: a list with the whole map first.
  const top = topMap(mapDef);
  const subs = MAPS.filter((x) => x.parent === top.id);
  $('region-box').hidden = subs.length === 0;
  if (subs.length) {
    $('region-label').textContent = t('region');
    const select = $<HTMLSelectElement>('region');
    select.innerHTML = '';
    for (const m of [top, ...subs]) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m === top ? t('regionAll') : mapName(m);
      o.selected = m === mapDef;
      select.append(o);
    }
  }
  // Time bonus per level differs per map (e.g. Flevoland: +0:30).
  $('howto-levels').innerHTML = t('howtoLevels', { bonus: clock(mapDef.time?.levelBonus ?? CONFIG.levelTimeBonus) });
  // The mode switch is only offered for maps that have physical data.
  ui.physicalToggle.hidden = !mapDef.loadPhysical;
  ui.physicalOption.checked = physicalOn;
  // The Netherlands: "Waters" or "Waters & areas" instead of mountains, rivers & lakes.
  const kind = mapDef.physicalKind;
  $('physical-label').innerHTML = t(kind === 'watersAreas' ? 'physicalOptionWatersAreas' : kind ? 'physicalOptionWaters' : 'physicalOption');
  $('howto-physical').innerHTML = kind ? t('howtoPhysicalWaters') + (kind === 'watersAreas' ? ' ' + t('howtoPhysicalAreas') : '') : t('howtoPhysical');
  $('howto-physical').hidden = !physicalOn;
  const best = getBest(scoreId());
  const params = { map: mapName(mapDef), n: best };
  const bestKey: StringKey = !physicalOn
    ? 'best'
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
  renderMapSelect();
  const [data, physical, serbianNames, dutchNames] = await Promise.all([
    def.load(),
    physicalOn ? def.loadPhysical?.() : undefined,
    def.loadSerbianNames?.(),
    def.loadDutchNames?.(),
  ]);
  setPlaceNames(def.placeNames, serbianNames, dutchNames);
  mapData = { ...data, physical };
  renderMapSelect();
  // A non-started game gives the menu a live map in the background.
  newGame(false);
}

function newGame(start: boolean) {
  if (!mapData) return;
  const physical = physicalOn ? mapData.physical : undefined;
  game = new Game(mapData, mapDef.viewKm, { physical: !!physical, pool: mapDef.pool, time: mapDef.time, reveal: mapDef.reveal });
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
const SUB = { canal: 'Canal', dike: 'Dike', water: 'Water', province: 'Province', island: 'Island', airport: 'Airport' } as const;
const KIND = { city: 'City', river: 'River', lake: 'Lake', mountain: 'Mountain', area: 'Area', landmark: 'Airport' } as const;
const word = (t: Target) => (t.sub ? SUB[t.sub] : KIND[t.kind]);
const flyToKey = (t: Target): StringKey => (t.kind === 'city' ? 'flyTo' : `flyTo${word(t)}`) as StringKey;
const kindKey = (t: Target): StringKey => `kind${word(t)}` as StringKey;
/** Provinces and islands share the area hint. */
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

function endGame() {
  if (!game) return;
  sfx.over();
  const score = game.found.length;
  track(`finish/${scoreId()}/${scoreBucket(score)}`);
  const prevBest = getBest(scoreId());
  if (score > prevBest) setBest(scoreId(), score);

  $('final-score').textContent = String(score);
  $('final-label').textContent = plural('placesFound', score);
  $('final-best').textContent =
    score > prevBest && score > 0 ? t('newBest') : prevBest > 0 ? t('bestShort', { n: prevBest }) : '';
  $('final-missed').textContent = game.target ? t('lastOne', { name: placeName(game.target.name) }) : '';
  const list = $('found-list');
  list.innerHTML = '';
  const all = [
    ...game.found.map((f) => ({ c: f.target, skipped: false })),
    ...game.skipped.map((c) => ({ c, skipped: true })),
  ];
  for (const { c, skipped } of all) {
    const s = document.createElement('span');
    s.textContent = placeName(c.name);
    if (skipped) s.className = 'skipped';
    list.append(s);
  }
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
};

/** Fills every [data-i18n] element with its translation. */
function translateStatic() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.innerHTML = t(el.dataset.i18n as StringKey, STATIC_PARAMS);
  }
  updateMuteLabel();
  if (game?.target) setTargetLabel(game.target);
  if (game) $('final-label').textContent = plural('placesFound', game.found.length);
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
ui.physicalOption.onchange = async () => {
  physicalOn = ui.physicalOption.checked;
  saveOption(physicalOn);
  renderMapSelect();
  if (physicalOn && mapData && !mapData.physical) {
    const def = mapDef;
    const physical = await def.loadPhysical?.();
    // Ignore if the player switched maps while it loaded.
    if (def !== mapDef || !mapData) return;
    mapData = { ...mapData, physical };
  }
  newGame(false); // redraw the menu background with/without the detailed water
};
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
  const secs = Math.ceil(game.timeLeft);
  ui.timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  ui.timer.classList.toggle('low', secs <= 15 && state === 'playing');
  ui.score.textContent = String(game.found.length);
  ui.level.textContent = String(game.level);

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

  if (secs < lastWholeSecond && secs <= 10 && secs > 0) sfx.tick();
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

document.documentElement.lang = getLang();
translateStatic();
initStats();
track(`language-on-load/${getLang()}`);
void selectMap(mapDef);
requestAnimationFrame(frame);

// Debug handle for automated tests / tinkering in the dev console.
if (import.meta.env.DEV) Object.assign(window, { __game: () => game, __renderer: () => renderer });

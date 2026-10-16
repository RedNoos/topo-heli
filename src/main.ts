import './style.css';
import { Sfx } from './audio';
import { CONFIG } from './config';
import { Game } from './game';
import { Input } from './input';
import { MAPS } from './maps';
import type { MapData, MapDefinition } from './maps/types';
import { Renderer } from './renderer';
import { flagSvg, getLang, LANGS, onLangChange, placeName, plural, setLang, setPlaceNames, t, type StringKey } from './i18n';
import type { Target, TargetKind } from './targets';

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

const optionKey = (id: string) => `topo-heli:physical:${id}`;
function loadOption(id: string) {
  try {
    return localStorage.getItem(optionKey(id)) === '1';
  } catch {
    return false;
  }
}
function saveOption(id: string, on: boolean) {
  try {
    localStorage.setItem(optionKey(id), on ? '1' : '0');
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

function renderMapSelect() {
  const box = $('map-select');
  box.innerHTML = '';
  for (const m of MAPS) {
    const b = document.createElement('button');
    b.textContent = t(m.nameKey);
    b.classList.toggle('active', m === mapDef);
    b.onclick = () => void selectMap(m);
    box.append(b);
  }
  // The mode switch is only offered for maps that have physical data.
  ui.physicalToggle.hidden = !mapDef.loadPhysical;
  ui.physicalOption.checked = physicalOn;
  // Maps with only rivers (the Netherlands) call the option "Rivers".
  const riversOnly = !!mapDef.physicalRiversOnly;
  $('physical-label').innerHTML = t(riversOnly ? 'physicalOptionRivers' : 'physicalOption');
  $('howto-physical').innerHTML = t(riversOnly ? 'howtoPhysicalRivers' : 'howtoPhysical');
  $('howto-physical').hidden = !physicalOn;
  const best = getBest(scoreId());
  const params = { map: t(mapDef.nameKey), n: best };
  const bestKey: StringKey = !physicalOn ? 'best' : riversOnly ? 'bestPhysicalRivers' : 'bestPhysical';
  ui.best.innerHTML = best > 0 ? t(bestKey, params) : '';
}

async function selectMap(def: MapDefinition) {
  mapDef = def;
  mapData = null;
  physicalOn = !!def.loadPhysical && loadOption(def.id);
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
  game = new Game(mapData, mapDef.viewKm, { physical: !!physical });
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
            t('levelUp', { n: game!.level, bonus: `${CONFIG.levelTimeBonus / 60}:00` }),
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

const FLY_TO: Record<TargetKind, StringKey> = {
  city: 'flyTo',
  river: 'flyToRiver',
  lake: 'flyToLake',
  mountain: 'flyToMountain',
};
const KIND: Record<Exclude<TargetKind, 'city'>, StringKey> = {
  river: 'kindRiver',
  lake: 'kindLake',
  mountain: 'kindMountain',
};

/** Target card: name plus, for physical features, what kind of place it is. */
function setTargetLabel(target: Target) {
  ui.targetLabel.textContent = t(FLY_TO[target.kind]);
  const name = placeName(target.name);
  ui.targetName.textContent = name;
  if (target.kind !== 'city' && !name.toLowerCase().includes(t(KIND[target.kind]).toLowerCase())) {
    const tag = document.createElement('span');
    tag.className = `kind kind-${target.kind}`;
    tag.textContent = t(KIND[target.kind]);
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
    const choose = () => setLang(l.id);
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
ui.physicalOption.onchange = async () => {
  physicalOn = ui.physicalOption.checked;
  saveOption(mapDef.id, physicalOn);
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
  const hints: Record<TargetKind, StringKey> = { city: 'hintCity', river: 'hintRiver', lake: 'hintLake', mountain: 'hintMountain' };
  ui.targetHint.textContent =
    kind === 'river' && progress > 0
      ? t('followRiver', { p: Math.round(progress * 100) })
      : visible && kind
        ? t(hints[kind])
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
void selectMap(mapDef);
requestAnimationFrame(frame);

// Debug handle for automated tests / tinkering in the dev console.
if (import.meta.env.DEV) Object.assign(window, { __game: () => game });

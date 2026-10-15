import './style.css';
import { Sfx } from './audio';
import { CONFIG } from './config';
import { Game } from './game';
import { Input } from './input';
import { MAPS } from './maps';
import type { MapData, MapDefinition } from './maps/types';
import { Renderer } from './renderer';
import { KIND_LABEL, type Target } from './targets';

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
    b.textContent = m.name;
    b.classList.toggle('active', m === mapDef);
    b.onclick = () => void selectMap(m);
    box.append(b);
  }
  // The mode switch is only offered for maps that have physical data.
  ui.physicalToggle.hidden = !mapDef.loadPhysical;
  ui.physicalOption.checked = physicalOn;
  $('howto-physical').hidden = !physicalOn;
  const best = getBest(scoreId());
  const mode = physicalOn ? ' (with mountains, rivers & lakes)' : '';
  ui.best.textContent = best > 0 ? `Best on ${mapDef.name}${mode}: ${best} found` : '';
}

async function selectMap(def: MapDefinition) {
  mapDef = def;
  physicalOn = !!def.loadPhysical && loadOption(def.id);
  renderMapSelect();
  const [data, physical] = await Promise.all([def.load(), def.loadPhysical?.()]);
  mapData = { ...data, physical };
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
            `Level ${game!.level}! +${CONFIG.levelTimeBonus / 60}:00`,
            physicalOn ? 'Lesser-known places, and they show up later' : 'Smaller towns, and the dot shows up later',
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

/** Target card: name plus, for physical features, what kind of place it is. */
function setTargetLabel(t: Target) {
  ui.targetLabel.textContent = t.kind === 'city' ? 'Fly to' : `Fly to the ${KIND_LABEL[t.kind]}`;
  ui.targetName.textContent = t.name;
  if (t.kind !== 'city') {
    const tag = document.createElement('span');
    tag.className = `kind kind-${t.kind}`;
    tag.textContent = KIND_LABEL[t.kind];
    ui.targetName.append(' ', tag);
  }
  ui.progress.hidden = t.kind !== 'river';
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
  $('final-best').textContent =
    score > prevBest && score > 0 ? 'New best score!' : prevBest > 0 ? `Best: ${prevBest}` : '';
  $('final-missed').textContent = game.target ? `The last one was ${game.target.name}.` : '';
  const list = $('found-list');
  list.innerHTML = '';
  const all = [
    ...game.found.map((f) => ({ c: f.target, skipped: false })),
    ...game.skipped.map((c) => ({ c, skipped: true })),
  ];
  for (const { c, skipped } of all) {
    const s = document.createElement('span');
    s.textContent = c.name;
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
  ui.mute.textContent = sfx.muted ? 'Sound off' : 'Sound on';
}

// ---------- Controls ----------

$('btn-start').onclick = start;
ui.physicalOption.onchange = () => {
  physicalOn = ui.physicalOption.checked;
  saveOption(mapDef.id, physicalOn);
  renderMapSelect();
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
  const t = Math.ceil(game.timeLeft);
  ui.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  ui.timer.classList.toggle('low', t <= 15 && state === 'playing');
  ui.score.textContent = String(game.found.length);
  ui.level.textContent = String(game.level);

  const visible = game.targetVisible;
  const kind = game.target?.kind;
  const progress = game.riverProgress;
  (ui.progress.firstElementChild as HTMLElement).style.width = `${Math.round(progress * 100)}%`;
  ui.targetHint.textContent =
    kind === 'river' && progress > 0
      ? `Follow the river: ${Math.round(progress * 100)}%`
      : !visible
        ? ''
        : kind === 'river'
          ? 'Close! Follow the glowing river'
          : kind === 'lake'
            ? 'Close! Fly over the flashing lake'
            : kind === 'mountain'
              ? 'Close! Find the flashing peak'
              : 'Close! Find the flashing dot';
  if (visible && !wasVisible) sfx.reveal();
  wasVisible = visible;

  if (t < lastWholeSecond && t <= 10 && t > 0) sfx.tick();
  lastWholeSecond = t;
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

renderMapSelect();
void selectMap(mapDef);
requestAnimationFrame(frame);

// Debug handle for automated tests / tinkering in the dev console.
if (import.meta.env.DEV) Object.assign(window, { __game: () => game });

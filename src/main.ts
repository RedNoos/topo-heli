import './style.css';
import { Sfx } from './audio';
import { CONFIG } from './config';
import { Game } from './game';
import { Input } from './input';
import { MAPS } from './maps';
import type { MapData, MapDefinition } from './maps/types';
import { Renderer } from './renderer';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('game');
const minimap = $<HTMLCanvasElement>('minimap');
const ui = {
  hud: $('hud'),
  menu: $('menu'),
  pause: $('pause'),
  over: $('over'),
  timer: $('timer'),
  targetName: $('target-name'),
  targetHint: $('target-hint'),
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

// ---------- Best scores ----------

const bestKey = (id: string) => `topo-heli:best:${id}`;
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
  const best = getBest(mapDef.id);
  ui.best.textContent = best > 0 ? `Best on ${mapDef.name}: ${best} cities` : '';
}

async function selectMap(def: MapDefinition) {
  mapDef = def;
  renderMapSelect();
  mapData = await def.load();
  // A non-started game gives the menu a live map in the background.
  newGame(false);
}

function newGame(start: boolean) {
  if (!mapData) return;
  game = new Game(mapData, mapDef.viewKm);
  renderer = new Renderer(canvas, minimap, game, mapData.geo, mapDef.viewKm);
  wasVisible = false;
  lastWholeSecond = Math.ceil(game.timeLeft);
  ui.toast.hidden = true;

  game.on((e) => {
    switch (e.type) {
      case 'target':
        ui.targetName.textContent = e.city.name;
        ui.targetName.classList.remove('pop');
        void ui.targetName.offsetWidth; // restart animation
        ui.targetName.classList.add('pop');
        wasVisible = false;
        updateInsets(); // a long name may wrap and change the HUD height
        break;
      case 'found':
        renderer!.addFoundEffect(e.city, e.city.name);
        if (e.levelUp) {
          sfx.levelUp();
          showToast(
            `Level ${game!.level}! +${CONFIG.levelTimeBonus / 60}:00`,
            'Smaller towns, and the dot shows up later',
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
  const prevBest = getBest(mapDef.id);
  if (score > prevBest) setBest(mapDef.id, score);

  $('final-score').textContent = String(score);
  $('final-best').textContent =
    score > prevBest && score > 0 ? 'New best score!' : prevBest > 0 ? `Best: ${prevBest}` : '';
  $('final-missed').textContent = game.target ? `The last one was ${game.target.name}.` : '';
  const list = $('found-list');
  list.innerHTML = '';
  const all = [
    ...game.found.map((c) => ({ c, skipped: false })),
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
  ui.targetHint.textContent = visible ? 'Close! Find the flashing dot' : '';
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

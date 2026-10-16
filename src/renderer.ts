import { JOYSTICK_RADIUS, type Joystick } from './input';
import type { Found, Game } from './game';
import { placeName } from './i18n';
import type { GeoData, PhysicalData } from './maps/types';
import type { Projection } from './projection';
import type { Target } from './targets';

const COLORS = {
  sea: '#9cc3dc',
  neighbour: '#dedad0',
  neighbourBorder: '#b8b2a4',
  home: '#eef0d2',
  homeBorder: '#5e5038',
  district: 'rgba(120, 110, 80, 0.35)',
  water: '#5c9fd0',
  found: '#2f7d32',
  target: '#e53935',
  foundWater: '#1d5f9e',
  mountain: '#7a5230',
  countryBorder: 'rgba(70, 58, 40, 0.75)',
};

/** Fills for multi-country maps; neighbouring countries get different indexes. */
const COUNTRY_COLORS = ['#f1d9a8', '#cfe2b4', '#f4c6b6', '#dccdea', '#f6eba6', '#bfe0d4'];

interface Effect {
  x: number;
  y: number;
  age: number;
  life: number;
  kind: 'ring' | 'text';
  text?: string;
}

interface Layers {
  neighbours: Path2D;
  home: Path2D;
  lakes: Path2D;
  districts: Path2D;
  /** One path per colour index (multi-country maps only). */
  countries: { color: string; path: Path2D; empty: boolean }[];
  borders: Path2D;
  /** Rivers grouped by drawn width (px at default zoom); inside the playable area. */
  rivers: { width: number; path: Path2D }[];
  /** Base-map water outside the playable area (drawn muted). */
  riversOutside: { width: number; path: Path2D }[];
  lakesOutside: Path2D;
  /** Detailed rivers/water inside the playable area (physical mode), pre-clipped at build time. */
  physical?: { rivers: { width: number; path: Path2D }[]; water: Path2D; lines: Path2D };
}

function buildLayers(geo: GeoData, proj: Projection, physical?: PhysicalData): Layers {
  const ring = (path: Path2D, pts: [number, number][], close: boolean) => {
    pts.forEach(([lon, lat], i) => {
      const p = proj.project(lon, lat);
      if (i === 0) path.moveTo(p.x, p.y);
      else path.lineTo(p.x, p.y);
    });
    if (close) path.closePath();
  };
  const polygons = (polys: [number, number][][][]) => {
    const path = new Path2D();
    for (const poly of polys) for (const r of poly) ring(path, r, true);
    return path;
  };
  const lines = (list: [number, number][][]) => {
    const path = new Path2D();
    for (const l of list) ring(path, l, false);
    return path;
  };

  const widthOf = (rank: number) => (rank <= 4 ? 4.2 : rank <= 8 ? 2.2 : 1.3);
  const byWidth = (list: GeoData['rivers']) => {
    const groups = new Map<number, [number, number][][]>();
    for (const r of list) {
      const w = widthOf(r.r);
      if (!groups.has(w)) groups.set(w, []);
      groups.get(w)!.push(r.l);
    }
    return [...groups].map(([width, l]) => ({ width, path: lines(l) }));
  };

  let phys: Layers['physical'];
  if (physical) {
    // Level 1 rivers are the big ones: draw them widest.
    const widths = [3.6, 2.4, 1.6];
    phys = {
      rivers: widths.map((width, i) => ({ width, path: lines(physical.draw.rivers[i] ?? []) })),
      water: polygons(physical.draw.water),
      lines: lines(physical.draw.lines),
    };
  }

  return {
    physical: phys,
    riversOutside: byWidth(geo.riversOutside),
    lakesOutside: polygons(geo.lakesOutside),
    neighbours: polygons(geo.neighbours),
    countries: COUNTRY_COLORS.map((color, i) => {
      const polys = (geo.countries ?? []).filter((c) => c.c === i).flatMap((c) => c.p);
      return { color, path: polygons(polys), empty: polys.length === 0 };
    }),
    borders: lines(geo.borders ?? []),
    home: polygons(geo.home),
    lakes: polygons(geo.lakes),
    districts: lines(geo.districts),
    rivers: byWidth(geo.rivers),
  };
}

const MIN_VIEW_PX = 560;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layers: Layers;
  private readonly minimap: HTMLCanvasElement;
  private readonly minimapCtx: CanvasRenderingContext2D;
  private minimapStatic: HTMLCanvasElement | null = null;
  private effects: Effect[] = [];
  private targetPaths = new Map<Target, Path2D>();
  private w = 0;
  private h = 0;
  private dpr = 1;
  /** Pixels per km. */
  private scale = 1;
  private cam = { x: 0, y: 0 };
  private rotor = 0;
  private time = 0;
  /** Screen space covered by HUD bars (px); the camera keeps the map clear of them. */
  private insets = { top: 0, bottom: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    minimap: HTMLCanvasElement,
    private readonly game: Game,
    geo: GeoData,
    private readonly viewKm: number,
    physical?: PhysicalData,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.minimap = minimap;
    this.minimapCtx = minimap.getContext('2d')!;
    this.layers = buildLayers(geo, game.projection, physical);
    this.resize();
    this.cam = { x: game.heli.x, y: game.heli.y };
    this.clampCamera();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // Small screens (phones) are treated as at least MIN_VIEW_PX wide, so they zoom in further.
    this.scale = Math.max(Math.min(this.w, this.h), MIN_VIEW_PX) / this.viewKm;
    this.minimapStatic = null;
  }

  setInsets(top: number, bottom: number) {
    this.insets = { top, bottom };
  }

  addFoundEffect(f: Found) {
    this.effects.push({ x: f.x, y: f.y, age: 0, life: 0.9, kind: 'ring' });
    this.effects.push({ x: f.x, y: f.y, age: 0, life: 1.4, kind: 'text', text: placeName(f.target.name) });
  }

  /** Path2D (km coordinates) for a river or lake target, built once. */
  private pathOf(t: Target): Path2D {
    let p = this.targetPaths.get(t);
    if (!p) {
      const path = new Path2D();
      for (const l of t.lines ?? t.rings ?? []) {
        l.forEach((pt, i) => (i === 0 ? path.moveTo(pt.x, pt.y) : path.lineTo(pt.x, pt.y)));
        if (t.rings) path.closePath();
      }
      this.targetPaths.set(t, path);
      p = path;
    }
    return p;
  }

  private clampCamera() {
    const b = this.game.bounds;
    const halfW = this.w / 2 / this.scale;
    const top = (this.h / 2 - this.insets.top) / this.scale;
    const bottom = (this.h / 2 - this.insets.bottom) / this.scale;
    const clamp = (v: number, min: number, max: number) =>
      min > max ? (min + max) / 2 : Math.min(max, Math.max(min, v));
    this.cam.x = clamp(this.cam.x, b.minX + halfW, b.maxX - halfW);
    this.cam.y = clamp(this.cam.y, b.minY + top, b.maxY - bottom);
  }

  private toScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.scale + this.w / 2, y: (y - this.cam.y) * this.scale + this.h / 2 };
  }

  render(dt: number, joystick: Joystick | null) {
    const { ctx, game } = this;
    this.time += dt;
    this.rotor += dt * 28;

    // Camera follows the helicopter, leading a little in the flying direction.
    const h = game.heli;
    const lead = 0.6;
    const k = 1 - Math.exp(-4 * dt);
    this.cam.x += (h.x + h.vx * lead - this.cam.x) * k;
    // Keep the helicopter centred in the area between the HUD bars.
    const offsetY = (this.insets.top - this.insets.bottom) / 2 / this.scale;
    this.cam.y += (h.y + h.vy * lead - offsetY - this.cam.y) * k;
    this.clampCamera();

    const s = this.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.sea;
    ctx.fillRect(0, 0, this.w, this.h);

    // --- World layers (km coordinates) ---
    ctx.setTransform(
      this.dpr * s, 0, 0, this.dpr * s,
      this.dpr * (this.w / 2 - this.cam.x * s),
      this.dpr * (this.h / 2 - this.cam.y * s),
    );
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const L = this.layers;
    const px = (n: number) => n / s;
    // River widths grow a bit when zoomed in (big screens), stay readable when zoomed out.
    const riverScale = Math.min(1.6, Math.max(0.8, s / 3));

    ctx.fillStyle = COLORS.neighbour;
    ctx.fill(L.neighbours, 'evenodd');
    ctx.strokeStyle = COLORS.neighbourBorder;
    ctx.lineWidth = px(1);
    ctx.stroke(L.neighbours);

    this.fillHome(ctx);

    ctx.strokeStyle = COLORS.district;
    ctx.lineWidth = px(1.2);
    ctx.setLineDash([px(5), px(4)]);
    ctx.stroke(L.districts);
    ctx.setLineDash([]);

    // Water: muted outside the playable area, full colour inside it. Both are split at build
    // time, so no (expensive) clipping to the country shape is needed per frame.
    const strokeRivers = (list: { width: number; path: Path2D }[]) => {
      for (const r of list) {
        ctx.lineWidth = px(r.width * riverScale);
        ctx.stroke(r.path);
      }
    };
    ctx.strokeStyle = COLORS.water;
    ctx.fillStyle = COLORS.water;
    ctx.globalAlpha = 0.35;
    strokeRivers(L.riversOutside);
    ctx.fill(L.lakesOutside, 'evenodd');
    ctx.globalAlpha = 1;
    ctx.fill(L.lakes, 'evenodd');
    if (L.physical) {
      ctx.lineWidth = px(3.6 * riverScale);
      ctx.stroke(L.physical.lines);
      strokeRivers(L.physical.rivers);
      // nonzero: overlapping water shapes add up instead of cancelling; islands are
      // wound the other way, so they stay land.
      ctx.fill(L.physical.water, 'nonzero');
    } else {
      strokeRivers(L.rivers);
    }

    this.drawWorldTargets(px);

    ctx.strokeStyle = COLORS.countryBorder;
    ctx.lineWidth = px(1.6);
    ctx.stroke(L.borders);

    ctx.strokeStyle = 'rgba(94, 80, 56, 0.25)';
    ctx.lineWidth = px(7);
    ctx.stroke(L.home);
    ctx.strokeStyle = COLORS.homeBorder;
    ctx.lineWidth = px(2.2);
    ctx.stroke(L.home);

    // --- Screen-space overlays ---
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawFoundCities();
    if (!game.over && game.target && game.targetVisible) this.drawTarget(game.target);
    this.drawEffects(dt);
    this.drawHeli();
    if (joystick) this.drawJoystick(joystick);
    this.drawMinimap();
  }

  /** Fills the playable area: one colour, or a colour per country. */
  private fillHome(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = COLORS.home;
    // Multi-country maps are fully covered by the per-country fills below.
    if (this.layers.countries.every((c) => c.empty)) ctx.fill(this.layers.home, 'evenodd');
    for (const c of this.layers.countries) {
      ctx.fillStyle = c.color;
      ctx.fill(c.path, 'evenodd');
    }
  }

  /** Found rivers/lakes and the current river/lake target, drawn in km coordinates. */
  private drawWorldTargets(px: (n: number) => number) {
    const { ctx, game } = this;
    for (const f of game.found) {
      const t = f.target;
      if (t.kind === 'river') {
        ctx.strokeStyle = COLORS.foundWater;
        ctx.lineWidth = px(3);
        ctx.stroke(this.pathOf(t));
      } else if (t.kind === 'lake') {
        ctx.fillStyle = COLORS.foundWater;
        ctx.fill(this.pathOf(t), 'evenodd');
      }
    }

    const t = game.target;
    if (!t || game.over || !game.targetVisible || (t.kind !== 'river' && t.kind !== 'lake')) return;
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 6);
    if (t.kind === 'lake') {
      ctx.fillStyle = `rgba(229, 57, 53, ${0.25 + 0.3 * pulse})`;
      ctx.fill(this.pathOf(t), 'evenodd');
      ctx.strokeStyle = COLORS.target;
      ctx.lineWidth = px(2.5);
      ctx.stroke(this.pathOf(t));
      return;
    }
    // River: only the stretch within reveal range glows, so you still have to follow it.
    ctx.save();
    ctx.beginPath();
    ctx.arc(game.heli.x, game.heli.y, game.revealRadius, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = `rgba(229, 57, 53, ${0.35 + 0.4 * pulse})`;
    ctx.lineWidth = px(9);
    ctx.stroke(this.pathOf(t));
    ctx.restore();
    // Trail of the course covered so far.
    ctx.fillStyle = '#ffd54f';
    for (const p of game.coveredSamples) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, px(3.2), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawFoundCities() {
    const ctx = this.ctx;
    ctx.textBaseline = 'middle';
    for (const f of this.game.found) {
      const p = this.toScreen(f.x, f.y);
      if (p.x < -100 || p.y < -20 || p.x > this.w + 100 || p.y > this.h + 20) continue;
      const kind = f.target.kind;
      if (kind === 'city') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.found;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      } else if (kind === 'mountain') {
        this.mountainIcon(p.x, p.y, 6, COLORS.mountain);
      }
      // Water names are centred on the water, in italics (map convention).
      const water = kind === 'river' || kind === 'lake';
      ctx.font = water ? 'italic 600 12px system-ui, sans-serif' : '600 12px system-ui, sans-serif';
      ctx.textAlign = water ? 'center' : 'left';
      const x = water ? p.x : p.x + 8;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      const label = placeName(f.target.name);
      ctx.strokeText(label, x, p.y);
      ctx.fillStyle = water ? COLORS.foundWater : kind === 'mountain' ? '#5a3a1c' : '#24421f';
      ctx.fillText(label, x, p.y);
    }
  }

  private mountainIcon(x: number, y: number, r: number, fill: string, stroke = '#fff') {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.2);
    ctx.lineTo(x + r, y + r * 0.7);
    ctx.lineTo(x - r, y + r * 0.7);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  /** City or mountain target within reveal range: flashing marker. */
  private drawTarget(c: Target) {
    if (c.kind !== 'city' && c.kind !== 'mountain') return;
    const ctx = this.ctx;
    const p = this.toScreen(c.x, c.y);
    const t = this.time;
    // Expanding sonar ring.
    const phase = (t * 1.2) % 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6 + phase * 26, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(229, 57, 53, ${0.7 * (1 - phase)})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    const on = Math.sin(t * 12) > -0.3;
    if (c.kind === 'mountain') {
      this.mountainIcon(p.x, p.y, on ? 10 : 8, on ? COLORS.target : '#fff', on ? '#fff' : COLORS.target);
      return;
    }
    // Flashing dot.
    ctx.beginPath();
    ctx.arc(p.x, p.y, on ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = on ? COLORS.target : '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = on ? '#fff' : COLORS.target;
    ctx.stroke();
  }

  private drawEffects(dt: number) {
    const ctx = this.ctx;
    this.effects = this.effects.filter((e) => (e.age += dt) < e.life);
    for (const e of this.effects) {
      const p = this.toScreen(e.x, e.y);
      const f = e.age / e.life;
      if (e.kind === 'ring') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8 + f * 70, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(47, 125, 50, ${1 - f})`;
        ctx.lineWidth = 4 * (1 - f) + 1;
        ctx.stroke();
      } else {
        ctx.font = '800 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.globalAlpha = 1 - f * f;
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#fff';
        ctx.strokeText(e.text!, p.x, p.y - 24 - f * 40);
        ctx.fillStyle = COLORS.found;
        ctx.fillText(e.text!, p.x, p.y - 24 - f * 40);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawHeli() {
    const ctx = this.ctx;
    const h = this.game.heli;
    const p = this.toScreen(h.x, h.y);
    const size = Math.max(0.75, Math.min(1.1, Math.min(this.w, this.h) / 800));
    const speed = Math.hypot(h.vx, h.vy);
    const bob = Math.sin(this.time * 3) * 1.5;

    // Shadow on the ground.
    this.heliShape(p.x + 14 * size, p.y + 18 * size, h.heading, size * 0.95, true);
    // Slight forward pitch when flying fast (body looks shorter).
    const pitch = 1 - Math.min(speed / this.game.maxSpeed, 1) * 0.08;
    ctx.save();
    ctx.translate(0, bob);
    this.heliShape(p.x, p.y, h.heading, size, false, pitch);
    ctx.restore();
  }

  private heliShape(x: number, y: number, heading: number, size: number, shadow: boolean, pitch = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.scale(size * pitch, size);
    const dark = 'rgba(0,0,0,0.22)';

    // Tail boom + fin.
    ctx.fillStyle = shadow ? dark : '#b8321c';
    ctx.beginPath();
    ctx.moveTo(-6, -3);
    ctx.lineTo(-36, -1.5);
    ctx.lineTo(-36, 1.5);
    ctx.lineTo(-6, 3);
    ctx.fill();
    ctx.fillRect(-38, -6, 5, 12);

    // Skids.
    if (!shadow) {
      ctx.strokeStyle = '#3b3b3b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-12, -11); ctx.lineTo(14, -11);
      ctx.moveTo(-12, 11); ctx.lineTo(14, 11);
      ctx.stroke();
    }

    // Body.
    ctx.beginPath();
    ctx.ellipse(2, 0, 16, 9.5, 0, 0, Math.PI * 2);
    if (shadow) {
      ctx.fillStyle = dark;
      ctx.fill();
    } else {
      const g = ctx.createLinearGradient(0, -10, 0, 10);
      g.addColorStop(0, '#ff7b5c');
      g.addColorStop(0.5, '#e5482b');
      g.addColorStop(1, '#a92f19');
      ctx.fillStyle = g;
      ctx.fill();
      // Cockpit glass.
      ctx.beginPath();
      ctx.ellipse(10, 0, 7, 7, 0, -Math.PI / 2, Math.PI / 2);
      ctx.fillStyle = '#9fd8f5';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(11, -2.5, 3, 1.6, 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fill();
    }

    // Tail rotor.
    ctx.save();
    ctx.translate(-36, 7);
    ctx.rotate(this.rotor * 1.7);
    ctx.fillStyle = shadow ? dark : '#333';
    ctx.fillRect(-6, -1, 12, 2);
    ctx.restore();

    // Main rotor: motion-blur disc + two blades.
    ctx.beginPath();
    ctx.arc(2, 0, 30, 0, Math.PI * 2);
    ctx.fillStyle = shadow ? 'rgba(0,0,0,0.06)' : 'rgba(40,40,40,0.10)';
    ctx.fill();
    ctx.save();
    ctx.translate(2, 0);
    ctx.rotate(this.rotor);
    ctx.fillStyle = shadow ? dark : '#2b2b2b';
    for (let i = 0; i < 2; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.roundRect(-31, -2, 62, 4, 2);
      ctx.fill();
    }
    if (!shadow) {
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#666';
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
  }

  private drawJoystick(j: Joystick) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(j.baseX, j.baseY, JOYSTICK_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(j.knobX, j.knobY, 26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
    ctx.stroke();
  }

  private drawMinimap() {
    const mm = this.minimap;
    const ctx = this.minimapCtx;
    const b = this.game.bounds;
    const cssW = mm.clientWidth;
    if (cssW === 0) return;
    const cssH = cssW * ((b.maxY - b.minY) / (b.maxX - b.minX));
    const ms = cssW / (b.maxX - b.minX);

    if (!this.minimapStatic || mm.width !== Math.round(cssW * this.dpr)) {
      mm.style.height = `${cssH}px`;
      mm.width = Math.round(cssW * this.dpr);
      mm.height = Math.round(cssH * this.dpr);
      const off = document.createElement('canvas');
      off.width = mm.width;
      off.height = mm.height;
      const o = off.getContext('2d')!;
      o.fillStyle = COLORS.sea;
      o.fillRect(0, 0, off.width, off.height);
      o.setTransform(this.dpr * ms, 0, 0, this.dpr * ms, -b.minX * ms * this.dpr, -b.minY * ms * this.dpr);
      o.fillStyle = COLORS.neighbour;
      o.fill(this.layers.neighbours, 'evenodd');
      this.fillHome(o);
      o.strokeStyle = COLORS.countryBorder;
      o.lineWidth = 0.6 / ms;
      o.stroke(this.layers.borders);
      o.strokeStyle = COLORS.water;
      o.lineWidth = 1.2 / ms;
      for (const r of this.layers.rivers) if (r.width > 2) o.stroke(r.path);
      o.strokeStyle = COLORS.homeBorder;
      o.lineWidth = 1.2 / ms;
      o.stroke(this.layers.home);
      this.minimapStatic = off;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.minimapStatic, 0, 0);
    ctx.setTransform(this.dpr * ms, 0, 0, this.dpr * ms, -b.minX * ms * this.dpr, -b.minY * ms * this.dpr);

    // Visible area.
    const vw = this.w / this.scale;
    const vh = this.h / this.scale;
    ctx.strokeStyle = 'rgba(30,30,30,0.7)';
    ctx.lineWidth = 1.2 / ms;
    ctx.strokeRect(this.cam.x - vw / 2, this.cam.y - vh / 2, vw, vh);

    for (const c of this.game.found) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 1.8 / ms, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.found;
      ctx.fill();
    }
    const h = this.game.heli;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 3.5 / ms, 0, Math.PI * 2);
    ctx.fillStyle = '#e5482b';
    ctx.fill();
    ctx.lineWidth = 1.2 / ms;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}

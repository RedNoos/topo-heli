import { CONFIG } from './config';
import { JOYSTICK_RADIUS, type Joystick } from './input';
import type { Found, Game } from './game';
import { placeName } from './i18n';
import type { GeoData, PhysicalData } from './maps/types';
import type { Projection } from './projection';
import { insideRing, nearestSample, type Pt, type Target } from './targets';

const COLORS = {
  sea: '#9cc3dc',
  neighbour: '#dedad0',
  neighbourBorder: '#b8b2a4',
  home: '#eef0d2',
  homeBorder: '#5e5038',
  district: 'rgba(120, 110, 80, 0.35)',
  region: 'rgba(110, 95, 65, 0.55)',
  water: '#5c9fd0',
  found: '#2f7d32',
  target: '#e53935',
  foundWater: '#1d5f9e',
  mountain: '#7a5230',
  area: '#7b4fa0',
  dike: '#6d5b45',
  countryBorder: 'rgba(70, 58, 40, 0.75)',
};

/**
 * Helicopter parts in its own px (nose along +x), built once and shared by the helicopter and
 * its shadow. The blades turn around their hub (origin, at HUB), the tail rotor around its axle
 * (origin, at TAIL_AXLE).
 */
const HELI = (() => {
  const boom = new Path2D();
  boom.moveTo(-6, -3);
  boom.lineTo(-36, -1.5);
  boom.lineTo(-36, 1.5);
  boom.lineTo(-6, 3);
  boom.closePath();
  const fin = new Path2D();
  fin.rect(-38, -6, 5, 12);
  const skids = new Path2D();
  skids.rect(-12, -12, 26, 2);
  skids.rect(-12, 10, 26, 2);
  const hull = new Path2D();
  hull.ellipse(2, 0, 16, 9.5, 0, 0, Math.PI * 2);
  const cockpit = new Path2D();
  cockpit.ellipse(10, 0, 7, 7, 0, -Math.PI / 2, Math.PI / 2);
  const glint = new Path2D();
  glint.ellipse(11, -2.5, 3, 1.6, 0.3, 0, Math.PI * 2);
  const disc = new Path2D();
  disc.arc(2, 0, 30, 0, Math.PI * 2);
  // Both blades in one path, so where they cross is filled once (no darker spot in the shadow).
  const blades = new Path2D();
  blades.roundRect(-31, -2, 62, 4, 2);
  blades.roundRect(-2, -31, 4, 62, 2);
  const hub = new Path2D();
  hub.arc(0, 0, 3, 0, Math.PI * 2);
  const tailRotor = new Path2D();
  tailRotor.rect(-6, -1, 12, 2);
  return { boom, fin, skids, hull, cockpit, glint, disc, blades, hub, tailRotor };
})();
const HUB = { x: 2, y: 0 };
const TAIL_AXLE = { x: -36, y: 7 };

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
  regions: Path2D;
  /** One path per colour index (multi-country maps only). */
  countries: { color: string; path: Path2D; empty: boolean }[];
  borders: Path2D;
  /** Frames around insets (islands moved closer than they are). */
  insets: Path2D;
  /** Rivers grouped by drawn width (px at default zoom); inside the playable area. */
  rivers: { width: number; path: Path2D }[];
  /** Base-map water outside the playable area (drawn muted). */
  riversOutside: { width: number; path: Path2D }[];
  lakesOutside: Path2D;
  /** Detailed rivers/water inside the playable area (physical mode), pre-clipped at build time. */
  physical?: { rivers: { width: number; path: Path2D }[]; water: Path2D; lines: Path2D };
}

/**
 * Base-map lakes not already drawn by the detailed physical water: the coarse Natural Earth
 * shape and the OSM one don't line up, so both would show as a double outline. A lake counts as
 * covered when a water ring has about the same bounding box, or when at least half of a grid of
 * points inside it lies in the physical water.
 */
function uncoveredLakes(lakes: GeoData['lakes'], water: PhysicalData['draw']['water'], proj: Projection): GeoData['lakes'] {
  const toPts = (r: [number, number][]) => r.map(([lon, lat]) => proj.project(lon, lat));
  const box = (r: Pt[]) => {
    const b = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of r) {
      b[0] = Math.min(b[0], p.x);
      b[1] = Math.max(b[1], p.x);
      b[2] = Math.min(b[2], p.y);
      b[3] = Math.max(b[3], p.y);
    }
    return b;
  };
  const waterRings = water.flatMap((poly) => poly.map(toPts)).map((r) => ({ r, b: box(r) }));
  return lakes.filter((poly) => {
    const [outer, ...holes] = poly.map(toPts);
    const inLake = (p: Pt) => insideRing(p, outer) && !holes.some((h) => insideRing(p, h));
    const [x0, x1, y0, y1] = box(outer);
    // Only the water rings whose box overlaps the lake's (the background water can be large).
    const nearBoxes = waterRings.filter(({ b }) => b[0] <= x1 && b[1] >= x0 && b[2] <= y1 && b[3] >= y0);
    // Same lake with about the same extent: long, narrow lakes (Wakatipu) are shifted too much
    // for the grid test below.
    const area = (b: number[]) => (b[1] - b[0]) * (b[3] - b[2]);
    const sameBox = nearBoxes.some(({ b }) => {
      const overlap = (Math.min(x1, b[1]) - Math.max(x0, b[0])) * (Math.min(y1, b[3]) - Math.max(y0, b[2]));
      return overlap >= 0.5 * (area(b) + area([x0, x1, y0, y1]) - overlap);
    });
    if (sameBox) return false;
    const near = nearBoxes.map(({ r }) => r);
    const inWater = (p: Pt) => near.some((r) => insideRing(p, r));
    const N = 12;
    let inside = 0;
    let wet = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const p = { x: x0 + ((i + 0.5) / N) * (x1 - x0), y: y0 + ((j + 0.5) / N) * (y1 - y0) };
        if (!inLake(p)) continue;
        inside++;
        if (inWater(p)) wet++;
      }
    }
    return inside === 0 || wet / inside < 0.5;
  });
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
    // Edges sampled along the box, so the frame follows the projection.
    insets: polygons(
      (geo.insets ?? []).map(({ box: [w, s, e, n] }) => {
        const steps = Array.from({ length: 9 }, (_, i) => i / 8);
        return [[...steps.map((f): [number, number] => [w + f * (e - w), n]), ...steps.map((f): [number, number] => [e - f * (e - w), s])]];
      }),
    ),
    home: polygons(geo.home),
    lakes: polygons(physical ? uncoveredLakes(geo.lakes, physical.draw.water, proj) : geo.lakes),
    districts: lines(geo.districts),
    regions: lines(geo.regions ?? []),
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
  /** Discover mode: dot radius per city, bigger for the bigger places. */
  private dotSizes: Map<Target, number> | null = null;
  /** Discover mode: the targets in drawing order (see drawDiscover). */
  private discoverOrder: Target[] | null = null;
  /** Offscreen canvas for the helicopter shadow (see drawHeliShadow). */
  private shadowCanvas: HTMLCanvasElement | null = null;
  private shadowCtx: CanvasRenderingContext2D | null = null;
  /** Helicopter body fill, made once for this canvas. */
  private bodyFill: CanvasGradient | null = null;
  /** Minimap width in css px; read once after a resize (reading it every frame forces a layout). */
  private minimapW = 0;
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
    this.minimapW = 0;
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
      for (const l of t.lines ?? [...(t.rings ?? []), ...(t.holes ?? [])]) {
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

  /**
   * Calm camera: stands still while the helicopter is inside a dead zone in the middle of the
   * play area (between the HUD bars) and only scrolls, eased, once it flies out of it.
   * At speed it keeps a point ahead of the helicopter in the zone, so there is more map ahead.
   * (A camera that always follows the helicopter was here until 2026-11; a settings menu could
   * bring it back as an option.)
   */
  private calmCamera(dt: number) {
    const h = this.game.heli;
    const { deadZoneX, deadZoneY, ease, edgeMargin, lead } = CONFIG.camera;
    const s = this.scale;
    const playH = this.h - this.insets.top - this.insets.bottom;
    const offsetY = (this.insets.top - this.insets.bottom) / 2 / s;
    const k = 1 - Math.exp(-ease * dt);
    /** One axis: size = play area size (px), share = dead zone share of it. */
    const axis = (cam: number, pos: number, v: number, size: number, share: number) => {
      const zone = (size * share) / 2 / s;
      const d = pos + v * lead - cam; // a point ahead of the helicopter, so it sees more ahead at speed
      cam += (d - Math.max(-zone, Math.min(zone, d))) * k;
      // Never let the helicopter get closer than edgeMargin to the edge of the play area.
      const max = Math.max(0, (size / 2 - Math.min(this.w, this.h) * edgeMargin) / s);
      return Math.max(pos - max, Math.min(pos + max, cam));
    };
    this.cam.x = axis(this.cam.x, h.x, h.vx, this.w, deadZoneX);
    // y works on the centre of the play area, which sits offsetY below the camera centre.
    this.cam.y = axis(this.cam.y + offsetY, h.y, h.vy, playH, deadZoneY) - offsetY;
  }

  private toScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.scale + this.w / 2, y: (y - this.cam.y) * this.scale + this.h / 2 };
  }

  /** Map point (km) under a screen point (client px), with the camera of the last frame. */
  toWorld(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.w / 2) / this.scale + this.cam.x,
      y: (clientY - r.top - this.h / 2) / this.scale + this.cam.y,
    };
  }

  render(dt: number, joystick: Joystick | null) {
    const { ctx, game } = this;
    this.time += dt;
    this.rotor += dt * 28;

    this.calmCamera(dt);
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
    // Provinces / regions: a bit clearer than the districts.
    ctx.strokeStyle = COLORS.region;
    ctx.lineWidth = px(1.6);
    ctx.setLineDash([px(6), px(4)]);
    ctx.stroke(L.regions);
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
    this.strokeInsets(ctx, px(1.4), [px(7), px(5)]);

    // --- Screen-space overlays ---
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (game.discover) this.drawDiscover();
    this.drawFoundCities();
    if (!game.over && game.target && game.targetVisible) this.drawTarget(game.target);
    this.drawEffects(dt);
    if (game.flyTo && !game.over) this.drawFlyTo(game.flyTo);
    this.drawHeli();
    if (joystick) this.drawJoystick(joystick);
    this.drawMinimap();
  }

  /** Dashed frames around the insets (islands drawn closer than they are). */
  private strokeInsets(ctx: CanvasRenderingContext2D, width: number, dash: number[]) {
    ctx.save();
    ctx.strokeStyle = COLORS.homeBorder;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.stroke(this.layers.insets);
    ctx.restore();
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

  /** Found rivers/lakes/areas and the current river/lake/area target, drawn in km coordinates. */
  private drawWorldTargets(px: (n: number) => number) {
    const { ctx, game } = this;
    if (game.discover) return this.drawHovered(px);
    // Areas first: waters are drawn over them.
    for (const f of game.found) {
      if (f.target.kind !== 'area') continue;
      ctx.fillStyle = 'rgba(123, 79, 160, 0.07)';
      ctx.fill(this.pathOf(f.target), 'evenodd');
      ctx.strokeStyle = COLORS.area;
      ctx.lineWidth = px(1.5);
      ctx.stroke(this.pathOf(f.target));
    }
    for (const f of game.found) {
      const t = f.target;
      if (t.kind === 'river') {
        ctx.strokeStyle = t.sub === 'dike' ? COLORS.dike : COLORS.foundWater;
        ctx.lineWidth = px(3);
        ctx.stroke(this.pathOf(t));
      } else if (t.kind === 'lake') {
        ctx.fillStyle = COLORS.foundWater;
        ctx.fill(this.pathOf(t), 'evenodd');
      }
    }

    const t = game.target;
    if (!t || game.over || !game.targetVisible || (t.kind !== 'river' && t.kind !== 'lake' && t.kind !== 'area')) return;
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 6);
    if (t.kind === 'area') {
      ctx.fillStyle = `rgba(229, 57, 53, ${0.12 + 0.18 * pulse})`;
      ctx.fill(this.pathOf(t), 'evenodd');
      ctx.strokeStyle = COLORS.target;
      ctx.lineWidth = px(2 + 1.5 * pulse);
      ctx.stroke(this.pathOf(t));
      return;
    }
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
      } else if (kind === 'landmark') {
        this.landmarkIcon(f.target, p.x, p.y, 13, COLORS.found);
      }
      this.drawLabel(f.target, p);
    }
  }

  /** A place name on the map, styled by kind (screen coordinates). */
  private drawLabel(t: Target, p: { x: number; y: number }) {
    const ctx = this.ctx;
    const kind = t.kind;
    // Water names are centred on the water, in italics (map convention); areas centred, upright.
    const dike = t.sub === 'dike';
    const water = (kind === 'river' || kind === 'lake') && !dike;
    const centred = kind === 'river' || kind === 'lake' || kind === 'area';
    ctx.textBaseline = 'middle';
    ctx.font = water ? 'italic 600 12px system-ui, sans-serif' : kind === 'area' ? '700 13px system-ui, sans-serif' : '600 12px system-ui, sans-serif';
    ctx.textAlign = centred ? 'center' : 'left';
    const x = centred ? p.x : p.x + 8;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    const label = placeName(t.name);
    ctx.strokeText(label, x, p.y);
    ctx.fillStyle = water ? COLORS.foundWater : dike ? COLORS.dike : kind === 'area' ? COLORS.area : kind === 'mountain' ? '#5a3a1c' : '#24421f';
    ctx.fillText(label, x, p.y);
  }

  /** Discover mode: the river, lake or area the helicopter is over (km coordinates). */
  private drawHovered(px: (n: number) => number) {
    const { ctx } = this;
    const t = this.game.hovered;
    if (t?.kind === 'area') {
      ctx.fillStyle = 'rgba(123, 79, 160, 0.07)';
      ctx.fill(this.pathOf(t), 'evenodd');
      ctx.strokeStyle = COLORS.area;
      ctx.lineWidth = px(2);
      ctx.stroke(this.pathOf(t));
    } else if (t?.kind === 'river') {
      ctx.strokeStyle = t.sub === 'dike' ? COLORS.dike : COLORS.foundWater;
      ctx.lineWidth = px(3.5);
      ctx.stroke(this.pathOf(t));
    } else if (t?.kind === 'lake') {
      ctx.fillStyle = COLORS.foundWater;
      ctx.fill(this.pathOf(t), 'evenodd');
    }
  }

  /**
   * Discover mode: a marker for everything to discover (cities dots, mountains green, landmarks
   * purple, lakes a blue drop and areas a purple diamond at their name's spot), names near the
   * helicopter (fading with distance).
   */
  private drawDiscover() {
    const { ctx, game } = this;
    const hovered = game.hovered;
    // Lakes and areas first, so the dots of the places in them stay on top.
    if (!this.discoverOrder) {
      const order = (t: Target) => (t.kind === 'area' ? 0 : t.kind === 'lake' ? 1 : 2);
      this.discoverOrder = game.targets.filter((t) => t.kind !== 'river').sort((a, b) => order(a) - order(b));
    }
    for (const t of this.discoverOrder) {
      const p = this.toScreen(t.x, t.y);
      if (p.x < -20 || p.y < -20 || p.x > this.w + 20 || p.y > this.h + 20) continue;
      const on = t === hovered;
      if (t.kind === 'area') {
        this.diamondIcon(p.x, p.y, on ? 7 : 4.5, on ? COLORS.target : COLORS.area);
      } else if (t.kind === 'lake') {
        this.dropIcon(p.x, p.y, on ? 7 : 4.5, on ? COLORS.target : COLORS.foundWater);
      } else if (t.kind === 'mountain') {
        this.mountainIcon(p.x, p.y, on ? 8 : 5, on ? COLORS.target : COLORS.found);
      } else if (t.kind === 'landmark') {
        this.landmarkIcon(t, p.x, p.y, on ? 17 : 14, on ? COLORS.target : COLORS.area);
      } else {
        ctx.beginPath();
        const r = this.dotSize(t);
        ctx.arc(p.x, p.y, on ? r + 3 : r, 0, Math.PI * 2);
        ctx.fillStyle = on ? COLORS.target : COLORS.homeBorder;
        ctx.fill();
        ctx.lineWidth = on ? 2 : 1.2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    }
    // Areas only get the card: their names would sit far from the helicopter.
    const r = CONFIG.discover.nameRadius * game.distScale;
    const fade = r * CONFIG.discover.fade;
    for (const { target: t, d } of game.nearby) {
      if (t.kind === 'area') continue;
      const at = t.kind === 'river' ? nearestSample(t, game.heli) : t;
      ctx.globalAlpha = Math.min(1, (r - d) / fade);
      this.drawLabel(t, this.toScreen(at.x, at.y));
    }
    ctx.globalAlpha = 1;
  }

  /** Discover mode: dot radius of a city, from its population rank among the cities shown. */
  private dotSize(t: Target): number {
    if (!this.dotSizes) {
      const { dots, dotR } = CONFIG.discover;
      const cities = this.game.targets.filter((x) => x.kind === 'city').sort((a, b) => b.pop - a.pop);
      this.dotSizes = new Map(cities.map((x, i) => [x, dots.find((d) => i < d.upTo)?.r ?? dotR]));
    }
    return this.dotSizes.get(t) ?? CONFIG.discover.dotR;
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

  /** Area marker (Discover mode): a diamond, `r` from the centre to a corner. */
  private diamondIcon(x: number, y: number, r: number, fill: string) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  /** Lake marker (Discover mode): a water drop, `r` the radius of its round part. */
  private dropIcon(x: number, y: number, r: number, fill: string) {
    const ctx = this.ctx;
    const cy = y + r * 0.35;
    ctx.beginPath();
    ctx.moveTo(x, cy - r * 2);
    ctx.arc(x, cy, r, -Math.PI / 2 + 0.85, Math.PI * 1.5 - 0.85);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  /** Landmark symbol: a plane (airport) or a flag on a pole (historic site). */
  private landmarkIcon(t: Target, x: number, y: number, size: number, fill: string, stroke = '#fff') {
    if (t.sub === 'historic') this.flagIcon(x, y, size, fill, stroke);
    else this.planeIcon(x, y, size, fill, stroke);
  }

  /** Historic site symbol: a flag on a pole, the pole's foot on the spot. */
  private flagIcon(x: number, y: number, size: number, fill: string, stroke = '#fff') {
    const ctx = this.ctx;
    const h = size * 0.9;
    const px = x - size * 0.25;
    const flag = new Path2D();
    flag.moveTo(px, y - h);
    flag.lineTo(px + size * 0.6, y - h * 0.78);
    flag.lineTo(px, y - h * 0.56);
    flag.closePath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(px, y + 1);
    ctx.lineTo(px, y - h);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.stroke(flag);
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px, y - h);
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill(flag);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  /** Airport symbol. */
  private planeIcon(x: number, y: number, size: number, fill: string, stroke = '#fff') {
    const ctx = this.ctx;
    ctx.font = `${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = stroke;
    ctx.strokeText('✈', x, y);
    ctx.fillStyle = fill;
    ctx.fillText('✈', x, y);
    ctx.textBaseline = 'middle';
  }

  /** City, mountain or landmark target within reveal range: flashing marker. */
  private drawTarget(c: Target) {
    if (c.kind !== 'city' && c.kind !== 'mountain' && c.kind !== 'landmark') return;
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
    if (c.kind === 'landmark') {
      this.landmarkIcon(c, p.x, p.y, on ? 22 : 18, on ? COLORS.target : '#fff', on ? '#fff' : COLORS.target);
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
    this.drawHeliShadow(p.x + 14 * size, p.y + 18 * size, h.heading, size * 0.95);
    // Slight forward pitch when flying fast (body looks shorter).
    const pitch = 1 - Math.min(speed / this.game.maxSpeed, 1) * 0.08;
    ctx.save();
    ctx.translate(0, bob);
    this.heliShape(p.x, p.y, h.heading, size, pitch);
    ctx.restore();
  }

  /**
   * The shadow is drawn opaque on a small offscreen canvas first and then put down with one
   * alpha, so overlapping parts don't add up to darker patches. Only the rotor disc is lighter:
   * light passes through the spinning blades.
   */
  private drawHeliShadow(x: number, y: number, heading: number, size: number) {
    const R = 42 * size; // css px; covers rotor and tail
    const side = Math.ceil(2 * R * this.dpr);
    if (!this.shadowCanvas || this.shadowCanvas.width !== side) {
      this.shadowCanvas = document.createElement('canvas');
      this.shadowCanvas.width = this.shadowCanvas.height = side;
      // CPU-backed: drawing this tiny canvas is cheaper than syncing a GPU canvas every frame.
      this.shadowCtx = this.shadowCanvas.getContext('2d', { willReadFrequently: true })!;
    }
    const s = this.shadowCtx!;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, side, side);
    s.setTransform(this.dpr * size, 0, 0, this.dpr * size, side / 2, side / 2);
    s.rotate(heading);
    s.fillStyle = '#000';

    // Rotor disc with the blades a little darker.
    s.globalAlpha = 0.3;
    s.fill(HELI.disc);
    s.save();
    s.translate(HUB.x, HUB.y);
    s.rotate(this.rotor);
    s.globalAlpha = 0.4;
    s.fill(HELI.blades);
    s.restore();

    // Body, tail, fin, skids and tail rotor, opaque. Each part is filled on its own: merged
    // into one path, parts drawn in opposite directions would cancel out where they overlap.
    s.globalAlpha = 1;
    for (const part of [HELI.boom, HELI.fin, HELI.skids, HELI.hull]) s.fill(part);
    s.translate(TAIL_AXLE.x, TAIL_AXLE.y);
    s.rotate(this.rotor * 1.7);
    s.fill(HELI.tailRotor);

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(this.shadowCanvas, x - R, y - R, 2 * R, 2 * R);
    ctx.restore();
  }

  private heliShape(x: number, y: number, heading: number, size: number, pitch = 1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.scale(size * pitch, size);

    // Tail boom + fin, skids.
    ctx.fillStyle = '#b8321c';
    ctx.fill(HELI.boom);
    ctx.fill(HELI.fin);
    ctx.fillStyle = '#3b3b3b';
    ctx.fill(HELI.skids);

    // Body (the gradient is in the helicopter's own px, so it can be made once).
    if (!this.bodyFill) {
      this.bodyFill = ctx.createLinearGradient(0, -10, 0, 10);
      this.bodyFill.addColorStop(0, '#ff7b5c');
      this.bodyFill.addColorStop(0.5, '#e5482b');
      this.bodyFill.addColorStop(1, '#a92f19');
    }
    ctx.fillStyle = this.bodyFill;
    ctx.fill(HELI.hull);
    // Cockpit glass.
    ctx.fillStyle = '#9fd8f5';
    ctx.fill(HELI.cockpit);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill(HELI.glint);

    // Tail rotor.
    ctx.save();
    ctx.translate(TAIL_AXLE.x, TAIL_AXLE.y);
    ctx.rotate(this.rotor * 1.7);
    ctx.fillStyle = '#333';
    ctx.fill(HELI.tailRotor);
    ctx.restore();

    // Main rotor: motion-blur disc + two blades.
    ctx.fillStyle = 'rgba(40,40,40,0.10)';
    ctx.fill(HELI.disc);
    ctx.translate(HUB.x, HUB.y);
    ctx.rotate(this.rotor);
    ctx.fillStyle = '#2b2b2b';
    ctx.fill(HELI.blades);
    ctx.fillStyle = '#666';
    ctx.fill(HELI.hub);
    ctx.restore();
  }

  /** Small crosshair where a click or tap sent the helicopter; white, so it is not taken for the red target dot. */
  private drawFlyTo(p: { x: number; y: number }) {
    const ctx = this.ctx;
    const { x, y } = this.toScreen(p.x, p.y);
    const r = 9 + Math.sin(this.time * 6) * 1.5;
    ctx.save();
    ctx.lineCap = 'round';
    for (const [color, width] of [['rgba(0,0,0,0.35)', 4], ['rgba(255,255,255,0.95)', 2]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(x + dx * (r - 4), y + dy * (r - 4));
        ctx.lineTo(x + dx * (r + 4), y + dy * (r + 4));
      }
      ctx.stroke();
    }
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
    // 0 while the HUD is hidden (menu): asked again until it is shown.
    if (!this.minimapW) this.minimapW = mm.clientWidth;
    const cssW = this.minimapW;
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
      this.strokeInsets(o, 1 / ms, [3 / ms, 2 / ms]);
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

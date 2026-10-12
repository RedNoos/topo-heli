import { CONFIG } from './config';
import type { City, MapData } from './maps/types';
import { dist, Projection } from './projection';

export interface PlacedCity extends City {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type GameEvent =
  | { type: 'found'; city: PlacedCity; levelUp: boolean }
  | { type: 'skipped'; city: PlacedCity }
  | { type: 'target'; city: PlacedCity }
  | { type: 'over' };

export class Game {
  readonly projection: Projection;
  /** Cities sorted from best to least known. */
  readonly cities: PlacedCity[];
  /** World bounds in km; the helicopter cannot leave these. */
  readonly bounds: Bounds;

  heli = { x: 0, y: 0, vx: 0, vy: 0, heading: -Math.PI / 2 };
  timeLeft = CONFIG.startTime;
  elapsed = 0;
  found: PlacedCity[] = [];
  skipped: PlacedCity[] = [];
  /** Undefined until start() (the menu shows an idle game). */
  target?: PlacedCity;
  over = false;

  private asked = new Set<PlacedCity>();
  private listeners: ((e: GameEvent) => void)[] = [];

  constructor(data: MapData) {
    this.projection = new Projection(data.geo);
    this.cities = data.cities
      .map((c) => ({ ...c, ...this.projection.project(c.lon, c.lat) }))
      .sort((a, b) => b.pop - a.pop);

    const [minLon, minLat, maxLon, maxLat] = data.geo.bbox;
    const a = this.projection.project(minLon, maxLat);
    const b = this.projection.project(maxLon, minLat);
    this.bounds = { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };

    // Start in the middle of the playable country.
    const xs = this.cities.map((c) => c.x);
    const ys = this.cities.map((c) => c.y);
    this.heli.x = (Math.min(...xs) + Math.max(...xs)) / 2;
    this.heli.y = (Math.min(...ys) + Math.max(...ys)) / 2;
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: GameEvent) {
    for (const fn of this.listeners) fn(e);
  }

  get level() {
    return Math.floor(this.found.length / CONFIG.citiesPerLevel) + 1;
  }

  get revealRadius() {
    return CONFIG.revealRadius(this.level);
  }

  get targetDistance() {
    return this.target ? dist(this.heli.x, this.heli.y, this.target.x, this.target.y) : Infinity;
  }

  get targetVisible() {
    return this.targetDistance <= this.revealRadius;
  }

  start() {
    this.nextTarget();
  }

  private nextTarget() {
    let pool = this.cities.slice(0, CONFIG.poolSize(this.level)).filter((c) => !this.asked.has(c));
    if (pool.length === 0) {
      // Pool exhausted: widen to every city not asked yet, or start over.
      pool = this.cities.filter((c) => !this.asked.has(c));
      if (pool.length === 0) {
        this.asked.clear();
        pool = this.cities.filter((c) => c !== this.target);
      }
    }
    const farEnough = pool.filter(
      (c) => dist(c.x, c.y, this.heli.x, this.heli.y) >= CONFIG.minTargetDistance,
    );
    if (farEnough.length > 0) pool = farEnough;

    this.target = pool[Math.floor(Math.random() * pool.length)];
    this.asked.add(this.target);
    this.emit({ type: 'target', city: this.target });
  }

  skip() {
    if (this.over || !this.target) return;
    this.skipped.push(this.target);
    this.timeLeft = Math.max(0, this.timeLeft - CONFIG.skipPenalty);
    this.emit({ type: 'skipped', city: this.target });
    this.nextTarget();
  }

  update(dt: number, input: { x: number; y: number }) {
    if (this.over || !this.target) return;
    this.elapsed += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.over = true;
      this.emit({ type: 'over' });
      return;
    }

    // Velocity eases towards the stick direction: gives a bit of inertia.
    const h = this.heli;
    const { maxSpeed, responsiveness, turnRate } = CONFIG.heli;
    const k = 1 - Math.exp(-responsiveness * dt);
    h.vx += (input.x * maxSpeed - h.vx) * k;
    h.vy += (input.y * maxSpeed - h.vy) * k;
    h.x += h.vx * dt;
    h.y += h.vy * dt;

    const b = this.bounds;
    if (h.x < b.minX || h.x > b.maxX) h.vx = 0;
    if (h.y < b.minY || h.y > b.maxY) h.vy = 0;
    h.x = Math.min(b.maxX, Math.max(b.minX, h.x));
    h.y = Math.min(b.maxY, Math.max(b.minY, h.y));

    // Nose turns towards the flying direction (or the stick when hovering).
    const speed = Math.hypot(h.vx, h.vy);
    const wantX = speed > 3 ? h.vx : input.x;
    const wantY = speed > 3 ? h.vy : input.y;
    if (wantX !== 0 || wantY !== 0) {
      const want = Math.atan2(wantY, wantX);
      let diff = want - h.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      h.heading += diff * (1 - Math.exp(-turnRate * dt));
    }

    if (this.targetDistance <= CONFIG.catchRadius) {
      const city = this.target;
      this.found.push(city);
      const levelUp = this.found.length % CONFIG.citiesPerLevel === 0;
      if (levelUp) this.timeLeft += CONFIG.levelTimeBonus;
      this.emit({ type: 'found', city, levelUp });
      this.nextTarget();
    }
  }
}

import { CONFIG } from './config';
import type { MapData } from './maps/types';
import { dist, Projection } from './projection';
import { cityTargets, distanceTo, edgeDistance, nearestSample, physicalTargets, type Target } from './targets';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GameOptions {
  /** Add mountains, rivers and lakes as targets (maps with physical data only). */
  physical?: boolean;
  /** Cities in play per level (see MapDefinition.pool); default CONFIG.poolSize. */
  pool?: { first: number; step: number };
  /** Start time and extra time per level (seconds); default CONFIG.startTime / levelTimeBonus. */
  time?: { start: number; levelBonus: number };
  /** Factor on the reveal radius (see MapDefinition.reveal). */
  reveal?: number;
  /**
   * Basislijst mode: only the listed targets (physical features included), each once; the
   * clock counts up and the game ends when all are found.
   */
  practice?: boolean;
}

export interface Found {
  target: Target;
  /** Where it was found (label position; for rivers the spot on the river). */
  x: number;
  y: number;
  /** Seconds it took (since the previous find). */
  secs: number;
}

export type GameEvent =
  | { type: 'found'; found: Found; levelUp: boolean }
  | { type: 'skipped'; target: Target }
  | { type: 'target'; target: Target }
  | { type: 'over' };

export class Game {
  readonly projection: Projection;
  /**
   * All targets: cities from best to least known, listed (basislijst) places first (so they
   * enter the levels first); physical features follow and enter by level.
   */
  readonly targets: Target[];
  /** World bounds in km; the helicopter cannot leave these. */
  readonly bounds: Bounds;

  heli = { x: 0, y: 0, vx: 0, vy: 0, heading: -Math.PI / 2 };
  timeLeft: number;
  /** Extra seconds per level. */
  readonly levelBonus: number;
  elapsed = 0;
  found: Found[] = [];
  skipped: Target[] = [];
  /** Undefined until start() (the menu shows an idle game). */
  target?: Target;
  over = false;
  readonly practice: boolean;
  /** Basislijst mode: skipped targets, asked again once the others are done. */
  private later = new Set<Target>();
  private lastFoundAt = 0;
  /** River target: indexes of the course samples covered so far. */
  private covered = new Set<number>();

  private asked = new Set<Target>();
  private listeners: ((e: GameEvent) => void)[] = [];

  /** Scale for the distances in CONFIG (see CONFIG.referenceViewKm). */
  readonly distScale: number;
  private readonly revealFactor: number;
  /** Number of best-known cities in play at a level. */
  private readonly poolSize: (level: number) => number;

  constructor(data: MapData, viewKm: number, options: GameOptions = {}) {
    this.distScale = viewKm / CONFIG.referenceViewKm;
    this.revealFactor = options.reveal ?? 1;
    this.practice = !!options.practice;
    this.timeLeft = options.time?.start ?? CONFIG.startTime;
    this.levelBonus = options.time?.levelBonus ?? CONFIG.levelTimeBonus;
    const pool = options.pool;
    this.poolSize = pool ? (level) => pool.first + pool.step * (level - 1) : CONFIG.poolSize;
    this.projection = new Projection(data.geo);
    const cities = cityTargets(data.cities, this.projection).sort((a, b) => Number(!!b.listed) - Number(!!a.listed) || b.pop - a.pop);
    const physical = (options.physical || this.practice) && data.physical ? physicalTargets(data.physical, this.projection) : [];
    this.targets = [...cities, ...physical].filter((t) => !this.practice || t.listed);

    const rect = data.geo.projection?.rect;
    if (rect) {
      const [minX, minY, maxX, maxY] = rect;
      this.bounds = { minX, minY: -maxY, maxX, maxY: -minY };
    } else {
      const [minLon, minLat, maxLon, maxLat] = data.geo.bbox;
      const a = this.projection.project(minLon, maxLat);
      const b = this.projection.project(maxLon, minLat);
      this.bounds = { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
    }

    // Start in the middle of the playable country.
    const xs = cities.map((c) => c.x);
    const ys = cities.map((c) => c.y);
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

  get maxSpeed() {
    return CONFIG.heli.maxSpeed * this.distScale;
  }

  get revealRadius() {
    return CONFIG.revealRadius(this.level) * this.distScale * this.revealFactor;
  }

  get targetDistance() {
    return this.target ? distanceTo(this.target, this.heli) : Infinity;
  }

  get targetVisible() {
    return this.targetDistance <= this.revealRadius;
  }

  /** River course length (km) that must be covered to find the current river target. */
  private get riverRequired() {
    const t = this.target!;
    const { followKm, maxShare, sampleKm } = CONFIG.river;
    return Math.min(followKm * this.distScale, t.samples!.length * sampleKm * maxShare);
  }

  /** 0..1 progress of following the current river target (0 for other kinds). */
  get riverProgress() {
    if (this.target?.kind !== 'river') return 0;
    return Math.min(1, (this.covered.size * CONFIG.river.sampleKm) / this.riverRequired);
  }

  /** Area target: the helicopter is over it, but not yet deep enough inside. */
  get areaTooShallow() {
    const t = this.target;
    return t?.kind === 'area' && this.targetDistance === 0 && edgeDistance(t, this.heli) < t.depth!;
  }

  /** Course samples of the current river covered so far (for drawing the trail). */
  get coveredSamples() {
    const s = this.target?.samples;
    return s ? [...this.covered].map((i) => s[i]) : [];
  }

  start() {
    this.nextTarget();
  }

  /** Basislijst mode: number of names left to find (the current one included). */
  get remaining() {
    return this.targets.length - this.found.length;
  }

  /** Basislijst mode: any name not found yet; skipped ones only once the rest is done. */
  private nextPracticeTarget() {
    const found = new Set(this.found.map((f) => f.target));
    const left = this.targets.filter((t) => !found.has(t));
    if (left.length === 0) {
      this.target = undefined;
      this.over = true;
      this.emit({ type: 'over' });
      return;
    }
    let pool = left.filter((t) => t !== this.target && !this.later.has(t));
    if (pool.length === 0) pool = left.filter((t) => t !== this.target);
    if (pool.length === 0) pool = left;
    const farEnough = pool.filter((t) => distanceTo(t, this.heli) >= CONFIG.minTargetDistance * this.distScale);
    if (farEnough.length > 0) pool = farEnough;
    this.target = pool[Math.floor(Math.random() * pool.length)];
    this.later.delete(this.target);
    this.covered.clear();
    this.emit({ type: 'target', target: this.target });
  }

  private nextTarget() {
    if (this.practice) return this.nextPracticeTarget();
    const poolFor = (level: number) => {
      const size = this.poolSize(level);
      return this.targets.filter(
        (t, rank) =>
          // Physical features only enter by level; cities also by population rank.
          ((t.kind === 'city' && rank < size && level >= (t.minLevel ?? 1)) || (t.level ?? Infinity) <= level) &&
          !this.asked.has(t),
      );
    };
    // When this level's pool is used up (e.g. by skipping), widen one level at a time.
    let pool = poolFor(this.level);
    for (let l = this.level + 1; pool.length === 0 && l < 100; l++) {
      pool = poolFor(l);
    }
    if (pool.length === 0) {
      // Everything has been asked: start over.
      this.asked.clear();
      pool = this.targets.filter((t) => t !== this.target);
    }
    // Listed (basislijst) items first, as long as the level has some left.
    const listed = pool.filter((t) => t.listed);
    if (listed.length > 0) pool = listed;
    const farEnough = pool.filter((t) => distanceTo(t, this.heli) >= CONFIG.minTargetDistance * this.distScale);
    if (farEnough.length > 0) pool = farEnough;

    this.target = pool[Math.floor(Math.random() * pool.length)];
    this.asked.add(this.target);
    this.covered.clear();
    this.emit({ type: 'target', target: this.target });
  }

  skip() {
    if (this.over || !this.target) return;
    this.skipped.push(this.target);
    if (this.practice) {
      this.elapsed += CONFIG.practiceSkipPenalty;
      this.later.add(this.target);
    } else {
      this.timeLeft = Math.max(0, this.timeLeft - CONFIG.skipPenalty);
    }
    this.emit({ type: 'skipped', target: this.target });
    this.nextTarget();
  }

  update(dt: number, input: { x: number; y: number }) {
    if (this.over || !this.target) return;
    this.elapsed += dt;
    if (!this.practice) this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.over = true;
      this.emit({ type: 'over' });
      return;
    }

    // Velocity eases towards the stick direction: gives a bit of inertia.
    const h = this.heli;
    const { responsiveness, turnRate } = CONFIG.heli;
    const maxSpeed = this.maxSpeed;
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
    const moving = speed > maxSpeed * 0.05;
    const wantX = moving ? h.vx : input.x;
    const wantY = moving ? h.vy : input.y;
    if (wantX !== 0 || wantY !== 0) {
      const want = Math.atan2(wantY, wantX);
      let diff = want - h.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      h.heading += diff * (1 - Math.exp(-turnRate * dt));
    }

    if (this.isFound()) {
      const target = this.target;
      const at = target.kind === 'river' ? nearestSample(target, h) : target.kind === 'lake' ? { x: h.x, y: h.y } : target;
      this.found.push({ target, x: at.x, y: at.y, secs: this.elapsed - this.lastFoundAt });
      this.lastFoundAt = this.elapsed;
      const levelUp = !this.practice && this.found.length % CONFIG.citiesPerLevel === 0;
      if (levelUp) this.timeLeft += this.levelBonus;
      this.emit({ type: 'found', found: this.found[this.found.length - 1], levelUp });
      this.nextTarget();
    }
  }

  private isFound(): boolean {
    const t = this.target!;
    const catchKm = CONFIG.catchRadius * this.distScale;
    switch (t.kind) {
      case 'river': {
        const r = CONFIG.river.coverRadius * this.distScale;
        // Cheap pre-check: only scan samples when near the river.
        if (this.targetDistance > r) return false;
        t.samples!.forEach((s, i) => {
          if (dist(s.x, s.y, this.heli.x, this.heli.y) <= r) this.covered.add(i);
        });
        return this.riverProgress >= 1;
      }
      case 'mountain':
        return this.targetDistance <= catchKm * CONFIG.mountainCatchFactor;
      case 'area':
        // Touching is not enough: fly in, past the edge.
        return this.targetDistance === 0 && edgeDistance(t, this.heli) >= t.depth!;
      default:
        return this.targetDistance <= catchKm;
    }
  }
}

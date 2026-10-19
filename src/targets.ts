import { CONFIG } from './config';
import type { City, LonLat, PhysicalData } from './maps/types';
import { dist, type Projection } from './projection';

export type TargetKind = 'city' | 'mountain' | 'lake' | 'river' | 'area' | 'landmark';

interface Pt {
  x: number;
  y: number;
}

/** Anything the player can be asked to find. Coordinates in km (see Projection). */
export interface Target {
  kind: TargetKind;
  name: string;
  /** Population for cities (ranks how well-known they are); 0 for physical features. */
  pop: number;
  /** In play from this level on, regardless of population. */
  level?: number;
  /** Not before this level, even if its population ranks it earlier. */
  minLevel?: number;
  /** On the basislijst topografie: ranked and asked first. */
  core?: boolean;
  /** Anchor: the place itself for points, a label position for lakes, rivers and areas. */
  x: number;
  y: number;
  /** Rivers: course as polylines. */
  lines?: Pt[][];
  /** Rivers: points every CONFIG.river.sampleKm along the course, for "follow" progress. */
  samples?: Pt[];
  /** Lakes and areas: outline rings. */
  rings?: Pt[][];
  /** Lakes/seas: islands (not part of the water); areas: enclaves. */
  holes?: Pt[][];
  /** Areas: how far (km) inside the edge the helicopter must be. */
  depth?: number;
  /** Canal or dike (river kind), sea/estuary (lake kind), province or island (area kind), airport (landmark kind). */
  sub?: 'canal' | 'dike' | 'water' | 'province' | 'island' | 'airport';
}

function segmentDistance(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p.x, p.y, a.x + t * dx, a.y + t * dy);
}

function polylineDistance(p: Pt, lines: Pt[][]) {
  let best = Infinity;
  for (const l of lines) for (let i = 1; i < l.length; i++) best = Math.min(best, segmentDistance(p, l[i - 1], l[i]));
  return best;
}

function insideRing(p: Pt, ring: Pt[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to the target's outline (inside an area: how deep inside it is). */
export function edgeDistance(t: Target, p: Pt): number {
  return polylineDistance(p, [...(t.rings ?? []), ...(t.holes ?? [])]);
}

/** Distance from a point to the target's geometry (0 inside a lake or area). */
export function distanceTo(t: Target, p: Pt): number {
  if (t.lines) return polylineDistance(p, t.lines);
  if (t.rings) {
    const holes = t.holes ?? [];
    const inside = t.rings.some((r) => insideRing(p, r)) && !holes.some((h) => insideRing(p, h));
    return inside ? 0 : polylineDistance(p, [...t.rings, ...holes]);
  }
  return dist(p.x, p.y, t.x, t.y);
}

/** Nearest point on a river's course (where to put its label once found). */
export function nearestSample(t: Target, p: Pt): Pt {
  let best = t.samples![0];
  for (const s of t.samples!) if (dist(s.x, s.y, p.x, p.y) < dist(best.x, best.y, p.x, p.y)) best = s;
  return best;
}

function resample(lines: Pt[][], step: number): Pt[] {
  const out: Pt[] = [];
  for (const l of lines) {
    // `next`: distance into the current segment where the next sample goes.
    let next = 0;
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1];
      const b = l[i];
      const len = dist(a.x, a.y, b.x, b.y);
      let d = next;
      for (; d < len; d += step) out.push({ x: a.x + ((b.x - a.x) * d) / len, y: a.y + ((b.y - a.y) * d) / len });
      next = d - len;
    }
  }
  return out;
}

/** Deepest point of an area (on a grid) and its distance to the edge. */
function deepestPoint(t: Target): { x: number; y: number; depth: number } {
  const pts = t.rings!.flat();
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = Math.max(maxX - minX, maxY - minY) / 40;
  let best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, depth: 0 };
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let y = minY + step / 2; y < maxY; y += step) {
      const p = { x, y };
      if (distanceTo(t, p) > 0) continue;
      const depth = edgeDistance(t, p);
      if (depth > best.depth) best = { x, y, depth };
    }
  }
  return best;
}

export function cityTargets(cities: City[], proj: Projection): Target[] {
  return cities.map((c) => ({ kind: 'city', name: c.name, pop: c.pop, level: c.level, minLevel: c.minLevel, core: c.core, ...proj.project(c.lon, c.lat) }));
}

export function physicalTargets(data: PhysicalData, proj: Projection): Target[] {
  const toPts = (l: LonLat[]) => l.map(([lon, lat]) => proj.project(lon, lat));
  const targets: Target[] = [];

  for (const m of data.mountains) {
    targets.push({ kind: 'mountain', name: m.name, pop: 0, level: m.level, core: m.core, ...proj.project(m.lon, m.lat) });
  }
  for (const l of data.lakes) {
    const rings = l.rings.map(toPts);
    const pts = rings.flat();
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const holes = l.holes?.map(toPts);
    targets.push({ kind: 'lake', name: l.name, pop: 0, level: l.level, core: l.core, x, y, rings, holes, sub: l.type });
  }
  for (const a of data.areas ?? []) {
    const t: Target = { kind: 'area', name: a.name, pop: 0, level: a.level, core: a.core, x: 0, y: 0, rings: a.rings.map(toPts), holes: a.holes?.map(toPts), sub: a.type };
    const deep = deepestPoint(t);
    targets.push({ ...t, x: deep.x, y: deep.y, depth: Math.min(CONFIG.area.insideKm, deep.depth * CONFIG.area.maxShare) });
  }
  for (const m of data.landmarks ?? []) {
    targets.push({ kind: 'landmark', name: m.name, pop: 0, level: m.level, core: m.core, sub: m.type, ...proj.project(m.lon, m.lat) });
  }
  for (const r of data.rivers) {
    const lines = r.lines.map(toPts);
    const samples = resample(lines, CONFIG.river.sampleKm);
    const mid = samples[Math.floor(samples.length / 2)];
    targets.push({ kind: 'river', name: r.name, pop: 0, level: r.level, core: r.core, x: mid.x, y: mid.y, lines, samples, sub: r.type });
  }
  return targets;
}

import { CONFIG } from './config';
import type { City, LonLat, PhysicalData } from './maps/types';
import { dist, type Projection } from './projection';

export type TargetKind = 'city' | 'mountain' | 'lake' | 'river';

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
  /** Anchor: the place itself for points, a label position for lakes and rivers. */
  x: number;
  y: number;
  /** Rivers: course as polylines. */
  lines?: Pt[][];
  /** Rivers: points every CONFIG.river.sampleKm along the course, for "follow" progress. */
  samples?: Pt[];
  /** Lakes: outline rings. */
  rings?: Pt[][];
}

export const KIND_LABEL: Record<TargetKind, string> = {
  city: 'city',
  mountain: 'mountain',
  lake: 'lake',
  river: 'river',
};

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

/** Distance from a point to the target's geometry (0 inside a lake). */
export function distanceTo(t: Target, p: Pt): number {
  if (t.lines) return polylineDistance(p, t.lines);
  if (t.rings) return t.rings.some((r) => insideRing(p, r)) ? 0 : polylineDistance(p, t.rings);
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

export function cityTargets(cities: City[], proj: Projection): Target[] {
  return cities.map((c) => ({ kind: 'city', name: c.name, pop: c.pop, level: c.level, ...proj.project(c.lon, c.lat) }));
}

export function physicalTargets(data: PhysicalData, proj: Projection): Target[] {
  const toPts = (l: LonLat[]) => l.map(([lon, lat]) => proj.project(lon, lat));
  const targets: Target[] = [];

  for (const m of data.mountains) {
    targets.push({ kind: 'mountain', name: m.name, pop: 0, level: m.level, ...proj.project(m.lon, m.lat) });
  }
  for (const l of data.lakes) {
    const rings = l.rings.map(toPts);
    const pts = rings.flat();
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    targets.push({ kind: 'lake', name: l.name, pop: 0, level: l.level, x, y, rings });
  }
  for (const r of data.rivers) {
    const lines = r.lines.map(toPts);
    const samples = resample(lines, CONFIG.river.sampleKm);
    const mid = samples[Math.floor(samples.length / 2)];
    targets.push({ kind: 'river', name: r.name, pop: 0, level: r.level, x: mid.x, y: mid.y, lines, samples });
  }
  return targets;
}

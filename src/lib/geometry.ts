// 2D/3D 几何内核：轮廓校验、吸附、多边形切分、三角化、折叠变换
import type { SketchEntity, Vec2, BendLine } from '../types';

export const EPS = 1e-6;
export const SNAP_TOL = 8; // 屏幕像素吸附容差（实际按缩放换算）

// ---------- 基础向量 ----------
export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const angOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function bbox(points: Vec2[]): { min: Vec2; max: Vec2; w: number; h: number } {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const min = { x: Math.min(...xs), y: Math.min(...ys) };
  const max = { x: Math.max(...xs), y: Math.max(...ys) };
  return { min, max, w: max.x - min.x, h: max.y - min.y };
}

// ---------- 线段相交 ----------
export interface SegHit { point: Vec2; t: number; u: number }
export function segIntersection(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): SegHit | null {
  const r = sub(p2, p1), s = sub(p4, p3);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPS) return null;
  const t = cross(sub(p3, p1), s) / denom;
  const u = cross(sub(p3, p1), r) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { point: add(p1, scale(r, t)), t, u };
}

export function distPointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

// ---------- 实体离散化 ----------
export function entityEndpoints(e: SketchEntity): [Vec2, Vec2] | null {
  if (e.type === 'line') return [e.p1, e.p2];
  if (e.type === 'arc') {
    return [
      { x: e.center.x + e.radius * Math.cos(e.startAngle), y: e.center.y + e.radius * Math.sin(e.startAngle) },
      { x: e.center.x + e.radius * Math.cos(e.endAngle), y: e.center.y + e.radius * Math.sin(e.endAngle) },
    ];
  }
  return null; // 长圆孔是独立闭合孔
}

export function tessellate(e: SketchEntity, segLen = 2): Vec2[] {
  if (e.type === 'line') return [e.p1, e.p2];
  if (e.type === 'arc') {
    let d = e.endAngle - e.startAngle;
    if (e.ccw && d < 0) d += Math.PI * 2;
    if (!e.ccw && d > 0) d -= Math.PI * 2;
    const steps = Math.max(2, Math.ceil((Math.abs(d) * e.radius) / segLen));
    const pts: Vec2[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = e.startAngle + (d * i) / steps;
      pts.push({ x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) });
    }
    return pts;
  }
  // slot：长圆孔离散为闭合环
  const r = e.width / 2;
  const half = (e.length - e.width) / 2;
  const dir = { x: Math.cos(e.angle), y: Math.sin(e.angle) };
  const nd = perp(dir);
  const c1 = add(e.center, scale(dir, half));
  const c2 = add(e.center, scale(dir, -half));
  const pts: Vec2[] = [];
  const steps = 10;
  // 右端半圆（从 +nd 到 -nd，绕 c1）
  const a0 = angOf(nd);
  for (let i = 0; i <= steps; i++) {
    const a = a0 - (Math.PI * i) / steps;
    pts.push({ x: c1.x + r * Math.cos(a), y: c1.y + r * Math.sin(a) });
  }
  // 左端半圆
  const a1 = angOf(scale(nd, -1));
  for (let i = 0; i <= steps; i++) {
    const a = a1 - (Math.PI * i) / steps;
    pts.push({ x: c2.x + r * Math.cos(a), y: c2.y + r * Math.sin(a) });
  }
  return pts;
}

// ---------- 轮廓环构建 ----------
export interface LoopResult { loops: Vec2[][]; closed: boolean; reason: string }

export function buildLoops(entities: SketchEntity[]): LoopResult {
  const chains = entities.filter((e) => e.type !== 'slot');
  const holes = entities.filter((e) => e.type === 'slot');
  if (chains.length === 0) return { loops: [], closed: false, reason: '轮廓为空' };

  interface Chain { pts: Vec2[] }
  const pool: Chain[] = chains.map((e) => ({ pts: tessellate(e) }));
  const loops: Vec2[][] = [];

  while (pool.length > 0) {
    let current = pool.shift()!.pts;
    let guard = 0;
    while (guard++ < 10000) {
      const tail = current[current.length - 1];
      let best: { idx: number; rev: boolean; d: number } | null = null;
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i];
        const dH = dist(tail, c.pts[0]);
        const dHR = dist(tail, c.pts[c.pts.length - 1]);
        const dMin = Math.min(dH, dHR);
        if (!best || dMin < best.d) best = { idx: i, rev: dHR < dH, d: dMin };
      }
      if (!best || best.d > 0.5) {
        return { loops, closed: false, reason: '轮廓不闭合：存在断开的线条端点' };
      }
      const next = pool.splice(best.idx, 1)[0];
      const add = best.rev ? [...next.pts].reverse() : next.pts;
      current.push(...add.slice(1));
      if (dist(current[0], current[current.length - 1]) <= 0.5) {
        current.pop();
        loops.push(current);
        break;
      }
    }
  }
  for (const h of holes) loops.push(tessellate(h));
  // 外环应为最大面积环，置于首位
  loops.sort((a, b) => polygonArea(b) - polygonArea(a));
  return { loops, closed: true, reason: '' };
}

export function polygonArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += cross(a, b);
  }
  return s / 2;
}

/** 自交检测：逐段检查非相邻边，以及环与环之间的交叉 */
export function findSelfIntersection(loops: Vec2[][]): Vec2 | null {
  for (const poly of loops) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const adjacent = (j === i + 1) || (i === 0 && j === n - 1);
        if (adjacent) continue;
        const hit = segIntersection(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]);
        if (hit && !(hit.t < EPS || hit.t > 1 - EPS || hit.u < EPS || hit.u > 1 - EPS)) return hit.point;
      }
    }
  }
  if (loops.length > 1) {
    const outer = loops[0];
    for (let k = 1; k < loops.length; k++) {
      const hole = loops[k];
      for (let i = 0; i < outer.length; i++) {
        for (let j = 0; j < hole.length; j++) {
          const hit = segIntersection(outer[i], outer[(i + 1) % outer.length], hole[j], hole[(j + 1) % hole.length]);
          if (hit) return hit.point;
        }
      }
    }
  }
  return null;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------- 折弯线与多边形裁剪 ----------
/** 把无限长折弯线裁剪到多边形内部，返回内部线段 */
export function clipLineToPolygon(line: BendLine, poly: Vec2[]): { a: Vec2; b: Vec2 } | null {
  const d = norm(sub(line.p2, line.p1));
  const hits: { t: number; p: Vec2 }[] = [];
  for (let i = 0; i < poly.length; i++) {
    const hit = segIntersection(line.p1, line.p2, poly[i], poly[(i + 1) % poly.length]);
    if (hit) hits.push({ t: hit.t, p: hit.point });
  }
  // 用无限直线再求一次参数（折弯线可能画得比轮廓短）
  const far1 = sub(line.p1, scale(d, 100000));
  const far2 = add(line.p2, scale(d, 100000));
  const all: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const hit = segIntersection(far1, far2, poly[i], poly[(i + 1) % poly.length]);
    if (hit) all.push(dot(sub(hit.point, far1), d));
  }
  if (all.length < 2) return null;
  all.sort((a, b) => a - b);
  const a = add(far1, scale(d, all[0]));
  const b = add(far1, scale(d, all[all.length - 1]));
  if (dist(a, b) < EPS) return null;
  void hits;
  return { a, b };
}

/** 用一条内部线段把多边形切成两个多边形 */
export function splitPolygon(poly: Vec2[], a: Vec2, b: Vec2): Vec2[][] {
  // 找 a、b 分别落在哪条边
  const edgeOf = (pt: Vec2): number => {
    for (let i = 0; i < poly.length; i++) {
      if (distPointSeg(pt, poly[i], poly[(i + 1) % poly.length]) < 0.05) return i;
    }
    return -1;
  };
  const ia = edgeOf(a), ib = edgeOf(b);
  if (ia < 0 || ib < 0 || ia === ib) return [poly];
  const p1: Vec2[] = [a];
  for (let i = (ia + 1) % poly.length; ; i = (i + 1) % poly.length) {
    p1.push(poly[i]);
    if (i === ib) break;
  }
  p1.push(b);
  const p2: Vec2[] = [b];
  for (let i = (ib + 1) % poly.length; ; i = (i + 1) % poly.length) {
    p2.push(poly[i]);
    if (i === ia) break;
  }
  p2.push(a);
  return [p1, p2].filter((p) => Math.abs(polygonArea(p)) > 0.5);
}

// ---------- 耳切三角化 ----------
export function triangulate(polyIn: Vec2[]): number[] {
  const poly = polygonArea(polyIn) > 0 ? [...polyIn] : [...polyIn].reverse();
  const indices: number[] = [];
  const alive = poly.map((_, i) => i);
  let guard = 0;
  while (alive.length > 3 && guard++ < 10000) {
    let ear = -1;
    for (let k = 0; k < alive.length; k++) {
      const i0 = alive[(k - 1 + alive.length) % alive.length];
      const i1 = alive[k];
      const i2 = alive[(k + 1) % alive.length];
      const A = poly[i0], B = poly[i1], C = poly[i2];
      if (cross(sub(B, A), sub(C, A)) <= EPS) continue;
      let contains = false;
      for (const idx of alive) {
        if (idx === i0 || idx === i1 || idx === i2) continue;
        if (pointInTri(poly[idx], A, B, C)) { contains = true; break; }
      }
      if (!contains) { ear = k; break; }
    }
    if (ear < 0) break;
    const i0 = alive[(ear - 1 + alive.length) % alive.length];
    const i1 = alive[ear];
    const i2 = alive[(ear + 1) % alive.length];
    indices.push(i0, i1, i2);
    alive.splice(ear, 1);
  }
  if (alive.length === 3) indices.push(alive[0], alive[1], alive[2]);
  return indices;
}

function pointInTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = cross(sub(p, a), sub(b, a));
  const d2 = cross(sub(p, c), sub(b, c));
  const d3 = cross(sub(p, a), sub(c, a));
  const neg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const pos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(neg && pos);
}

// ---------- 吸附点候选 ----------
export interface SnapPoint { p: Vec2; kind: '端点' | '中点' | '圆心' | '象限点'; entityId: string }

export function collectSnapPoints(entities: SketchEntity[], bendLines: BendLine[]): SnapPoint[] {
  const out: SnapPoint[] = [];
  for (const e of entities) {
    if (e.type === 'line') {
      out.push({ p: e.p1, kind: '端点', entityId: e.id });
      out.push({ p: e.p2, kind: '端点', entityId: e.id });
      out.push({ p: mid(e.p1, e.p2), kind: '中点', entityId: e.id });
    } else if (e.type === 'arc') {
      out.push({ p: e.center, kind: '圆心', entityId: e.id });
      for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        out.push({ p: { x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) }, kind: '象限点', entityId: e.id });
      }
    } else {
      out.push({ p: e.center, kind: '圆心', entityId: e.id });
    }
  }
  for (const b of bendLines) {
    out.push({ p: b.p1, kind: '端点', entityId: b.id });
    out.push({ p: b.p2, kind: '端点', entityId: b.id });
    out.push({ p: mid(b.p1, b.p2), kind: '中点', entityId: b.id });
  }
  return out;
}

export function nearestSnap(p: Vec2, candidates: SnapPoint[], tolMm: number): SnapPoint | null {
  let best: SnapPoint | null = null;
  let bd = tolMm;
  for (const c of candidates) {
    const d = dist(p, c.p);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

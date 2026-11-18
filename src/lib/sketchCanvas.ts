// 2D 展开轮廓手绘编辑器（Canvas2D）：直线/圆弧/长圆孔、吸附、折弯线、实时校验
import type { Part, SketchEntity, Vec2, BendLine } from '../types';
import type { SnapPoint } from './geometry';
import {
  collectSnapPoints, nearestSnap, tessellate, buildLoops, findSelfIntersection,
  dist, mid, uid, round2,
} from './geometry';

export type Tool = 'select' | 'line' | 'arc' | 'slot' | 'bend' | 'erase';

interface SketchCallbacks {
  onChange: () => void;
  onValidation: (closed: boolean, reason: string, selfCross: Vec2 | null) => void;
}

export class SketchCanvas {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private part: Part;
  tool: Tool = 'select';
  private cb: SketchCallbacks;
  private scale = 4;
  private offset: Vec2 = { x: 60, y: 60 };
  private drawing: Vec2[] = [];
  private hover: Vec2 | null = null;
  private snap: SnapPoint | null = null;
  private selectedEntityId: string | null = null;
  private selectedBendId: string | null = null;
  private snapTolMm = 4;

  constructor(canvas: HTMLCanvasElement, part: Part, cb: SketchCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.part = part;
    this.cb = cb;
    this.attach();
    this.autoFit();
    this.runValidation();
  }

  setPart(part: Part): void {
    this.part = part;
    this.drawing = [];
    this.selectedEntityId = null;
    this.selectedBendId = null;
    this.autoFit();
    this.render();
    this.runValidation();
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.drawing = [];
    this.canvas.style.cursor = t === 'select' ? 'default' : 'crosshair';
    this.render();
  }

  getSelected(): { entity?: SketchEntity; bend?: BendLine } {
    const entity = this.part.entities.find((e) => e.id === this.selectedEntityId);
    const bend = this.part.bendLines.find((b) => b.id === this.selectedBendId);
    return { entity, bend };
  }

  deleteSelected(): void {
    if (this.selectedEntityId) {
      this.part.entities = this.part.entities.filter((e) => e.id !== this.selectedEntityId);
      this.part.dimensions = this.part.dimensions.filter((d) => d.entityId !== this.selectedEntityId);
      this.selectedEntityId = null;
    }
    if (this.selectedBendId) {
      this.part.bendLines = this.part.bendLines.filter((b) => b.id !== this.selectedBendId);
      this.part.bends = this.part.bends.filter((b) => b.bendLineId !== this.selectedBendId);
      this.selectedBendId = null;
    }
    this.cb.onChange();
    this.runValidation();
    this.render();
  }

  autoFit(): void {
    const all = this.part.entities.flatMap((e) => tessellate(e));
    if (all.length < 2) { this.scale = 4; this.offset = { x: 80, y: 80 }; return; }
    const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
    const w = Math.max(1, Math.max(...xs) - Math.min(...xs));
    const h = Math.max(1, Math.max(...ys) - Math.min(...ys));
    this.scale = Math.min((this.canvas.width - 120) / w, (this.canvas.height - 120) / h, 8);
    this.scale = Math.max(1, this.scale);
    this.offset = {
      x: 60 - Math.min(...xs) * this.scale,
      y: 60 - Math.min(...ys) * this.scale,
    };
  }

  private toScreen(p: Vec2): Vec2 {
    return { x: p.x * this.scale + this.offset.x, y: p.y * this.scale + this.offset.y };
  }

  private toWorld(p: Vec2): Vec2 {
    return { x: (p.x - this.offset.x) / this.scale, y: (p.y - this.offset.y) / this.scale };
  }

  private attach(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', () => this.onUp());
    c.addEventListener('dblclick', () => { this.drawing = []; this.render(); });
  }

  private eventPos(e: PointerEvent): Vec2 {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (this.canvas.width / r.width), y: (e.clientY - r.top) * (this.canvas.height / r.height) };
  }

  private onMove(e: PointerEvent): void {
    const sp = this.eventPos(e);
    const wp = this.toWorld(sp);
    const candidates = collectSnapPoints(this.part.entities, this.part.bendLines);
    this.snap = nearestSnap(wp, candidates, this.snapTolMm);
    this.hover = this.snap ? this.snap.p : wp;
    this.render();
  }

  private onDown(e: PointerEvent): void {
    const sp = this.eventPos(e);
    const wp = this.toWorld(sp);
    const point = this.snap ? this.snap.p : wp;

    if (this.tool === 'line') {
      this.drawing.push(point);
      if (this.drawing.length === 2) {
        if (dist(this.drawing[0], this.drawing[1]) > 0.2) {
          this.part.entities.push({ id: uid('e'), type: 'line', p1: this.drawing[0], p2: this.drawing[1] });
          this.commit();
        }
        this.drawing = [];
      }
    } else if (this.tool === 'arc') {
      // 三点定弧：圆心、起点、终点
      this.drawing.push(point);
      if (this.drawing.length === 3) {
        const [center, start, end] = this.drawing;
        const radius = dist(center, start);
        if (radius > 0.2 && Math.abs(dist(center, end) - radius) < radius * 0.25 + 2) {
          this.part.entities.push({
            id: uid('e'), type: 'arc', center, radius,
            startAngle: Math.atan2(start.y - center.y, start.x - center.x),
            endAngle: Math.atan2(end.y - center.y, end.x - center.x),
            ccw: true,
          });
          this.commit();
        }
        this.drawing = [];
      }
    } else if (this.tool === 'slot') {
      // 两点定长圆孔：中心 + 端点（决定长度与方向），宽度默认 8mm
      this.drawing.push(point);
      if (this.drawing.length === 2) {
        const [center, end] = this.drawing;
        const d = dist(center, end);
        if (d > 5) {
          const width = Math.min(8, d);
          this.part.entities.push({
            id: uid('e'), type: 'slot', center,
            length: round2(d * 2), width,
            angle: Math.atan2(end.y - center.y, end.x - center.x),
          });
          this.commit();
        }
        this.drawing = [];
      }
    } else if (this.tool === 'bend') {
      this.drawing.push(point);
      if (this.drawing.length === 2) {
        if (dist(this.drawing[0], this.drawing[1]) > 1) {
          const bl: BendLine = { id: uid('bl'), p1: this.drawing[0], p2: this.drawing[1] };
          this.part.bendLines.push(bl);
          this.part.bends.push({
            id: uid('bn'), bendLineId: bl.id, angle: 90, direction: 1, innerRadius: this.part.thickness,
            kFactor: null, upperDieId: null, lowerDieId: null,
            gaugeXManual: null, fingerClearanceManual: null, orderLocked: false,
          });
          this.commit();
        }
        this.drawing = [];
      }
    } else if (this.tool === 'erase' || this.tool === 'select') {
      const hitE = this.hitEntity(wp);
      const hitB = this.hitBend(wp);
      if (this.tool === 'erase') {
        if (hitE) {
          this.part.entities = this.part.entities.filter((x) => x.id !== hitE.id);
          this.part.dimensions = this.part.dimensions.filter((d) => d.entityId !== hitE.id);
          this.commit();
        } else if (hitB) {
          this.part.bendLines = this.part.bendLines.filter((x) => x.id !== hitB.id);
          this.part.bends = this.part.bends.filter((x) => x.bendLineId !== hitB.id);
          this.commit();
        }
      } else {
        this.selectedEntityId = hitE?.id ?? null;
        this.selectedBendId = hitB?.id ?? null;
        this.render();
      }
    }
  }

  private onUp(): void { /* 点击式工具，逻辑在 down 完成 */ }

  private hitEntity(wp: Vec2): SketchEntity | null {
    let best: { e: SketchEntity; d: number } | null = null;
    for (const e of this.part.entities) {
      const pts = tessellate(e);
      for (let i = 0; i < pts.length - 1; i++) {
        const d = pointSeg(wp, pts[i], pts[i + 1]);
        if (d < 3 && (!best || d < best.d)) best = { e, d };
      }
    }
    return best?.e ?? null;
  }

  private hitBend(wp: Vec2): BendLine | null {
    let best: { b: BendLine; d: number } | null = null;
    for (const b of this.part.bendLines) {
      const d = pointSeg(wp, b.p1, b.p2);
      if (d < 4 && (!best || d < best.d)) best = { b, d };
    }
    return best?.b ?? null;
  }

  private commit(): void {
    this.cb.onChange();
    this.runValidation();
    this.render();
  }

  runValidation(): void {
    const loops = buildLoops(this.part.entities);
    const cross = loops.closed ? findSelfIntersection(loops.loops) : null;
    this.cb.onValidation(loops.closed, loops.reason, cross);
  }

  render(): void {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.fillStyle = '#10141a';
    ctx.fillRect(0, 0, W, H);
    this.drawGrid();

    // 实体
    for (const e of this.part.entities) {
      const selected = e.id === this.selectedEntityId;
      ctx.strokeStyle = e.type === 'slot' ? '#4fc3f7' : selected ? '#ffd54f' : '#cfd8dc';
      ctx.lineWidth = selected ? 3 : 2;
      const pts = tessellate(e);
      ctx.beginPath();
      pts.forEach((p, i) => {
        const s = this.toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      if (e.type === 'slot' || e.type === 'arc') ctx.closePath();
      ctx.stroke();
      if (e.type === 'slot') {
        ctx.fillStyle = 'rgba(79,195,247,0.12)';
        ctx.fill();
      }
    }

    // 标注
    for (const d of this.part.dimensions) this.drawDimension(d.p1, d.p2, d.label, '#81c784');

    // 折弯线
    this.part.bendLines.forEach((b, i) => {
      const selected = b.id === this.selectedBendId;
      const a = this.toScreen(b.p1), c = this.toScreen(b.p2);
      ctx.strokeStyle = selected ? '#ffb74d' : '#ff7043';
      ctx.lineWidth = selected ? 3 : 2;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffab91';
      ctx.font = '13px sans-serif';
      ctx.fillText(`刀${i + 1}`, mid(a, c).x + 6, mid(a, c).y - 6);
    });

    // 绘制中的橡皮筋
    if (this.drawing.length > 0 && this.hover) {
      ctx.strokeStyle = '#80cbc4';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const s0 = this.toScreen(this.drawing[0]);
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(...Object.values(this.toScreen(this.hover)) as [number, number]);
      ctx.stroke();
      ctx.setLineDash([]);
      this.drawing.forEach((p) => this.drawNode(p, '#80cbc4'));
    }

    // 吸附标记
    if (this.snap && this.tool !== 'select' && this.tool !== 'erase') {
      const s = this.toScreen(this.snap.p);
      ctx.strokeStyle = '#ffeb3b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffeb3b';
      ctx.font = '12px sans-serif';
      ctx.fillText(this.snap.kind, s.x + 10, s.y - 8);
    }
  }

  private drawNode(p: Vec2, color: string): void {
    const s = this.toScreen(p);
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawDimension(p1: Vec2, p2: Vec2, label: string, color: string): void {
    const ctx = this.ctx;
    const a = this.toScreen(p1), b = this.toScreen(p2);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '12px sans-serif';
    const m = mid(a, b);
    ctx.fillText(label, m.x + 4, m.y - 4);
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const step = 10 * this.scale;
    ctx.strokeStyle = '#1b222c';
    ctx.lineWidth = 1;
    for (let x = this.offset.x % step; x < this.canvas.width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.canvas.height); ctx.stroke();
    }
    for (let y = this.offset.y % step; y < this.canvas.height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.canvas.width, y); ctx.stroke();
    }
  }
}

function pointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 < 1e-9) return dist(p, a);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + abx * t, y: a.y + aby * t });
}

import type { Part } from '../types';
import { store } from '../lib/store';
import { el, clear, fmt, badge, numberInput } from '../ui/dom';
import { toast } from '../main';
import { GLRenderer, flatColorArray } from '../lib/glRenderer';
import { buildFlatMesh, foldedVertices } from '../lib/mesh';
import { buildLoops } from '../lib/geometry';
import { simulate, checkFeasibility } from '../lib/bendMath';
import { exportPressProgram } from '../lib/export';

export class SimulationPage {
  private host: HTMLElement;
  private part: Part;
  private unsub: () => void;
  private gl: GLRenderer | null = null;
  private progress: number[] = [];
  private playing = false;
  private rafId = 0;

  constructor(host: HTMLElement, partId: string) {
    this.host = host;
    this.part = store.getPart(partId)!;
    this.unsub = store.subscribe(() => {
      const fresh = store.getPart(partId);
      if (fresh) { this.part = fresh; }
    });
    this.progress = this.part.bends.map(() => 0);
    this.render();
  }

  destroy(): void {
    this.unsub();
    cancelAnimationFrame(this.rafId);
    store.flush();
  }

  private data() {
    const settings = store.getSettings();
    const machine = settings.machines.find((m) => m.id === settings.activeMachineId)!;
    const mat = settings.materials.find((m) => m.name === this.part.material)!;
    const outer = buildLoops(this.part.entities).loops[0] ?? [];
    const sim = simulate(this.part, mat, machine, settings.lowerDies, outer, settings.defaultFingerClearance);
    const report = checkFeasibility(this.part, mat, machine, settings.lowerDies, outer);
    return { settings, machine, mat, outer, sim, report };
  }

  private render(): void {
    clear(this.host);
    cancelAnimationFrame(this.rafId);
    if (this.part.bends.length === 0) {
      this.host.append(el('div', { class: 'card muted' }, '该零件还没有折弯，请先到折弯编辑页绘制折弯线并配置刀次。'));
      return;
    }
    const { sim, report, settings, machine } = this.data();
    const wrap = el('div', { class: 'layout-sim' });
    const left = el('div', {});
    const side = el('div', { class: 'panel-side' });

    const glCanvas = el('canvas', { class: 'view', width: '820', height: '520' }) as HTMLCanvasElement;
    left.append(el('div', { class: 'card' },
      el('h3', {}, '折弯成形仿真（拖动滑块或播放，按刀次逐折）'),
      glCanvas,
      el('div', { style: 'display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap' },
        el('button', { class: 'btn primary', id: 'play-btn', onclick: () => this.togglePlay() }, '▶ 播放整套'),
        el('button', { class: 'btn', onclick: () => this.reset() }, '复位（展开态）'),
        el('input', {
          type: 'range', min: '0', max: String(this.part.bends.length * 100), value: '0',
          id: 'progress-range', style: 'flex:1;min-width:200px',
          oninput: (e: Event) => this.onRange((e.target as HTMLInputElement).valueAsNumber),
        }),
      ),
      el('div', { id: 'step-label', class: 'muted', style: 'margin-top:6px' }, '当前：展开平板态'),
    ));

    // 曲线区
    const tonChart = el('canvas', { width: '760', height: '220' }) as HTMLCanvasElement;
    const timeChart = el('canvas', { width: '760', height: '180' }) as HTMLCanvasElement;
    left.append(
      el('div', { class: 'card' }, el('h3', {}, '吨位—工进行程曲线（逐刀峰值对压力）'), el('div', { class: 'chart-box' }, tonChart)),
      el('div', { class: 'card' }, el('h3', {}, '滑块行程时间曲线（快下 / 工进 / 回程）'), el('div', { class: 'chart-box' }, timeChart)),
    );

    // 侧栏：节拍汇总
    const s = sim.summary;
    side.append(el('div', { class: 'card' }, el('h3', {}, '节拍汇总'),
      el('div', { class: 'kv' },
        el('span', { class: 'k' }, '整板加工节拍'), el('span', { class: 'mono' }, `${fmt(s.totalTime, 1)} s`),
        el('span', { class: 'k' }, '工进时间'), el('span', { class: 'mono' }, `${fmt(s.workTime, 1)} s`),
        el('span', { class: 'k' }, '空行程时间'), el('span', { class: 'mono' }, `${fmt(s.idleTime, 1)} s`),
        el('span', { class: 'k' }, '空行程占比'), el('span', {}, badge(fmt(s.idlePct, 1) + '%', s.idlePct > 60 ? 'badge warn' : 'badge ok')),
        el('span', { class: 'k' }, '峰值吨位'), el('span', { class: 'mono' }, `${fmt(s.peakTonnage, 2)} t / ${machine.ratedTonnage} t`),
      ),
      el('button', { class: 'btn primary', style: 'margin-top:12px;width:100%', onclick: () => exportPressProgram(this.part, settings, report.checks, sim.steps) }, '导出折弯机程序文件'),
      el('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, '程序含每刀角度、后挡料 X 坐标、挡指避让与预估压力'),
    ));

    // 后挡料表
    const gaugeCard = el('div', { class: 'card' }, el('h3', {}, '后挡料定位（人工修改后，后续刀次自动重排）'));
    gaugeCard.append(el('table', { class: 'grid' },
      el('thead', {}, el('tr', {}, ...['刀次', '挡料 X(mm)', '挡指避让(mm)', '峰值吨', '校验'].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...sim.steps.map((st, i) => {
        const b = this.part.bends[i];
        const chk = report.checks[i];
        return el('tr', {},
          el('td', {}, `#${i + 1}`),
          el('td', {}, numberInput(st.gaugeX, (v) => {
            b.gaugeXManual = v;
            this.applyGaugeRipple(i, v);
          }, '0.1')),
          el('td', {}, numberInput(st.fingerClearance, (v) => {
            b.fingerClearanceManual = v;
            store.upsertPart(this.part);
            this.render();
          }, '0.1')),
          el('td', { class: 'mono' }, fmt(st.tonnagePeak, 2)),
          el('td', {}, chk.messages.length === 0 ? badge('合格', 'badge ok') : badge(`${chk.messages.length}项`, 'badge error')),
        );
      })),
    ));
    side.append(gaugeCard);
    wrap.append(left, side);
    this.host.append(wrap);

    requestAnimationFrame(() => {
      this.initGl(glCanvas);
      this.drawTonnageChart(tonChart);
      this.drawTimeChart(timeChart);
    });
  }

  /** 人工改某刀 X 后，后续刀次按相同增量重排（不覆盖其它人工值以外的自动值） */
  private applyGaugeRipple(idx: number, value: number): void {
    const outer = buildLoops(this.part.entities).loops[0] ?? [];
    const settings = store.getSettings();
    const mat = settings.materials.find((m) => m.name === this.part.material)!;
    const auto = simulate(this.part, mat, settings.machines.find((m) => m.id === settings.activeMachineId)!, settings.lowerDies, outer, settings.defaultFingerClearance);
    const delta = value - auto.steps[idx].gaugeX;
    this.part.bends.forEach((b, i) => {
      if (i > idx && b.gaugeXManual == null) {
        b.gaugeXManual = Math.max(0, auto.steps[i].gaugeX + delta);
      }
    });
    store.upsertPart(this.part);
    toast(`第 ${idx + 1} 刀已人工定位，后续 ${this.part.bends.length - idx - 1} 刀按增量联动重排`);
    this.render();
  }

  private onRange(raw: number): void {
    this.playing = false;
    const total = this.part.bends.length * 100;
    const f = raw / total;
    this.progress = this.part.bends.map((_, i) => Math.max(0, Math.min(1, f * this.part.bends.length - i)));
    this.updateMesh();
    const done = Math.min(this.part.bends.length, Math.floor(f * this.part.bends.length + 1e-6));
    const label = this.host.querySelector('#step-label');
    if (label) label.textContent = f === 0 ? '当前：展开平板态' : `当前：完成 ${done} / ${this.part.bends.length} 刀（${fmt(f * 100, 0)}%）`;
  }

  private togglePlay(): void {
    if (this.playing) { this.playing = false; return; }
    this.playing = true;
    if (this.progress.every((p) => p >= 1)) this.progress = this.part.bends.map(() => 0);
    const btn = this.host.querySelector('#play-btn') as HTMLButtonElement | null;
    if (btn) btn.textContent = '⏸ 暂停';
    let last = performance.now();
    const tick = (now: number) => {
      if (!this.playing) { if (btn) btn.textContent = '▶ 播放整套'; return; }
      const dt = (now - last) / 1000;
      last = now;
      const perBend = 0.9; // 每刀 0.9s
      let adv = dt / perBend;
      for (let i = 0; i < this.progress.length && adv > 0; i++) {
        if (this.progress[i] < 1) {
          const room = 1 - this.progress[i];
          const take = Math.min(room, adv);
          this.progress[i] += take;
          adv -= take;
        }
      }
      this.updateMesh();
      const done = this.progress.filter((p) => p >= 1).length;
      const range = this.host.querySelector('#progress-range') as HTMLInputElement | null;
      if (range) range.value = String((this.progress.reduce((a, b) => a + b, 0) / this.part.bends.length) * this.part.bends.length * 100);
      const label = this.host.querySelector('#step-label');
      if (label) label.textContent = `当前：完成 ${done} / ${this.part.bends.length} 刀`;
      if (this.progress.every((p) => p >= 1)) {
        this.playing = false;
        if (btn) btn.textContent = '▶ 播放整套';
        return;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private reset(): void {
    this.playing = false;
    this.progress = this.part.bends.map(() => 0);
    const range = this.host.querySelector('#progress-range') as HTMLInputElement | null;
    if (range) range.value = '0';
    const label = this.host.querySelector('#step-label');
    if (label) label.textContent = '当前：展开平板态';
    this.updateMesh();
  }

  private initGl(canvas: HTMLCanvasElement): void {
    try {
      this.gl = new GLRenderer(canvas);
      this.updateMesh();
      const loop = () => {
        this.gl?.render();
        this.rafId = requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      canvas.replaceWith(el('div', { class: 'err-text card' }, `WebGL2 初始化失败：${String(e)}`));
    }
  }

  private updateMesh(): void {
    if (!this.gl) return;
    const mesh = buildFlatMesh(this.part);
    if (!mesh) return;
    const verts = foldedVertices(this.part, mesh, this.progress);
    const colors = flatColorArray(mesh.vertices.length / 3, [0.62, 0.72, 0.82]);
    this.gl.updateMesh(verts, colors, mesh.indices);
    const pos: number[] = [], col: number[] = [];
    for (const seg of mesh.bendSegments) {
      pos.push(seg.a.x, seg.a.y, 0.6, seg.b.x, seg.b.y, 0.6);
      col.push(1, 0.44, 0.26, 1, 0.44, 0.26);
    }
    this.gl.updateLines(new Float32Array(pos), new Float32Array(col));
    const xs: number[] = [], ys: number[] = [], zs: number[] = [];
    for (let i = 0; i < verts.length; i += 3) { xs.push(verts[i]); ys.push(verts[i + 1]); zs.push(verts[i + 2]); }
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs), 50);
    this.gl.frameTarget((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, extent);
  }

  private drawTonnageChart(canvas: HTMLCanvasElement): void {
    const { sim } = this.data();
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#10141a';
    ctx.fillRect(0, 0, W, H);
    const pad = 46;
    const colors = ['#4dd0e1', '#ffb74d', '#81c784', '#ba68c8', '#ef5350', '#64b5f6', '#aed581', '#4db6ac'];
    const maxTon = Math.max(1, ...sim.steps.map((s) => s.tonnagePeak));
    this.drawAxes(ctx, W, H, pad, '工进行程 0→1', '吨位 t', maxTon);
    sim.steps.forEach((st, i) => {
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = 2;
      ctx.beginPath();
      st.tonnageCurve.forEach((pt, k) => {
        const x = pad + (pt.s * (W - pad * 1.4));
        const y = H - pad - (pt.f * st.tonnagePeak / maxTon) * (H - pad * 2);
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = colors[i % colors.length];
      ctx.font = '12px sans-serif';
      ctx.fillText(`#${i + 1} 峰值${fmt(st.tonnagePeak, 1)}t`, pad + 8 + (i % 4) * 170, 18 + Math.floor(i / 4) * 16);
    });
  }

  private drawTimeChart(canvas: HTMLCanvasElement): void {
    const { sim } = this.data();
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#10141a';
    ctx.fillRect(0, 0, W, H);
    const pad = 46;
    const total = sim.summary.totalTime || 1;
    const barH = 26;
    const colors2 = { rapid: '#4dd0e1', work: '#ef5350', ret: '#81c784' };
    sim.steps.forEach((st, i) => {
      const y = 24 + i * (barH + 10);
      let x = pad;
      const seg = (time: number, color: string, label: string) => {
        const w = (time / total) * (W - pad * 1.4);
        ctx.fillStyle = color;
        ctx.fillRect(x, y, Math.max(1, w), barH);
        if (w > 26) {
          ctx.fillStyle = '#0f141b';
          ctx.font = '11px sans-serif';
          ctx.fillText(`${label}${fmt(time, 1)}s`, x + 4, y + 17);
        }
        x += w;
      };
      seg(st.rapidTime, colors2.rapid, '快下');
      seg(st.workTime, colors2.work, '工进');
      seg(st.returnTime, colors2.ret, '回程');
      ctx.fillStyle = '#dce3ec';
      ctx.font = '12px sans-serif';
      ctx.fillText(`#${i + 1}`, 8, y + 17);
    });
    ctx.fillStyle = '#8593a3';
    ctx.font = '12px sans-serif';
    ctx.fillText(`总节拍 ${fmt(total, 1)}s（每刀三段：快下/工进/回程）`, pad, H - 12);
  }

  private drawAxes(ctx: CanvasRenderingContext2D, W: number, H: number, pad: number, xLabel: string, yLabel: string, yMax: number): void {
    ctx.strokeStyle = '#2a3542';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, 10); ctx.lineTo(pad, H - pad); ctx.lineTo(W - pad * 0.4, H - pad);
    ctx.stroke();
    ctx.fillStyle = '#8593a3';
    ctx.font = '12px sans-serif';
    ctx.fillText(xLabel, W - pad * 2, H - pad + 22);
    ctx.save();
    ctx.translate(14, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
    for (let i = 0; i <= 4; i++) {
      const y = H - pad - (i / 4) * (H - pad * 2);
      ctx.fillStyle = '#8593a3';
      ctx.fillText(fmt((yMax * i) / 4, 1), 18, y + 4);
      ctx.strokeStyle = '#1b222c';
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad * 0.4, y); ctx.stroke();
    }
  }
}

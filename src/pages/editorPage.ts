import type { Part, BendStep, MaterialDef } from '../types';
import { store } from '../lib/store';
import { el, clear, fmt, badge, numberInput, select, field } from '../ui/dom';
import { toast } from '../main';
import { SketchCanvas, type Tool } from '../lib/sketchCanvas';
import { GLRenderer, flatColorArray } from '../lib/glRenderer';
import { buildFlatMesh, foldedVertices } from '../lib/mesh';
import { buildLoops } from '../lib/geometry';
import { refreshDimensions } from '../lib/dimensions';
import {
  calcBend, recommendedV, suggestDie, checkFeasibility, autoBendOrder,
  directionGroupSummary, bendGeometry,
} from '../lib/bendMath';
import { exportPartJson } from '../lib/export';

type SubTab = 'sketch' | 'bends' | 'sequence' | 'calc';

export class EditorPage {
  private host: HTMLElement;
  private partId: string;
  private part: Part;
  private unsub: () => void;
  private sub: SubTab = 'sketch';
  private sketch: SketchCanvas | null = null;
  private gl: GLRenderer | null = null;
  private glCanvas: HTMLCanvasElement | null = null;
  private validation = { closed: false, reason: '', cross: false };

  constructor(host: HTMLElement, partId: string) {
    this.host = host;
    this.partId = partId;
    this.part = store.getPart(partId)!;
    this.unsub = store.subscribe(() => this.onStore());
    this.render();
  }

  destroy(): void {
    this.unsub();
    store.flush();
  }

  private onStore(): void {
    const fresh = store.getPart(this.partId);
    if (!fresh) return;
    this.part = fresh;
  }

  private material(): MaterialDef {
    return store.getSettings().materials.find((m) => m.name === this.part.material) ?? store.getSettings().materials[0];
  }

  private outerPoly() {
    return buildLoops(this.part.entities).loops[0] ?? [];
  }

  private render(): void {
    clear(this.host);
    const subTabs: { key: SubTab; label: string }[] = [
      { key: 'sketch', label: '轮廓手绘' },
      { key: 'bends', label: '折弯与模具' },
      { key: 'sequence', label: '工艺顺序与校验' },
      { key: 'calc', label: '展开计算校核' },
    ];
    this.host.append(
      el('div', { class: 'tabs-sub' }, ...subTabs.map((t) =>
        el('button', { class: this.sub === t.key ? 'active' : '', onclick: () => { this.sub = t.key; this.render(); } }, t.label))),
    );
    if (this.sub === 'sketch') this.renderSketch();
    if (this.sub === 'bends') this.renderBends();
    if (this.sub === 'sequence') this.renderSequence();
    if (this.sub === 'calc') this.renderCalc();
  }

  // ---------------- 轮廓手绘 ----------------
  private renderSketch(): void {
    const wrap = el('div', { class: 'layout-2' });
    const canvas = el('canvas', { class: 'view', width: '900', height: '720' }) as HTMLCanvasElement;
    const side = el('div', { class: 'panel-side' });

    const tools: { key: Tool; label: string }[] = [
      { key: 'select', label: '选择' },
      { key: 'line', label: '直线' },
      { key: 'arc', label: '圆弧(三点)' },
      { key: 'slot', label: '长圆孔' },
      { key: 'bend', label: '折弯线' },
      { key: 'erase', label: '擦除' },
    ];
    const toolCard = el('div', { class: 'card' },
      el('h3', {}, '绘图工具'),
      el('div', { class: 'tabs-sub' }, ...tools.map((t) =>
        el('button', { onclick: () => this.sketch?.setTool(t.key) }, t.label))),
      el('div', { class: 'muted', style: 'font-size:12px' },
        '直线/折弯线点击两点；圆弧依次点圆心、起点、终点；长圆孔点中心和长度端点。光标靠近端点/中点/圆心自动吸附。双击取消当前绘制。'),
      el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' },
        el('button', { class: 'btn small', onclick: () => this.sketch?.autoFit() }, '适应视图'),
        el('button', { class: 'btn small danger', onclick: () => this.sketch?.deleteSelected() }, '删除选中'),
      ),
    );

    const infoCard = el('div', { class: 'card' }, el('h3', {}, '零件信息'), this.partInfo());
    const validCard = el('div', { class: 'card' }, el('h3', {}, '轮廓校验'), el('div', { id: 'valid-box' }));
    const glCard = el('div', { class: 'card' },
      el('h3', {}, '三角网格预览（WebGL2，折弯线红色高亮）'),
      el('canvas', { class: 'view', id: 'gl-canvas', width: '640', height: '420' }) as HTMLCanvasElement,
      el('div', { style: 'display:flex;gap:8px;margin-top:8px' },
        el('button', { class: 'btn small', onclick: () => this.gl?.resetView() }, '复位视角'),
      ),
    );
    side.append(toolCard, infoCard, validCard, glCard);
    wrap.append(el('div', {}, canvas), side);
    this.host.append(wrap);

    this.sketch = new SketchCanvas(canvas, this.part, {
      onChange: () => {
        refreshDimensions(this.part);
        store.upsertPart(this.part);
        this.refreshGl();
        this.refreshInfo();
      },
      onValidation: (closed, reason, cross) => {
        this.validation = { closed, reason, cross: !!cross };
        this.renderValidation();
      },
    });
    this.sketch.setTool('select');
    this.glCanvas = glCard.querySelector('#gl-canvas');
    requestAnimationFrame(() => this.initGl());
  }

  private partInfo(): HTMLElement {
    const box = el('div', { class: 'kv', id: 'part-info' });
    const fill = () => {
      clear(box);
      box.append(
        el('span', { class: 'k' }, '型号/名称'), el('span', {}, `${this.part.model} / ${this.part.name}`),
        el('span', { class: 'k' }, '牌号'), el('span', {}, this.part.material),
        el('span', { class: 'k' }, '料厚'), el('span', { class: 'mono' }, `${this.part.thickness} mm`),
        el('span', { class: 'k' }, '实体数'), el('span', {}, String(this.part.entities.length)),
        el('span', { class: 'k' }, '折弯线'), el('span', {}, `${this.part.bendLines.length} 条`),
      );
    };
    fill();
    return box;
  }

  private refreshInfo(): void {
    const box = this.host.querySelector('#part-info');
    if (box) {
      const fresh = this.partInfo();
      box.replaceWith(fresh);
    }
  }

  private renderValidation(): void {
    const box = this.host.querySelector('#valid-box');
    if (!box) return;
    clear(box as HTMLElement);
    const { closed, reason, cross } = this.validation;
    const loops = buildLoops(this.part.entities);
    if (this.part.entities.filter((e) => e.type !== 'slot').length === 0) {
      box.append(el('div', { class: 'muted' }, '请先绘制外轮廓。'));
      return;
    }
    if (!closed) {
      box.append(el('div', { class: 'msg-line error' }, `✗ ${reason} —— 未闭合轮廓禁止保存`));
    } else if (cross) {
      box.append(el('div', { class: 'msg-line error' }, '✗ 轮廓线条自相交 —— 请消除交点后再保存'));
    } else {
      box.append(el('div', { class: 'msg-line ok' }, '✓ 轮廓闭合、无自相交，可以保存'));
      box.append(el('div', { class: 'msg-line', style: 'color:var(--muted)' }, `环数 ${loops.loops.length}（含长圆孔孔位），标注已随轮廓联动更新`));
    }
    const dims = this.part.dimensions;
    if (dims.length) {
      box.append(el('hr', { style: 'border-color:var(--border)' }));
      dims.forEach((d) => box.append(el('div', { class: 'msg-line ok' }, `📏 ${d.label}`)));
    }
    const saveBtn = el('button', {
      class: 'btn primary', style: 'margin-top:10px',
      disabled: String(!closed || cross),
      onclick: () => {
        if (!closed || cross) { toast('轮廓未闭合或自相交，无法保存'); return; }
        store.upsertPart(this.part, true);
        toast('零件已保存到本地');
      },
    }, '保存零件');
    box.append(saveBtn);
    box.append(' ', el('button', { class: 'btn', onclick: () => exportPartJson(this.part) }, '导出 JSON 图纸'));
  }

  private initGl(): void {
    const canvas = this.host.querySelector('#gl-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    try {
      this.gl = new GLRenderer(canvas);
      this.refreshGl();
      const loop = () => {
        if (!this.gl) return;
        this.gl.render();
        requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      canvas.replaceWith(el('div', { class: 'err-text card' }, `WebGL2 初始化失败：${String(e)}`));
    }
  }

  private refreshGl(): void {
    if (!this.gl) return;
    const mesh = buildFlatMesh(this.part);
    if (!mesh || mesh.vertices.length === 0) return;
    const colors = flatColorArray(mesh.vertices.length / 3, [0.62, 0.72, 0.82]);
    this.gl.updateMesh(mesh.vertices, colors, mesh.indices);
    // 折弯线高亮线段
    const pos: number[] = [], col: number[] = [];
    for (const seg of mesh.bendSegments) {
      pos.push(seg.a.x, seg.a.y, 0.5, seg.b.x, seg.b.y, 0.5);
      col.push(1, 0.44, 0.26, 1, 0.44, 0.26);
    }
    this.gl.updateLines(new Float32Array(pos), new Float32Array(col));
    const all = Array.from(mesh.vertices);
    const xs = all.filter((_, i) => i % 3 === 0);
    const ys = all.filter((_, i) => i % 3 === 1);
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    this.gl.frameTarget((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, extent);
  }

  // ---------------- 折弯与模具 ----------------
  private renderBends(): void {
    const settings = store.getSettings();
    const mat = this.material();
    if (this.part.bends.length === 0) {
      this.host.append(el('div', { class: 'card muted' }, '还没有折弯线。请先到「轮廓手绘」页用折弯线工具在展开件上画折弯线。'));
      return;
    }
    const outer = this.outerPoly();
    this.part.bends.forEach((b, idx) => {
      const line = this.part.bendLines.find((bl) => bl.id === b.bendLineId)!;
      const geo = bendGeometry(line, outer);
      const calc = calcBend(b, mat, this.part.thickness);
      const rec = recommendedV(mat, this.part.thickness);
      const die = settings.lowerDies.find((d) => d.id === b.lowerDieId);
      const card = el('div', { class: 'card' });
      card.append(
        el('h3', {}, `刀次 ${idx + 1} ｜ 折弯线长 ${fmt(geo.bendLength)} mm ｜ 两侧法兰 ${fmt(geo.flangeA)} / ${fmt(geo.flangeB)} mm`),
        el('div', { class: 'row' },
          field('折弯角 °', numberInput(b.angle, (v) => { b.angle = v; this.commit(); }, '1')),
          field('折弯方向', select(
            [{ value: '1', label: '正向 ↑（折向上）' }, { value: '-1', label: '反向 ↓（折向下）' }],
            String(b.direction), (v) => { b.direction = (parseInt(v) as 1 | -1); this.commit(); })),
          field('内 R mm', numberInput(b.innerRadius, (v) => { b.innerRadius = v; this.commit(); }, '0.1')),
          field('K 因子(空=自动)', numberInput(b.kFactor ?? calc.k, (v) => { b.kFactor = v > 0 ? v : null; this.commit(); }, '0.01')),
        ),
        el('div', { class: 'row', style: 'margin-top:10px' },
          field('上模', select(
            [{ value: '', label: '未选择' }, ...settings.upperDies.map((d) => ({ value: d.id, label: `${d.name} ${d.angle}°` }))],
            b.upperDieId ?? '', (v) => { b.upperDieId = v || null; this.commit(); })),
          field('下模', select(
            [{ value: '', label: '未选择' }, ...settings.lowerDies.map((d) => ({ value: d.id, label: `${d.name}（最小法兰${d.minFlange}mm ${d.tonnageRated}t）` }))],
            b.lowerDieId ?? '', (v) => { b.lowerDieId = v || null; this.commit(); })),
          el('button', {
            class: 'btn small', onclick: () => {
              const sug = suggestDie(mat, this.part.thickness, settings.lowerDies);
              if (sug) { b.lowerDieId = sug.id; this.commit(); toast(`已按料厚推荐 ${sug.name}`); }
            },
          }, '推荐下模'),
        ),
        el('div', { class: 'kv', style: 'margin-top:12px' },
          el('span', { class: 'k' }, '推荐 V 槽宽'), el('span', { class: 'mono' }, `V${fmt(rec.min, 1)} ~ V${fmt(rec.max, 1)}（优选 V${fmt(rec.preferred, 1)}）`),
          el('span', { class: 'k' }, '当前 V 槽'), el('span', {}, die ? this.vMatchLabel(die.vWidth, mat) : el('span', { class: 'err-text' }, '未选下模')),
          el('span', { class: 'k' }, 'BA 折弯余量'), el('span', { class: 'mono' }, `${fmt(calc.BA, 3)} mm`),
          el('span', { class: 'k' }, 'OSS 外侧回弹距'), el('span', { class: 'mono' }, `${fmt(calc.OSS, 3)} mm`),
          el('span', { class: 'k' }, 'BD 折弯扣除'), el('span', { class: 'mono' }, `${fmt(calc.BD, 3)} mm`),
          el('span', { class: 'k' }, '当前 K 因子'), el('span', { class: 'mono' }, String(fmt(calc.k, 3))),
        ),
      );
      if (die) {
        const sev = (() => {
          const r = rec;
          if (die.vWidth < r.min * 0.8 || die.vWidth > r.max * 1.25) return 'error';
          if (die.vWidth < r.min || die.vWidth > r.max) return 'warn';
          return 'ok';
        })();
        if (sev !== 'ok') {
          card.append(el('div', { class: `msg-line ${sev === 'error' ? 'error' : 'warn'}`, style: 'margin-top:8px' },
            sev === 'error'
              ? `✗ V${die.vWidth} 与板厚 ${this.part.thickness}mm 不匹配，已拦截该选择风险，建议改用 V${fmt(rec.preferred, 1)} 附近槽宽`
              : `⚠ V${die.vWidth} 偏离推荐区间 V${fmt(rec.min, 1)}~V${fmt(rec.max, 1)}，请确认工艺`));
        }
      }
      this.host.append(card);
    });
  }

  private vMatchLabel(V: number, mat: MaterialDef): HTMLElement {
    const rec = recommendedV(mat, this.part.thickness);
    const ok = V >= rec.min && V <= rec.max;
    return el('span', { class: ok ? 'ok-text' : 'warn-text' }, `V${V} ${ok ? '✓ 匹配' : `（推荐 V${fmt(rec.min, 1)}~V${fmt(rec.max, 1)}）`}`);
  }

  // ---------------- 工艺顺序与可行性 ----------------
  private renderSequence(): void {
    const settings = store.getSettings();
    const machine = settings.machines.find((m) => m.id === settings.activeMachineId)!;
    const mat = this.material();
    const outer = this.outerPoly();
    const report = checkFeasibility(this.part, mat, machine, settings.lowerDies, outer);

    const bar = el('div', { class: 'toolbar' },
      el('button', {
        class: 'btn primary', onclick: () => {
          const next = autoBendOrder(this.part, outer);
          this.part.bends = next;
          this.commit();
          toast('已按「先短后长、先内后外」生成顺序，锁定刀次保持原位');
        },
      }, '自动排序（先短后长·先内后外）'),
      el('span', { class: 'muted' }, '勾选锁定的刀次不会被自动排序覆盖；上下挪动为人工调整'),
    );
    this.host.append(bar);

    const rows = this.part.bends.map((b, idx) => {
      const chk = report.checks[idx];
      const die = settings.lowerDies.find((d) => d.id === b.lowerDieId);
      return el('tr', {},
        el('td', {}, el('div', { style: 'display:flex;gap:4px' },
          el('button', { class: 'btn small', disabled: idx === 0 ? 'true' : '', onclick: () => this.moveBend(idx, -1) }, '↑'),
          el('button', { class: 'btn small', disabled: idx === this.part.bends.length - 1 ? 'true' : '', onclick: () => this.moveBend(idx, 1) }, '↓'),
        )),
        el('td', {}, `#${idx + 1}`),
        el('td', {}, `${b.angle}° ${b.direction > 0 ? '↑' : '↓'} / R${b.innerRadius}`),
        el('td', {}, die ? `V${die.vWidth}` : badge('未选', 'badge error')),
        el('td', { class: 'mono' }, `${fmt(chk?.tonnageRequired ?? 0, 2)} t`),
        el('td', {}, chk ? this.ratioBadge(chk.tonnageRatio) : '-'),
        el('td', {}, chk ? (chk.minFlangeOk ? badge('合格', 'badge ok') : badge(`<${chk.minFlangeRequired}`, 'badge error')) : '-'),
        el('td', {}, chk ? (chk.shutHeightOk && chk.strokeOk ? badge('合格', 'badge ok') : badge('超限', 'badge error')) : '-'),
        el('td', {}, chk ? (chk.eccentric ? badge(`${fmt(chk.eccentricPct, 0)}%偏载`, 'badge error') : badge(`${fmt(chk.eccentricPct, 0)}%`, 'badge ok')) : '-'),
        el('td', {}, el('input', {
          type: 'checkbox', checked: String(b.orderLocked),
          onchange: (e: Event) => { b.orderLocked = (e.target as HTMLInputElement).checked; this.commit(); },
        }), ' 锁定'),
      );
    });
    this.host.append(el('div', { class: 'card' },
      el('h3', {}, `刀次工艺表（调整顺序后全套 ${this.part.bends.length} 刀可行性已重算）`),
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, ...['调序', '刀次', '角度/R', '下模', '需求吨位', '负载率', '法兰边', '闭合/行程', '偏载', '锁定'].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...rows),
      ),
    ));

    // 超标刀次明细
    const detail = el('div', { class: 'card' }, el('h3', {}, '逐刀校验明细与超标数值'));
    report.checks.forEach((c) => {
      const block = el('div', { style: 'margin-bottom:10px' },
        el('div', {}, `刀次 ${c.bendIndex + 1}：`, c.messages.length === 0 ? badge('全部合格', 'badge ok') : badge(`${c.messages.length} 项问题`, c.minFlangeOk && c.tonnageOk && c.strokeOk && c.shutHeightOk ? 'badge warn' : 'badge error')),
      );
      if (c.messages.length === 0) {
        block.append(el('div', { class: 'msg-line ok' },
          `吨位 ${fmt(c.tonnageRequired, 2)}t / 额定 ${machine.ratedTonnage}t，闭合高度需求 ${fmt(c.shutHeightRequired, 1)}mm，压深 ${fmt(c.strokeRequired, 2)}mm，后挡料 X=${fmt(c.gaugeX, 2)}mm`));
      } else {
        c.messages.forEach((m) => block.append(el('div', { class: 'msg-line error' }, `• ${m}`)));
      }
      detail.append(block);
    });
    this.host.append(detail);
  }

  private ratioBadge(ratio: number): HTMLElement {
    const cls = ratio > 1 ? 'badge error' : ratio > 0.85 ? 'badge warn' : 'badge ok';
    return badge(`${fmt(ratio * 100, 0)}%`, cls);
  }

  private moveBend(idx: number, dir: number): void {
    const j = idx + dir;
    const arr = this.part.bends;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    this.commit();
    toast('顺序已调整，全套刀次可行性已重新计算');
  }

  // ---------------- 展开计算校核 ----------------
  private renderCalc(): void {
    const mat = this.material();
    const groups = directionGroupSummary(this.part, mat);
    const card = el('div', { class: 'card' },
      el('h3', {}, '展开长度计算（BA 中性层法，逐刀精确公式）'),
      el('div', { class: 'muted', style: 'margin-bottom:10px' },
        '公式：BA = π/180 × θ × (R + K·T)；OSS = (R+T)·tan(θ/2)；BD = 2·OSS − BA。折成外形尺寸 = 展开尺寸 − ΣBD。修改角度/内R/K 后本页与手绘标注即时重算。'),
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, ...['方向组', '刀次', '展开毛坯(mm)', 'ΣBA(mm)', 'ΣBD(mm)', '折成外形(mm)'].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...groups.map((g) => el('tr', {},
          el('td', {}, g.direction),
          el('td', {}, g.bends.join('、')),
          el('td', { class: 'mono' }, fmt(g.blank, 3)),
          el('td', { class: 'mono' }, fmt(g.baSum, 3)),
          el('td', { class: 'mono' }, fmt(g.bdSum, 3)),
          el('td', { class: 'mono' }, fmt(g.folded, 3)),
        ))),
      ),
    );
    this.host.append(card);

    // 逐刀明细
    const detail = el('div', { class: 'card' }, el('h3', {}, '逐刀展开参数'));
    detail.append(el('table', { class: 'grid' },
      el('thead', {}, el('tr', {}, ...['刀次', '角度°', '内R', 'K', 'BA(mm)', 'OSS(mm)', 'BD(mm)'].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...this.part.bends.map((b, i) => {
        const c = calcBend(b, mat, this.part.thickness);
        return el('tr', {},
          el('td', {}, `#${i + 1}`),
          el('td', { class: 'mono' }, String(b.angle)),
          el('td', { class: 'mono' }, fmt(b.innerRadius, 2)),
          el('td', { class: 'mono' }, fmt(c.k, 3)),
          el('td', { class: 'mono' }, fmt(c.BA, 3)),
          el('td', { class: 'mono' }, fmt(c.OSS, 3)),
          el('td', { class: 'mono' }, fmt(c.BD, 3)),
        );
      })),
    ));
    this.host.append(detail);

    // 手工校核
    const checkCard = el('div', { class: 'card' }, el('h3', {}, '手工展开校核（目标误差 ≤ 0.1 mm）'));
    const manual = this.part.manualFlatLength;
    const blankTotal = groups.reduce((s, g) => s + g.blank, 0);
    checkCard.append(
      el('div', { class: 'row' },
        field('手工核算展开长度 mm', numberInput(manual ?? 0, (v) => { this.part.manualFlatLength = v > 0 ? v : null; this.commit(); }, '0.01')),
        el('button', { class: 'btn small', onclick: () => { this.part.manualFlatLength = null; this.commit(); } }, '清除手工值'),
      ),
    );
    if (manual != null && groups.length) {
      const diff = Math.abs(manual - blankTotal);
      checkCard.append(el('div', { class: `msg-line ${diff <= 0.1 ? 'ok' : 'error'}`, style: 'margin-top:10px;font-size:14px' },
        diff <= 0.1
          ? `✓ 手工值 ${fmt(manual, 2)} mm 与系统展开 ${fmt(blankTotal, 2)} mm 相差 ${fmt(diff, 3)} mm，在 0.1 mm 允差内`
          : `✗ 相差 ${fmt(diff, 3)} mm，超过 0.1 mm 允差，请核对 K 因子表或内 R 取值`));
    }
    this.host.append(checkCard);
  }

  private commit(): void {
    store.upsertPart(this.part);
    this.render();
  }
}

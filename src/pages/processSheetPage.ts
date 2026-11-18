import type { Part } from '../types';
import { store } from '../lib/store';
import { el, clear, fmt, badge } from '../ui/dom';
import { toast } from '../main';
import { buildLoops } from '../lib/geometry';
import { simulate, checkFeasibility, calcBend, bendGeometry } from '../lib/bendMath';
import { buildProcessSheetCanvases, exportPdfFromCanvases, exportPressProgram } from '../lib/export';

export class ProcessSheetPage {
  private host: HTMLElement;
  private part: Part;
  private unsub: () => void;

  constructor(host: HTMLElement, partId: string) {
    this.host = host;
    this.part = store.getPart(partId)!;
    this.unsub = store.subscribe(() => {
      const fresh = store.getPart(partId);
      if (fresh) this.part = fresh;
    });
    this.render();
  }

  destroy(): void { this.unsub(); store.flush(); }

  private render(): void {
    clear(this.host);
    const settings = store.getSettings();
    const machine = settings.machines.find((m) => m.id === settings.activeMachineId)!;
    const mat = settings.materials.find((m) => m.name === this.part.material)!;
    const outer = buildLoops(this.part.entities).loops[0] ?? [];
    const sim = simulate(this.part, mat, machine, settings.lowerDies, outer, settings.defaultFingerClearance);
    const report = checkFeasibility(this.part, mat, machine, settings.lowerDies, outer);

    this.host.append(el('div', { class: 'toolbar' },
      el('button', {
        class: 'btn primary',
        onclick: () => {
          const canvases = buildProcessSheetCanvases(this.part, settings, report.checks, sim.steps);
          exportPdfFromCanvases(canvases, `${this.part.model}_工艺单.pdf`);
          toast('PDF 工艺单已导出，可直接打印');
        },
      }, '导出 PDF（车间打印）'),
      el('button', {
        class: 'btn',
        onclick: () => exportPressProgram(this.part, settings, report.checks, sim.steps),
      }, '导出折弯机程序'),
    ));

    // 抬头
    const head = el('div', { class: 'card' },
      el('div', { style: 'display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px' },
        el('h3', { style: 'margin:0;font-size:18px' }, '钣金折弯工艺单'),
        el('span', { class: 'muted' }, new Date().toLocaleString('zh-CN'))),
      el('div', { class: 'kv', style: 'margin-top:12px;grid-template-columns:120px 1fr 120px 1fr' },
        el('span', { class: 'k' }, '产品型号'), el('span', {}, this.part.model),
        el('span', { class: 'k' }, '零件名称'), el('span', {}, this.part.name),
        el('span', { class: 'k' }, '材料牌号'), el('span', {}, this.part.material),
        el('span', { class: 'k' }, '料厚'), el('span', { class: 'mono' }, `${this.part.thickness} mm`),
        el('span', { class: 'k' }, '机床'), el('span', {}, `${machine.name}（${machine.ratedTonnage}t）`),
        el('span', { class: 'k' }, '刀次总数'), el('span', {}, String(this.part.bends.length)),
      ),
    );
    this.host.append(head);

    // 刀次表
    const rows = this.part.bends.map((b, i) => {
      const die = settings.lowerDies.find((d) => d.id === b.lowerDieId);
      const upper = settings.upperDies.find((d) => d.id === b.upperDieId);
      const chk = report.checks[i];
      const st = sim.steps[i];
      const line = this.part.bendLines.find((bl) => bl.id === b.bendLineId)!;
      const geo = bendGeometry(line, outer);
      const calc = calcBend(b, mat, this.part.thickness);
      return el('tr', {},
        el('td', {}, String(i + 1)),
        el('td', { class: 'mono' }, `${b.angle}° ${b.direction > 0 ? '↑' : '↓'}`),
        el('td', { class: 'mono' }, fmt(b.innerRadius, 2)),
        el('td', { class: 'mono' }, fmt(calc.k, 3)),
        el('td', {}, upper?.name ?? badge('未选', 'badge error')),
        el('td', {}, die ? `${die.name} V${die.vWidth}` : badge('未选', 'badge error')),
        el('td', { class: 'mono' }, fmt(st.gaugeX, 2)),
        el('td', { class: 'mono' }, fmt(st.fingerClearance, 1)),
        el('td', { class: 'mono' }, `${fmt(geo.bendLength, 1)}`),
        el('td', { class: 'mono' }, fmt(st.tonnagePeak, 2)),
        el('td', {}, chk.messages.length === 0 ? badge('合格', 'badge ok') : badge('不通过', 'badge error')),
      );
    });
    this.host.append(el('div', { class: 'card' },
      el('h3', {}, '逐道折弯工艺（按加工顺序）'),
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {},
          ...['刀次', '角度', '内R', 'K因子', '上模', '下模', '定位X mm', '避让 mm', '折线长 mm', '预估压力 t', '校验'].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...rows),
      ),
    ));

    // 校验问题汇总
    const problems = report.checks.filter((c) => c.messages.length > 0);
    const issueCard = el('div', { class: 'card' }, el('h3', {}, '可行性校验汇总'));
    if (problems.length === 0) {
      issueCard.append(el('div', { class: 'msg-line ok' }, '✓ 全套刀次吨位、法兰边、闭合高度、滑块行程、偏载均在机床允许范围内，可下发车间。'));
    } else {
      problems.forEach((c) => c.messages.forEach((m) =>
        issueCard.append(el('div', { class: 'msg-line error' }, `刀次 ${c.bendIndex + 1}：${m}`))));
    }
    this.host.append(issueCard);

    // 节拍与展开
    const totalBA = this.part.bends.reduce((s, b) => s + calcBend(b, mat, this.part.thickness).BA, 0);
    const totalBD = this.part.bends.reduce((s, b) => s + calcBend(b, mat, this.part.thickness).BD, 0);
    this.host.append(el('div', { class: 'card' }, el('h3', {}, '汇总数据'),
      el('div', { class: 'kv' },
        el('span', { class: 'k' }, '整板节拍'), el('span', { class: 'mono' }, `${fmt(sim.summary.totalTime, 1)} s（空行程占比 ${fmt(sim.summary.idlePct, 1)}%）`),
        el('span', { class: 'k' }, '峰值吨位'), el('span', { class: 'mono' }, `${fmt(sim.summary.peakTonnage, 2)} t`),
        el('span', { class: 'k' }, 'ΣBA'), el('span', { class: 'mono' }, `${fmt(totalBA, 3)} mm`),
        el('span', { class: 'k' }, 'ΣBD'), el('span', { class: 'mono' }, `${fmt(totalBD, 3)} mm`),
        el('span', { class: 'k' }, '备注'), el('span', {}, this.part.note || '—'),
      ),
    ));
  }
}

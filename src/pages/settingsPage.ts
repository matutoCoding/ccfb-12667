import type { Settings, MachineConfig, UpperDie, LowerDie, MaterialDef } from '../types';
import { store } from '../lib/store';
import { el, clear, fmt, numberInput, field, select } from '../ui/dom';
import { toast } from '../main';
import { defaultSettings } from '../lib/defaults';
import { uid } from '../lib/geometry';

type Section = 'machine' | 'dies' | 'materials';

export class SettingsPage {
  private host: HTMLElement;
  private unsub: () => void;
  private section: Section = 'machine';
  private draft: Settings;

  constructor(host: HTMLElement) {
    this.host = host;
    this.unsub = store.subscribe(() => this.render());
    this.draft = structuredClone(store.getSettings());
    this.render();
  }

  destroy(): void { this.unsub(); }

  private save(): void {
    store.saveSettings(this.draft);
    toast('设置已保存到本地');
  }

  private render(): void {
    clear(this.host);
    this.host.append(
      el('div', { class: 'tabs-sub' },
        ...([['machine', '机床参数'], ['dies', '模具库'], ['materials', '材料与K因子表']] as [Section, string][]).map(([k, l]) =>
          el('button', { class: this.section === k ? 'active' : '', onclick: () => { this.section = k; this.render(); } }, l))),
      el('div', { class: 'toolbar' },
        el('button', { class: 'btn primary', onclick: () => this.save() }, '保存全部设置'),
        el('button', {
          class: 'btn danger', onclick: () => {
            this.draft = defaultSettings();
            store.saveSettings(this.draft);
            toast('已恢复出厂默认设置');
          },
        }, '恢复默认'),
      ),
    );
    if (this.section === 'machine') this.renderMachine();
    if (this.section === 'dies') this.renderDies();
    if (this.section === 'materials') this.renderMaterials();
  }

  private renderMachine(): void {
    const card = el('div', { class: 'card' },
      el('h3', {}, '机床选择与吨位/开启高度'),
      field('当前机床', select(
        this.draft.machines.map((m) => ({ value: m.id, label: m.name })),
        this.draft.activeMachineId, (v) => { this.draft.activeMachineId = v; this.render(); })),
    );
    const m = this.draft.machines.find((x) => x.id === this.draft.activeMachineId)!;
    const num = (key: keyof MachineConfig, label: string, step = '1') =>
      field(label, numberInput(m[key] as number, (v) => { (m as any)[key] = v; this.save(); }, step));
    card.append(el('div', { class: 'row', style: 'margin-top:12px' },
      num('ratedTonnage', '额定吨位 t'),
      num('maxOpenHeight', '最大开启高度 mm'),
      num('ramStroke', '滑块行程 mm'),
      num('shutHeight', '模具闭合高度需求 mm'),
    ), el('div', { class: 'row', style: 'margin-top:10px' },
      num('rapidSpeed', '快下速度 mm/s'),
      num('workSpeed', '工进速度 mm/s'),
      num('returnSpeed', '回程速度 mm/s'),
      num('eccentricLimitPct', '偏载报警比例 %'),
    ));
    this.host.append(card);

    const extra = el('div', { class: 'card' }, el('h3', {}, '通用参数'),
      el('div', { class: 'row' },
        field('默认挡指避让 mm', numberInput(this.draft.defaultFingerClearance, (v) => { this.draft.defaultFingerClearance = v; this.save(); }, '0.5')),
        field('回收站保留天数', numberInput(this.draft.recycleDays, (v) => { this.draft.recycleDays = Math.max(1, v); this.save(); }, '1')),
      ),
      el('div', { class: 'muted', style: 'margin-top:8px' }, '所有参数仅保存在本机浏览器 IndexedDB 中，不上传任何服务器。'),
    );
    this.host.append(extra);
  }

  private renderDies(): void {
    const upCard = el('div', { class: 'card' },
      el('h3', {}, '上模库'),
      el('button', {
        class: 'btn small', style: 'margin-bottom:10px', onclick: () => {
          this.draft.upperDies.push({ id: uid('u'), name: '新上模', angle: 88, tipRadius: 1, height: 120 });
          this.save();
        },
      }, '＋ 新增上模'),
      this.dieTable(this.draft.upperDies, (id) => { this.draft.upperDies = this.draft.upperDies.filter((d) => d.id !== id); this.save(); }, true),
    );
    const lowCard = el('div', { class: 'card' },
      el('h3', {}, '下模库（V 槽宽 / 角度 / 压力吨位 / 最小法兰边）'),
      el('button', {
        class: 'btn small', style: 'margin-bottom:10px', onclick: () => {
          this.draft.lowerDies.push({ id: uid('l'), name: '新下模', vWidth: 10, angle: 88, minFlange: 8, height: 30, tonnageRated: 100 });
          this.save();
        },
      }, '＋ 新增下模'),
      this.dieTable(this.draft.lowerDies, (id) => { this.draft.lowerDies = this.draft.lowerDies.filter((d) => d.id !== id); this.save(); }, false),
    );
    this.host.append(upCard, lowCard);
  }

  private dieTable(dies: (UpperDie | LowerDie)[], remove: (id: string) => void, isUpper: boolean): HTMLElement {
    const rows = dies.map((d) => {
      const nameI = el('input', { value: d.name, oninput: (e: Event) => { d.name = (e.target as HTMLInputElement).value; } }) as HTMLInputElement;
      nameI.addEventListener('change', () => this.save());
      const angleI = numberInput(d.angle, (v) => { d.angle = v; this.save(); }, '1');
      const common = [el('td', {}, nameI), el('td', {}, angleI)];
      if (isUpper) {
        const u = d as UpperDie;
        return el('tr', {}, ...common,
          el('td', {}, numberInput(u.tipRadius, (v) => { u.tipRadius = v; this.save(); }, '0.1')),
          el('td', {}, numberInput(u.height, (v) => { u.height = v; this.save(); }, '1')),
          el('td', {}, '—'), el('td', {}, '—'),
          el('td', {}, el('button', { class: 'btn small danger', onclick: () => remove(d.id) }, '删')),
        );
      }
      const l = d as LowerDie;
      return el('tr', {}, ...common,
        el('td', {}, numberInput(l.vWidth, (v) => { l.vWidth = v; this.save(); }, '0.5')),
        el('td', {}, numberInput(l.minFlange, (v) => { l.minFlange = v; this.save(); }, '0.5')),
        el('td', {}, numberInput(l.height, (v) => { l.height = v; this.save(); }, '1')),
        el('td', {}, numberInput(l.tonnageRated, (v) => { l.tonnageRated = v; this.save(); }, '1')),
        el('td', {}, el('button', { class: 'btn small danger', onclick: () => remove(l.id) }, '删')),
      );
    });
    const heads = isUpper
      ? ['名称', '角度°', '刀尖R', '高度mm', '', '', '', '']
      : ['名称', 'V角°', 'V槽宽mm', '最小法兰mm', '高度mm', '额定吨t', '', ''];
    return el('table', { class: 'grid' },
      el('thead', {}, el('tr', {}, ...heads.map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rows),
    );
  }

  private renderMaterials(): void {
    for (const mat of this.draft.materials) {
      const card = el('div', { class: 'card' });
      card.append(el('h3', {}, `${mat.name}（独立 K 因子表与角度系数）`));
      card.append(el('div', { class: 'row' },
        field('抗拉强度 Rm MPa', numberInput(mat.tensileStrength, (v) => { mat.tensileStrength = v; this.save(); }, '1')),
        field('屈服 MPa', numberInput(mat.yieldStrength, (v) => { mat.yieldStrength = v; this.save(); }, '1')),
        field('V槽倍数下限', numberInput(mat.vMinMult, (v) => { mat.vMinMult = v; this.save(); }, '0.5')),
        field('V槽倍数上限', numberInput(mat.vMaxMult, (v) => { mat.vMaxMult = v; this.save(); }, '0.5')),
      ));
      // K 因子表
      const kTable = el('table', { class: 'grid', style: 'margin-top:12px' },
        el('thead', {}, el('tr', {}, el('th', {}, 'R/T 比值'), el('th', {}, 'K 因子'), el('th', {}, ''))),
        el('tbody', {}, ...mat.kTable.map((row, ri) => el('tr', {},
          el('td', {}, numberInput(row.ratio, (v) => { row.ratio = v; this.save(); }, '0.1')),
          el('td', {}, numberInput(row.k, (v) => { row.k = Math.max(0.1, Math.min(0.6, v)); this.save(); }, '0.01')),
          el('td', {}, el('button', {
            class: 'btn small danger',
            onclick: () => { mat.kTable.splice(ri, 1); this.save(); },
          }, '删')),
        ))),
      );
      card.append(kTable, el('button', {
        class: 'btn small', style: 'margin-top:8px', onclick: () => {
          mat.kTable.push({ ratio: 4, k: 0.45 });
          mat.kTable.sort((a, b) => a.ratio - b.ratio);
          this.save();
        },
      }, '＋ 增加 K 因子区间'));

      // 角度系数表
      const aTable = el('table', { class: 'grid', style: 'margin-top:12px' },
        el('thead', {}, el('tr', {}, el('th', {}, '折弯角 °'), el('th', {}, '吨位系数'), el('th', {}, ''))),
        el('tbody', {}, ...mat.angleFactorTable.map((row, ri) => el('tr', {},
          el('td', {}, numberInput(row.angle, (v) => { row.angle = v; this.save(); }, '1')),
          el('td', {}, numberInput(row.factor, (v) => { row.factor = v; this.save(); }, '0.01')),
          el('td', {}, el('button', {
            class: 'btn small danger',
            onclick: () => { mat.angleFactorTable.splice(ri, 1); this.save(); },
          }, '删')),
        ))),
      );
      card.append(aTable, el('button', {
        class: 'btn small', style: 'margin-top:8px', onclick: () => {
          mat.angleFactorTable.push({ angle: 90, factor: 1 });
          mat.angleFactorTable.sort((a, b) => a.angle - b.angle);
          this.save();
        },
      }, '＋ 增加角度系数'));
      this.host.append(card);
    }

    const addCard = el('div', { class: 'card' },
      el('button', {
        class: 'btn primary', onclick: () => {
          const name = `新材料${this.draft.materials.length + 1}`;
          const nm: MaterialDef = {
            name, tensileStrength: 400, yieldStrength: 250, vMinMult: 6, vMaxMult: 10,
            kTable: [{ ratio: 1, k: 0.33 }, { ratio: 2, k: 0.38 }, { ratio: 4, k: 0.45 }],
            angleFactorTable: [{ angle: 90, factor: 1 }, { angle: 120, factor: 0.85 }],
          };
          this.draft.materials.push(nm);
          this.save();
        },
      }, '＋ 新增材料牌号'),
      el('div', { class: 'muted', style: 'margin-top:8px' }, 'SPCC、SUS304 等牌号的 K 因子与强度分开存储，互不影响。当前共 ' + this.draft.materials.length + ' 种材料。'),
    );
    this.host.append(addCard);
    void fmt;
  }
}

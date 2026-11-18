import type { Part } from '../types';
import { store } from '../lib/store';
import { el, clear, fmtBytes, badge, input, select } from '../ui/dom';
import { toast } from '../main';

export class ListPage {
  private host: HTMLElement;
  private unsub: () => void;
  private filterThickness = '';
  private filterMaterial = '';
  private filterTime = 'all';
  private showRecycle = false;
  private selected = new Set<string>();
  private stats = { bytes: 0, quota: null as number | null };

  constructor(host: HTMLElement) {
    this.host = host;
    this.unsub = store.subscribe(() => this.render());
    void this.refreshStats();
    this.render();
  }

  destroy(): void { this.unsub(); }

  private async refreshStats(): Promise<void> {
    this.stats = await store.storageStats();
    this.render();
  }

  private filteredParts(): Part[] {
    let list = store.getParts().filter((p) => p.status === (this.showRecycle ? 'recycled' : 'active'));
    if (this.filterMaterial) list = list.filter((p) => p.material === this.filterMaterial);
    if (this.filterThickness) list = list.filter((p) => String(p.thickness) === this.filterThickness);
    const dayMs = { all: Infinity, '7': 7, '30': 30 }[this.filterTime] ?? Infinity;
    if (dayMs !== Infinity) list = list.filter((p) => Date.now() - p.updatedAt <= dayMs * 86400_000);
    list.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    return list;
  }

  private render(): void {
    clear(this.host);
    const parts = this.filteredParts();
    const all = store.getParts().filter((p) => p.status === 'active');
    const materials = Array.from(new Set(store.getParts().map((p) => p.material)));
    const thicknesses = Array.from(new Set(store.getParts().map((p) => String(p.thickness))).values());
    const models = new Map<string, Part[]>();
    for (const p of parts) {
      const arr = models.get(p.model) ?? [];
      arr.push(p);
      models.set(p.model, arr);
    }

    // 统计卡
    const recycledCount = store.getParts().filter((p) => p.status === 'recycled').length;
    const statsBar = el('div', { class: 'row', style: 'margin-bottom:14px' },
      this.stat(all.length, '在用零件'),
      this.stat(models.size, '产品型号组'),
      this.stat(fmtBytes(this.stats.bytes), '本地占用空间'),
      this.stat(recycledCount, '回收站待清'),
    );

    // 工具栏
    const toolbar = el('div', { class: 'toolbar' },
      el('button', { class: 'btn primary', onclick: () => this.openCreate() }, '＋ 新建零件'),
      el('button', { class: 'btn', onclick: () => this.importFile() }, '导入 JSON'),
      el('label', { class: 'field' }, el('span', {}, '牌号'),
        select([{ value: '', label: '全部' }, ...materials.map((m) => ({ value: m, label: m }))], this.filterMaterial, (v) => { this.filterMaterial = v; this.render(); })),
      el('label', { class: 'field' }, el('span', {}, '料厚'),
        select([{ value: '', label: '全部' }, ...thicknesses.map((t) => ({ value: t, label: `${t} mm` }))], this.filterThickness, (v) => { this.filterThickness = v; this.render(); })),
      el('label', { class: 'field' }, el('span', {}, '修改时间'),
        select([
          { value: 'all', label: '全部' }, { value: '7', label: '近 7 天' }, { value: '30', label: '近 30 天' },
        ], this.filterTime, (v) => { this.filterTime = v; this.render(); })),
      el('div', { class: 'spacer' }),
      el('button', {
        class: `btn ${this.showRecycle ? 'primary' : ''}`,
        onclick: () => { this.showRecycle = !this.showRecycle; this.selected.clear(); this.render(); },
      }, this.showRecycle ? '← 返回列表' : '回收站'),
    );

    // 批量操作条
    const batchBar: HTMLElement | null = this.showRecycle || this.selected.size === 0
      ? null
      : el('div', { class: 'toolbar' },
        el('span', { class: 'muted' }, `已选 ${this.selected.size} 件：`),
        el('button', { class: 'btn small', onclick: () => this.batchTag() }, '批量打标签'),
        el('button', { class: 'btn small danger', onclick: () => { this.selected.forEach((id) => store.recycle(id)); this.selected.clear(); toast('已移入回收站'); } }, '批量删除'),
        el('button', { class: 'btn small', onclick: () => { this.selected.clear(); this.render(); } }, '取消选择'),
      );

    this.host.append(statsBar, toolbar);
    if (batchBar) this.host.append(batchBar);

    if (this.showRecycle) this.renderRecycle();
    else if (models.size === 0) this.host.append(el('div', { class: 'card muted' }, '没有符合条件的零件，点击「新建零件」开始绘制展开轮廓。'));
    else for (const [model, list] of models) this.host.append(this.modelGroup(model, list));
  }

  private stat(num: number | string, label: string): HTMLElement {
    return el('div', { class: 'stat' }, el('div', { class: 'num' }, String(num)), el('div', { class: 'lbl' }, label));
  }

  private modelGroup(model: string, list: Part[]): HTMLElement {
    const rows = list.map((p) => {
      const checked = this.selected.has(p.id);
      const tags = p.tags.map((t) => badge(t));
      return el('tr', {},
        el('td', {}, el('input', {
          type: 'checkbox', checked: String(checked),
          onchange: (e: Event) => {
            const v = (e.target as HTMLInputElement).checked;
            if (v) this.selected.add(p.id); else this.selected.delete(p.id);
            this.render();
          },
        })),
        el('td', {}, p.favorite ? badge('★ 收藏', 'badge star') : ''),
        el('td', {}, el('a', {
          style: 'color:var(--accent);cursor:pointer',
          onclick: () => store.navigate({ page: 'editor', partId: p.id }),
        }, p.name)),
        el('td', {}, p.material),
        el('td', { class: 'mono' }, `${p.thickness} mm`),
        el('td', {}, ...(tags.length ? tags : [el('span', { class: 'muted' }, '—')])),
        el('td', {}, `${p.bends.length} 刀`),
        el('td', { class: 'muted' }, new Date(p.updatedAt).toLocaleString('zh-CN')),
        el('td', {}, this.rowActions(p)),
      );
    });
    return el('div', { class: 'card' },
      el('h3', {}, `${model}（${list.length} 件）`),
      el('table', { class: 'grid' },
        el('thead', {}, el('tr', {},
          ...['选', '藏', '零件名称', '牌号', '料厚', '标签', '折弯', '修改时间', '操作'].map((h) => el('th', {}, h)),
        )),
        el('tbody', {}, ...rows),
      ),
    );
  }

  private rowActions(p: Part): HTMLElement {
    return el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
      el('button', { class: 'btn small', onclick: () => store.toggleFavorite(p.id) }, p.favorite ? '取消收藏' : '收藏'),
      el('button', { class: 'btn small', onclick: () => store.navigate({ page: 'simulation', partId: p.id }) }, '仿真'),
      el('button', { class: 'btn small', onclick: () => store.navigate({ page: 'process-sheet', partId: p.id }) }, '工艺单'),
      el('button', { class: 'btn small', onclick: () => this.exportOne(p) }, '导出'),
      el('button', { class: 'btn small danger', onclick: () => { store.recycle(p.id); toast('已移入回收站，7 天后自动清除'); } }, '删除'),
    );
  }

  private renderRecycle(): void {
    const list = store.getParts().filter((p) => p.status === 'recycled');
    const card = el('div', { class: 'card' },
      el('h3', {}, `回收站（保留 ${store.getSettings().recycleDays} 天，到期自动清除）`),
      el('div', { class: 'toolbar' },
        el('button', {
          class: 'btn danger', onclick: () => { store.emptyRecycleBin(); toast('回收站已清空'); },
        }, '清空回收站'),
      ),
    );
    if (list.length === 0) {
      card.append(el('div', { class: 'muted' }, '回收站为空。'));
    } else {
      card.append(el('table', { class: 'grid' },
        el('thead', {}, el('tr', {}, ...['零件', '型号', '删除时间', '剩余', '操作'].map((h) => el('th', {}, h)))),
        el('tbody', {}, ...list.map((p) => {
          const days = store.getSettings().recycleDays - Math.floor((Date.now() - (p.recycledAt ?? 0)) / 86400_000);
          return el('tr', {},
            el('td', {}, p.name), el('td', {}, p.model),
            el('td', { class: 'muted' }, new Date(p.recycledAt ?? 0).toLocaleString('zh-CN')),
            el('td', {}, days > 0 ? `${days} 天` : badge('即将清除', 'badge error')),
            el('td', {},
              el('button', { class: 'btn small primary', onclick: () => store.restore(p.id) }, '还原'),
              ' ',
              el('button', { class: 'btn small danger', onclick: () => store.hardDelete(p.id) }, '彻底删除'),
            ),
          );
        })),
      ));
    }
    this.host.append(card);
  }

  private exportOne(p: Part): void {
    const blob = new Blob([store.exportPart(p.id)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.model}_${p.name}.json`;
    a.click();
  }

  private importFile(): void {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.json,application/json';
    picker.onchange = () => {
      const f = picker.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const p = store.importPart(String(reader.result));
          toast(`已导入：${p.name}`);
        } catch {
          toast('导入失败：文件格式不正确');
        }
      };
      reader.readAsText(f);
    };
    picker.click();
  }

  private openCreate(): void {
    const settings = store.getSettings();
    let model = `MODEL-${String(store.getParts().length + 1).padStart(3, '0')}`;
    let name = '新零件';
    let material = settings.materials[0]?.name ?? 'SPCC';
    let thickness = 1.5;
    const mask = el('div', { class: 'modal-mask' });
    const nameI = input(name, (v) => { name = v; });
    const modelI = input(model, (v) => { model = v; });
    const matS = select(settings.materials.map((m) => ({ value: m.name, label: m.name })), material, (v) => { material = v; });
    const thickI = input(thickness, (v) => { thickness = parseFloat(v) || 0; }, 'number');
    const modal = el('div', { class: 'modal' },
      el('h3', {}, '新建零件（先选牌号和料厚）'),
      el('div', { class: 'kv' },
        el('span', { class: 'k' }, '产品型号'), modelI,
        el('span', { class: 'k' }, '零件名称'), nameI,
        el('span', { class: 'k' }, '材料牌号'), matS,
        el('span', { class: 'k' }, '料厚 mm'), thickI,
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: () => mask.remove() }, '取消'),
        el('button', {
          class: 'btn primary', onclick: () => {
            if (thickness <= 0) { toast('料厚必须大于 0'); return; }
            const p = store.createPart({ model: model || '未分组', name: name || '新零件', material, thickness });
            mask.remove();
            store.navigate({ page: 'editor', partId: p.id });
          },
        }, '创建并绘制'),
      ),
    );
    mask.append(modal);
    document.body.append(mask);
  }

  private batchTag(): void {
    let val = '';
    const mask = el('div', { class: 'modal-mask' });
    const tagI = input('', (v) => { val = v; });
    const modal = el('div', { class: 'modal' },
      el('h3', {}, `给 ${this.selected.size} 个零件批量打标签`),
      el('p', { class: 'muted' }, '多个标签用逗号分隔，已有标签不会被覆盖'),
      tagI,
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: () => mask.remove() }, '取消'),
        el('button', {
          class: 'btn primary', onclick: () => {
            const tags = val.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
            if (tags.length) {
              store.batchTag([...this.selected], tags);
              this.selected.clear();
              toast('标签已添加');
            }
            mask.remove();
          },
        }, '确定'),
      ),
    );
    mask.append(modal);
    document.body.append(mask);
  }
}

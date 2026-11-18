import { store, type Route } from './lib/store';
import { el, clear } from './ui/dom';
import { ListPage } from './pages/listPage';
import { EditorPage } from './pages/editorPage';
import { SimulationPage } from './pages/simulationPage';
import { ProcessSheetPage } from './pages/processSheetPage';
import { SettingsPage } from './pages/settingsPage';
import './styles.css';

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, id] = h.split('/');
  if (page === 'editor' && id) return { page: 'editor', partId: id };
  if (page === 'simulation' && id) return { page: 'simulation', partId: id };
  if (page === 'process-sheet' && id) return { page: 'process-sheet', partId: id };
  if (page === 'settings') return { page: 'settings' };
  return { page: 'list' };
}

let toastTimer: number | null = null;
export function toast(msg: string): void {
  document.querySelectorAll('.toast').forEach((n) => n.remove());
  const t = el('div', { class: 'toast' }, msg);
  document.body.append(t);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 2600);
}

export class App {
  private main: HTMLElement;
  private current: { destroy?: () => void } | null = null;

  constructor() {
    const app = document.getElementById('app')!;
    app.append(this.buildTopbar());
    this.main = el('main', {});
    app.append(this.main);
    window.addEventListener('hashchange', () => this.route());
    store.subscribe(() => this.renderTopbar());
  }

  private topbarNav = el('nav', { class: 'tabs' });
  private topbarSub = el('span', { class: 'sub' });

  private buildTopbar(): HTMLElement {
    const header = el('header', { class: 'topbar' },
      el('span', { class: 'brand' }, '钣金折弯工艺系统'),
      this.topbarNav,
      this.topbarSub,
    );
    return header;
  }

  private renderTopbar(): void {
    const route = store.getRoute();
    const part = route.page === 'list' || route.page === 'settings'
      ? null
      : store.getPart((route as { partId: string }).partId);
    const tabs: { key: Route['page']; label: string; disabled?: boolean; route: Route }[] = [
      { key: 'list', label: '零件列表', route: { page: 'list' } },
      { key: 'editor', label: '折弯编辑', disabled: !part, route: part ? { page: 'editor', partId: part.id } : { page: 'list' } },
      { key: 'simulation', label: '折弯仿真', disabled: !part, route: part ? { page: 'simulation', partId: part.id } : { page: 'list' } },
      { key: 'process-sheet', label: '工艺单', disabled: !part, route: part ? { page: 'process-sheet', partId: part.id } : { page: 'list' } },
      { key: 'settings', label: '设置', route: { page: 'settings' } },
    ];
    clear(this.topbarNav);
    for (const t of tabs) {
      const btn = el('button', {
        class: route.page === t.key ? 'active' : '',
        onclick: () => { if (!t.disabled) store.navigate(t.route); },
      }, t.label);
      if (t.disabled) btn.style.opacity = '.4';
      this.topbarNav.append(btn);
    }
    this.topbarSub.textContent = part ? `${part.model} / ${part.name}（${part.material} T=${part.thickness}mm）` : '全部计算本地运行 · 无外部接口';
  }

  async start(): Promise<void> {
    await store.init();
    store.setRoute(parseHash());
    if (!location.hash) location.hash = '#/list';
    this.renderTopbar();
    this.route();
  }

  route(): void {
    const r = parseHash();
    store.setRoute(r);
    this.renderTopbar();
    this.current?.destroy?.();
    clear(this.main);
    if (r.page === 'list') {
      this.current = new ListPage(this.main);
      return;
    }
    if (r.page === 'settings') {
      this.current = new SettingsPage(this.main);
      return;
    }
    const part = store.getPart(r.partId);
    if (!part) { location.hash = '#/list'; return; }
    if (r.page === 'editor') this.current = new EditorPage(this.main, r.partId);
    if (r.page === 'simulation') this.current = new SimulationPage(this.main, r.partId);
    if (r.page === 'process-sheet') this.current = new ProcessSheetPage(this.main, r.partId);
  }
}

new App().start().catch((err) => {
  document.getElementById('app')!.append(el('div', { class: 'card err-text' }, `启动失败：${String(err)}`));
});

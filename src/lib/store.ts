// 全局状态 Store：内存态 + IndexedDB 持久化，切页不丢数据
import type { Part, Settings } from '../types';
import { idb } from './db';
import { defaultSettings } from './defaults';
import { buildSampleParts } from './samples';
import { uid } from './geometry';

export type Route =
  | { page: 'list' }
  | { page: 'editor'; partId: string }
  | { page: 'simulation'; partId: string }
  | { page: 'process-sheet'; partId: string }
  | { page: 'settings' };

interface State {
  parts: Part[];
  settings: Settings;
  route: Route;
  loaded: boolean;
}

type Listener = () => void;

class Store {
  private state: State = { parts: [], settings: defaultSettings(), route: { page: 'list' }, loaded: false };
  private listeners = new Set<Listener>();
  private saveTimer: number | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  getState(): State {
    return this.state;
  }

  getParts(): Part[] {
    return this.state.parts;
  }

  getSettings(): Settings {
    return this.state.settings;
  }

  getPart(id: string): Part | undefined {
    return this.state.parts.find((p) => p.id === id);
  }

  getRoute(): Route {
    return this.state.route;
  }

  navigate(route: Route): void {
    location.hash = route.page === 'list'
      ? '#/list'
      : route.page === 'settings'
        ? '#/settings'
        : `#/${route.page}/${route.partId}`;
  }

  setRoute(route: Route): void {
    this.state.route = route;
    this.notify();
  }

  async init(): Promise<void> {
    if (this.state.loaded) return;
    const [parts, savedSettings] = await Promise.all([
      idb.getAll<Part>('parts'),
      idb.get<Settings>('settings', 'app-settings'),
    ]);
    this.state.settings = savedSettings ?? defaultSettings();
    let list = parts;
    if (list.length === 0) {
      list = buildSampleParts();
      await idb.bulkPut('parts', list);
    }
    // 旧版本数据迁移：补折弯方向字段
    for (const p of list) {
      for (const b of p.bends) {
        if (b.direction !== 1 && b.direction !== -1) b.direction = 1;
      }
      if (p.manualFlatLength === undefined) p.manualFlatLength = null;
    }
    // 回收站到期清理
    const days = this.state.settings.recycleDays;
    const now = Date.now();
    const kept: Part[] = [];
    for (const p of list) {
      if (p.status === 'recycled' && p.recycledAt && now - p.recycledAt > days * 86400_000) {
        await idb.delete('parts', p.id);
      } else {
        kept.push(p);
      }
    }
    this.state.parts = kept;
    this.state.loaded = true;
    if (!savedSettings) await idb.put('settings', { ...this.state.settings, id: 'app-settings' });
    this.notify();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void idb.bulkPut('parts', this.state.parts);
      this.saveTimer = null;
    }, 200);
  }

  private persistNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    void idb.bulkPut('parts', this.state.parts);
  }

  saveSettings(next: Settings): void {
    this.state.settings = next;
    void idb.put('settings', { ...next, id: 'app-settings' });
    this.notify();
  }

  upsertPart(part: Part, immediate = false): void {
    const i = this.state.parts.findIndex((p) => p.id === part.id);
    part.updatedAt = Date.now();
    if (i >= 0) this.state.parts[i] = part;
    else this.state.parts.unshift(part);
    if (immediate) this.persistNow();
    else this.scheduleSave();
    this.notify();
  }

  createPart(input: { model: string; name: string; material: string; thickness: number }): Part {
    const part: Part = {
      id: uid('part'),
      model: input.model,
      name: input.name,
      material: input.material,
      thickness: input.thickness,
      tags: [],
      favorite: false,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      recycledAt: null,
      entities: [],
      dimensions: [],
      bendLines: [],
      bends: [],
      manualFlatLength: null,
      note: '',
    };
    this.state.parts.unshift(part);
    this.scheduleSave();
    this.notify();
    return part;
  }

  toggleFavorite(id: string): void {
    const p = this.getPart(id);
    if (!p) return;
    p.favorite = !p.favorite;
    this.scheduleSave();
    this.notify();
  }

  setTags(id: string, tags: string[]): void {
    const p = this.getPart(id);
    if (!p) return;
    p.tags = tags;
    this.scheduleSave();
    this.notify();
  }

  batchTag(ids: string[], tags: string[]): void {
    for (const id of ids) {
      const p = this.getPart(id);
      if (p) p.tags = Array.from(new Set([...p.tags, ...tags]));
    }
    this.scheduleSave();
    this.notify();
  }

  recycle(id: string): void {
    const p = this.getPart(id);
    if (!p) return;
    p.status = 'recycled';
    p.recycledAt = Date.now();
    this.scheduleSave();
    this.notify();
  }

  restore(id: string): void {
    const p = this.getPart(id);
    if (!p) return;
    p.status = 'active';
    p.recycledAt = null;
    this.scheduleSave();
    this.notify();
  }

  hardDelete(id: string): void {
    this.state.parts = this.state.parts.filter((p) => p.id !== id);
    void idb.delete('parts', id);
    this.notify();
  }

  emptyRecycleBin(): void {
    const gone = this.state.parts.filter((p) => p.status === 'recycled').map((p) => p.id);
    this.state.parts = this.state.parts.filter((p) => p.status !== 'recycled');
    gone.forEach((id) => void idb.delete('parts', id));
    this.notify();
  }

  async storageStats(): Promise<{ count: number; bytes: number; quota: number | null }> {
    const est = await idb.estimateBytes();
    return { count: this.state.parts.filter((p) => p.status === 'active').length, bytes: est.bytes, quota: est.quota };
  }

  exportPart(id: string): string {
    const p = this.getPart(id);
    return JSON.stringify({ app: 'bend-system', version: 1, part: p }, null, 2);
  }

  importPart(json: string): Part {
    const data = JSON.parse(json);
    const part: Part = data.part ?? data;
    part.id = uid('part');
    part.status = 'active';
    part.recycledAt = null;
    part.createdAt = Date.now();
    part.updatedAt = Date.now();
    this.state.parts.unshift(part);
    this.persistNow();
    this.notify();
    return part;
  }

  /** 离开编辑页前确保落盘 */
  flush(): void {
    this.persistNow();
  }
}

export const store = new Store();

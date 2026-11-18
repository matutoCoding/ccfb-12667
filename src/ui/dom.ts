// 极简 DOM 构建助手（无框架）
export type ElChild = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener | null | undefined> = {},
  ...children: ElChild[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, val] of Object.entries(attrs)) {
    if (val == null || val === false) continue;
    if (k.startsWith('on') && typeof val === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), val as EventListener);
    } else if (k === 'class') {
      node.className = String(val);
    } else if (k === 'style' && typeof val === 'string') {
      node.setAttribute('style', val);
    } else {
      node.setAttribute(k, String(val));
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '-';
  return n.toFixed(digits);
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function field(label: string, input: HTMLElement): HTMLElement {
  return el('label', { class: 'field' }, el('span', {}, label), input);
}

export function input(value: string | number, onInput: (v: string) => void, type = 'text'): HTMLInputElement {
  const i = el('input', { type, value: String(value) }) as HTMLInputElement;
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

export function numberInput(value: number, onInput: (v: number) => void, step = '0.1'): HTMLInputElement {
  const i = el('input', { type: 'number', step, value: String(value) }) as HTMLInputElement;
  i.addEventListener('input', () => onInput(parseFloat(i.value) || 0));
  return i;
}

export function select(options: { value: string; label: string }[], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = el('select', {}) as HTMLSelectElement;
  for (const o of options) {
    const opt = el('option', { value: o.value }, o.label);
    if (o.value === value) opt.selected = true;
    s.append(opt);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function badge(text: string, cls = 'badge'): HTMLElement {
  return el('span', { class: cls }, text);
}

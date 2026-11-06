/** Tiny DOM helpers: enough structure to avoid a framework, nothing clever. */

type Child = Node | string | null | false;
type Attributes = Record<string, string | number | boolean | EventListener | null>;

/**
 * h('button', { class: 'primary', onclick: save }, 'Save')
 * Attributes starting with "on" become event listeners; false/null attributes are skipped.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === false) {
      continue;
    }
    if (typeof value === 'function') {
      element.addEventListener(name.slice(2), value);
    } else if (name in element && name !== 'list' && name !== 'class') {
      (element as unknown as Record<string, unknown>)[name] = value;
    } else {
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }
  append(element, children);
  return element;
}

export function append(parent: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child !== null && child !== false) {
      parent.append(child);
    }
  }
}

export function replaceChildren(parent: HTMLElement, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}

export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Element #${id} is missing from index.html`);
  }
  return element as T;
}

let toastTimer: number | undefined;

export function toast(message: string, action?: { label: string; run: () => void }): void {
  const container = byId('toast');
  replaceChildren(container, h('span', {}, message), action ? h('button', { class: 'link', onclick: action.run }, action.label) : null);
  container.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => container.classList.remove('visible'), action ? 10000 : 4000);
}

/** Splits "a, b ,c" into ["a","b","c"]. */
export function splitList(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function downloadText(fileName: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = h('a', { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Opens the system file chooser and resolves with the chosen file's text (null if cancelled). */
export function chooseTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      resolve(file === undefined ? null : { name: file.name, text: await file.text() });
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export function groupDots(colors: readonly string[]): HTMLElement {
  return h('span', { class: 'dots' }, ...colors.map((color) => h('span', { class: 'dot', style: `background:${color}` })));
}

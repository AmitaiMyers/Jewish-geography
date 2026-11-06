import { checkIcon } from './icons';

/** Tiny DOM helpers: enough structure to avoid a framework, nothing clever. */

type Child = Node | string | null | false;
type Attributes = Record<string, string | number | boolean | EventListener | null>;

/**
 * h('button', { class: 'btn', onclick: save }, 'Save')
 * "on*" attributes become listeners; null/false attributes are skipped;
 * known DOM properties (value, checked, disabled…) are set as properties.
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
    } else if (name in element && name !== 'list' && name !== 'class' && name !== 'role' && !name.startsWith('aria')) {
      (element as unknown as Record<string, unknown>)[name] = value;
    } else {
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }
  append(element, children);
  return element;
}

export function append(parent: Element, children: Child[]): void {
  for (const child of children) {
    if (child !== null && child !== false) {
      parent.append(child);
    }
  }
}

export function replaceChildren(parent: Element, ...children: Child[]): void {
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

/** Wraps a name so mixed Hebrew/English text keeps its own direction. */
export function bdi(text: string): HTMLElement {
  return h('bdi', {}, text);
}

let idCounter = 0;
export function uniqueId(prefix: string): string {
  idCounter++;
  return `${prefix}-${idCounter}`;
}

// ---------- toast ----------

export interface ToastOptions {
  /** e.g. Undo. The toast stays longer when it has an action. */
  action?: { label: string; run: () => void | Promise<void> };
  success?: boolean;
}

let toastTimer: number | undefined;

export function toast(message: string, options: ToastOptions = {}): void {
  const container = byId('toast');
  const { action, success = false } = options;
  replaceChildren(
    container,
    success ? checkIcon() : null,
    h('span', { class: 'grow' }, message),
    action
      ? h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              container.classList.remove('is-visible');
              await action.run();
            },
          },
          action.label,
        )
      : null,
  );
  container.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => container.classList.remove('is-visible'), action ? 7000 : 3500);
}

// ---------- files ----------

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

import { t } from '../../i18n/i18n';
import { h, replaceChildren, uniqueId } from '../dom';
import { icon } from '../icons';
import { DURATION, duration, wait } from '../motion';

/**
 * <jg-sheet> — bottom sheet (phones) / side panel (≥768px).
 *
 * Built on a modal <dialog>, so focus is trapped, the page behind is inert and
 * Escape works natively. Adds: drag handle with snap points (peek / half / full),
 * swipe-down to close, backdrop tap to close, animated exit, focus returned on close.
 */

export type Snap = 'peek' | 'half' | 'full';

const SNAP_HEIGHT: Record<Snap, string> = { peek: '38dvh', half: '64dvh', full: '94dvh' };
const SNAP_FRACTION: Record<Snap, number> = { peek: 0.38, half: 0.64, full: 0.94 };
const DESKTOP = window.matchMedia('(min-width: 768px)');

export interface SheetOptions {
  snaps: Snap[];
  /** Remove the element from the page when it closes (one-off flows). */
  disposable?: boolean;
}

export class JgSheet extends HTMLElement {
  static create(options: SheetOptions): JgSheet {
    const sheet = document.createElement('jg-sheet') as JgSheet;
    sheet.setup(options);
    document.body.append(sheet);
    return sheet;
  }

  readonly body = h('div', { class: 'sheet-body' });
  readonly footer = h('div', { class: 'sheet-footer', hidden: true });
  private readonly dialog = h('dialog', { class: 'sheet' });
  private readonly titleElement = h('h2', { class: 'grow ellipsis', id: uniqueId('sheet-title') });
  private readonly headerExtra = h('div', { class: 'row' });
  private snaps: Snap[] = ['half'];
  private disposable = false;
  private returnFocusTo: HTMLElement | null = null;
  private readonly closeHandlers: (() => void)[] = [];

  private setup(options: SheetOptions): void {
    if (options.snaps.length === 0) {
      throw new Error('a sheet needs at least one snap point');
    }
    this.snaps = options.snaps;
    this.disposable = options.disposable ?? false;

    const handle = h('div', { class: 'sheet-handle', 'aria-hidden': 'true' });
    const header = h(
      'div',
      { class: 'sheet-header' },
      this.titleElement,
      this.headerExtra,
      h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': t('close'), onclick: () => void this.close() }, icon('close')),
    );
    this.dialog.setAttribute('aria-labelledby', this.titleElement.id);
    this.dialog.append(handle, header, this.body, this.footer);
    this.append(this.dialog);

    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      void this.close();
    });
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) {
        void this.close();
      }
    });
    this.enableDrag(handle);
    this.enableDrag(header);
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  get snap(): Snap {
    return this.dialog.dataset['snap'] as Snap;
  }

  setTitle(title: string): void {
    this.titleElement.textContent = title;
  }

  setHeaderExtra(...nodes: Node[]): void {
    replaceChildren(this.headerExtra, ...nodes);
  }

  setBody(...children: (Node | null | false)[]): void {
    replaceChildren(this.body, ...children);
  }

  setFooter(...children: (Node | null | false)[]): void {
    replaceChildren(this.footer, ...children);
    this.footer.hidden = this.footer.childElementCount === 0;
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler);
  }

  open(snap: Snap = this.snaps[0] as Snap): void {
    this.snapTo(snap);
    if (!this.dialog.open) {
      this.returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.dialog.showModal();
    }
  }

  snapTo(snap: Snap): void {
    if (!this.snaps.includes(snap)) {
      throw new Error(`snap "${snap}" is not allowed for this sheet`);
    }
    this.dialog.dataset['snap'] = snap;
    this.dialog.style.setProperty('--sheet-height', SNAP_HEIGHT[snap]);
  }

  async close(): Promise<void> {
    if (!this.dialog.open) {
      return;
    }
    this.dialog.classList.add('is-closing');
    await wait(duration(DURATION.base));
    this.dialog.classList.remove('is-closing');
    this.dialog.close();
    this.returnFocusTo?.focus();
    this.closeHandlers.forEach((handler) => handler());
    if (this.disposable) {
      this.remove();
    }
  }

  /** Drag the handle/header to resize; release snaps to the nearest point, or closes when pulled low. */
  private enableDrag(area: HTMLElement): void {
    area.addEventListener('pointerdown', (down) => {
      const target = down.target as HTMLElement;
      if (DESKTOP.matches || target.closest('button, input, select, textarea, a') !== null) {
        return;
      }
      const startY = down.clientY;
      const startHeight = this.dialog.getBoundingClientRect().height;
      const viewport = window.innerHeight;
      let height = startHeight;
      this.dialog.classList.add('is-dragging');
      area.setPointerCapture(down.pointerId);

      const move = (event: PointerEvent): void => {
        height = Math.min(viewport * SNAP_FRACTION.full, Math.max(64, startHeight - (event.clientY - startY)));
        this.dialog.style.height = `${height}px`;
      };
      const up = (): void => {
        area.removeEventListener('pointermove', move);
        this.dialog.classList.remove('is-dragging');
        this.dialog.style.height = '';
        const lowest = Math.min(...this.snaps.map((snap) => SNAP_FRACTION[snap])) * viewport;
        if (height < lowest * 0.7) {
          void this.close();
          return;
        }
        const nearest = [...this.snaps].sort(
          (a, b) => Math.abs(SNAP_FRACTION[a] * viewport - height) - Math.abs(SNAP_FRACTION[b] * viewport - height),
        )[0] as Snap;
        this.snapTo(nearest);
      };
      area.addEventListener('pointermove', move);
      area.addEventListener('pointerup', up, { once: true });
      area.addEventListener('pointercancel', up, { once: true });
    });
  }
}

customElements.define('jg-sheet', JgSheet);

/** Small sheet asking for one line of text (replaces window.prompt). Resolves null when cancelled. */
export function askText(title: string, label: string, initial = ''): Promise<string | null> {
  const sheet = JgSheet.create({ snaps: ['peek'], disposable: true });
  const input = h('input', { value: initial, required: true, enterkeyhint: 'done', 'aria-label': label });
  let answer: string | null = null;
  return new Promise((resolve) => {
    const submit = (event: Event): void => {
      event.preventDefault();
      if (input.value.trim() === '') {
        input.focus();
        return;
      }
      answer = input.value.trim();
      void sheet.close();
    };
    sheet.setTitle(title);
    sheet.setBody(
      h(
        'form',
        { class: 'stack', onsubmit: submit },
        h('label', { class: 'field' }, h('span', { class: 'label' }, label), input),
        h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('save')),
      ),
    );
    sheet.onClose(() => resolve(answer));
    sheet.open();
    input.focus();
    input.select();
  });
}

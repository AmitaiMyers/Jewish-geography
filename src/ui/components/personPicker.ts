import { t } from '../../i18n/i18n';
import { normalizeName } from '../../model/identity';
import type { Person } from '../../model/types';
import type { AppStore } from '../../store/appStore';
import { avatar } from '../avatar';
import { groupColors } from '../context';
import { bdi, h, replaceChildren, uniqueId } from '../dom';

/**
 * <jg-person-picker> — type-to-search person chooser following the ARIA combobox pattern.
 * Arrow keys move, Enter chooses, Escape closes. Recently chosen people come first.
 */

const MAX_RESULTS = 30;
const MAX_RECENT = 5;
const recentIds: string[] = [];

function remember(personId: string): void {
  const existing = recentIds.indexOf(personId);
  if (existing !== -1) recentIds.splice(existing, 1);
  recentIds.unshift(personId);
  recentIds.length = Math.min(recentIds.length, MAX_RECENT);
}

export interface PickerOptions {
  label: string;
  onChoose?: (personId: string) => void;
  exclude?: () => readonly string[];
}

export class JgPersonPicker extends HTMLElement {
  static create(store: AppStore, options: PickerOptions): JgPersonPicker {
    const picker = document.createElement('jg-person-picker') as JgPersonPicker;
    picker.setup(store, options);
    return picker;
  }

  private store!: AppStore;
  private options!: PickerOptions;
  private readonly input = h('input', {
    type: 'search',
    role: 'combobox',
    autocomplete: 'off',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
  });
  private readonly listbox = h('ul', { class: 'picker-list', role: 'listbox', id: uniqueId('picker'), hidden: true });
  /** Current options (named so it does not shadow HTMLElement.matches). */
  private results: Person[] = [];
  private activeIndex = -1;
  private selectedId: string | null = null;

  private setup(store: AppStore, options: PickerOptions): void {
    this.store = store;
    this.options = options;
    this.className = 'picker';
    this.input.placeholder = t('choosePerson');
    this.input.setAttribute('aria-label', options.label);
    this.input.setAttribute('aria-controls', this.listbox.id);
    this.append(this.input, this.listbox);

    this.input.addEventListener('input', () => this.openList());
    this.input.addEventListener('focus', () => this.openList());
    this.input.addEventListener('blur', () => window.setTimeout(() => this.closeList(), 150));
    this.input.addEventListener('keydown', (event) => this.onKey(event));
  }

  get value(): string | null {
    return this.selectedId;
  }

  set(personId: string | null): void {
    this.selectedId = personId;
    this.input.value = personId === null ? '' : this.store.person(personId).name;
  }

  focusInput(): void {
    this.input.focus();
  }

  private candidates(): Person[] {
    const excluded = new Set(this.options.exclude?.() ?? []);
    const query = normalizeName(this.input.value === this.selectedName() ? '' : this.input.value);
    const everyone = this.store.peopleSorted().filter((person) => !excluded.has(person.id));
    if (query === '') {
      const recent = recentIds.filter((id) => this.store.people.has(id) && !excluded.has(id)).map((id) => this.store.person(id));
      return [...recent, ...everyone.filter((person) => !recent.includes(person))].slice(0, MAX_RESULTS);
    }
    return everyone.filter((person) => normalizeName(person.name).includes(query)).slice(0, MAX_RESULTS);
  }

  private selectedName(): string {
    return this.selectedId === null || !this.store.people.has(this.selectedId) ? '' : this.store.person(this.selectedId).name;
  }

  private openList(): void {
    this.results = this.candidates();
    this.activeIndex = this.results.length > 0 ? 0 : -1;
    const recentCount = this.input.value === this.selectedName() ? recentIds.filter((id) => this.results.some((p) => p.id === id)).length : 0;
    replaceChildren(
      this.listbox,
      recentCount > 0 ? h('li', { class: 'picker-heading', role: 'presentation' }, t('recentPeople')) : null,
      ...this.results.map((person, index) =>
        h(
          'li',
          {
            class: 'picker-option',
            role: 'option',
            id: `${this.listbox.id}-${index}`,
            'aria-selected': String(index === this.activeIndex),
            onpointerdown: (event: Event) => event.preventDefault(),
            onclick: () => this.choose(index),
          },
          avatar(person.name, groupColors(this.store, person), 'sm', person.id === this.store.meId),
          bdi(person.name),
        ),
      ),
    );
    this.listbox.hidden = this.results.length === 0;
    this.input.setAttribute('aria-expanded', String(!this.listbox.hidden));
    this.syncActive();
  }

  private closeList(): void {
    this.listbox.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
  }

  private syncActive(): void {
    this.listbox.querySelectorAll('[role=option]').forEach((option, index) => {
      option.setAttribute('aria-selected', String(index === this.activeIndex));
      if (index === this.activeIndex) {
        option.scrollIntoView({ block: 'nearest' });
        this.input.setAttribute('aria-activedescendant', option.id);
      }
    });
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.listbox.hidden) {
        this.openList();
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.activeIndex = (this.activeIndex + step + this.results.length) % this.results.length;
      this.syncActive();
    } else if (event.key === 'Enter' && !this.listbox.hidden && this.activeIndex >= 0) {
      event.preventDefault();
      this.choose(this.activeIndex);
    } else if (event.key === 'Escape' && !this.listbox.hidden) {
      event.preventDefault();
      event.stopPropagation();
      this.closeList();
    }
  }

  private choose(index: number): void {
    const person = this.results[index];
    if (person === undefined) {
      return;
    }
    remember(person.id);
    this.set(person.id);
    this.closeList();
    this.options.onChoose?.(person.id);
  }
}

customElements.define('jg-person-picker', JgPersonPicker);

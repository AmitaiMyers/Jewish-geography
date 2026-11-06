import { t } from '../i18n/i18n';
import { normalizeName } from '../model/identity';
import type { AppStore } from '../store/appStore';
import { h, replaceChildren } from './dom';

const MAX_RESULTS = 30;

/**
 * Type-to-search person chooser. Works with thousands of people
 * where a native <select> would be unusable on a phone.
 */
export class PersonPicker {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly results: HTMLElement;
  private selectedId: string | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly onChoose: (personId: string) => void,
    private readonly excludeIds: () => readonly string[] = () => [],
  ) {
    this.input = h('input', { type: 'search', placeholder: t('choosePerson'), autocomplete: 'off', oninput: () => this.showResults() });
    this.input.addEventListener('focus', () => this.showResults());
    this.input.addEventListener('blur', () => window.setTimeout(() => this.results.replaceChildren(), 200));
    this.results = h('div', { class: 'picker-results', role: 'listbox' });
    this.element = h('div', { class: 'picker' }, this.input, this.results);
  }

  get value(): string | null {
    return this.selectedId;
  }

  set(personId: string | null): void {
    this.selectedId = personId;
    this.input.value = personId === null ? '' : this.store.person(personId).name;
  }

  private showResults(): void {
    const query = normalizeName(this.input.value);
    const excluded = new Set(this.excludeIds());
    const matches = this.store
      .peopleSorted()
      .filter((person) => !excluded.has(person.id) && normalizeName(person.name).includes(query))
      .slice(0, MAX_RESULTS);
    replaceChildren(
      this.results,
      ...matches.map((person) =>
        h(
          'button',
          {
            type: 'button',
            class: 'picker-option',
            role: 'option',
            onmousedown: (event: Event) => event.preventDefault(),
            onclick: () => {
              this.set(person.id);
              this.results.replaceChildren();
              this.onChoose(person.id);
            },
          },
          person.name,
        ),
      ),
    );
  }
}

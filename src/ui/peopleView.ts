import { t } from '../i18n/i18n';
import { normalizeName } from '../model/identity';
import type { Person } from '../model/types';
import { groupColors, relationToMeText, type AppContext, type View } from './context';
import { groupDots, h, replaceChildren } from './dom';

/** Searchable list of everyone, with multi-select for bulk delete and grouping. */
export class PeopleView implements View {
  readonly element: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly list: HTMLElement;
  private query = '';
  private selecting = false;
  private readonly selected = new Set<string>();

  constructor(private readonly ctx: AppContext) {
    this.toolbar = h('div', { class: 'toolbar' });
    this.list = h('ul', { class: 'list people-list' });
    this.element = h('section', { class: 'view scroll' }, this.toolbar, this.list);
  }

  onShow(): void {
    this.render();
  }

  setQuery(query: string): void {
    this.query = normalizeName(query);
    this.render();
  }

  render(): void {
    const store = this.ctx.store;
    [...this.selected].filter((id) => !store.people.has(id)).forEach((id) => this.selected.delete(id));
    const people = store.peopleSorted().filter((person) => normalizeName(person.name).includes(this.query));

    this.renderToolbar(people);
    replaceChildren(
      this.list,
      ...(store.people.size <= 1 ? [h('li', { class: 'muted' }, t('noPeople'))] : []),
      ...people.map((person) => this.row(person)),
    );
  }

  private renderToolbar(visible: Person[]): void {
    const store = this.ctx.store;
    if (!this.selecting) {
      replaceChildren(
        this.toolbar,
        h('span', { class: 'muted grow' }, t('peopleCount', { count: store.people.size })),
        h('button', { onclick: () => this.toggleSelecting(true) }, t('select')),
        h('button', { class: 'primary', onclick: () => this.addPerson() }, t('addPerson')),
      );
      return;
    }
    const groupSelect = h(
      'select',
      { 'aria-label': t('addSelectedToGroup') },
      h('option', { value: '' }, t('addSelectedToGroup')),
      ...[...store.groups.values()].map((group) => h('option', { value: group.id }, group.name)),
    );
    groupSelect.addEventListener('change', async () => {
      if (groupSelect.value !== '' && this.selected.size > 0) {
        await store.addPeopleToGroup([...this.selected], groupSelect.value);
        this.toggleSelecting(false);
      }
    });
    replaceChildren(
      this.toolbar,
      h('span', { class: 'grow' }, t('selectedCount', { count: this.selected.size })),
      h(
        'button',
        {
          onclick: () => {
            visible.filter((p) => p.id !== store.meId).forEach((p) => this.selected.add(p.id));
            this.render();
          },
        },
        t('selectAll'),
      ),
      store.groups.size > 0 ? groupSelect : null,
      h(
        'button',
        {
          class: 'danger',
          disabled: this.selected.size === 0,
          onclick: async () => {
            if (confirm(t('confirmDeleteMany', { count: this.selected.size }))) {
              await store.deletePeople([...this.selected]);
              this.toggleSelecting(false);
            }
          },
        },
        t('deleteSelected'),
      ),
      h('button', { onclick: () => this.toggleSelecting(false) }, t('cancel')),
    );
  }

  private row(person: Person): HTMLElement {
    const store = this.ctx.store;
    const isMe = person.id === store.meId;
    const relationText = relationToMeText(store, person);
    const content = [
      groupDots(groupColors(store, person)),
      h('span', { class: 'grow' }, person.name, isMe ? h('span', { class: 'badge' }, t('you')) : null),
      relationText !== '' ? h('span', { class: 'tag' }, relationText) : null,
      h('span', { class: 'muted count' }, String(store.index.degree(person.id))),
    ];

    if (this.selecting && !isMe) {
      const checkbox = h('input', { type: 'checkbox', checked: this.selected.has(person.id) });
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) this.selected.add(person.id);
        else this.selected.delete(person.id);
        this.renderToolbar(store.peopleSorted().filter((p) => normalizeName(p.name).includes(this.query)));
      });
      return h('li', {}, h('label', { class: 'row-button' }, checkbox, ...content));
    }
    return h('li', {}, h('button', { class: 'row-button', onclick: () => this.ctx.openPerson(person.id) }, ...content));
  }

  private toggleSelecting(on: boolean): void {
    this.selecting = on;
    this.selected.clear();
    this.render();
  }

  private async addPerson(): Promise<void> {
    const name = prompt(t('newPerson'))?.trim() ?? '';
    if (name === '') {
      return;
    }
    const person = await this.ctx.store.addPerson({
      name,
      gender: 'unknown',
      phones: [],
      emails: [],
      groupIds: [],
      notes: '',
      source: 'manual',
    });
    this.ctx.openPerson(person.id);
  }
}

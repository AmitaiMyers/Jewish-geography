import { t, tCount } from '../i18n/i18n';
import { normalizeName } from '../model/identity';
import type { Person } from '../model/types';
import { avatar } from './avatar';
import { groupColors, relationToMeText, type AppContext, type View } from './context';
import { bdi, h, replaceChildren, toast } from './dom';
import { icon, networkIllustration } from './icons';
import { haptic } from './motion';

type SortOrder = 'name' | 'connections' | 'recent';

const FIRST_ROWS = 60;
const ROWS_PER_FRAME = 200;

/** Everyone, searchable and sortable, with multi-select for bulk grouping and deleting. */
export class PeopleView implements View {
  readonly element: HTMLElement;
  private readonly filter = h('input', { type: 'search', autocomplete: 'off' });
  private readonly sort = h('select', {});
  private readonly selectButton = h('button', { class: 'btn' });
  private readonly addButton = h('button', { class: 'btn btn-primary' });
  private readonly summary = h('p', { class: 'caption nums', 'aria-live': 'polite' });
  private readonly list = h('ul', { class: 'list' });
  private readonly selectionBar = h('div', { class: 'selection-bar', hidden: true });
  private order: SortOrder = 'name';
  private selecting = false;
  private readonly selected = new Set<string>();
  private renderToken = 0;

  constructor(private readonly ctx: AppContext) {
    this.filter.addEventListener('input', () => this.renderList());
    this.sort.addEventListener('change', () => {
      this.order = this.sort.value as SortOrder;
      this.renderList();
    });
    this.selectButton.addEventListener('click', () => this.setSelecting(!this.selecting));
    this.addButton.addEventListener('click', () => void ctx.addPerson());
    this.element = h(
      'section',
      { class: 'view scroll', role: 'tabpanel' },
      h(
        'div',
        { class: 'view-inner' },
        h('div', { class: 'toolbar' }, this.filter, this.sort, this.selectButton, this.addButton),
        this.summary,
        this.list,
        this.selectionBar,
      ),
    );
  }

  onShow(): void {
    this.render();
  }

  render(): void {
    this.filter.placeholder = t('searchPeople');
    this.filter.setAttribute('aria-label', t('searchPeople'));
    this.sort.setAttribute('aria-label', t('sortBy'));
    replaceChildren(
      this.sort,
      ...(['name', 'connections', 'recent'] as const).map((value) =>
        h('option', { value, selected: value === this.order }, t(value === 'name' ? 'sortName' : value === 'connections' ? 'sortConnections' : 'sortRecent')),
      ),
    );
    this.selectButton.textContent = this.selecting ? t('cancel') : t('select');
    replaceChildren(this.addButton, icon('plus'), t('addPerson'));
    this.renderList();
  }

  private visiblePeople(): Person[] {
    const store = this.ctx.store;
    const query = normalizeName(this.filter.value);
    const people = [...store.people.values()].filter((person) => normalizeName(person.name).includes(query));
    const index = store.index;
    const compare: Record<SortOrder, (a: Person, b: Person) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      connections: (a, b) => index.degree(b.id) - index.degree(a.id) || a.name.localeCompare(b.name),
      recent: (a, b) => b.createdAt - a.createdAt,
    };
    return people.sort(compare[this.order]);
  }

  private renderList(): void {
    const store = this.ctx.store;
    [...this.selected].filter((id) => !store.people.has(id)).forEach((id) => this.selected.delete(id));
    const people = this.visiblePeople();
    this.summary.textContent = t('peopleCount', { count: store.people.size });

    if (store.people.size <= 1) {
      replaceChildren(
        this.list,
        h(
          'li',
          { class: 'empty' },
          networkIllustration(),
          h('h2', {}, t('noPeopleTitle')),
          h('p', {}, t('noPeopleBody')),
          h('button', { class: 'btn btn-primary', onclick: () => this.ctx.openImport() }, t('importContacts')),
        ),
      );
    } else if (people.length === 0) {
      replaceChildren(this.list, h('li', { class: 'empty' }, h('p', {}, t('noMatches', { query: this.filter.value }))));
    } else {
      this.renderRows(people);
    }
    this.renderSelectionBar(people);
  }

  /**
   * First rows immediately, the rest in animation-frame chunks, so a 1,500-person list never
   * blocks a tab switch. A newer render cancels an older one still streaming in.
   */
  private renderRows(people: Person[]): void {
    const token = ++this.renderToken;
    replaceChildren(this.list, ...people.slice(0, FIRST_ROWS).map((person) => this.row(person)));
    const appendFrom = (start: number): void => {
      if (token !== this.renderToken || start >= people.length) return;
      this.list.append(...people.slice(start, start + ROWS_PER_FRAME).map((person) => this.row(person)));
      window.requestAnimationFrame(() => appendFrom(start + ROWS_PER_FRAME));
    };
    window.requestAnimationFrame(() => appendFrom(FIRST_ROWS));
  }

  private row(person: Person): HTMLElement {
    const store = this.ctx.store;
    const isMe = person.id === store.meId;
    const relation = relationToMeText(store, person);
    const content = [
      avatar(person.name, groupColors(store, person), 'md', isMe),
      h(
        'span',
        { class: 'grow' },
        h('span', { class: 'row-title ellipsis' }, bdi(person.name), isMe ? ` · ${t('you')}` : ''),
        h('span', { class: 'row-sub nums' }, tCount('connectionsCount', store.index.degree(person.id))),
      ),
      relation === '' ? null : h('span', { class: 'tag tag-family' }, relation),
    ];

    if (this.selecting && !isMe) {
      const checkbox = h('input', { type: 'checkbox', checked: this.selected.has(person.id), 'aria-label': person.name });
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) this.selected.add(person.id);
        else this.selected.delete(person.id);
        haptic();
        this.renderSelectionBar(this.visiblePeople());
      });
      return h('li', {}, h('label', { class: 'list-row' }, checkbox, ...content));
    }
    return h('li', {}, h('button', { class: 'list-row', onclick: () => this.ctx.openPerson(person.id) }, ...content));
  }

  private renderSelectionBar(visible: Person[]): void {
    const store = this.ctx.store;
    this.selectionBar.hidden = !this.selecting;
    if (!this.selecting) return;

    const groupSelect = h(
      'select',
      { 'aria-label': t('addToGroup'), disabled: this.selected.size === 0 || store.groups.size === 0 },
      h('option', { value: '' }, t('addToGroup')),
      ...[...store.groups.values()].map((group) => h('option', { value: group.id }, group.name)),
    );
    groupSelect.addEventListener('change', async () => {
      const groupId = groupSelect.value;
      if (groupId === '') return;
      await store.addPeopleToGroup([...this.selected], groupId);
      toast(t('addedToGroup', { group: store.group(groupId).name }), { success: true });
      this.setSelecting(false);
    });
    replaceChildren(
      this.selectionBar,
      h('strong', { class: 'grow nums' }, t('selectedCount', { count: this.selected.size })),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            visible.filter((p) => p.id !== store.meId).forEach((p) => this.selected.add(p.id));
            this.renderList();
          },
        },
        t('selectAll'),
      ),
      groupSelect,
      h(
        'button',
        {
          class: 'btn btn-danger',
          disabled: this.selected.size === 0,
          onclick: async () => {
            const ids = [...this.selected];
            this.setSelecting(false);
            await this.ctx.deleteWithUndo(t('deletedPeople', { count: ids.length }), () => store.deletePeople(ids));
          },
        },
        icon('trash'),
        t('delete'),
      ),
    );
  }

  private setSelecting(on: boolean): void {
    this.selecting = on;
    this.selected.clear();
    this.render();
  }
}

import { t } from '../i18n/i18n';
import type { Group } from '../model/types';
import type { AppContext, View } from './context';
import { h, replaceChildren } from './dom';

/** Create, recolour, rename and delete groups; jump to a group's cluster on the graph. */
export class GroupsView implements View {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly toolbar: HTMLElement;

  constructor(private readonly ctx: AppContext) {
    this.toolbar = h('div', { class: 'toolbar' });
    this.list = h('ul', { class: 'list' });
    this.element = h('section', { class: 'view scroll' }, this.toolbar, this.list);
  }

  onShow(): void {
    this.render();
  }

  setQuery(): void {
    // Groups are few; the people search does not apply here.
  }

  render(): void {
    const store = this.ctx.store;
    replaceChildren(
      this.toolbar,
      h('span', { class: 'grow' }),
      h(
        'button',
        {
          class: 'primary',
          onclick: async () => {
            const name = prompt(t('groupName'))?.trim() ?? '';
            if (name !== '') {
              await store.createGroup(name);
            }
          },
        },
        t('newGroup'),
      ),
    );
    const groups = [...store.groups.values()].sort((a, b) => a.name.localeCompare(b.name));
    replaceChildren(this.list, ...(groups.length === 0 ? [h('li', { class: 'muted' }, t('noGroups'))] : groups.map((group) => this.row(group))));
  }

  private row(group: Group): HTMLElement {
    const store = this.ctx.store;
    const memberCount = [...store.people.values()].filter((person) => person.groupIds.includes(group.id)).length;
    const color = h('input', { type: 'color', value: group.color, 'aria-label': group.name });
    color.addEventListener('change', () => store.saveGroup({ ...group, color: color.value }));

    return h(
      'li',
      { class: 'group-row' },
      color,
      h('span', { class: 'grow' }, h('strong', {}, group.name), h('br', {}), h('span', { class: 'muted' }, t('membersCount', { count: memberCount }))),
      h('button', { onclick: () => this.ctx.showOnGraph({ kind: 'group', groupId: group.id }) }, t('showGroupOnGraph')),
      h(
        'button',
        {
          onclick: async () => {
            const name = prompt(t('rename'), group.name)?.trim() ?? '';
            if (name !== '') {
              await store.saveGroup({ ...group, name });
            }
          },
        },
        t('rename'),
      ),
      h(
        'button',
        {
          class: 'danger',
          onclick: async () => {
            if (confirm(t('confirmDeleteGroup', { name: group.name }))) {
              await store.deleteGroup(group.id);
            }
          },
        },
        t('delete'),
      ),
    );
  }
}

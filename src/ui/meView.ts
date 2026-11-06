import { language, t, tCount } from '../i18n/i18n';
import type { Group, Language } from '../model/types';
import { avatar } from './avatar';
import { askText } from './components/sheet';
import { groupColors, type AppContext, type View } from './context';
import { bdi, chooseTextFile, downloadText, h, replaceChildren, toast } from './dom';
import { icon } from './icons';
import { importOptionCards } from './importFlow';

/** Me: profile, suggestions to review, groups, import, backup and settings. */
export class MeView implements View {
  readonly element: HTMLElement;
  private readonly inner = h('div', { class: 'view-inner stack-lg' });

  constructor(private readonly ctx: AppContext) {
    this.element = h('section', { class: 'view scroll', role: 'tabpanel' }, this.inner);
  }

  onShow(): void {
    this.render();
  }

  render(): void {
    replaceChildren(
      this.inner,
      this.profile(),
      this.suggestions(),
      this.groups(),
      h('section', { class: 'stack' }, h('h2', { class: 'section-title' }, t('importTitle')), importOptionCards(this.ctx)),
      this.backup(),
      this.settings(),
    );
  }

  private profile(): HTMLElement {
    const store = this.ctx.store;
    const me = store.person(store.meId);
    return h(
      'article',
      { class: 'card card-hero row' },
      avatar(me.name, groupColors(store, me), 'xl', true),
      h(
        'div',
        { class: 'grow stack', style: 'gap:4px' },
        h('h2', { class: 'ellipsis' }, bdi(me.name)),
        h(
          'p',
          { class: 'muted nums' },
          t('meStats', { people: store.people.size - 1, connections: store.relations.size, groups: store.groups.size }),
        ),
      ),
      h('button', { class: 'btn', onclick: () => this.ctx.openPerson(me.id, 'full') }, t('editProfile')),
    );
  }

  private suggestions(): HTMLElement | null {
    const count = this.ctx.store.suggestions.size;
    if (count === 0) return null;
    return h(
      'button',
      { class: 'option-card', onclick: () => this.ctx.openSuggestions() },
      h('span', { class: 'option-icon' }, icon('sparkle')),
      h('span', { class: 'grow' }, h('span', { class: 'row-title' }, t('suggestionsCount', { count }))),
      h('span', { class: 'badge' }, String(count)),
    );
  }

  private groups(): HTMLElement {
    const store = this.ctx.store;
    const groups = [...store.groups.values()].sort((a, b) => a.name.localeCompare(b.name));
    return h(
      'section',
      { class: 'stack' },
      h(
        'div',
        { class: 'row' },
        h('h2', { class: 'section-title grow' }, t('groups')),
        h('button', { class: 'btn', onclick: () => void this.ctx.createGroup() }, icon('plus'), t('newGroup')),
      ),
      groups.length === 0
        ? h('p', { class: 'muted' }, t('noGroups'))
        : h('ul', { class: 'list card', style: 'padding-block:4px' }, ...groups.map((group) => this.groupRow(group))),
    );
  }

  private groupRow(group: Group): HTMLElement {
    const store = this.ctx.store;
    const members = [...store.people.values()].filter((person) => person.groupIds.includes(group.id)).length;
    const color = h('input', { type: 'color', value: group.color, 'aria-label': `${t('color')}: ${group.name}` });
    color.addEventListener('change', () => void store.saveGroup({ ...group, color: color.value }));
    return h(
      'li',
      { class: 'row', style: 'flex-wrap:nowrap;padding:4px 0' },
      color,
      h(
        'button',
        { class: 'list-row grow', onclick: () => this.ctx.showOnGraph({ kind: 'group', groupId: group.id }) },
        h('span', { class: 'grow' }, h('span', { class: 'row-title' }, group.name), h('span', { class: 'row-sub nums' }, tCount('membersCount', members))),
      ),
      h(
        'button',
        {
          class: 'btn btn-ghost',
          onclick: async () => {
            const name = await askText(t('rename'), t('groupName'), group.name);
            if (name !== null) await store.saveGroup({ ...group, name });
          },
        },
        t('rename'),
      ),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-icon btn-danger',
          'aria-label': `${t('delete')}: ${group.name}`,
          onclick: () => void this.ctx.deleteWithUndo(t('groupDeleted', { name: group.name }), () => store.deleteGroup(group.id)),
        },
        icon('trash'),
      ),
    );
  }

  private backup(): HTMLElement {
    const store = this.ctx.store;
    return h(
      'section',
      { class: 'card stack' },
      h('h2', { class: 'section-title' }, t('backupTitle')),
      h('p', { class: 'muted' }, t('backupHint')),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              const date = new Date().toISOString().slice(0, 10);
              downloadText(`jewish-geography-${date}.json`, JSON.stringify(store.exportBackup(), null, 2), 'application/json');
            },
          },
          icon('backup'),
          t('exportBackup'),
        ),
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              const file = await chooseTextFile('.json,application/json');
              if (file !== null && confirm(t('confirmRestore'))) {
                await store.restoreBackup(file.text);
                toast(t('restored'), { success: true });
              }
            },
          },
          t('restoreBackup'),
        ),
      ),
    );
  }

  private settings(): HTMLElement {
    const languageSelect = h(
      'select',
      {},
      h('option', { value: 'en', selected: language() === 'en' }, 'English'),
      h('option', { value: 'he', selected: language() === 'he' }, 'עברית'),
    );
    languageSelect.addEventListener('change', () => void this.ctx.store.setLanguage(languageSelect.value as Language));
    return h(
      'section',
      { class: 'card stack' },
      h('h2', { class: 'section-title' }, t('settingsTitle')),
      h('label', { class: 'field' }, h('span', { class: 'label' }, t('language')), languageSelect),
      h('h3', {}, t('installTitle')),
      h('p', { class: 'muted' }, t('installHint')),
      h('h3', {}, t('privacyTitle')),
      h('p', { class: 'muted' }, t('privacyBody')),
    );
  }
}

import { t } from '../i18n/i18n';
import { normalizeName } from '../model/identity';
import { avatar } from './avatar';
import { JgSheet } from './components/sheet';
import { groupColors, relationToMeText, type AppContext } from './context';
import { bdi, h, replaceChildren } from './dom';
import { icon, type IconName } from './icons';

const MAX_PEOPLE = 8;

interface Action {
  label: string;
  iconName: IconName;
  run: () => void;
}

/**
 * Command palette: one box to find a person, a group or an action.
 * Choosing a person flies the graph camera to them.
 */
export function openSearch(ctx: AppContext): void {
  const store = ctx.store;
  const sheet = JgSheet.create({ snaps: ['full'], disposable: true });
  const input = h('input', { type: 'search', autocomplete: 'off', placeholder: t('searchEverything'), 'aria-label': t('searchEverything') });
  const results = h('div', { class: 'stack', 'aria-live': 'polite' });

  const close = (then: () => void): void => {
    void sheet.close().then(then);
  };
  const actions: Action[] = [
    { label: t('addPerson'), iconName: 'plus', run: () => void ctx.addPerson() },
    { label: t('importContacts'), iconName: 'file', run: () => ctx.openImport() },
    { label: t('newGroup'), iconName: 'people', run: () => void ctx.createGroup() },
    { label: t('actionShowCode'), iconName: 'qr', run: () => ctx.openCompare('show') },
    { label: t('actionScanCode'), iconName: 'camera', run: () => ctx.openCompare('scan') },
    ...(store.suggestions.size > 0 ? [{ label: t('actionSuggestions'), iconName: 'sparkle' as const, run: () => ctx.openSuggestions() }] : []),
    { label: t('actionBackup'), iconName: 'backup', run: () => ctx.navigate('me') },
  ];

  const section = (title: string, rows: HTMLElement[]): HTMLElement | null =>
    rows.length === 0 ? null : h('section', { class: 'stack', style: 'gap:4px' }, h('h3', { class: 'label muted' }, title), h('ul', { class: 'list' }, ...rows));
  const row = (content: (Node | string | null)[], run: () => void): HTMLElement =>
    h('li', {}, h('button', { class: 'list-row', 'data-result': '', onclick: () => close(run) }, ...content));

  const render = (): void => {
    const query = normalizeName(input.value);
    const index = store.index;
    const people = [...store.people.values()]
      .filter((person) => normalizeName(person.name).includes(query))
      .sort((a, b) => (query === '' ? index.degree(b.id) - index.degree(a.id) : a.name.localeCompare(b.name)))
      .slice(0, MAX_PEOPLE);
    const groups = [...store.groups.values()].filter((group) => normalizeName(group.name).includes(query));
    const matchingActions = actions.filter((action) => normalizeName(action.label).includes(query));

    const sections = [
      section(
        t('sectionPeople'),
        people.map((person) => {
          const relation = relationToMeText(store, person);
          return row(
            [
              avatar(person.name, groupColors(store, person), 'sm', person.id === store.meId),
              h('span', { class: 'grow ellipsis' }, bdi(person.name)),
              relation === '' ? null : h('span', { class: 'tag tag-family' }, relation),
            ],
            () => {
              ctx.showOnGraph({ kind: 'person', personId: person.id });
              ctx.openPerson(person.id, 'peek');
            },
          );
        }),
      ),
      section(
        t('sectionGroups'),
        groups.map((group) =>
          row([h('span', { class: 'chip-dot', style: `background:${group.color}` }), h('span', { class: 'grow' }, group.name)], () =>
            ctx.showOnGraph({ kind: 'group', groupId: group.id }),
          ),
        ),
      ),
      section(
        t('sectionActions'),
        matchingActions.map((action) => row([h('span', { class: 'option-icon' }, icon(action.iconName)), h('span', { class: 'grow' }, action.label)], action.run)),
      ),
    ];
    replaceChildren(
      results,
      ...(sections.every((s) => s === null) ? [h('p', { class: 'muted' }, t('noResults', { query: input.value }))] : sections),
    );
  };

  input.addEventListener('input', render);
  sheet.body.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [input, ...sheet.body.querySelectorAll<HTMLElement>('[data-result]')];
    const position = items.indexOf(document.activeElement as HTMLElement);
    const next = items[position + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next !== undefined) {
      event.preventDefault();
      next.focus();
    }
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      (sheet.body.querySelector<HTMLElement>('[data-result]'))?.click();
    }
  });

  sheet.setTitle(t('searchTitle'));
  sheet.setBody(h('div', { class: 'stack-lg' }, input, results));
  render();
  sheet.open();
  input.focus();
}

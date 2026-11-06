import { kinshipBetween } from '../graph/kinship';
import { relationLabelFrom, t } from '../i18n/i18n';
import { kinshipText } from '../i18n/kinshipText';
import type { AppContext, View } from './context';
import { h, replaceChildren } from './dom';
import { PersonPicker } from './personPicker';

/**
 * "How are these two connected?"
 *  - family relation (inferred through parent/spouse/sibling links)
 *  - the shortest chain of any connections (bidirectional BFS)
 *  - mutual connections
 */
export class ConnectView implements View {
  readonly element: HTMLElement;
  private readonly fromPicker: PersonPicker;
  private readonly toPicker: PersonPicker;
  private readonly results: HTMLElement;
  private readonly title: HTMLElement;
  private readonly fromLabel: HTMLElement;
  private readonly toLabel: HTMLElement;

  constructor(private readonly ctx: AppContext) {
    this.fromPicker = new PersonPicker(ctx.store, () => this.render());
    this.toPicker = new PersonPicker(ctx.store, () => this.render());
    this.results = h('div', { class: 'stack' });
    this.title = h('h2', {});
    this.fromLabel = h('span', {});
    this.toLabel = h('span', {});
    this.element = h(
      'section',
      { class: 'view scroll stack' },
      this.title,
      h('div', { class: 'field' }, this.fromLabel, this.fromPicker.element),
      h('div', { class: 'field' }, this.toLabel, this.toPicker.element),
      this.results,
    );
  }

  onShow(): void {
    if (this.fromPicker.value === null && this.ctx.store.isOnboarded) {
      this.fromPicker.set(this.ctx.store.meId);
    }
    this.render();
  }

  setQuery(): void {
    // The pickers have their own search.
  }

  render(): void {
    const store = this.ctx.store;
    this.title.textContent = t('connectTitle');
    this.fromLabel.textContent = t('from');
    this.toLabel.textContent = t('to');

    for (const picker of [this.fromPicker, this.toPicker]) {
      if (picker.value !== null && !store.people.has(picker.value)) {
        picker.set(null);
      }
    }
    const from = this.fromPicker.value;
    const to = this.toPicker.value;
    if (from === null || to === null || from === to) {
      this.results.replaceChildren();
      return;
    }

    const index = store.index;
    const kinship = kinshipBetween(index, from, to);
    const path = index.shortestPath(from, to);
    const mutual = index.mutualConnections(from, to).map((id) => store.person(id)).sort((a, b) => a.name.localeCompare(b.name));
    const target = store.person(to);
    const genderOf = (id: string) => store.person(id).gender;

    replaceChildren(
      this.results,
      h(
        'article',
        { class: 'card' },
        h('h3', {}, t('familyRelation')),
        kinship === null || kinship.kind === 'self'
          ? h('p', { class: 'muted' }, t('noFamilyRelation'))
          : h('p', { class: 'big' }, t('kinshipOf', { target: target.name, term: kinshipText(kinship, target.gender, genderOf), from: store.person(from).name })),
      ),
      h(
        'article',
        { class: 'card' },
        h('h3', {}, t('shortestChain'), path === null ? '' : ` · ${t('steps', { count: path.relations.length })}`),
        path === null
          ? h('p', { class: 'muted' }, t('noChain'))
          : h(
              'ol',
              { class: 'chain' },
              ...path.personIds.map((personId, i) => {
                const relation = path.relations[i];
                return h(
                  'li',
                  {},
                  h('button', { class: 'link', onclick: () => this.ctx.openPerson(personId) }, store.person(personId).name),
                  relation === undefined ? null : h('span', { class: 'tag' }, relationLabelFrom(relation, personId)),
                );
              }),
            ),
        path === null ? null : h('button', { onclick: () => this.ctx.showOnGraph({ kind: 'path', path }) }, t('showOnGraph')),
      ),
      h(
        'article',
        { class: 'card' },
        h('h3', {}, t('mutual'), ` · ${mutual.length}`),
        mutual.length === 0
          ? h('p', { class: 'muted' }, t('noMutual'))
          : h('div', { class: 'chips' }, ...mutual.map((person) => h('button', { class: 'chip', onclick: () => this.ctx.openPerson(person.id) }, person.name))),
      ),
    );
  }
}

import { kinshipBetween } from '../graph/kinship';
import { relationLabelFrom, t, tCount } from '../i18n/i18n';
import { kinshipText } from '../i18n/kinshipText';
import { avatar } from './avatar';
import { JgPersonPicker } from './components/personPicker';
import { groupColors, type AppContext, type View } from './context';
import { bdi, h, replaceChildren } from './dom';
import { icon } from './icons';
import { openPitzuchim, sharedBetween } from './pitzuchim';

/**
 * Two questions:
 *  1. Compare with a friend (stage 2): QR / shared code → who we both know.
 *  2. How are these two connected? Family relation, shortest chain (as a ribbon), mutual connections.
 */
export class ConnectView implements View {
  readonly element: HTMLElement;
  private readonly compareCard = h('article', { class: 'card card-hero stack' });
  private readonly pairCard = h('article', { class: 'card stack' });
  private readonly results = h('div', { class: 'stack' });
  private readonly fromPicker: JgPersonPicker;
  private readonly toPicker: JgPersonPicker;

  constructor(private readonly ctx: AppContext) {
    this.fromPicker = JgPersonPicker.create(ctx.store, { label: t('from'), onChoose: () => this.renderResults() });
    this.toPicker = JgPersonPicker.create(ctx.store, { label: t('to'), onChoose: () => this.renderResults() });
    this.element = h(
      'section',
      { class: 'view scroll', role: 'tabpanel' },
      h('div', { class: 'view-inner stack-lg' }, this.compareCard, this.pairCard, this.results),
    );
  }

  onShow(): void {
    if (this.fromPicker.value === null) {
      this.fromPicker.set(this.ctx.store.meId);
    }
    this.render();
  }

  setPair(fromId: string, toId: string): void {
    this.fromPicker.set(fromId);
    this.toPicker.set(toId);
  }

  render(): void {
    this.renderCompareCard();
    this.renderPairCard();
    this.renderResults();
  }

  private renderCompareCard(): void {
    const me = this.ctx.store.person(this.ctx.store.meId);
    const recognisable = me.phones.length > 0 || me.emails.length > 0;
    replaceChildren(
      this.compareCard,
      h('h2', {}, t('compareTitle')),
      h('p', { class: 'muted' }, t('compareBody')),
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn btn-accent', onclick: () => this.ctx.openCompare('show') }, icon('qr'), t('showMyCode')),
        h('button', { class: 'btn', onclick: () => this.ctx.openCompare('scan') }, icon('camera'), t('scanCode')),
      ),
      recognisable
        ? null
        : h(
            'p',
            { class: 'row caption muted' },
            t('addPhoneForCompare'),
            h('button', { class: 'btn btn-ghost', style: 'color:inherit;text-decoration:underline', onclick: () => this.ctx.openPerson(me.id, 'full') }, t('addPhone')),
          ),
    );
  }

  private renderPairCard(): void {
    this.fromPicker.querySelector('input')?.setAttribute('aria-label', t('from'));
    this.toPicker.querySelector('input')?.setAttribute('aria-label', t('to'));
    replaceChildren(
      this.pairCard,
      h('h2', {}, t('connectTitle')),
      h(
        'div',
        { class: 'swap-row' },
        h(
          'div',
          { class: 'stack' },
          h('div', { class: 'field' }, h('span', { class: 'label' }, t('from')), this.fromPicker),
          h('div', { class: 'field' }, h('span', { class: 'label' }, t('to')), this.toPicker),
        ),
        h(
          'button',
          {
            class: 'btn btn-icon',
            'aria-label': t('swap'),
            onclick: () => {
              const from = this.fromPicker.value;
              this.fromPicker.set(this.toPicker.value);
              this.toPicker.set(from);
              this.renderResults();
            },
          },
          icon('swap'),
        ),
      ),
    );
  }

  private renderResults(): void {
    const store = this.ctx.store;
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
        { class: 'card stack', 'aria-live': 'polite' },
        h('h3', {}, t('familyRelation')),
        kinship === null || kinship.kind === 'self'
          ? h('p', { class: 'muted' }, t('noFamilyRelation'))
          : h(
              'p',
              { class: 'big-answer' },
              t('kinshipOf', { target: target.name, term: kinshipText(kinship, target.gender, genderOf), from: store.person(from).name }),
            ),
      ),
      h(
        'article',
        { class: 'card stack' },
        h('h3', {}, t('shortestChain'), path === null ? '' : h('span', { class: 'caption nums' }, ` · ${tCount('steps', path.relations.length)}`)),
        path === null
          ? h('p', { class: 'muted' }, t('noChain'))
          : h(
              'ol',
              { class: 'ribbon' },
              ...path.personIds.flatMap((personId, i) => {
                const person = store.person(personId);
                const relation = path.relations[i];
                const node = h(
                  'li',
                  {},
                  h(
                    'button',
                    { class: 'ribbon-node', style: `animation-delay:${i * 60}ms`, onclick: () => this.ctx.openPerson(personId) },
                    avatar(person.name, groupColors(store, person), 'lg', personId === store.meId),
                    h('span', { class: 'ellipsis', style: 'max-width:100%' }, bdi(person.name)),
                  ),
                );
                return relation === undefined
                  ? [node]
                  : [node, h('li', { class: 'ribbon-link', 'aria-label': relationLabelFrom(relation, personId) }, relationLabelFrom(relation, personId))];
              }),
            ),
        path === null ? null : h('button', { class: 'btn', onclick: () => this.ctx.showOnGraph({ kind: 'path', path }) }, icon('graph'), t('showOnGraph')),
      ),
      h(
        'article',
        { class: 'card stack' },
        h('h3', {}, t('mutual'), h('span', { class: 'caption nums' }, ` · ${mutual.length}`)),
        sharedBetween(store, from, to).length === 0
          ? null
          : h('button', { class: 'btn btn-accent', onclick: () => openPitzuchim(this.ctx, { mode: 'between', aId: from, bId: to }) }, `✨ ${t('showPitzuchim')}`),
        mutual.length === 0
          ? h('p', { class: 'muted' }, t('noMutual'))
          : h(
              'div',
              { class: 'chips' },
              ...mutual.map((person) =>
                h(
                  'button',
                  { class: 'chip', onclick: () => this.ctx.openPerson(person.id) },
                  avatar(person.name, [], 'sm'),
                  bdi(person.name),
                ),
              ),
            ),
      ),
    );
  }
}

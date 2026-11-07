import { relationLabelFrom, t } from '../i18n/i18n';
import type { EndpointChoice, Suggestion, UnresolvedEndpoint } from '../model/types';
import { avatar } from './avatar';
import { JgSheet } from './components/sheet';
import { groupColors, type AppContext } from './context';
import { bdi, h, uniqueId } from './dom';
import { checkIcon } from './icons';
import { duration, DURATION, haptic, shake, wait } from './motion';

const SWIPE_THRESHOLD = 90;
const NEW_PERSON = '__new__';

/**
 * Reviews suggested links one card at a time: swipe right / Accept, swipe left / Skip.
 * When the named person is ambiguous ("אמא של רז") the card asks "Which Raz?" first.
 */
export function openSuggestionCards(ctx: AppContext): void {
  const store = ctx.store;
  const sheet = JgSheet.create({ snaps: ['half', 'full'], disposable: true });
  const total = store.suggestions.size;
  let reviewed = 0;
  /** Ignores a second tap/swipe while the current card is still leaving (it would act on it twice). */
  let busy = false;
  sheet.setTitle(t('suggestionsTitle'));

  const decide = async (suggestion: Suggestion, accept: boolean, choice: EndpointChoice | null, card: HTMLElement, direction: 1 | -1): Promise<void> => {
    if (busy) return;
    if (accept && suggestion.unresolved !== null && choice === null) {
      card.style.transition = `transform ${duration(DURATION.base)}ms cubic-bezier(.34,1.56,.64,1)`;
      card.style.transform = '';
      shake(card);
      return;
    }
    busy = true;
    sheet.footer.querySelectorAll('button').forEach((button) => (button.disabled = true));
    haptic();
    card.style.transition = `transform ${duration(DURATION.base)}ms ease-out, opacity ${duration(DURATION.base)}ms ease-out`;
    card.style.transform = `translateX(${direction * 120}%) rotate(${direction * 12}deg)`;
    card.style.opacity = '0';
    await wait(duration(DURATION.base));
    reviewed++;
    if (accept) {
      await store.acceptSuggestion(suggestion.id, choice);
    } else {
      await store.dismissSuggestion(suggestion.id);
    }
    busy = false;
    show();
  };

  const show = (): void => {
    const next = store.suggestions.values().next();
    if (next.done === true) {
      sheet.setBody(h('div', { class: 'empty' }, checkIcon(), h('h2', {}, t('suggestionsDone'))));
      sheet.setFooter(h('button', { class: 'btn btn-primary', onclick: () => void sheet.close() }, t('done')));
      return;
    }
    const suggestion = next.value;
    const unresolved = suggestion.unresolved;
    let choice: EndpointChoice | null =
      unresolved !== null && unresolved.candidateIds.length === 0 && unresolved.canCreate ? { newPersonName: unresolved.name } : null;

    const endpoint = (side: 'from' | 'to'): { name: string; node: HTMLElement } => {
      if (unresolved !== null && unresolved.side === side) {
        return { name: `${unresolved.name}?`, node: avatar(unresolved.name, [], 'lg') };
      }
      const person = store.person(suggestion[side]);
      return { name: person.name, node: avatar(person.name, groupColors(store, person), 'lg', person.id === store.meId) };
    };
    const from = endpoint('from');
    const to = endpoint('to');
    const accept = h('button', { class: 'btn btn-primary', disabled: unresolved !== null && choice === null }, t('accept'));

    const card = h(
      'div',
      { class: 'suggestion-card', role: 'group', 'aria-roledescription': 'card' },
      h('p', { class: 'caption nums' }, t('suggestionProgress', { index: Math.min(reviewed + 1, total), count: total })),
      h('div', { class: 'suggestion-pair' }, from.node, h('span', { class: 'suggestion-arrow' }, '→'), to.node),
      h(
        'p',
        { class: 'big-answer' },
        bdi(from.name),
        ' · ',
        h('span', { class: 'tag tag-family' }, relationLabelFrom({ ...suggestion, createdAt: 0 }, suggestion.from)),
        ' · ',
        bdi(to.name),
      ),
      h('p', { class: 'caption' }, t('suggestionReason', { evidence: suggestion.evidence })),
      unresolved === null ? null : chooser(unresolved),
    );

    function chooser(pending: UnresolvedEndpoint): HTMLElement {
      const name = pending.name;
      const group = uniqueId('who');
      const option = (value: string, content: (Node | string)[], checked: boolean): HTMLElement => {
        const radio = h('input', { type: 'radio', name: group, value, checked });
        radio.addEventListener('change', () => {
          choice = value === NEW_PERSON ? { newPersonName: name } : { personId: value };
          accept.disabled = false;
        });
        return h('label', { class: 'list-row' }, radio, ...content);
      };
      const candidates = pending.candidateIds.map((id) => store.person(id));
      return h(
        'fieldset',
        { class: 'stack', style: 'border:none;padding:0;margin:0;width:100%;text-align:start' },
        h('legend', { class: 'label' }, t('whichPerson', { name })),
        ...candidates.map((person) =>
          option(person.id, [avatar(person.name, groupColors(store, person), 'sm'), h('span', { class: 'grow ellipsis' }, bdi(person.name))], false),
        ),
        pending.canCreate
          ? option(NEW_PERSON, [avatar(name, [], 'sm'), h('span', { class: 'grow' }, t('someoneNew', { name }))], candidates.length === 0)
          : null,
      );
    }

    accept.addEventListener('click', () => void decide(suggestion, true, choice, card, 1));
    enableSwipe(card, (direction) => void decide(suggestion, direction === 1, choice, card, direction));
    sheet.setBody(
      h(
        'div',
        { class: 'stack' },
        h('div', { class: 'suggestion-stage' }, card),
        h('p', { class: 'caption', style: 'text-align:center' }, unresolved !== null ? t('chooseWhoFirst') : t('swipeHint')),
      ),
    );
    sheet.setFooter(h('button', { class: 'btn', onclick: () => void decide(suggestion, false, null, card, -1) }, t('skip')), accept);
    sheet.open(unresolved !== null && unresolved.candidateIds.length > 2 ? 'full' : 'half');
  };

  show();
  if (!sheet.isOpen) sheet.open();
}

/** Horizontal drag with a little rotation; past the threshold it commits, otherwise springs back. */
function enableSwipe(card: HTMLElement, onSwipe: (direction: 1 | -1) => void): void {
  card.addEventListener('pointerdown', (down) => {
    // Let taps on the "which one?" choices work normally: capturing the pointer would swallow their clicks.
    if ((down.target as HTMLElement).closest('label, input, button') !== null) return;
    const startX = down.clientX;
    let dx = 0;
    card.setPointerCapture(down.pointerId);
    card.style.transition = 'none';
    const move = (event: PointerEvent): void => {
      dx = event.clientX - startX;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
    };
    const up = (): void => {
      card.removeEventListener('pointermove', move);
      if (Math.abs(dx) > SWIPE_THRESHOLD) {
        onSwipe(dx > 0 ? 1 : -1);
      } else {
        card.style.transition = `transform ${duration(DURATION.base)}ms cubic-bezier(.34,1.56,.64,1)`;
        card.style.transform = '';
      }
    };
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerup', up, { once: true });
    card.addEventListener('pointercancel', up, { once: true });
  });
}

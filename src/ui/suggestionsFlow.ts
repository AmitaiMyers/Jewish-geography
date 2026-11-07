import { relationLabelFrom, t } from '../i18n/i18n';
import type { StringKey } from '../i18n/strings';
import type { EndpointChoice, FamilyKind, Suggestion, UnresolvedEndpoint } from '../model/types';
import { avatar } from './avatar';
import { JgPersonPicker } from './components/personPicker';
import { JgSheet } from './components/sheet';
import { groupColors, type AppContext } from './context';
import { bdi, h, uniqueId } from './dom';
import { checkIcon, icon } from './icons';
import { duration, DURATION, haptic, shake, wait } from './motion';

const SWIPE_THRESHOLD = 90;
const NEW_PERSON = '__new__';
const SOMEONE_ELSE = '__search__';
const FAMILY_KINDS: readonly { kind: FamilyKind; label: StringKey }[] = [
  { kind: 'parent', label: 'kindParent' },
  { kind: 'child', label: 'kindChild' },
  { kind: 'sibling', label: 'kindSibling' },
  { kind: 'spouse', label: 'kindSpouse' },
  { kind: 'relative', label: 'kindRelative' },
];

/** What the user has picked on the current card; a card is ready when everything it asks for is answered. */
interface Answers {
  endpoint: EndpointChoice | null;
  kind: FamilyKind | null;
}

function isReady(suggestion: Suggestion, answers: Answers): boolean {
  return (suggestion.unresolved === null || answers.endpoint !== null) && (!suggestion.askKind || answers.kind !== null);
}

/** A labelled radio group: each option is a row with any content; `onPick` gets the chosen value. */
function radioGroup(legend: string, options: { value: string; content: (Node | string)[]; checked: boolean }[], onPick: (value: string) => void): HTMLElement {
  const name = uniqueId('choice');
  return h(
    'fieldset',
    { class: 'stack', style: 'border:none;padding:0;margin:0;width:100%;text-align:start;gap:0' },
    h('legend', { class: 'label', style: 'margin-bottom:4px' }, legend),
    ...options.map((option) => {
      const radio = h('input', { type: 'radio', name, value: option.value, checked: option.checked });
      radio.addEventListener('change', () => onPick(option.value));
      return h('label', { class: 'list-row' }, radio, ...option.content);
    }),
  );
}

/**
 * Reviews suggested links one card at a time: swipe right / Accept, swipe left / Skip.
 * A card may first ask "Which Raz?" (ambiguous name) and/or "How is Yoni Myers related to you?" (shared surname).
 * "Which Raz?" also lets me search all my contacts myself, or discard the connection outright.
 */
export function openSuggestionCards(ctx: AppContext): void {
  const store = ctx.store;
  const sheet = JgSheet.create({ snaps: ['half', 'full'], disposable: true });
  const total = store.suggestions.size;
  let reviewed = 0;
  /** Ignores a second tap/swipe while the current card is still leaving (it would act on it twice). */
  let busy = false;
  sheet.setTitle(t('suggestionsTitle'));

  const decide = async (suggestion: Suggestion, accept: boolean, answers: Answers, card: HTMLElement, direction: 1 | -1): Promise<void> => {
    if (busy) return;
    if (accept && !isReady(suggestion, answers)) {
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
      await store.acceptSuggestion(suggestion.id, answers.endpoint, suggestion.askKind ? answers.kind : null);
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
    const answers: Answers = {
      endpoint: unresolved !== null && unresolved.candidateIds.length === 0 && unresolved.canCreate ? { newPersonName: unresolved.name } : null,
      kind: null,
    };

    const endpoint = (side: 'from' | 'to'): { name: string; node: HTMLElement } => {
      if (unresolved !== null && unresolved.side === side) {
        return { name: `${unresolved.name}?`, node: avatar(unresolved.name, [], 'lg') };
      }
      const person = store.person(suggestion[side]);
      return { name: person.name, node: avatar(person.name, groupColors(store, person), 'lg', person.id === store.meId) };
    };
    const from = endpoint('from');
    const to = endpoint('to');
    const accept = h('button', { class: 'btn btn-primary', disabled: !isReady(suggestion, answers) }, t('accept'));
    const refresh = (): void => {
      accept.disabled = !isReady(suggestion, answers);
    };

    const whoChooser = (pending: UnresolvedEndpoint): HTMLElement => {
      const candidates = pending.candidateIds.map((id) => store.person(id));
      const knownId = suggestion[pending.side === 'from' ? 'to' : 'from'];
      const picker = JgPersonPicker.create(store, {
        label: t('searchContactsFor', { name: pending.name }),
        exclude: () => [knownId],
        onChoose: (personId) => {
          answers.endpoint = { personId };
          refresh();
        },
      });
      picker.hidden = true;
      const choices = radioGroup(
        t('whichPerson', { name: pending.name }),
        [
          ...candidates.map((person) => ({
            value: person.id,
            content: [avatar(person.name, groupColors(store, person), 'sm'), h('span', { class: 'grow ellipsis' }, bdi(person.name))],
            checked: false,
          })),
          ...(pending.canCreate
            ? [{ value: NEW_PERSON, content: [avatar(pending.name, [], 'sm'), h('span', { class: 'grow' }, t('someoneNew', { name: pending.name }))], checked: candidates.length === 0 }]
            : []),
          { value: SOMEONE_ELSE, content: [icon('search'), h('span', { class: 'grow' }, t('someoneElse'))], checked: false },
        ],
        (value) => {
          picker.hidden = value !== SOMEONE_ELSE;
          if (value === SOMEONE_ELSE) {
            answers.endpoint = picker.value === null ? null : { personId: picker.value };
            picker.focusInput();
          } else {
            answers.endpoint = value === NEW_PERSON ? { newPersonName: pending.name } : { personId: value };
          }
          refresh();
        },
      );
      return h(
        'div',
        { class: 'stack', style: 'width:100%' },
        choices,
        picker,
        h('button', { class: 'btn btn-ghost btn-danger btn-block', onclick: () => void decide(suggestion, false, answers, card, -1) }, icon('trash'), t('discardConnection')),
      );
    };
    const kindChooser = (): HTMLElement =>
      radioGroup(
        t('howRelated', { name: from.name }),
        FAMILY_KINDS.map(({ kind, label }) => ({ value: kind, content: [h('span', { class: 'grow' }, t(label))], checked: false })),
        (value) => {
          answers.kind = value as FamilyKind;
          refresh();
        },
      );

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
        h('span', { class: 'tag tag-family' }, suggestion.askKind ? suggestion.label : relationLabelFrom({ ...suggestion, createdAt: 0 }, suggestion.from)),
        ' · ',
        bdi(to.name),
      ),
      h('p', { class: 'caption' }, t('suggestionReason', { evidence: suggestion.evidence })),
      unresolved === null ? null : whoChooser(unresolved),
      suggestion.askKind ? kindChooser() : null,
    );

    accept.addEventListener('click', () => void decide(suggestion, true, answers, card, 1));
    enableSwipe(card, (direction) => void decide(suggestion, direction === 1, answers, card, direction));
    const asks = unresolved !== null || suggestion.askKind;
    sheet.setBody(
      h(
        'div',
        { class: 'stack' },
        h('div', { class: 'suggestion-stage' }, card),
        h('p', { class: 'caption', style: 'text-align:center' }, asks ? t('chooseWhoFirst') : t('swipeHint')),
      ),
    );
    sheet.setFooter(h('button', { class: 'btn', onclick: () => void decide(suggestion, false, answers, card, -1) }, t('discard')), accept);
    sheet.open(asks ? 'full' : 'half');
  };

  show();
  if (!sheet.isOpen) sheet.open();
}

/** Horizontal drag with a little rotation; past the threshold it commits, otherwise springs back. */
function enableSwipe(card: HTMLElement, onSwipe: (direction: 1 | -1) => void): void {
  card.addEventListener('pointerdown', (down) => {
    // Let taps on the choices work normally: capturing the pointer would swallow their clicks.
    if ((down.target as HTMLElement).closest('label, input, button, jg-person-picker') !== null) return;
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

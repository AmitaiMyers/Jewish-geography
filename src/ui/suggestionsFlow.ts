import { relationLabelFrom, t } from '../i18n/i18n';
import type { Suggestion } from '../model/types';
import { avatar } from './avatar';
import { JgSheet } from './components/sheet';
import { groupColors, type AppContext } from './context';
import { bdi, h } from './dom';
import { checkIcon } from './icons';
import { duration, DURATION, haptic, wait } from './motion';

const SWIPE_THRESHOLD = 90;

/** Reviews suggested links one card at a time: swipe right / Accept, swipe left / Skip. */
export function openSuggestionCards(ctx: AppContext): void {
  const store = ctx.store;
  const sheet = JgSheet.create({ snaps: ['half', 'full'], disposable: true });
  const total = store.suggestions.size;
  let reviewed = 0;
  /** Ignores a second tap/swipe while the current card is still leaving (it would act on it twice). */
  let busy = false;
  sheet.setTitle(t('suggestionsTitle'));

  const decide = async (suggestion: Suggestion, accept: boolean, card: HTMLElement, direction: 1 | -1): Promise<void> => {
    if (busy) return;
    busy = true;
    sheet.footer.querySelectorAll('button').forEach((button) => (button.disabled = true));
    haptic();
    card.style.transition = `transform ${duration(DURATION.base)}ms ease-out, opacity ${duration(DURATION.base)}ms ease-out`;
    card.style.transform = `translateX(${direction * 120}%) rotate(${direction * 12}deg)`;
    card.style.opacity = '0';
    await wait(duration(DURATION.base));
    reviewed++;
    if (accept) {
      await store.acceptSuggestion(suggestion.id);
    } else {
      await store.dismissSuggestion(suggestion.id);
    }
    busy = false;
    show();
  };

  const show = (): void => {
    const next = store.suggestions.values().next();
    if (next.done === true) {
      sheet.setBody(
        h('div', { class: 'empty' }, checkIcon(), h('h2', {}, t('suggestionsDone'))),
      );
      sheet.setFooter(h('button', { class: 'btn btn-primary', onclick: () => void sheet.close() }, t('done')));
      return;
    }
    const suggestion = next.value;
    const from = store.person(suggestion.from);
    const to = store.person(suggestion.to);
    const card = h(
      'div',
      { class: 'suggestion-card', role: 'group', 'aria-roledescription': 'card' },
      h('p', { class: 'caption nums' }, t('suggestionProgress', { index: Math.min(reviewed + 1, total), count: total })),
      h(
        'div',
        { class: 'suggestion-pair' },
        avatar(from.name, groupColors(store, from), 'lg', from.id === store.meId),
        h('span', { class: 'suggestion-arrow' }, '→'),
        avatar(to.name, groupColors(store, to), 'lg', to.id === store.meId),
      ),
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
    );
    enableSwipe(card, (direction) => void decide(suggestion, direction === 1, card, direction));
    sheet.setBody(h('div', { class: 'stack' }, h('div', { class: 'suggestion-stage' }, card), h('p', { class: 'caption', style: 'text-align:center' }, t('swipeHint'))));
    sheet.setFooter(
      h('button', { class: 'btn', onclick: () => void decide(suggestion, false, card, -1) }, t('skip')),
      h('button', { class: 'btn btn-primary', onclick: () => void decide(suggestion, true, card, 1) }, t('accept')),
    );
  };

  show();
  sheet.open();
}

/** Horizontal drag with a little rotation; past the threshold it commits, otherwise springs back. */
function enableSwipe(card: HTMLElement, onSwipe: (direction: 1 | -1) => void): void {
  card.addEventListener('pointerdown', (down) => {
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

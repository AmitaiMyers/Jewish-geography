import type { Overlap } from '../compare/overlap';
import type { ComparePayload } from '../compare/payload';
import { relationLabelFrom, relationTypeName, t, tCount } from '../i18n/i18n';
import { SOCIAL_TYPES, type Person, type RelationType } from '../model/types';
import { avatar } from './avatar';
import type { AppStore } from '../store/appStore';
import { groupColors, relationToMeText, type AppContext } from './context';
import { bdi, h, toast, uniqueId } from './dom';
import { DURATION, duration, haptic, prefersReducedMotion, wait } from './motion';

/**
 * The Pitzuchim reveal (docs/DESIGN_SYSTEM.md §9): the app's main moment.
 * Two people's avatars meet, seeds crack open, the number of people they both know counts up,
 * the best shared link is called out, and everyone shared is listed by how you know them.
 *
 *  - compare: after scanning a friend's code — nothing is saved until "Add Yossi + N pitzuchim";
 *  - between: two people already in the graph — a celebration of their mutual connections.
 */

export type PitzuchimRequest =
  | { mode: 'compare'; payload: ComparePayload; overlap: Overlap }
  | { mode: 'between'; aId: string; bId: string };

const SEED_COUNT = 22;
const STAGGERED_ROWS = 15;
const COUNT_UP_MS = 900;
const FRIEND_TYPES: readonly RelationType[] = [...SOCIAL_TYPES, 'sibling', 'spouse'];

interface Section {
  key: string;
  title: string;
  color: string | null;
  people: Person[];
}

/** Groups the app creates for non-social reasons: they go last and are never "the best pitzuach". */
const UTILITY_GROUPS = new Set(['Services', 'שירותים', '🐶']);
const CLOSE_GROUP = '❤️';

/** Family first, then close people (❤️), then my groups (largest first), then 🐶 / services, then everyone else. */
function groupShared(ctx: AppContext, people: readonly Person[]): Section[] {
  const store = ctx.store;
  const family: Person[] = [];
  const byGroup = new Map<string, Person[]>();
  const other: Person[] = [];
  for (const person of people) {
    const groupId = person.groupIds[0];
    if (relationToMeText(store, person) !== '') family.push(person);
    else if (groupId !== undefined) byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), person]);
    else other.push(person);
  }
  const rank = (name: string): number => (name === CLOSE_GROUP ? 0 : UTILITY_GROUPS.has(name) ? 2 : 1);
  const groupSections = [...byGroup]
    .map(([groupId, members]): Section => ({ key: groupId, title: store.group(groupId).name, color: store.group(groupId).color, people: members }))
    .sort((a, b) => rank(a.title) - rank(b.title) || b.people.length - a.people.length);
  const byConnections = (a: Person, b: Person): number => store.index.degree(b.id) - store.index.degree(a.id);
  return [
    ...(family.length > 0 ? [{ key: 'family', title: t('sectionFamily'), color: null, people: family }] : []),
    ...groupSections,
    ...(other.length > 0 ? [{ key: 'other', title: t('sectionOther'), color: null, people: [...other].sort(byConnections) }] : []),
  ];
}

/** The single most exciting shared link: a relative of mine, else the biggest real group, else a few names. */
function bestPitzuach(ctx: AppContext, sections: readonly Section[], friendName: string): string | null {
  const relative = sections.find((section) => section.key === 'family')?.people[0];
  if (relative !== undefined) {
    return t('pitzFamilyHighlight', { relation: relationToMeText(ctx.store, relative), person: relative.name, name: friendName });
  }
  const biggest = sections
    .filter((section) => section.key !== 'other' && section.key !== 'family' && !UTILITY_GROUPS.has(section.title))
    .sort((a, b) => b.people.length - a.people.length)[0];
  if (biggest !== undefined && biggest.people.length >= 2) {
    return t('pitzGroupHighlight', { count: biggest.people.length, group: biggest.title });
  }
  const names = sections.flatMap((section) => section.people).slice(0, 3).map((person) => person.name);
  return names.length === 0 ? null : t('pitzIncluding', { names: names.join(', ') });
}

/** Gold seeds that crack out from the meeting point and tumble down (decorative, aria-hidden). */
function seedBurst(): HTMLElement {
  const burst = h('div', { class: 'pitz-burst', 'aria-hidden': 'true' });
  for (let i = 0; i < SEED_COUNT; i++) {
    const angle = (i / SEED_COUNT) * 2 * Math.PI + Math.random() * 0.4;
    const distance = 90 + Math.random() * 90;
    const seed = h('span', { class: `pitz-seed${i % 3 === 0 ? ' is-sand' : ''}` });
    seed.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    seed.style.setProperty('--dy', `${Math.sin(angle) * distance - 40}px`);
    seed.style.setProperty('--fall', `${120 + Math.random() * 120}px`);
    seed.style.setProperty('--spin', `${(Math.random() - 0.5) * 900}deg`);
    seed.style.setProperty('--delay', `${Math.random() * 120}ms`);
    burst.append(seed);
  }
  return burst;
}

function countUp(target: HTMLElement, to: number): void {
  if (prefersReducedMotion() || to === 0) {
    target.textContent = String(to);
    return;
  }
  const start = performance.now();
  const tick = (now: number): void => {
    const progress = Math.min(1, (now - start) / COUNT_UP_MS);
    target.textContent = String(Math.round(to * (1 - Math.pow(1 - progress, 3))));
    if (progress < 1) window.requestAnimationFrame(tick);
  };
  window.requestAnimationFrame(tick);
}

/**
 * Who two people in my graph both know. When one of them is me, that is everyone the other is
 * connected to (everyone in my graph is someone I know); otherwise their mutual connections.
 */
export function sharedBetween(store: AppStore, aId: string, bId: string): string[] {
  if (aId === store.meId || bId === store.meId) {
    const other = aId === store.meId ? bId : aId;
    return [...new Set(store.index.neighbors(other).map((n) => n.personId))].filter((id) => id !== store.meId);
  }
  return store.index.mutualConnections(aId, bId);
}

export function openPitzuchim(ctx: AppContext, request: PitzuchimRequest): void {
  const store = ctx.store;
  const me = store.person(store.meId);
  const isCompare = request.mode === 'compare';
  const left: { name: string; colors: string[]; isMe: boolean } =
    request.mode === 'compare'
      ? { name: me.name, colors: groupColors(store, me), isMe: true }
      : { name: store.person(request.aId).name, colors: groupColors(store, store.person(request.aId)), isMe: request.aId === store.meId };
  const friendName =
    request.mode === 'compare'
      ? request.overlap.friendId === null
        ? request.payload.name
        : store.person(request.overlap.friendId).name
      : store.person(request.bId).name;
  const friendColors = request.mode === 'between' ? groupColors(store, store.person(request.bId)) : [];
  const sharedIds = request.mode === 'compare' ? request.overlap.commonIds : sharedBetween(store, request.aId, request.bId);
  const shared = sharedIds.map((id) => store.person(id));
  const kept = new Set(sharedIds);
  const sections = groupShared(ctx, shared);
  const highlight = bestPitzuach(ctx, sections, friendName);
  const count = shared.length;

  const titleId = uniqueId('pitz-title');
  const summaryId = uniqueId('pitz-summary');
  const summaryText =
    request.mode === 'between' && !left.isMe
      ? t('pitzSummaryBetween', { a: left.name, b: friendName, count })
      : tCount('pitzSummary', count, { name: friendName });
  const dialog = h('dialog', { class: 'pitz', 'aria-labelledby': titleId, 'aria-describedby': summaryId });
  const number = h('span', { class: 'pitz-number nums', 'aria-hidden': 'true' }, '0');
  const live = h('p', { class: 'sr-only', role: 'status' });
  const cta = h('button', { class: 'btn pitz-cta' });

  const refreshCta = (): void => {
    if (isCompare) {
      cta.textContent = tCount('pitzAdd', kept.size, { name: friendName });
    }
  };

  const close = async (): Promise<void> => {
    dialog.classList.add('is-closing');
    await wait(duration(DURATION.base));
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    void close();
  });

  const row = (person: Person, index: number): HTMLElement => {
    const relation = relationToMeText(store, person);
    const neighbor = request.mode === 'between' ? store.index.neighbors(request.aId).find((n) => n.personId === person.id) : undefined;
    const how = relation !== '' ? relation : neighbor !== undefined ? relationLabelFrom(neighbor.relation, person.id) : '';
    const content = [
      avatar(person.name, groupColors(store, person), 'sm', person.id === store.meId),
      h('span', { class: 'grow' }, h('span', { class: 'row-title ellipsis' }, bdi(person.name)), how === '' ? null : h('span', { class: 'row-sub' }, how)),
    ];
    const style = `animation-delay:${Math.min(index, STAGGERED_ROWS) * 40 + 700}ms`;
    if (!isCompare) {
      return h(
        'li',
        { class: 'pitz-row', style },
        h(
          'button',
          {
            class: 'list-row',
            onclick: async () => {
              await close();
              ctx.openPerson(person.id);
            },
          },
          ...content,
        ),
      );
    }
    const checkbox = h('input', { type: 'checkbox', checked: true, 'aria-label': `${t('pitzKnows', { name: friendName })}: ${person.name}` });
    const item = h('li', { class: 'pitz-row', style }, h('label', { class: 'list-row' }, ...content, checkbox));
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) kept.add(person.id);
      else kept.delete(person.id);
      item.classList.toggle('is-out', !checkbox.checked);
      number.textContent = String(kept.size);
      refreshCta();
      haptic();
    });
    return item;
  };

  let rowIndex = 0;
  const list = sections.map((section) =>
    h(
      'section',
      { class: 'pitz-section' },
      h(
        'h3',
        { class: 'pitz-section-title' },
        section.color === null ? null : h('span', { class: 'chip-dot', style: `background:${section.color}` }),
        section.title,
        h('span', { class: 'nums' }, ` · ${section.people.length}`),
      ),
      h('ul', { class: 'list' }, ...section.people.map((person) => row(person, rowIndex++))),
    ),
  );

  const relationSelect = h(
    'select',
    { 'aria-label': t('connectionType') },
    ...FRIEND_TYPES.map((type) => h('option', { value: type, selected: type === 'friend' }, relationTypeName(type))),
  );

  if (request.mode === 'compare') {
    const { payload, overlap } = request;
    cta.addEventListener('click', async () => {
      cta.classList.add('is-loading');
      const friendId = await store.applyComparison({
        friendId: overlap.friendId,
        newFriend: { name: payload.name, phones: payload.phones, emails: payload.emails },
        relationType: relationSelect.value as RelationType,
        label: '',
        commonIds: [...kept],
      });
      haptic([10, 40, 10]);
      await close();
      toast(tCount('compareDone', kept.size, { name: friendName }), { success: true });
      ctx.showOnGraph({ kind: 'person', personId: friendId });
    });
  } else {
    const { bId } = request;
    cta.textContent = t('showOnGraph');
    cta.addEventListener('click', async () => {
      await close();
      ctx.showOnGraph({ kind: 'person', personId: bId }); // their neighbourhood includes everyone you share
    });
  }
  refreshCta();

  const friendLine =
    request.mode === 'compare'
      ? h('p', { class: 'pitz-muted' }, request.overlap.friendId === null ? t('friendNew', { name: friendName }) : t('friendKnown', { name: friendName }))
      : null;

  dialog.append(
    h(
      'div',
      { class: 'pitz-scroll' },
      h(
        'div',
        { class: 'pitz-hero', 'aria-hidden': 'true' },
        h('div', { class: 'pitz-avatar pitz-a' }, avatar(left.name, left.colors, 'xl', left.isMe)),
        h('div', { class: 'pitz-avatar pitz-b' }, avatar(friendName, friendColors, 'xl')),
        count > 0 ? seedBurst() : null,
      ),
      h('h2', { class: 'pitz-title', id: titleId, tabindex: -1 }, count > 0 ? t('pitzTitle') : t('pitzNone')),
      h('p', { class: 'sr-only', id: summaryId }, summaryText),
      count > 0
        ? h(
            'div',
            { class: 'pitz-count', 'aria-hidden': 'true' },
            h('span', {}, request.mode === 'between' && !left.isMe ? t('pitzBetween', { a: left.name, b: friendName }) : t('pitzBothKnow', { name: friendName })),
            number,
            h('span', {}, t('pitzPeople')),
          )
        : h('p', { class: 'pitz-muted' }, isCompare ? t('pitzNoneBody', { name: friendName }) : ''),
      highlight === null ? null : h('p', { class: 'pitz-highlight' }, '✨ ', highlight),
      friendLine,
      count > 0 && isCompare ? h('p', { class: 'pitz-muted pitz-hint' }, t('pitzCoincidence')) : null,
      h('div', { class: 'pitz-list' }, ...list),
      live,
    ),
    h(
      'div',
      { class: 'pitz-footer' },
      isCompare ? h('label', { class: 'pitz-relation' }, h('span', {}, t('friendIs', { name: friendName })), relationSelect) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn pitz-ghost', onclick: () => void close() }, isCompare ? t('pitzNotNow') : t('close')), cta),
    ),
  );

  document.body.append(dialog);
  dialog.showModal();
  (dialog.querySelector(`#${titleId}`) as HTMLElement).focus();
  if (count > 0) haptic([20, 30, 40]);
  window.setTimeout(() => countUp(number, count), duration(500));
  window.setTimeout(() => (live.textContent = summaryText), 600);
}

import { relationLabelFrom, relationTypeName, t, tCount } from '../i18n/i18n';
import { relationProblem } from '../model/relationRules';
import {
  FAMILY_PRIMITIVE_TYPES,
  isFamilyType,
  isLabelledType,
  SOCIAL_TYPES,
  type Gender,
  type Person,
  type RelationType,
} from '../model/types';
import type { RelationDraft } from '../store/appStore';
import { avatar } from './avatar';
import { JgPersonPicker } from './components/personPicker';
import { JgSheet, type Snap } from './components/sheet';
import { groupColors, relationToMeText, type AppContext } from './context';
import { bdi, h, splitList, toast } from './dom';
import { icon } from './icons';
import { haptic, shake } from './motion';

/**
 * Everything about one person: who they are to me, their groups and connections,
 * a sentence-style form to add a connection ("Avi is the uncle of Sarah"),
 * and their details (collapsed until needed).
 */

/** "childOf" is a UI-only choice, stored as a parent relation pointing the other way. */
type ConnectionChoice = RelationType | 'childOf';

const FAMILY_CHOICES: readonly ConnectionChoice[] = ['parent', 'childOf', ...FAMILY_PRIMITIVE_TYPES.filter((type) => type !== 'parent'), 'relative'];
const SOCIAL_CHOICES: readonly ConnectionChoice[] = [...SOCIAL_TYPES, 'custom'];

function choiceLabel(choice: ConnectionChoice): string {
  if (choice === 'parent') return t('typeParentOf');
  if (choice === 'childOf') return t('typeChildOf');
  return relationTypeName(choice);
}

function toDraft(choice: ConnectionChoice, personId: string, otherId: string, label: string): RelationDraft {
  if (choice === 'childOf') {
    return { from: otherId, to: personId, type: 'parent', label: '' };
  }
  return { from: personId, to: otherId, type: choice, label: isLabelledType(choice) ? label : '' };
}

export class PersonSheet {
  private readonly sheet = JgSheet.create({ snaps: ['peek', 'half', 'full'] });
  private personId: string | null = null;

  constructor(private readonly ctx: AppContext) {
    this.sheet.onClose(() => {
      this.personId = null;
    });
    ctx.store.subscribe(() => {
      if (this.personId === null) return;
      if (ctx.store.people.has(this.personId)) {
        this.render();
      } else {
        void this.sheet.close();
      }
    });
  }

  open(personId: string, snap: Snap = 'half'): void {
    this.personId = personId;
    this.render();
    this.sheet.open(snap);
  }

  private render(): void {
    const store = this.ctx.store;
    const person = store.person(this.personId as string);
    const isMe = person.id === store.meId;
    const relation = relationToMeText(store, person);

    this.sheet.setTitle(person.name);
    this.sheet.setBody(
      h(
        'div',
        { class: 'stack-lg' },
        h(
          'div',
          { class: 'row' },
          avatar(person.name, groupColors(store, person), 'xl', isMe),
          h(
            'div',
            { class: 'grow stack', style: 'gap:4px' },
            h(
              'p',
              { class: relation === '' ? 'muted' : 'big-answer' },
              isMe ? t('you') : relation === '' ? t('notFamily') : t('relationToYou', { relation }),
            ),
            h('p', { class: 'caption nums' }, tCount('connectionsCount', store.index.degree(person.id))),
          ),
        ),
        this.quickActions(person, isMe),
        this.groupToggles(person),
        this.connectionList(person),
        this.addConnectionForm(person),
        this.detailsForm(person, isMe),
      ),
    );
  }

  private quickActions(person: Person, isMe: boolean): HTMLElement {
    const store = this.ctx.store;
    return h(
      'div',
      { class: 'row' },
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            await this.sheet.close(); // the page behind stays inert until the modal has fully closed
            this.ctx.showOnGraph({ kind: 'person', personId: person.id });
          },
        },
        icon('graph'),
        t('showOnGraph'),
      ),
      isMe
        ? null
        : h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                await this.sheet.close();
                this.ctx.showConnection(store.meId, person.id);
              },
            },
            icon('connect'),
            t('pathToMe'),
          ),
      isMe
        ? null
        : h(
            'button',
            {
              class: 'btn btn-ghost btn-danger',
              onclick: () => void this.ctx.deleteWithUndo(t('deletedPerson', { name: person.name }), () => store.deletePeople([person.id])),
            },
            icon('trash'),
            t('delete'),
          ),
    );
  }

  private groupToggles(person: Person): HTMLElement | null {
    const store = this.ctx.store;
    const groups = [...store.groups.values()];
    if (groups.length === 0) {
      return null;
    }
    return h(
      'section',
      { class: 'stack', 'aria-label': t('groups') },
      h('h3', {}, t('groups')),
      h(
        'div',
        { class: 'chips' },
        ...groups.map((group) => {
          const isMember = person.groupIds.includes(group.id);
          return h(
            'button',
            {
              class: 'chip',
              'aria-pressed': String(isMember),
              onclick: () => {
                haptic();
                void store.updatePerson({
                  ...person,
                  groupIds: isMember ? person.groupIds.filter((id) => id !== group.id) : [...person.groupIds, group.id],
                });
              },
            },
            h('span', { class: 'chip-dot', style: `background:${group.color}` }),
            group.name,
          );
        }),
      ),
    );
  }

  private connectionList(person: Person): HTMLElement {
    const store = this.ctx.store;
    const neighbors = [...store.index.neighbors(person.id)].sort((a, b) =>
      store.person(a.personId).name.localeCompare(store.person(b.personId).name),
    );
    return h(
      'section',
      { class: 'stack' },
      h('h3', {}, t('connections')),
      neighbors.length === 0
        ? h('p', { class: 'muted' }, t('noConnections'))
        : h(
            'ul',
            { class: 'list' },
            ...neighbors.map(({ personId, relation }) => {
              const other = store.person(personId);
              return h(
                'li',
                { class: 'row', style: 'flex-wrap:nowrap' },
                h(
                  'button',
                  { class: 'list-row grow', onclick: () => this.open(personId, this.sheet.snap) },
                  avatar(other.name, groupColors(store, other), 'sm', other.id === store.meId),
                  h('span', { class: 'grow ellipsis' }, bdi(other.name)),
                  h('span', { class: isFamilyType(relation.type) ? 'tag tag-family' : 'tag' }, relationLabelFrom(relation, person.id)),
                ),
                h(
                  'button',
                  {
                    class: 'btn btn-ghost btn-icon',
                    'aria-label': t('removeConnection', { name: other.name }),
                    onclick: () => void this.ctx.deleteWithUndo(t('connectionRemoved'), () => store.deleteRelation(relation.id)),
                  },
                  icon('close'),
                ),
              );
            }),
          ),
    );
  }

  private addConnectionForm(person: Person): HTMLElement {
    const store = this.ctx.store;
    const optionGroup = (label: string, choices: readonly ConnectionChoice[]): HTMLElement =>
      h('optgroup', { label }, ...choices.map((choice) => h('option', { value: choice }, choiceLabel(choice))));
    const type = h('select', { 'aria-label': t('connectionType') }, optionGroup(t('familyTypes'), FAMILY_CHOICES), optionGroup(t('socialTypes'), SOCIAL_CHOICES));
    type.value = 'friend';
    const label = h('input', { placeholder: t('labelPlaceholder'), 'aria-label': t('labelPlaceholder'), hidden: true });
    const error = h('p', { class: 'field-error', 'aria-live': 'polite' });
    const picker = JgPersonPicker.create(store, { label: t('choosePerson'), exclude: () => [person.id], onChoose: () => (error.textContent = '') });
    type.addEventListener('change', () => {
      label.hidden = !isLabelledType(type.value as RelationType);
      if (!label.hidden) label.focus();
    });

    const form = h(
      'form',
      { class: 'stack card' },
      h('h3', {}, t('addConnection')),
      h('p', { class: 'muted' }, bdi(person.name), ` ${t('isThe')}`),
      type,
      label,
      h('p', { class: 'muted' }, t('of')),
      picker,
      error,
      h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('plus'), t('add')),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const otherId = picker.value;
      if (otherId === null) {
        error.textContent = t('choosePerson');
        shake(form);
        picker.focusInput();
        return;
      }
      const draft = toDraft(type.value as ConnectionChoice, person.id, otherId, label.value);
      const problem = relationProblem(draft, store.relations.values());
      if (problem !== null) {
        error.textContent = t(`problem_${problem}`);
        shake(form);
        return;
      }
      await store.addRelation(draft);
      haptic([10, 40, 10]);
      toast(t('connectionAdded'), { success: true });
    });
    return form;
  }

  private detailsForm(person: Person, isMe: boolean): HTMLElement {
    const field = (labelText: string, control: HTMLElement, hint?: string): HTMLElement =>
      h('label', { class: 'field' }, h('span', { class: 'label' }, labelText), control, hint === undefined ? null : h('span', { class: 'caption' }, hint));
    const name = h('input', { value: person.name, required: true, autocomplete: 'off' });
    const gender = h(
      'select',
      {},
      ...(['unknown', 'male', 'female'] as const).map((value) =>
        h('option', { value, selected: person.gender === value }, t(value === 'unknown' ? 'genderUnknown' : value)),
      ),
    );
    const phones = h('input', { value: person.phones.join(', '), inputmode: 'tel', autocomplete: isMe ? 'tel' : 'off' });
    const emails = h('input', { value: person.emails.join(', '), inputmode: 'email' });
    const notes = h('textarea', { rows: 3 });
    notes.value = person.notes;

    const form = h(
      'form',
      { class: 'stack', style: 'padding-top:12px' },
      field(t('name'), name),
      field(t('gender'), gender),
      field(t('phones'), phones, isMe ? t('yourPhoneHint') : t('separateWithCommas')),
      field(t('emails'), emails, t('separateWithCommas')),
      field(t('notes'), notes),
      h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, t('save')),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (name.value.trim() === '') {
        shake(name);
        name.focus();
        return;
      }
      await this.ctx.store.updatePerson({
        ...person,
        name: name.value.trim(),
        gender: gender.value as Gender,
        phones: splitList(phones.value),
        emails: splitList(emails.value),
        notes: notes.value,
      });
      toast(t('saved'), { success: true });
    });
    return h('details', { class: 'card', open: isMe }, h('summary', { class: 'label' }, t('details')), form);
  }
}

import { relationLabelFrom, relationTypeName, t } from '../i18n/i18n';
import { relationProblem } from '../model/relationRules';
import { ALL_RELATION_TYPES, isLabelledType, type Gender, type Person, type RelationType } from '../model/types';
import type { RelationDraft } from '../store/appStore';
import { relationToMeText, type AppContext } from './context';
import { byId, h, replaceChildren, splitList } from './dom';
import { PersonPicker } from './personPicker';

/**
 * Bottom sheet for one person: details, groups, how they relate to me,
 * their connections, and a form to add a new connection.
 */

/** "childOf" is a UI-only choice: it is stored as a parent relation pointing the other way. */
type ConnectionChoice = RelationType | 'childOf';

const CONNECTION_CHOICES: readonly ConnectionChoice[] = ALL_RELATION_TYPES.flatMap((type): ConnectionChoice[] =>
  type === 'parent' ? ['parent', 'childOf'] : [type],
);

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
  private readonly dialog: HTMLDialogElement;
  private personId: string | null = null;

  constructor(private readonly ctx: AppContext) {
    this.dialog = byId<HTMLDialogElement>('person-sheet');
    this.dialog.addEventListener('close', () => {
      this.personId = null;
    });
    ctx.store.subscribe(() => {
      if (this.personId !== null) {
        if (ctx.store.people.has(this.personId)) {
          this.render();
        } else {
          this.dialog.close();
        }
      }
    });
  }

  open(personId: string): void {
    this.personId = personId;
    this.render();
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
  }

  private render(): void {
    const store = this.ctx.store;
    const person = store.person(this.personId as string);
    const isMe = person.id === store.meId;
    const kinshipText = relationToMeText(store, person);

    replaceChildren(
      this.dialog,
      h(
        'div',
        { class: 'sheet-header' },
        h('h2', {}, person.name, isMe ? h('span', { class: 'badge' }, t('you')) : null),
        h('button', { class: 'icon', 'aria-label': t('close'), onclick: () => this.dialog.close() }, '✕'),
      ),
      isMe ? null : h('p', { class: 'kinship' }, kinshipText !== '' ? `${t('relationToYou')}: ${kinshipText}` : t('notFamily')),
      this.detailsForm(person),
      this.groupToggles(person),
      this.connectionList(person),
      this.addConnectionForm(person),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            onclick: () => {
              this.dialog.close();
              this.ctx.showOnGraph({ kind: 'person', personId: person.id });
            },
          },
          t('showOnGraph'),
        ),
        isMe
          ? null
          : h(
              'button',
              {
                class: 'danger',
                onclick: async () => {
                  if (confirm(t('confirmDeletePerson', { name: person.name }))) {
                    await store.deletePeople([person.id]);
                  }
                },
              },
              t('delete'),
            ),
      ),
    );
  }

  private detailsForm(person: Person): HTMLElement {
    const name = h('input', { value: person.name, required: true });
    const gender = h(
      'select',
      {},
      ...(['unknown', 'male', 'female'] as const).map((value) =>
        h('option', { value, selected: person.gender === value }, t(value === 'unknown' ? 'genderUnknown' : value)),
      ),
    );
    const phones = h('input', { value: person.phones.join(', '), inputmode: 'tel' });
    const emails = h('input', { value: person.emails.join(', '), inputmode: 'email' });
    const notes = h('textarea', { rows: 2 });
    notes.value = person.notes;

    const form = h(
      'form',
      { class: 'stack' },
      field(t('name'), name),
      field(t('gender'), gender),
      field(t('phones'), phones),
      field(t('emails'), emails),
      field(t('notes'), notes),
      h('button', { type: 'submit', class: 'primary' }, t('save')),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await this.ctx.store.updatePerson({
        ...person,
        name: name.value.trim(),
        gender: gender.value as Gender,
        phones: splitList(phones.value),
        emails: splitList(emails.value),
        notes: notes.value,
      });
    });
    return h('details', {}, h('summary', {}, t('details')), form);
  }

  private groupToggles(person: Person): HTMLElement | null {
    const store = this.ctx.store;
    const groups = [...store.groups.values()];
    if (groups.length === 0) {
      return null;
    }
    return h(
      'fieldset',
      { class: 'chips' },
      h('legend', {}, t('groups')),
      ...groups.map((group) => {
        const isMember = person.groupIds.includes(group.id);
        return h(
          'button',
          {
            class: `chip ${isMember ? 'active' : ''}`,
            onclick: () =>
              store.updatePerson({
                ...person,
                groupIds: isMember ? person.groupIds.filter((id) => id !== group.id) : [...person.groupIds, group.id],
              }),
          },
          h('span', { class: 'dot', style: `background:${group.color}` }),
          group.name,
        );
      }),
    );
  }

  private connectionList(person: Person): HTMLElement {
    const store = this.ctx.store;
    const neighbors = [...store.index.neighbors(person.id)].sort((a, b) =>
      store.person(a.personId).name.localeCompare(store.person(b.personId).name),
    );
    return h(
      'section',
      {},
      h('h3', {}, t('relations')),
      neighbors.length === 0
        ? h('p', { class: 'muted' }, t('noRelations'))
        : h(
            'ul',
            { class: 'list' },
            ...neighbors.map(({ personId, relation }) =>
              h(
                'li',
                {},
                h('span', { class: 'tag' }, relationLabelFrom(relation, person.id)),
                h('button', { class: 'link', onclick: () => this.open(personId) }, store.person(personId).name),
                h('button', { class: 'icon', 'aria-label': t('delete'), onclick: () => store.deleteRelation(relation.id) }, '✕'),
              ),
            ),
          ),
    );
  }

  private addConnectionForm(person: Person): HTMLElement {
    let otherId: string | null = null;
    const type = h('select', {}, ...CONNECTION_CHOICES.map((choice) => h('option', { value: choice }, choiceLabel(choice))));
    type.value = 'friend';
    const label = h('input', { placeholder: t('label'), hidden: true });
    const problem = h('p', { class: 'error' });
    const picker = new PersonPicker(this.ctx.store, (id) => (otherId = id), () => [person.id]);

    type.addEventListener('change', () => {
      label.hidden = !isLabelledType(type.value as RelationType);
    });

    const add = async (): Promise<void> => {
      if (otherId === null) {
        problem.textContent = t('choosePerson');
        return;
      }
      const draft = toDraft(type.value as ConnectionChoice, person.id, otherId, label.value);
      const issue = relationProblem(draft, this.ctx.store.relations.values());
      if (issue !== null) {
        problem.textContent = t(`problem_${issue}`);
        return;
      }
      await this.ctx.store.addRelation(draft);
    };

    return h(
      'section',
      { class: 'stack' },
      h('h3', {}, t('addRelation')),
      h('div', { class: 'sentence' }, h('strong', {}, person.name), h('span', {}, t('isThe')), type, label, h('span', {}, t('ofPerson'))),
      picker.element,
      problem,
      h('button', { class: 'primary', onclick: add }, t('add')),
    );
  }
}

function field(labelText: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, labelText), control);
}

import { t } from '../i18n/i18n';
import { planImport, type ImportCandidate } from '../model/importPlan';
import type { PersonSource } from '../model/types';
import type { RawContact } from '../importers/rawContact';
import type { AppStore } from '../store/appStore';
import { byId, h, replaceChildren, toast } from './dom';

const NEW_GROUP = '__new__';

/**
 * Shows imported contacts before they are added: new ones are ticked,
 * people already in the graph are unticked. The user may put them all in a group.
 */
export function openImportReview(store: AppStore, contacts: RawContact[], source: PersonSource, suggestedGroupName: string): void {
  if (contacts.length === 0) {
    toast(t('nothingFound'));
    return;
  }
  const dialog = byId<HTMLDialogElement>('import-sheet');
  const candidates = planImport(contacts, [...store.people.values()]);
  const chosen = new Set(candidates.filter((c) => c.existingPersonId === null));

  const submit = h('button', { class: 'primary' });
  const refreshCount = (): void => {
    submit.textContent = t('importSelected', { count: chosen.size });
    submit.disabled = chosen.size === 0;
  };

  const groupSelect = h(
    'select',
    {},
    h('option', { value: '' }, t('noGroup')),
    ...[...store.groups.values()].map((group) => h('option', { value: group.id }, group.name)),
    h('option', { value: NEW_GROUP }, t('newGroup')),
  );
  const newGroupName = h('input', { value: suggestedGroupName, placeholder: t('groupName') });
  groupSelect.value = suggestedGroupName !== '' ? NEW_GROUP : '';
  const syncGroupInput = (): void => {
    newGroupName.hidden = groupSelect.value !== NEW_GROUP;
  };
  groupSelect.addEventListener('change', syncGroupInput);
  syncGroupInput();

  submit.addEventListener('click', async () => {
    const groupId = await resolveGroup(store, groupSelect.value, newGroupName.value);
    const picked = candidates.filter((c) => chosen.has(c)).map((c) => c.contact);
    const result = await store.importContacts(picked, source, groupId);
    dialog.close();
    toast(t('importDone', { added: result.added, suggested: result.suggested }));
  });

  replaceChildren(
    dialog,
    h(
      'div',
      { class: 'sheet-header' },
      h('h2', {}, t('reviewImport')),
      h('button', { class: 'icon', 'aria-label': t('close'), onclick: () => dialog.close() }, '✕'),
    ),
    h('label', { class: 'field' }, h('span', {}, t('importIntoGroup')), groupSelect, newGroupName),
    h(
      'ul',
      { class: 'list' },
      ...candidates.map((candidate) => candidateRow(candidate, chosen, refreshCount)),
    ),
    h('div', { class: 'row sticky-bottom' }, h('button', { onclick: () => dialog.close() }, t('cancel')), submit),
  );
  refreshCount();
  dialog.showModal();
}

function candidateRow(candidate: ImportCandidate, chosen: Set<ImportCandidate>, onChange: () => void): HTMLElement {
  const checkbox = h('input', { type: 'checkbox', checked: chosen.has(candidate) });
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) chosen.add(candidate);
    else chosen.delete(candidate);
    onChange();
  });
  const note =
    candidate.reason === 'identifier' ? t('alreadyInGraph') : candidate.reason === 'name' ? t('possibleDuplicate') : null;
  const detail = [...candidate.contact.phones, ...candidate.contact.emails].join(' · ');
  return h(
    'li',
    {},
    h(
      'label',
      { class: 'row-button' },
      checkbox,
      h('span', { class: 'grow' }, candidate.contact.name, detail !== '' ? h('small', { class: 'muted block' }, detail) : null),
      note === null ? null : h('span', { class: 'tag warn' }, note),
    ),
  );
}

async function resolveGroup(store: AppStore, selection: string, newName: string): Promise<string | null> {
  if (selection === '') {
    return null;
  }
  if (selection === NEW_GROUP) {
    return newName.trim() === '' ? null : (await store.createGroup(newName)).id;
  }
  return selection;
}

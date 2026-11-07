import { relationTypeName, t, tCount } from '../i18n/i18n';
import { isContactPickerSupported, pickPhoneContacts } from '../importers/contactPicker';
import { parseFacebookFriends } from '../importers/facebook';
import type { RawContact } from '../importers/rawContact';
import { parseVCards } from '../importers/vcard';
import { readWhatsAppExport } from '../importers/whatsapp';
import { planImport, type ImportCandidate } from '../model/importPlan';
import { SOCIAL_TYPES, type PersonSource, type SocialType } from '../model/types';
import { avatar } from './avatar';
import { JgSheet } from './components/sheet';
import type { AppContext } from './context';
import { bdi, chooseFile, chooseTextFile, h, toast } from './dom';
import { icon, type IconName } from './icons';
import { haptic } from './motion';

const NEW_GROUP = '__new__';

/** The import sources as large, tappable option cards. `onPicked` runs before the review opens. */
export function importOptionCards(ctx: AppContext, onPicked: () => void = () => undefined): HTMLElement {
  const review = (contacts: RawContact[], source: PersonSource, groupName = ''): void => {
    onPicked();
    openImportReview(ctx, contacts, source, groupName);
  };
  const fromFile = async (accept: string, handle: (file: { name: string; text: string }) => void): Promise<void> => {
    const file = await chooseTextFile(accept);
    if (file !== null) handle(file);
  };
  const option = (iconName: IconName, title: string, hint: string, run: () => void | Promise<void>): HTMLElement =>
    h(
      'button',
      { class: 'option-card', onclick: run },
      h('span', { class: 'option-icon' }, icon(iconName)),
      h('span', { class: 'grow' }, h('span', { class: 'row-title' }, title), h('span', { class: 'row-sub' }, hint)),
    );

  return h(
    'div',
    { class: 'stack' },
    isContactPickerSupported()
      ? option('phone', t('importPhone'), t('importPhoneHint'), async () => review(await pickPhoneContacts(), 'contacts'))
      : null,
    option('file', t('importVcard'), t('importVcardHint'), () =>
      fromFile('.vcf,text/vcard,text/x-vcard', (file) => review(parseVCards(file.text), 'vcard')),
    ),
    option('chat', t('importWhatsapp'), t('importWhatsappHint'), async () => {
      // iPhone exports a .zip (with _chat.txt inside); Android exports the .txt itself.
      const file = await chooseFile('.zip,.txt,application/zip,application/x-zip-compressed,text/plain');
      if (file === null) return;
      const chat = await readWhatsAppExport(file.name, new Uint8Array(await file.arrayBuffer()));
      review(chat.contacts, 'whatsapp', chat.chatName);
    }),
    option('globe', t('importFacebook'), t('importFacebookHint'), () =>
      fromFile('.json,application/json', (file) => review(parseFacebookFriends(file.text), 'facebook')),
    ),
  );
}

/** "Bring in your people" (first run) or plain "Import people". */
export function openImportSheet(ctx: AppContext, welcome: boolean): void {
  const sheet = JgSheet.create({ snaps: ['half', 'full'], disposable: true });
  sheet.setTitle(welcome ? t('bringPeopleTitle') : t('importTitle'));
  sheet.setBody(
    h(
      'div',
      { class: 'stack' },
      welcome ? h('p', { class: 'muted' }, t('bringPeopleBody')) : null,
      importOptionCards(ctx, () => void sheet.close()),
    ),
  );
  sheet.setFooter(welcome ? h('button', { class: 'btn', onclick: () => void sheet.close() }, t('skipForNow')) : null);
  sheet.open(welcome ? 'full' : 'half');
}

/**
 * Review before importing: new people are ticked, people already in the graph are not.
 * Optionally drops everyone into a group (a WhatsApp chat suggests its own name).
 */
export function openImportReview(ctx: AppContext, contacts: RawContact[], source: PersonSource, suggestedGroupName: string): void {
  const store = ctx.store;
  if (contacts.length === 0) {
    toast(t('nothingFound'));
    return;
  }
  const candidates = planImport(contacts, [...store.people.values()]);
  const chosen = new Set(candidates.filter((c) => c.existingPersonId === null));
  const sheet = JgSheet.create({ snaps: ['full'], disposable: true });

  const submit = h('button', { class: 'btn btn-primary' });
  const refreshCount = (): void => {
    submit.textContent = t('importSelected', { count: chosen.size });
    submit.disabled = chosen.size === 0;
  };

  const groupSelect = h(
    'select',
    {},
    h('option', { value: '' }, t('noGroup')),
    ...[...store.groups.values()].map((group) => h('option', { value: group.id }, group.name)),
    h('option', { value: NEW_GROUP }, t('newGroupOption')),
  );
  // "How do you know them?" — links everyone in this import (new and existing) to me.
  const howKnown = h(
    'select',
    {},
    h('option', { value: '' }, t('justAddThem')),
    ...SOCIAL_TYPES.map((type) => h('option', { value: type }, relationTypeName(type))),
  );
  const newGroupName = h('input', { value: suggestedGroupName, placeholder: t('groupName'), 'aria-label': t('groupName') });
  groupSelect.value = suggestedGroupName !== '' ? NEW_GROUP : '';
  const syncGroupInput = (): void => {
    newGroupName.hidden = groupSelect.value !== NEW_GROUP;
  };
  groupSelect.addEventListener('change', syncGroupInput);
  syncGroupInput();

  submit.addEventListener('click', async () => {
    submit.classList.add('is-loading');
    submit.setAttribute('aria-label', t('importing'));
    const groupId =
      groupSelect.value === NEW_GROUP
        ? newGroupName.value.trim() === ''
          ? null
          : (await store.createGroup(newGroupName.value)).id
        : groupSelect.value === ''
          ? null
          : groupSelect.value;
    const picked = candidates.filter((c) => chosen.has(c)).map((c) => c.contact);
    // People already in the graph are not added again, but they were in this source: they join its group
    // and get the "how do you know them" link too.
    const alreadyHere = candidates.flatMap((c) => (c.existingPersonId === null ? [] : [c.existingPersonId]));
    const result = await store.importContacts(picked, source, {
      groupId,
      servicesGroupName: t('servicesGroup'),
      existingInSource: alreadyHere,
      linkToMe: howKnown.value === '' ? null : (howKnown.value as SocialType),
    });
    await sheet.close();
    haptic([10, 40, 10]);
    const message = [
      t('importDone', { added: result.added }),
      result.linked > 0 ? tCount('importLinked', result.linked) : '',
      result.groups > 0 ? tCount('importGroups', result.groups) : '',
      result.suggested > 0 ? tCount('importSuggestions', result.suggested) : '',
    ]
      .filter((part) => part !== '')
      .join(' ');
    toast(message, {
      success: true,
      action: result.suggested > 0 ? { label: t('review'), run: () => ctx.openSuggestions() } : undefined,
    });
    ctx.navigate('graph');
  });

  sheet.setTitle(t('reviewImport'));
  sheet.setBody(
    h(
      'div',
      { class: 'stack' },
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'label' }, t('importIntoGroup')),
        groupSelect,
        newGroupName,
        candidates.some((c) => c.existingPersonId !== null) ? h('span', { class: 'caption' }, t('existingJoinIn')) : null,
      ),
      h('label', { class: 'field' }, h('span', { class: 'label' }, t('howKnowThem')), howKnown),
      h('ul', { class: 'list' }, ...candidates.map((candidate) => candidateRow(candidate, chosen, refreshCount))),
    ),
  );
  sheet.setFooter(h('button', { class: 'btn', onclick: () => void sheet.close() }, t('cancel')), submit);
  refreshCount();
  sheet.open();
}

function candidateRow(candidate: ImportCandidate, chosen: Set<ImportCandidate>, onChange: () => void): HTMLElement {
  const checkbox = h('input', { type: 'checkbox', checked: chosen.has(candidate), 'aria-label': candidate.contact.name });
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) chosen.add(candidate);
    else chosen.delete(candidate);
    onChange();
  });
  const note = candidate.reason === 'identifier' ? t('alreadyInGraph') : candidate.reason === 'name' ? t('possibleDuplicate') : null;
  const detail = [...candidate.contact.phones, ...candidate.contact.emails].join(' · ');
  return h(
    'li',
    {},
    h(
      'label',
      { class: 'list-row' },
      checkbox,
      avatar(candidate.contact.name, [], 'sm'),
      h(
        'span',
        { class: 'grow' },
        h('span', { class: 'row-title ellipsis' }, bdi(candidate.contact.name)),
        detail === '' ? null : h('span', { class: 'row-sub ellipsis' }, bdi(detail)),
      ),
      note === null ? null : h('span', { class: 'tag tag-warn' }, note),
    ),
  );
}

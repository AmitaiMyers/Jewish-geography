import { language, relationLabelFrom, t } from '../i18n/i18n';
import { isContactPickerSupported, pickPhoneContacts } from '../importers/contactPicker';
import { parseFacebookFriends } from '../importers/facebook';
import type { RawContact } from '../importers/rawContact';
import { parseVCards } from '../importers/vcard';
import { parseWhatsAppChat } from '../importers/whatsapp';
import type { Language, PersonSource, Suggestion } from '../model/types';
import type { AppContext, View } from './context';
import { chooseTextFile, downloadText, h, replaceChildren, toast } from './dom';
import { openImportReview } from './importReview';

/** Import, suggestions to review, backup and settings. */
export class MoreView implements View {
  readonly element: HTMLElement;

  constructor(private readonly ctx: AppContext) {
    this.element = h('section', { class: 'view scroll stack' });
  }

  onShow(): void {
    this.render();
  }

  setQuery(): void {
    // Nothing here is searchable.
  }

  render(): void {
    replaceChildren(
      this.element,
      this.suggestionsSection(),
      this.importSection(),
      this.backupSection(),
      this.settingsSection(),
    );
  }

  private suggestionsSection(): HTMLElement {
    const suggestions = [...this.ctx.store.suggestions.values()];
    return h(
      'article',
      { class: 'card', id: 'suggestions' },
      h('h2', {}, t('suggestionsTitle'), suggestions.length > 0 ? h('span', { class: 'badge' }, String(suggestions.length)) : null),
      suggestions.length === 0
        ? h('p', { class: 'muted' }, t('suggestionsNone'))
        : h('ul', { class: 'list' }, ...suggestions.map((suggestion) => this.suggestionRow(suggestion))),
    );
  }

  private suggestionRow(suggestion: Suggestion): HTMLElement {
    const store = this.ctx.store;
    const relationPreview = { ...suggestion, createdAt: 0 };
    return h(
      'li',
      { class: 'suggestion' },
      h(
        'span',
        { class: 'grow' },
        h('strong', {}, store.person(suggestion.from).name),
        ' ',
        h('span', { class: 'tag' }, relationLabelFrom(relationPreview, suggestion.from)),
        ' ',
        h('strong', {}, store.person(suggestion.to).name),
        h('small', { class: 'muted block' }, t('suggestionReason', { evidence: suggestion.evidence })),
      ),
      h('button', { class: 'primary', onclick: () => store.acceptSuggestion(suggestion.id) }, t('accept')),
      h('button', { onclick: () => store.dismissSuggestion(suggestion.id) }, t('dismiss')),
    );
  }

  private importSection(): HTMLElement {
    const store = this.ctx.store;
    const review = (contacts: RawContact[], source: PersonSource, groupName = ''): void =>
      openImportReview(store, contacts, source, groupName);

    const fromFile = async (accept: string, handle: (file: { name: string; text: string }) => void): Promise<void> => {
      const file = await chooseTextFile(accept);
      if (file !== null) {
        handle(file);
      }
    };

    return h(
      'article',
      { class: 'card stack' },
      h('h2', {}, t('importTitle')),
      isContactPickerSupported()
        ? importOption(t('importPhone'), t('importPhoneHint'), async () => review(await pickPhoneContacts(), 'contacts'))
        : null,
      importOption(t('importVcard'), t('importVcardHint'), () =>
        fromFile('.vcf,text/vcard,text/x-vcard', (file) => review(parseVCards(file.text), 'vcard')),
      ),
      importOption(t('importWhatsapp'), t('importWhatsappHint'), () =>
        fromFile('.txt,text/plain', (file) => {
          const chat = parseWhatsAppChat(file.text, file.name);
          review(chat.contacts, 'whatsapp', chat.chatName);
        }),
      ),
      importOption(t('importFacebook'), t('importFacebookHint'), () =>
        fromFile('.json,application/json', (file) => review(parseFacebookFriends(file.text), 'facebook')),
      ),
    );
  }

  private backupSection(): HTMLElement {
    const store = this.ctx.store;
    return h(
      'article',
      { class: 'card stack' },
      h('h2', {}, t('backupTitle')),
      h('p', { class: 'muted' }, t('backupHint')),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            onclick: () => {
              const date = new Date().toISOString().slice(0, 10);
              downloadText(`jewish-geography-${date}.json`, JSON.stringify(store.exportBackup(), null, 2), 'application/json');
            },
          },
          t('exportBackup'),
        ),
        h(
          'button',
          {
            onclick: async () => {
              const file = await chooseTextFile('.json,application/json');
              if (file !== null && confirm(t('confirmRestore'))) {
                await store.restoreBackup(file.text);
                toast(t('restored'));
              }
            },
          },
          t('restoreBackup'),
        ),
      ),
    );
  }

  private settingsSection(): HTMLElement {
    const languageSelect = h(
      'select',
      {},
      h('option', { value: 'en', selected: language() === 'en' }, 'English'),
      h('option', { value: 'he', selected: language() === 'he' }, 'עברית'),
    );
    languageSelect.addEventListener('change', () => this.ctx.store.setLanguage(languageSelect.value as Language));
    return h(
      'article',
      { class: 'card stack' },
      h('h2', {}, t('settingsTitle')),
      h('label', { class: 'field' }, h('span', {}, t('language')), languageSelect),
      h('h3', {}, t('installTitle')),
      h('p', { class: 'muted' }, t('installHint')),
      h('h3', {}, t('privacyTitle')),
      h('p', { class: 'muted' }, t('privacyBody')),
    );
  }
}

function importOption(title: string, hint: string, run: () => void | Promise<void>): HTMLElement {
  return h('div', { class: 'import-option' }, h('button', { onclick: run }, title), h('small', { class: 'muted' }, hint));
}

import { applyLanguageToDocument, language, setLanguage, t } from '../i18n/i18n';
import type { Language } from '../model/types';
import type { AppStore } from '../store/appStore';
import { byId, h, replaceChildren, splitList } from './dom';
import { shake } from './motion';

/**
 * First run, one screen: name, optional phone (so friends recognise you when comparing), language.
 * The next step — "Bring in your people" — is opened by the app right after.
 */
export function runOnboarding(store: AppStore): Promise<void> {
  const dialog = byId<HTMLDialogElement>('onboarding');
  setLanguage(navigator.language.startsWith('he') ? 'he' : 'en');
  applyLanguageToDocument();
  const iconUrl = `${import.meta.env.BASE_URL}icons/icon.svg`;

  return new Promise((resolve) => {
    let name = '';
    let phone = '';
    const render = (): void => {
      const nameInput = h('input', { value: name, required: true, autocomplete: 'name', enterkeyhint: 'next' });
      const phoneInput = h('input', { value: phone, type: 'tel', autocomplete: 'tel', inputmode: 'tel', enterkeyhint: 'done' });
      nameInput.addEventListener('input', () => (name = nameInput.value));
      phoneInput.addEventListener('input', () => (phone = phoneInput.value));
      const languageSelect = h(
        'select',
        {},
        h('option', { value: 'en', selected: language() === 'en' }, 'English'),
        h('option', { value: 'he', selected: language() === 'he' }, 'עברית'),
      );
      languageSelect.addEventListener('change', () => {
        setLanguage(languageSelect.value as Language);
        applyLanguageToDocument();
        render();
      });

      const form = h(
        'form',
        { class: 'sheet-body stack-lg', style: 'padding-top:24px' },
        h('div', { class: 'welcome-art' }, h('img', { src: iconUrl, alt: '' })),
        h('h1', { style: 'font: var(--text-display); text-align:center' }, t('welcomeTitle')),
        h('p', { class: 'muted', style: 'text-align:center' }, t('welcomeBody')),
        h('label', { class: 'field' }, h('span', { class: 'label' }, t('yourName')), nameInput),
        h('label', { class: 'field' }, h('span', { class: 'label' }, t('yourPhone')), phoneInput, h('span', { class: 'caption' }, t('yourPhoneHint'))),
        h('label', { class: 'field' }, h('span', { class: 'label' }, t('language')), languageSelect),
        h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, t('continue')),
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (name.trim() === '') {
          shake(nameInput);
          nameInput.focus();
          return;
        }
        await store.createMe(name.trim(), language(), splitList(phone));
        dialog.close();
        resolve();
      });
      replaceChildren(dialog, form);
      dialog.setAttribute('aria-label', t('welcomeTitle'));
    };
    render();
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.dataset['snap'] = 'full';
    dialog.style.setProperty('--sheet-height', '100dvh');
    dialog.showModal();
  });
}

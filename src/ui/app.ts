import { applyLanguageToDocument, language, setLanguage, t } from '../i18n/i18n';
import type { StringKey } from '../i18n/strings';
import type { Language } from '../model/types';
import type { AppStore } from '../store/appStore';
import { ConnectView } from './connectView';
import type { AppContext, Highlight, TabName, View } from './context';
import { byId, h, replaceChildren } from './dom';
import { GraphView } from './graphView';
import { GroupsView } from './groupsView';
import { MoreView } from './moreView';
import { PeopleView } from './peopleView';
import { PersonSheet } from './personSheet';

const TABS: readonly { name: TabName; icon: string; label: StringKey }[] = [
  { name: 'graph', icon: '◉', label: 'tabGraph' },
  { name: 'people', icon: '☰', label: 'tabPeople' },
  { name: 'groups', icon: '◍', label: 'tabGroups' },
  { name: 'connect', icon: '⇄', label: 'tabConnect' },
  { name: 'more', icon: '⋯', label: 'tabMore' },
];

/** App shell: top bar with search, the five tabs, and the person sheet. */
export class App implements AppContext {
  private readonly graph: GraphView;
  private readonly views: Record<TabName, View>;
  private readonly sheet: PersonSheet;
  private readonly search = byId<HTMLInputElement>('search');
  private active: TabName = 'graph';

  constructor(readonly store: AppStore) {
    this.graph = new GraphView(this);
    this.views = {
      graph: this.graph,
      people: new PeopleView(this),
      groups: new GroupsView(this),
      connect: new ConnectView(this),
      more: new MoreView(this),
    };
    this.sheet = new PersonSheet(this);

    const main = byId('views');
    for (const [name, view] of Object.entries(this.views)) {
      view.element.hidden = name !== this.active;
      main.append(view.element);
    }
    this.search.addEventListener('input', () => this.views[this.active].setQuery(this.search.value));
    store.subscribe(() => this.refresh());
  }

  start(): void {
    this.refresh();
    this.views[this.active].onShow();
  }

  openPerson(personId: string): void {
    this.sheet.open(personId);
  }

  showOnGraph(highlight: Highlight): void {
    this.navigate('graph');
    this.graph.show(highlight);
  }

  navigate(tab: TabName): void {
    if (tab === this.active) {
      return;
    }
    this.views[this.active].element.hidden = true;
    this.active = tab;
    const view = this.views[tab];
    view.element.hidden = false;
    view.setQuery(this.search.value);
    view.onShow();
    this.renderChrome();
  }

  private refresh(): void {
    if (language() !== this.store.settings.language) {
      setLanguage(this.store.settings.language);
      applyLanguageToDocument();
    }
    this.renderChrome();
    this.graph.render();
    if (this.active !== 'graph') {
      this.views[this.active].render();
    }
  }

  private renderChrome(): void {
    document.title = t('appName');
    byId('title').textContent = t('appName');
    this.search.placeholder = t('search');
    this.search.hidden = this.active !== 'graph' && this.active !== 'people';
    const suggestionCount = this.store.suggestions.size;
    replaceChildren(
      byId('tabs'),
      ...TABS.map((tab) =>
        h(
          'button',
          {
            class: `tab ${tab.name === this.active ? 'active' : ''}`,
            'aria-current': tab.name === this.active ? 'page' : null,
            onclick: () => this.navigate(tab.name),
          },
          h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, tab.icon),
          h('span', {}, t(tab.label)),
          tab.name === 'more' && suggestionCount > 0 ? h('span', { class: 'badge' }, String(suggestionCount)) : null,
        ),
      ),
    );
  }
}

/** First run: ask for the user's name and language, then create the "me" node. */
export function runOnboarding(store: AppStore): Promise<void> {
  const dialog = byId<HTMLDialogElement>('onboarding');
  const browserLanguage: Language = navigator.language.startsWith('he') ? 'he' : 'en';
  setLanguage(browserLanguage);
  applyLanguageToDocument();

  return new Promise((resolve) => {
    const render = (): void => {
      const name = h('input', { required: true, autocomplete: 'name' });
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
        { class: 'stack' },
        h('h2', {}, t('welcomeTitle')),
        h('p', {}, t('welcomeBody')),
        h('label', { class: 'field' }, h('span', {}, t('yourName')), name),
        h('label', { class: 'field' }, h('span', {}, t('language')), languageSelect),
        h('button', { type: 'submit', class: 'primary' }, t('start')),
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        await store.createMe(name.value, language());
        dialog.close();
        resolve();
      });
      replaceChildren(dialog, form);
    };
    render();
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.showModal();
  });
}

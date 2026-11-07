import { applyLanguageToDocument, language, setLanguage, t } from '../i18n/i18n';
import type { StringKey } from '../i18n/strings';
import type { AppStore, Snapshot } from '../store/appStore';
import { openMyCode, openScanner } from './compareFlow';
import { askText, type Snap } from './components/sheet';
import { ConnectView } from './connectView';
import type { AppContext, Highlight, TabName, View } from './context';
import { byId, h, replaceChildren, toast } from './dom';
import { GraphView } from './graphView';
import { icon, type IconName } from './icons';
import { openImportSheet } from './importFlow';
import { MeView } from './meView';
import { haptic } from './motion';
import { PeopleView } from './peopleView';
import { PersonSheet } from './personSheet';
import { openSearch } from './searchCommand';
import { openSuggestionCards } from './suggestionsFlow';

const TABS: readonly { name: TabName; icon: IconName; label: StringKey }[] = [
  { name: 'graph', icon: 'graph', label: 'tabGraph' },
  { name: 'people', icon: 'people', label: 'tabPeople' },
  { name: 'connect', icon: 'connect', label: 'tabConnect' },
  { name: 'me', icon: 'me', label: 'tabMe' },
];

/** App shell: header with the search trigger, four tabs, and the shared person sheet. */
export class App implements AppContext {
  private readonly graph: GraphView;
  private readonly connect: ConnectView;
  private readonly views: Record<TabName, View>;
  private readonly sheet: PersonSheet;
  private active: TabName = 'graph';

  constructor(readonly store: AppStore) {
    this.graph = new GraphView(this);
    this.connect = new ConnectView(this);
    this.views = { graph: this.graph, people: new PeopleView(this), connect: this.connect, me: new MeView(this) };
    this.sheet = new PersonSheet(this);

    const main = byId('views');
    main.replaceChildren(); // drop the loading skeleton
    for (const tab of TABS) {
      const view = this.views[tab.name];
      view.element.id = `view-${tab.name}`;
      view.element.setAttribute('role', 'tabpanel');
      view.element.setAttribute('aria-labelledby', `tab-${tab.name}`);
      view.element.hidden = tab.name !== this.active;
      main.append(view.element);
    }
    byId('search-trigger').addEventListener('click', () => this.openSearch());
    store.subscribe(() => this.refresh());
  }

  start(): void {
    this.refresh();
    this.views[this.active].onShow();
  }

  // ---------- AppContext ----------

  navigate(tab: TabName): void {
    if (tab === this.active) return;
    this.views[this.active].element.hidden = true;
    this.active = tab;
    this.views[tab].element.hidden = false;
    this.views[tab].onShow();
    this.renderChrome();
  }

  openPerson(personId: string, snap?: Snap): void {
    this.sheet.open(personId, snap);
  }

  showOnGraph(highlight: Highlight): void {
    this.navigate('graph');
    this.graph.show(highlight);
  }

  showConnection(fromId: string, toId: string): void {
    this.connect.setPair(fromId, toId);
    if (this.active === 'connect') this.connect.render();
    this.navigate('connect');
  }

  openSearch(): void {
    openSearch(this);
  }

  openImport(welcome = false): void {
    openImportSheet(this, welcome);
  }

  openSuggestions(): void {
    openSuggestionCards(this);
  }

  openCompare(mode: 'show' | 'scan'): void {
    if (mode === 'show') openMyCode(this);
    else openScanner(this);
  }

  async addPerson(): Promise<void> {
    const name = await askText(t('newPersonTitle'), t('name'));
    if (name === null) return;
    const person = await this.store.addPerson({ name, gender: 'unknown', phones: [], emails: [], groupIds: [], notes: '', source: 'manual' });
    haptic();
    this.openPerson(person.id, 'half');
  }

  async createGroup(): Promise<void> {
    const name = await askText(t('newGroup'), t('groupName'));
    if (name === null) return;
    await this.store.createGroup(name);
    toast(name, { success: true });
  }

  async rescanNames(): Promise<void> {
    const result = await this.store.rescanNames(t('servicesGroup'));
    toast(t('rescanDone', { groups: result.groups, suggested: result.suggested }), {
      success: true,
      action: result.suggested > 0 ? { label: t('review'), run: () => this.openSuggestions() } : undefined,
    });
  }

  async deleteWithUndo(message: string, run: () => Promise<Snapshot>): Promise<void> {
    const snapshot = await run();
    haptic();
    toast(message, { action: { label: t('undo'), run: () => this.store.restore(snapshot) } });
  }

  // ---------- rendering ----------

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
    byId('brand-name').textContent = t('appName');
    replaceChildren(byId('search-trigger'), icon('search'), h('span', {}, t('searchEverything')));
    const tabs = byId('tabs');
    tabs.setAttribute('aria-label', t('mainNavigation'));
    const suggestionCount = this.store.suggestions.size;
    replaceChildren(
      tabs,
      ...TABS.map((tab) =>
        h(
          'button',
          {
            class: 'tab',
            role: 'tab',
            id: `tab-${tab.name}`,
            'aria-controls': `view-${tab.name}`,
            'aria-selected': String(tab.name === this.active),
            tabindex: tab.name === this.active ? 0 : -1,
            onclick: () => this.navigate(tab.name),
            onkeydown: (event: Event) => this.onTabKey(event as KeyboardEvent, tab.name),
          },
          icon(tab.icon),
          h('span', {}, t(tab.label)),
          tab.name === 'me' && suggestionCount > 0 ? h('span', { class: 'badge', 'aria-label': t('suggestionsCount', { count: suggestionCount }) }, String(suggestionCount)) : null,
        ),
      ),
    );
  }

  /** Roving tabindex: arrow keys move between tabs (mirrored for right-to-left). */
  private onTabKey(event: KeyboardEvent, current: TabName): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const forward = (event.key === 'ArrowRight') !== (document.documentElement.dir === 'rtl');
    const position = TABS.findIndex((tab) => tab.name === current);
    const next = TABS[(position + (forward ? 1 : -1) + TABS.length) % TABS.length] as (typeof TABS)[number];
    event.preventDefault();
    this.navigate(next.name);
    byId(`tab-${next.name}`).focus();
  }
}

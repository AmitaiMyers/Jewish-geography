import cytoscape, { type Collection, type Core, type EdgeSingular, type NodeCollection, type NodeSingular, type StylesheetJson } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { convexHull } from '../graph/hull';
import { t } from '../i18n/i18n';
import { assert } from '../model/assert';
import { relationToMeText, type AppContext, type Highlight, type View } from './context';
import { h, replaceChildren } from './dom';
import { buildGraphElements, isLoose } from './graphElements';
import { icon, networkIllustration } from './icons';
import { DURATION, duration, haptic, prefersReducedMotion } from './motion';

cytoscape.use(fcose);

const DARK_SCHEME = window.matchMedia('(prefers-color-scheme: dark)');
const COACH_KEY = 'jg.coach.tapPerson';
const SVG_NS = 'http://www.w3.org/2000/svg';
const PATH_STAGGER_MS = 60;
/** Above this many connected people the layout switches to its faster "draft" mode without animation. */
const LARGE_CORE = 250;
const MIN_CORE_TO_FOCUS = 4;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPIRAL_SPACING = 16;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** @param showLoose draw people who are not connected to anyone yet (off by default: they can number in the thousands) */
function stylesheet(showLoose: boolean): StylesheetJson {
  const accent = cssVar('--color-accent');
  return [
    {
      selector: 'node.person',
      style: {
        'background-opacity': 0,
        'border-width': 0,
        width: 36,
        height: 36,
        label: 'data(label)',
        color: cssVar('--color-text'),
        'font-family': 'Rubik, system-ui, sans-serif',
        'font-size': 11,
        'font-weight': 500,
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'text-wrap': 'ellipsis',
        'text-max-width': '96px',
        'text-background-color': cssVar('--color-bg'),
        'text-background-opacity': 0.8,
        'text-background-padding': '2px',
        'text-background-shape': 'roundrectangle',
        'min-zoomed-font-size': 7,
        'underlay-color': cssVar('--color-primary'),
        'underlay-opacity': 0,
        'underlay-padding': 0,
        'underlay-shape': 'ellipse',
        'transition-property': 'width, height, opacity, underlay-opacity',
        'transition-duration': duration(DURATION.base),
      },
    },
    { selector: 'node.core', style: { 'background-image': 'data(avatar)', 'background-fit': 'cover' } },
    {
      selector: 'node.loose',
      style: {
        display: showLoose ? 'element' : 'none',
        width: 12,
        height: 12,
        'background-color': 'data(color)',
        'background-opacity': 0.75,
        'font-size': 7,
        'min-zoomed-font-size': 10,
        'text-margin-y': 2,
        'text-background-opacity': 0,
      },
    },
    { selector: 'node.loose.hover', style: { width: 16, height: 16 } },
    { selector: 'node.me', style: { width: 50, height: 50, 'font-size': 12, 'font-weight': 700, 'underlay-opacity': 0.18, 'underlay-padding': 5 } },
    { selector: 'node.core.hover', style: { width: 41, height: 41 } },
    { selector: 'node.me.hover', style: { width: 57, height: 57 } },
    { selector: 'node.hub', style: { width: 1, height: 1, opacity: 0, events: 'no', label: '' } },
    { selector: 'edge.layout', style: { opacity: 0, events: 'no', width: 0 } },
    {
      selector: 'edge.relation',
      style: {
        width: 1.5,
        'line-color': cssVar('--color-social'),
        'curve-style': 'bezier',
        opacity: 0.75,
        'transition-property': 'line-color, width, opacity',
        'transition-duration': duration(DURATION.base),
      },
    },
    { selector: 'edge.family', style: { width: 2.5, 'line-color': cssVar('--color-family') } },
    { selector: 'edge[type = "parent"]', style: { 'target-arrow-shape': 'triangle', 'target-arrow-color': cssVar('--color-family'), 'arrow-scale': 0.8 } },
    { selector: 'edge[type = "spouse"]', style: { width: 4 } },
    { selector: 'edge[type = "custom"], edge[type = "relative"], edge[type = "knows"]', style: { 'line-style': 'dashed', 'line-dash-pattern': [6, 4] } },
    { selector: 'edge.hover', style: { opacity: 1, width: 3 } },
    { selector: '.faded', style: { opacity: 0.12 } },
    { selector: 'node.highlight', style: { 'underlay-color': accent, 'underlay-opacity': 0.55, 'underlay-padding': 6, 'z-index': 10 } },
    { selector: 'edge.highlight', style: { 'line-color': accent, 'target-arrow-color': accent, width: 4, opacity: 1, 'z-index': 10 } },
  ];
}

/** Style-only node animation (Cytoscape's typings wrongly demand a position for every animation). */
function animateStyle(node: NodeSingular, style: Record<string, number>, easing: 'ease-in' | 'ease-out'): Promise<unknown> {
  const options = { style, duration: 600, easing } as unknown as Parameters<NodeSingular['animation']>[0];
  return node.animation(options).play().promise();
}

export class GraphView implements View {
  readonly element: HTMLElement;
  private readonly canvas = h('div', { class: 'graph-canvas', role: 'img' });
  private readonly hullPath = document.createElementNS(SVG_NS, 'path');
  private readonly chips = h('div', { class: 'chips graph-chips', role: 'toolbar' });
  private readonly tools = h('div', { class: 'graph-tools' });
  private readonly fabWrap = h('div', { class: 'fab-wrap' });
  private readonly emptyLayer = h('div', { class: 'graph-empty' });
  private readonly coachLayer = h('div', {});
  private readonly a11yList = h('ul', { class: 'list' });
  private readonly a11yNav = h('nav', { class: 'graph-a11y' }, this.a11yList);
  private cyInstance: Core | null = null;
  private layoutNeeded = true;
  private hasLaidOut = false;
  private highlight: Highlight | null = null;
  private fabOpen = false;
  private showLoose = false;
  private haloShown = false;
  private hullFrame = 0;
  private staggerTimers: number[] = [];

  constructor(private readonly ctx: AppContext) {
    const hull = document.createElementNS(SVG_NS, 'svg');
    hull.classList.add('graph-hull');
    hull.setAttribute('aria-hidden', 'true');
    hull.append(this.hullPath);
    this.element = h(
      'section',
      { class: 'view graph-view' },
      this.canvas,
      hull,
      this.a11yNav,
      this.chips,
      this.coachLayer,
      this.emptyLayer,
      this.tools,
      this.fabWrap,
    );
    this.a11yList.addEventListener('keydown', (event) => this.onListKey(event));
    document.addEventListener('pointerdown', (event) => {
      if (this.fabOpen && !this.fabWrap.contains(event.target as Node)) {
        this.setFab(false);
      }
    });
    DARK_SCHEME.addEventListener('change', () => {
      if (this.cyInstance !== null) {
        this.cyInstance.style(stylesheet(this.showLoose));
        this.render();
      }
    });
  }

  /** Cytoscape measures its container when created, so it is created on first render, once attached. */
  private get cy(): Core {
    if (this.cyInstance === null) {
      assert(this.element.isConnected, 'graph view must be attached to the page before rendering');
      const cy = cytoscape({
        container: this.canvas,
        style: stylesheet(this.showLoose),
        minZoom: 0.05,
        maxZoom: 2,
        boxSelectionEnabled: false,
        // 3× phone screens would draw 9× the pixels; 2× is visually identical for this graph and far cheaper.
        pixelRatio: Math.min(window.devicePixelRatio, 2),
      });
      cy.on('tap', 'node.person', (event) => {
        const id = (event.target as NodeSingular).id();
        haptic();
        this.dismissCoach();
        this.show({ kind: 'person', personId: id });
        this.ctx.openPerson(id, 'peek');
      });
      cy.on('tap', (event) => {
        if (event.target === cy && this.highlight !== null) {
          this.show(null);
        }
      });
      cy.on('mouseover', 'node.person', (event) => {
        const node = event.target as NodeSingular;
        node.addClass('hover');
        node.connectedEdges('.relation').addClass('hover');
      });
      cy.on('mouseout', 'node.person', (event) => {
        const node = event.target as NodeSingular;
        node.removeClass('hover');
        node.connectedEdges('.relation').removeClass('hover');
      });
      cy.on('render', () => this.scheduleHull());
      this.cyInstance = cy;
    }
    return this.cyInstance;
  }

  render(): void {
    this.canvas.setAttribute('aria-label', t('graphLabel'));
    this.a11yNav.setAttribute('aria-label', t('graphListLabel'));
    if (this.highlight?.kind === 'group' && !this.ctx.store.groups.has(this.highlight.groupId)) {
      this.highlight = null;
    }
    this.syncElements();
    this.renderChips();
    this.renderTools();
    this.renderFab();
    this.renderEmpty();
    this.renderA11yList();
    this.applyHighlight(false);
    if (this.isVisible() && this.layoutNeeded) {
      this.runLayout(false);
    }
  }

  onShow(): void {
    this.cy.resize();
    if (this.layoutNeeded) {
      this.runLayout(false);
    }
    this.applyHighlight(true);
    this.renderCoach();
    void this.pulseMe();
  }

  show(highlight: Highlight | null): void {
    this.highlight = highlight;
    this.renderChips();
    this.renderTools();
    if (this.isVisible()) {
      this.applyHighlight(true);
    }
  }

  private isVisible(): boolean {
    return !this.element.hidden && this.element.isConnected;
  }

  // ---------- elements & layout ----------

  /** Adds, removes and updates elements in place so positions survive edits; new people start at "me". */
  private syncElements(): void {
    const cy = this.cy;
    const wanted = buildGraphElements(this.ctx.store);
    const wantedIds = new Set(wanted.map((definition) => definition.data.id as string));
    const me = cy.getElementById(this.ctx.store.meId);
    const origin = me.nonempty() ? { ...me.position() } : { x: 0, y: 0 };
    let structureChanged = false;

    cy.batch(() => {
      const stale = cy.elements().filter((element) => !wantedIds.has(element.id()));
      structureChanged = stale.nonempty();
      stale.remove();
      for (const definition of wanted) {
        const existing = cy.getElementById(definition.data.id as string);
        if (existing.empty()) {
          const position = { x: origin.x + Math.random() * 4, y: origin.y + Math.random() * 4 };
          cy.add(definition.group === 'nodes' ? { ...definition, position } : definition);
          structureChanged = true;
        } else {
          // Only touch what changed: rewriting data marks the node dirty and Cytoscape restyles it.
          const changed = Object.entries(definition.data).some(([key, value]) => existing.data(key) !== value);
          if (changed) existing.data(definition.data);
          const classes = String(definition.classes);
          if (existing.hasClass('loose') !== classes.includes('loose')) {
            existing.classes(classes); // became connected (or lost its last link): it moves between spiral and core
            structureChanged = true;
          }
        }
      }
    });
    this.layoutNeeded ||= structureChanged;
  }

  /**
   * Force layout (fcose) runs on the connected core only — its cost grows with the square of the node count.
   * Loose people then go into a sunflower spiral around the core in linear time.
   */
  private runLayout(force: boolean): void {
    if (!force && !this.layoutNeeded) {
      return;
    }
    this.layoutNeeded = false;
    const cy = this.cy;
    const firstTime = !this.hasLaidOut;
    this.hasLaidOut = true;
    const core = cy.elements().difference(cy.nodes('.loose'));
    const large = core.nodes('.person').length > LARGE_CORE;
    const layout = core.layout({
      name: 'fcose',
      quality: large ? 'draft' : 'default',
      randomize: firstTime || force,
      animate: !firstTime && !large && !prefersReducedMotion(),
      animationDuration: DURATION.slow,
      animationEasing: 'ease-out',
      fit: false,
      packComponents: false,
      nodeDimensionsIncludeLabels: false,
      idealEdgeLength: (edge: EdgeSingular) => (edge.hasClass('anchor') ? 170 : edge.hasClass('member') ? 45 : 85),
      edgeElasticity: (edge: EdgeSingular) => (edge.hasClass('member') ? 0.8 : 0.45),
      nodeRepulsion: (node: NodeSingular) => (node.hasClass('hub') ? 800 : 7000),
      numIter: large ? 1000 : 2500,
    } as cytoscape.LayoutOptions);
    void layout.promiseOn('layoutstop').then(() => {
      this.placeLooseNodes();
      if (firstTime || force) {
        this.fitStart();
      } else if (this.highlight === null && !this.isInView(this.cy.nodes('.core'))) {
        // The connected part grew past the screen (e.g. right after accepting suggestions): bring it back into view.
        this.cy.animate({ fit: { eles: this.cy.nodes('.core'), padding: 48 }, duration: duration(DURATION.slow), easing: 'ease-out' });
      }
    });
    layout.run();
  }

  /** Golden-angle spiral: evenly spaced dots, deterministic order (by name), O(n). */
  private placeLooseNodes(): void {
    const cy = this.cy;
    const loose = cy.nodes('.loose').sort((a, b) => String(a.data('label')).localeCompare(String(b.data('label'))));
    if (loose.empty()) return;
    const box = cy.nodes('.core').boundingBox();
    const centerX = (box.x1 + box.x2) / 2;
    const centerY = (box.y1 + box.y2) / 2;
    const innerRadius = Math.max(box.w, box.h) / 2 + 70;
    loose.positions((_node, i) => {
      const radius = innerRadius + SPIRAL_SPACING * Math.sqrt(i);
      const angle = i * GOLDEN_ANGLE;
      return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) };
    });
  }

  private isInView(elements: NodeCollection): boolean {
    const view = this.cy.extent();
    const box = elements.boundingBox();
    return box.x1 >= view.x1 && box.x2 <= view.x2 && box.y1 >= view.y1 && box.y2 <= view.y2;
  }

  /** Opens on the connected people (the interesting part); with almost no one connected, shows everyone. */
  private fitStart(): void {
    const core = this.cy.nodes('.core');
    this.cy.fit(core.length >= MIN_CORE_TO_FOCUS || !this.showLoose ? core : this.cy.nodes('.person'), 48);
  }

  // ---------- chrome ----------

  private renderChips(): void {
    const store = this.ctx.store;
    const activeGroupId = this.highlight?.kind === 'group' ? this.highlight.groupId : null;
    const groups = [...store.groups.values()].filter((group) => [...store.people.values()].some((p) => p.groupIds.includes(group.id)));
    const chip = (content: (Node | string)[], pressed: boolean, onclick: () => void): HTMLElement =>
      h('button', { class: 'chip', 'aria-pressed': String(pressed), onclick }, ...content);
    const looseCount = [...store.people.values()].filter((person) => isLoose(store, person)).length;
    replaceChildren(
      this.chips,
      looseCount === 0
        ? null
        : chip([this.showLoose ? t('hideLoose') : t('showLoose', { count: looseCount })], this.showLoose, () => this.setShowLoose(!this.showLoose)),
      ...(groups.length === 0
        ? []
        : [
            chip([t('allPeople')], activeGroupId === null, () => this.show(null)),
            ...groups.map((group) =>
              chip(
                [h('span', { class: 'chip-dot', style: `background:${group.color}` }), group.name],
                activeGroupId === group.id,
                () => this.show({ kind: 'group', groupId: group.id }),
              ),
            ),
          ]),
    );
  }

  private setShowLoose(show: boolean): void {
    this.showLoose = show;
    this.cy.style(stylesheet(show));
    this.renderChips();
    this.renderEmpty();
    const visible = this.cy.nodes(show ? '.person' : '.core');
    this.cy.animate({ fit: { eles: visible, padding: 48 }, duration: duration(DURATION.slow), easing: 'ease-out' });
  }

  private renderTools(): void {
    replaceChildren(
      this.tools,
      h('button', { class: 'btn btn-icon', 'aria-label': t('fitGraph'), onclick: () => this.fitAll() }, icon('fit')),
      h('button', { class: 'btn btn-icon', 'aria-label': t('rearrange'), onclick: () => this.runLayout(true) }, icon('shuffle')),
      this.highlight === null ? null : h('button', { class: 'btn', onclick: () => this.show(null) }, t('clearHighlight')),
    );
  }

  private renderFab(): void {
    const menuId = 'fab-menu';
    const item = (label: string, run: () => void): HTMLElement =>
      h(
        'li',
        {},
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              this.setFab(false);
              run();
            },
          },
          label,
        ),
      );
    replaceChildren(
      this.fabWrap,
      this.fabOpen
        ? h(
            'ul',
            { class: 'fab-menu', id: menuId, 'aria-label': t('quickActions') },
            item(t('addPerson'), () => void this.ctx.addPerson()),
            item(t('importContacts'), () => this.ctx.openImport()),
            item(t('newGroup'), () => void this.ctx.createGroup()),
          )
        : null,
      h(
        'button',
        {
          class: 'fab',
          'aria-label': t('quickActions'),
          'aria-expanded': String(this.fabOpen),
          'aria-controls': menuId,
          onclick: () => this.setFab(!this.fabOpen),
          onkeydown: (event: Event) => {
            if ((event as KeyboardEvent).key === 'Escape') this.setFab(false);
          },
        },
        '+',
      ),
    );
  }

  private setFab(open: boolean): void {
    if (this.fabOpen === open) return;
    this.fabOpen = open;
    this.renderFab();
  }

  /**
   * Two empty states: nobody at all yet, or many people but none connected
   * (typical right after a big import) — each with the one next step that helps.
   */
  private renderEmpty(): void {
    const store = this.ctx.store;
    const others = store.people.size - 1;
    const noOne = others === 0;
    const noneConnected =
      !noOne && !this.showLoose && [...store.people.values()].every((person) => person.id === store.meId || isLoose(store, person));
    this.emptyLayer.hidden = !noOne && !noneConnected;
    const actions = noOne
      ? [
          h('button', { class: 'btn btn-primary', onclick: () => this.ctx.openImport() }, t('importContacts')),
          h('button', { class: 'btn', onclick: () => void this.ctx.addPerson() }, t('addPerson')),
        ]
      : [
          store.suggestions.size > 0
            ? h('button', { class: 'btn btn-primary', onclick: () => this.ctx.openSuggestions() }, t('suggestionsCount', { count: store.suggestions.size }))
            : null,
          h('button', { class: 'btn', onclick: () => this.setShowLoose(true) }, t('showLoose', { count: others })),
        ];
    replaceChildren(
      this.emptyLayer,
      this.emptyLayer.hidden
        ? null
        : h(
            'div',
            { class: 'empty' },
            networkIllustration(),
            h('h2', {}, noOne ? t('emptyGraphTitle') : t('noneConnectedTitle', { count: others })),
            h('p', {}, noOne ? t('emptyGraphBody') : t('noneConnectedBody')),
            h('div', { class: 'row', style: 'justify-content:center' }, ...actions),
          ),
    );
  }

  private renderCoach(): void {
    const show = this.ctx.store.people.size >= 2 && window.localStorage.getItem(COACH_KEY) !== '1';
    replaceChildren(
      this.coachLayer,
      show
        ? h(
            'div',
            { class: 'coach', role: 'status' },
            h('span', { class: 'grow' }, t('coachTapPerson')),
            h('button', { class: 'btn', onclick: () => this.dismissCoach() }, t('gotIt')),
          )
        : null,
    );
  }

  private dismissCoach(): void {
    window.localStorage.setItem(COACH_KEY, '1');
    this.coachLayer.replaceChildren();
  }

  /** Keyboard / screen-reader twin of the canvas. */
  private renderA11yList(): void {
    const store = this.ctx.store;
    const index = store.index;
    replaceChildren(
      this.a11yList,
      ...store.peopleSorted().map((person) => {
        const relation = relationToMeText(store, person);
        return h(
          'li',
          {},
          h(
            'button',
            {
              class: 'list-row',
              'data-person': person.id,
              onclick: () => {
                this.show({ kind: 'person', personId: person.id });
                this.ctx.openPerson(person.id);
              },
            },
            t('graphPersonSummary', { name: person.name, relation: relation === '' ? '' : `${relation},`, count: index.degree(person.id) }),
          ),
        );
      }),
    );
  }

  /** ↑/↓ move through people, →/← jump to their first connection. Enter is the button's own click. */
  private onListKey(event: KeyboardEvent): void {
    const current = (event.target as HTMLElement).closest<HTMLElement>('[data-person]');
    if (current === null) return;
    const buttons = [...this.a11yList.querySelectorAll<HTMLElement>('[data-person]')];
    const position = buttons.indexOf(current);
    let next: HTMLElement | undefined;
    if (event.key === 'ArrowDown') next = buttons[position + 1];
    if (event.key === 'ArrowUp') next = buttons[position - 1];
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const neighbor = this.ctx.store.index.neighbors(current.dataset['person'] as string)[0];
      next = neighbor === undefined ? undefined : buttons.find((button) => button.dataset['person'] === neighbor.personId);
    }
    if (next !== undefined) {
      event.preventDefault();
      next.focus();
    }
  }

  // ---------- highlight, hull, camera ----------

  private fitAll(): void {
    this.cy.animate({ fit: { eles: this.cy.nodes(this.showLoose ? '.person' : '.core'), padding: 48 }, duration: duration(DURATION.slow), easing: 'ease-out' });
  }

  private groupMembers(groupId: string): NodeCollection {
    const store = this.ctx.store;
    return this.cy.nodes('.person').filter((node) => store.people.has(node.id()) && store.person(node.id()).groupIds.includes(groupId)) as NodeCollection;
  }

  private applyHighlight(moveCamera: boolean): void {
    const cy = this.cy;
    this.staggerTimers.forEach((timer) => window.clearTimeout(timer));
    this.staggerTimers = [];
    cy.elements('.faded, .highlight').removeClass('faded highlight');

    const highlight = this.highlight;
    let focus: Collection = cy.collection();
    let ordered: Collection[] = [];
    if (highlight?.kind === 'path') {
      ordered = highlight.path.personIds.flatMap((id, i) => {
        const relation = highlight.path.relations[i];
        return relation === undefined ? [cy.getElementById(id)] : [cy.getElementById(id), cy.getElementById(relation.id)];
      });
      focus = ordered.reduce((all, element) => all.union(element), cy.collection());
    } else if (highlight?.kind === 'group') {
      const members = this.groupMembers(highlight.groupId);
      focus = members.union(members.edgesWith(members).filter('.relation'));
    } else if (highlight?.kind === 'person') {
      focus = cy
        .getElementById(highlight.personId)
        .closedNeighborhood()
        .filter((element) => element.hasClass('person') || element.hasClass('relation'));
    }

    if (focus.nonempty()) {
      cy.elements('.person, .relation').difference(focus).addClass('faded');
      if (highlight?.kind === 'path' && !prefersReducedMotion()) {
        ordered.forEach((element, i) => this.staggerTimers.push(window.setTimeout(() => element.addClass('highlight'), i * PATH_STAGGER_MS)));
      } else if (highlight?.kind !== 'group') {
        focus.addClass('highlight');
      }
      if (moveCamera) {
        cy.animate({ fit: { eles: focus, padding: 72 }, duration: duration(DURATION.slow), easing: 'ease-out' });
      }
    }
    this.scheduleHull();
  }

  private scheduleHull(): void {
    if (this.hullFrame !== 0) return;
    this.hullFrame = window.requestAnimationFrame(() => {
      this.hullFrame = 0;
      this.drawHull();
    });
  }

  /** Soft tinted blob around the selected group's members: a thick rounded stroke over their convex hull. */
  private drawHull(): void {
    const highlight = this.highlight;
    if (highlight?.kind !== 'group' || this.cyInstance === null) {
      this.hullPath.setAttribute('d', '');
      return;
    }
    const color = this.ctx.store.group(highlight.groupId).color;
    const hull = convexHull(this.groupMembers(highlight.groupId).map((node) => node.renderedPosition()));
    const width = Math.min(90, Math.max(36, 64 * this.cyInstance.zoom()));
    this.hullPath.setAttribute('d', hull.length === 0 ? '' : `M${hull.map((p) => `${p.x} ${p.y}`).join(' L')} Z`);
    // Opaque fill + stroke, faded as one layer (.graph-hull opacity) so the overlap has no darker band.
    this.hullPath.setAttribute('fill', color);
    this.hullPath.setAttribute('stroke', color);
    this.hullPath.setAttribute('stroke-width', String(width));
  }

  /** A soft pulse around "me" the first time the graph is shown. */
  private async pulseMe(): Promise<void> {
    if (this.haloShown || prefersReducedMotion() || this.ctx.store.people.size <= 1) return;
    this.haloShown = true;
    const me = this.cy.getElementById(this.ctx.store.meId);
    for (let i = 0; i < 2; i++) {
      await animateStyle(me, { 'underlay-opacity': 0.45, 'underlay-padding': 16 }, 'ease-out');
      await animateStyle(me, { 'underlay-opacity': 0.18, 'underlay-padding': 5 }, 'ease-in');
    }
  }
}

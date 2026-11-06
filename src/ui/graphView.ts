import cytoscape, { type Core, type EdgeSingular, type NodeSingular, type StylesheetJson } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { t } from '../i18n/i18n';
import { assert } from '../model/assert';
import { normalizeName } from '../model/identity';
import type { AppContext, Highlight, View } from './context';
import { h, replaceChildren } from './dom';
import { buildGraphElements, MAX_PIE_SLICES } from './graphElements';

cytoscape.use(fcose);

const DARK_SCHEME = window.matchMedia('(prefers-color-scheme: dark)');

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function pieStyle(): Record<string, string> {
  const style: Record<string, string> = { 'pie-size': '100%' };
  for (let slice = 1; slice <= MAX_PIE_SLICES; slice++) {
    style[`pie-${slice}-background-color`] = `data(pie${slice}Color)`;
    style[`pie-${slice}-background-size`] = `data(pie${slice}Size)`;
  }
  return style;
}

function stylesheet(): StylesheetJson {
  const text = cssVar('--text');
  const surface = cssVar('--bg');
  const accent = cssVar('--accent');
  const highlight = cssVar('--highlight');
  return [
    {
      selector: 'node.person',
      style: {
        'background-color': cssVar('--node'),
        label: 'data(label)',
        color: text,
        'font-size': 11,
        'text-valign': 'bottom',
        'text-margin-y': 3,
        'text-wrap': 'ellipsis',
        'text-max-width': '90px',
        'text-background-color': surface,
        'text-background-opacity': 0.75,
        'text-background-padding': '1px',
        'min-zoomed-font-size': 7,
        width: 20,
        height: 20,
      },
    },
    { selector: 'node.person[groupCount > 0]', style: pieStyle() },
    { selector: 'node.me', style: { width: 34, height: 34, 'border-width': 3, 'border-color': accent, 'font-weight': 'bold' } },
    { selector: 'node.hub', style: { width: 1, height: 1, opacity: 0, events: 'no', label: '' } },
    { selector: 'edge.layout', style: { opacity: 0, events: 'no', width: 0 } },
    { selector: 'edge.relation', style: { width: 1.5, 'line-color': cssVar('--social'), 'curve-style': 'bezier' } },
    { selector: 'edge.family', style: { width: 2.5, 'line-color': cssVar('--family') } },
    {
      selector: 'edge[type = "parent"]',
      style: { 'target-arrow-shape': 'triangle', 'target-arrow-color': cssVar('--family'), 'arrow-scale': 0.9 },
    },
    { selector: 'edge[type = "spouse"]', style: { width: 4.5 } },
    { selector: 'edge[type = "custom"], edge[type = "relative"]', style: { 'line-style': 'dashed' } },
    { selector: '.faded', style: { opacity: 0.12 } },
    { selector: 'node.match', style: { 'border-width': 3, 'border-color': highlight } },
    { selector: 'node.highlight', style: { 'border-width': 4, 'border-color': highlight, 'z-index': 10 } },
    { selector: 'edge.highlight', style: { 'line-color': highlight, 'target-arrow-color': highlight, width: 4, 'z-index': 10 } },
  ];
}

export class GraphView implements View {
  readonly element: HTMLElement;
  private readonly canvas: HTMLElement;
  private cyInstance: Core | null = null;
  private readonly chips: HTMLElement;
  private readonly emptyMessage: HTMLElement;
  private readonly clearButton: HTMLButtonElement;
  private layoutNeeded = true;
  private hasLaidOut = false;
  private highlight: Highlight | null = null;
  private query = '';

  constructor(private readonly ctx: AppContext) {
    this.canvas = h('div', { class: 'graph-canvas' });
    this.chips = h('div', { class: 'chips' });
    this.emptyMessage = h('p', { class: 'graph-empty' });
    this.clearButton = h('button', { class: 'chip', onclick: () => this.show(null) });
    this.element = h(
      'section',
      { class: 'view graph-view' },
      this.canvas,
      this.chips,
      this.emptyMessage,
      h(
        'div',
        { class: 'graph-tools' },
        this.clearButton,
        h('button', { class: 'chip', onclick: () => this.runLayout(true) }, '⟳'),
        h('button', { class: 'chip', onclick: () => this.cy.animate({ fit: { eles: this.cy.nodes('.person'), padding: 30 } }) }, '⤢'),
      ),
    );
  }

  /**
   * Cytoscape measures its container when created, so it is created on first use,
   * once the view is in the page (a detached container measures as NaN and crashes layouts).
   */
  private get cy(): Core {
    if (this.cyInstance === null) {
      assert(this.element.isConnected, 'graph view must be attached to the page before rendering');
      const cy = cytoscape({ container: this.canvas, style: stylesheet(), minZoom: 0.05, maxZoom: 2, boxSelectionEnabled: false });
      cy.on('tap', 'node.person', (event) => this.ctx.openPerson((event.target as NodeSingular).id()));
      cy.on('tap', (event) => {
        if (event.target === cy && this.highlight !== null) {
          this.show(null);
        }
      });
      DARK_SCHEME.addEventListener('change', () => cy.style(stylesheet()));
      this.cyInstance = cy;
    }
    return this.cyInstance;
  }

  render(): void {
    this.syncElements();
    this.renderChips();
    this.applyHighlight(false);
    const isEmpty = this.ctx.store.people.size <= 1;
    this.emptyMessage.textContent = isEmpty ? t('emptyGraph') : '';
    this.clearButton.textContent = t('clearHighlight');
    this.clearButton.hidden = this.highlight === null;
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
  }

  setQuery(query: string): void {
    this.query = normalizeName(query);
    this.applyHighlight(false);
  }

  show(highlight: Highlight | null): void {
    this.highlight = highlight;
    this.clearButton.hidden = highlight === null;
    this.renderChips();
    if (this.isVisible()) {
      this.applyHighlight(true);
    }
  }

  private isVisible(): boolean {
    return !this.element.hidden && this.element.isConnected;
  }

  /** Adds, removes and updates elements in place so positions survive edits. */
  private syncElements(): void {
    const wanted = buildGraphElements(this.ctx.store);
    const wantedIds = new Set(wanted.map((definition) => definition.data.id as string));
    let structureChanged = false;

    this.cy.batch(() => {
      const stale = this.cy.elements().filter((element) => !wantedIds.has(element.id()));
      structureChanged = stale.nonempty();
      stale.remove();
      for (const definition of wanted) {
        const existing = this.cy.getElementById(definition.data.id as string);
        if (existing.empty()) {
          this.cy.add(definition);
          structureChanged = true;
        } else {
          existing.data(definition.data);
        }
      }
    });
    this.layoutNeeded ||= structureChanged;
  }

  private runLayout(force: boolean): void {
    if (!force && !this.layoutNeeded) {
      return;
    }
    this.layoutNeeded = false;
    const firstTime = !this.hasLaidOut;
    this.hasLaidOut = true;
    this.cy
      .layout({
        name: 'fcose',
        quality: 'default',
        randomize: firstTime || force,
        animate: !firstTime,
        animationDuration: 450,
        fit: true,
        padding: 30,
        packComponents: false,
        nodeDimensionsIncludeLabels: false,
        idealEdgeLength: (edge: EdgeSingular) => (edge.hasClass('anchor') ? 170 : edge.hasClass('member') ? 45 : 80),
        edgeElasticity: (edge: EdgeSingular) => (edge.hasClass('member') ? 0.8 : 0.45),
        nodeRepulsion: (node: NodeSingular) => (node.hasClass('hub') ? 800 : 6500),
        numIter: 2500,
      } as cytoscape.LayoutOptions)
      .run();
  }

  private renderChips(): void {
    const activeGroupId = this.highlight?.kind === 'group' ? this.highlight.groupId : null;
    const groups = [...this.ctx.store.groups.values()].filter((group) =>
      [...this.ctx.store.people.values()].some((person) => person.groupIds.includes(group.id)),
    );
    replaceChildren(
      this.chips,
      ...(groups.length === 0
        ? []
        : [
            h('button', { class: `chip ${activeGroupId === null ? 'active' : ''}`, onclick: () => this.show(null) }, t('allPeople')),
            ...groups.map((group) =>
              h(
                'button',
                {
                  class: `chip ${activeGroupId === group.id ? 'active' : ''}`,
                  onclick: () => this.show({ kind: 'group', groupId: group.id }),
                },
                h('span', { class: 'dot', style: `background:${group.color}` }),
                group.name,
              ),
            ),
          ]),
    );
  }

  private applyHighlight(moveCamera: boolean): void {
    const cy = this.cy;
    const people = cy.nodes('.person');
    const relations = cy.edges('.relation');
    cy.elements().removeClass('faded highlight match');

    let focus = cy.collection();
    const highlight = this.highlight;
    if (highlight?.kind === 'path') {
      const ids = [...highlight.path.personIds, ...highlight.path.relations.map((relation) => relation.id)];
      focus = ids.reduce((collection, id) => collection.union(cy.getElementById(id)), cy.collection());
    } else if (highlight?.kind === 'group') {
      const members = people.filter((node) => this.ctx.store.person(node.id()).groupIds.includes(highlight.groupId));
      focus = members.union(members.edgesWith(members).filter('.relation'));
    } else if (highlight?.kind === 'person') {
      const node = cy.getElementById(highlight.personId);
      focus = node.closedNeighborhood().filter((element) => element.hasClass('person') || element.hasClass('relation'));
    }

    if (this.query !== '') {
      const matches = people.filter((node) => normalizeName(node.data('label') as string).includes(this.query));
      matches.addClass('match');
      if (focus.empty()) {
        focus = matches;
      }
    }

    if (focus.nonempty()) {
      people.union(relations).difference(focus).addClass('faded');
      focus.addClass('highlight');
      if (moveCamera) {
        cy.animate({ fit: { eles: focus, padding: 60 }, duration: 400 });
      }
    }
  }
}

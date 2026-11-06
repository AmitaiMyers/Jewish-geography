import type { ElementDefinition } from 'cytoscape';
import { isFamilyType } from '../model/types';
import type { AppStore } from '../store/appStore';
import { groupColors } from './context';

/**
 * Converts the store into Cytoscape elements.
 *
 * Besides people and relations it adds invisible layout helpers:
 *  - one hidden "hub" per group, tied to every member, so groups gather into clusters;
 *  - hidden "anchor" links from me to each hub and to unconnected people,
 *    so the whole picture stays one compact component around me.
 */

export const MAX_PIE_SLICES = 6;

export const hubId = (groupId: string): string => `hub:${groupId}`;

export function buildGraphElements(store: AppStore): ElementDefinition[] {
  const meId = store.meId;
  const index = store.index;
  const elements: ElementDefinition[] = [];

  for (const person of store.people.values()) {
    const colors = groupColors(store, person).slice(0, MAX_PIE_SLICES);
    const pie: Record<string, string | number> = {};
    for (let slice = 1; slice <= MAX_PIE_SLICES; slice++) {
      pie[`pie${slice}Color`] = colors[slice - 1] ?? '#000000';
      pie[`pie${slice}Size`] = slice <= colors.length ? 100 / colors.length : 0;
    }
    elements.push({
      group: 'nodes',
      data: { id: person.id, label: person.name, groupCount: colors.length, ...pie },
      classes: person.id === meId ? 'person me' : 'person',
    });
    if (person.id !== meId && person.groupIds.length === 0 && index.degree(person.id) === 0) {
      elements.push(layoutEdge(`anchor:${person.id}`, meId, person.id, 'anchor'));
    }
  }

  for (const relation of store.relations.values()) {
    elements.push({
      group: 'edges',
      data: { id: relation.id, source: relation.from, target: relation.to, type: relation.type },
      classes: isFamilyType(relation.type) ? 'relation family' : 'relation social',
    });
  }

  for (const group of store.groups.values()) {
    const members = [...store.people.values()].filter((person) => person.groupIds.includes(group.id));
    if (members.length === 0) {
      continue;
    }
    elements.push({ group: 'nodes', data: { id: hubId(group.id) }, classes: 'hub' });
    elements.push(layoutEdge(`anchor:${group.id}`, meId, hubId(group.id), 'anchor'));
    for (const member of members) {
      elements.push(layoutEdge(`member:${group.id}:${member.id}`, hubId(group.id), member.id, 'member'));
    }
  }
  return elements;
}

function layoutEdge(id: string, source: string, target: string, kind: 'anchor' | 'member'): ElementDefinition {
  return { group: 'edges', data: { id, source, target }, classes: `layout ${kind}` };
}

import type { ElementDefinition } from 'cytoscape';
import { isFamilyType, type Person } from '../model/types';
import type { AppStore } from '../store/appStore';
import { avatarDataUri, currentTheme, hueFor } from './avatar';
import { groupColors } from './context';

/**
 * Converts the store into Cytoscape elements.
 *
 * "Core" people (me, anyone with a link or a group) are drawn as avatar images and laid out by force.
 * "Loose" people — imported contacts not linked to anyone yet, often the large majority — are light
 * dots without images, placed in a cheap spiral around the core, so 1,500+ contacts stay fast.
 * Invisible layout helpers keep the core readable: one hidden "hub" per group tied to its members
 * (groups gather into clusters), and hidden "anchor" links from me to each hub.
 */

export const hubId = (groupId: string): string => `hub:${groupId}`;

export function isLoose(store: AppStore, person: Person): boolean {
  return person.id !== store.meId && person.groupIds.length === 0 && store.index.degree(person.id) === 0;
}

export function buildGraphElements(store: AppStore): ElementDefinition[] {
  const meId = store.meId;
  const theme = currentTheme();
  const elements: ElementDefinition[] = [];

  for (const person of store.people.values()) {
    if (isLoose(store, person)) {
      elements.push({
        group: 'nodes',
        data: { id: person.id, label: person.name, color: `hsl(${hueFor(person.name)} 45% 60%)` },
        classes: 'person loose',
      });
    } else {
      elements.push({
        group: 'nodes',
        data: { id: person.id, label: person.name, avatar: avatarDataUri(person.name, groupColors(store, person), theme) },
        classes: person.id === meId ? 'person core me' : 'person core',
      });
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

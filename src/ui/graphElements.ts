import type { ElementDefinition } from 'cytoscape';
import { isFamilyType, type Person } from '../model/types';
import type { AppStore } from '../store/appStore';
import { avatarColors, avatarDataUri, currentTheme, hueFor } from './avatar';
import { groupColors } from './context';

/**
 * Converts the store into Cytoscape elements.
 *
 * "Core" people (me, anyone with a link or a group) are drawn as avatar images and laid out by force.
 * "Loose" people — imported contacts not linked to anyone yet, often the large majority — are light
 * dots without images, placed in a cheap spiral around the core, so 1,500+ contacts stay fast.
 * Invisible layout helpers keep the core readable: one hidden "hub" per group tied to its members
 * (groups gather into clusters), and hidden "anchor" links from me to each hub and to linked people
 * outside any group.
 */

export const hubId = (groupId: string): string => `hub:${groupId}`;

export function isLoose(store: AppStore, person: Person): boolean {
  return person.id !== store.meId && person.groupIds.length === 0 && store.index.degree(person.id) === 0;
}

/** Above this many connected people nodes are plain coloured circles: decoding hundreds of avatar images freezes phones. */
export const LARGE_CORE = 150;

export function buildGraphElements(store: AppStore): ElementDefinition[] {
  const meId = store.meId;
  const theme = currentTheme();
  const elements: ElementDefinition[] = [];
  const people = [...store.people.values()];
  const loose = new Set(people.filter((person) => isLoose(store, person)).map((person) => person.id));
  const lite = people.length - loose.size > LARGE_CORE;

  for (const person of people) {
    if (loose.has(person.id)) {
      elements.push({
        group: 'nodes',
        data: { id: person.id, label: person.name, color: `hsl(${hueFor(person.name)}, 45%, 60%)` },
        classes: 'person loose',
      });
    } else {
      const colors = groupColors(store, person);
      const data = lite
        ? { id: person.id, label: person.name, color: avatarColors(person.name, theme).background, ring: colors[0] ?? avatarColors(person.name, theme).foreground }
        : { id: person.id, label: person.name, avatar: avatarDataUri(person.name, colors, theme) };
      elements.push({
        group: 'nodes',
        data,
        classes: `person core ${lite ? 'lite' : 'rich'}${person.id === meId ? ' me' : ''}`,
      });
      // Linked people outside any group (family, friends) are tied to me, so no little island drifts away.
      if (person.id !== meId && person.groupIds.length === 0) {
        elements.push(layoutEdge(`anchor:${person.id}`, meId, person.id, 'anchor'));
      }
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
  // Every node before any edge: Cytoscape rejects an edge whose end is not added yet, and people come
  // back from storage sorted by id, so "me" is not necessarily first.
  return [...elements.filter((element) => element.group === 'nodes'), ...elements.filter((element) => element.group === 'edges')];
}

function layoutEdge(id: string, source: string, target: string, kind: 'anchor' | 'member'): ElementDefinition {
  return { group: 'edges', data: { id, source, target }, classes: `layout ${kind}` };
}

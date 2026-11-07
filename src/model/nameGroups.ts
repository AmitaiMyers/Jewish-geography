import { detectLabels, isServiceName, nameWords } from '../importers/labels';
import { isPetOwner, petNames } from '../importers/nameHints';
import { newId } from './assert';
import { nextGroupColor } from './groupColors';
import { normalizeName } from './identity';
import type { Group, Person } from './types';

/**
 * Groups people by what their names say about them:
 *  - a label shared by enough contacts ("מדמ"ח", "אלתא", "תגלית") becomes a group of those contacts;
 *  - service contacts (taxi, delivery, clinic…) go into one services group;
 *  - names with a heart ("מיקה ❤️", "אהוב שלי") go into a "❤️" group of close people;
 *  - dog owners ("שיר אמא של מנטה 🐶") go into a "🐶" group.
 * Existing groups with the same name are reused, so importing again does not duplicate them.
 * Pure: returns what to create/update; the store writes it.
 */

/** Hearts or "my love" in a name mark someone close — a group, not a partner link (several can have hearts). */
const CLOSE_PEOPLE = /[\u2764\u2665\u{1F495}\u{1F496}\u{1F497}\u{1F498}\u{1F49E}\u{1F60D}\u{1F970}]|אהוב שלי|אהובה שלי/u;
const CLOSE_GROUP_NAME = '❤️';
const PET_GROUP_NAME = '🐶';

export interface NameGroupPlan {
  newGroups: Group[];
  /** People whose groupIds changed, by id. */
  updatedPeople: Map<string, Person>;
}

export function planNameGroups(people: readonly Person[], existingGroups: readonly Group[], meId: string, servicesGroupName: string): NameGroupPlan {
  const others = people.filter((person) => person.id !== meId);
  const services = others.filter((person) => isServiceName(person.name));
  const serviceIds = new Set(services.map((person) => person.id));
  const labelled = others.filter((person) => !serviceIds.has(person.id));
  const words = new Map(labelled.map((person) => [person.id, ` ${nameWords(person.name).join(' ')} `]));

  const newGroups: Group[] = [];
  const updatedPeople = new Map<string, Person>();
  const byName = new Map(existingGroups.map((group) => [normalizeName(group.name), group]));

  const ensureGroup = (name: string): Group => {
    const existing = byName.get(normalizeName(name));
    if (existing !== undefined) return existing;
    const usedColors = [...existingGroups, ...newGroups].map((group) => group.color);
    const group: Group = { id: newId(), name, color: nextGroupColor(usedColors) };
    newGroups.push(group);
    byName.set(normalizeName(name), group);
    return group;
  };
  const addTo = (person: Person, group: Group): void => {
    const current = updatedPeople.get(person.id) ?? person;
    if (!current.groupIds.includes(group.id)) {
      updatedPeople.set(person.id, { ...current, groupIds: [...current.groupIds, group.id] });
    }
  };

  for (const label of detectLabels(labelled.map((person) => person.name))) {
    const group = ensureGroup(label.display);
    labelled.filter((person) => (words.get(person.id) as string).includes(` ${label.key} `)).forEach((person) => addTo(person, group));
  }
  if (services.length > 0) {
    const group = ensureGroup(servicesGroupName);
    services.forEach((person) => addTo(person, group));
  }
  const pets = petNames(people.map((person) => person.name));
  const petOwners = others.filter((person) => isPetOwner(person.name, pets));
  if (petOwners.length > 0) {
    const group = ensureGroup(PET_GROUP_NAME);
    petOwners.forEach((person) => addTo(person, group));
  }
  const close = labelled.filter((person) => CLOSE_PEOPLE.test(person.name));
  if (close.length > 0) {
    const group = ensureGroup(CLOSE_GROUP_NAME);
    close.forEach((person) => addTo(person, group));
  }
  return { newGroups, updatedPeople };
}

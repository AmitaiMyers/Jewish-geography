import type { IDBPDatabase } from 'idb';
import { GraphIndex } from '../graph/graphIndex';
import { classifyWalk, familyWalksFrom, type Kinship } from '../graph/kinship';
import { suggestionsFromName } from '../importers/nameHints';
import type { RawContact } from '../importers/rawContact';
import { assert, newId, required } from '../model/assert';
import { nextGroupColor } from '../model/groupColors';
import { relationProblem } from '../model/relationRules';
import type { Gender, Group, Language, Person, PersonSource, Relation, RelationType, Settings, Suggestion } from '../model/types';
import { DATA_STORES, openDatabase, type GeographyDB } from './db';
import { parseBackup, type Backup } from './backup';

/**
 * Single source of truth. Holds everything in memory, writes through to IndexedDB,
 * and notifies the UI after every change. Derived data (graph index, everyone's
 * relation to me) is computed lazily once per change.
 */

export interface PersonDraft {
  name: string;
  gender: Gender;
  phones: string[];
  emails: string[];
  groupIds: string[];
  notes: string;
  source: PersonSource;
}

export interface RelationDraft {
  from: string;
  to: string;
  type: RelationType;
  label: string;
}

/** Everything one delete removed, so the toast's Undo can put it back exactly. */
export interface Snapshot {
  people: Person[];
  relations: Relation[];
  groups: Group[];
  suggestions: Suggestion[];
}

const EMPTY_SNAPSHOT: Snapshot = { people: [], relations: [], groups: [], suggestions: [] };

export interface Comparison {
  /** My existing node for the friend, or null to create `newFriend`. */
  friendId: string | null;
  newFriend: { name: string; phones: string[]; emails: string[] };
  relationType: RelationType;
  label: string;
  commonIds: string[];
}

type Listener = () => void;

export class AppStore {
  readonly people = new Map<string, Person>();
  readonly relations = new Map<string, Relation>();
  readonly groups = new Map<string, Group>();
  readonly suggestions = new Map<string, Suggestion>();
  private currentSettings: Settings | null = null;

  private readonly listeners = new Set<Listener>();
  private cachedIndex: GraphIndex | null = null;
  private cachedKinshipToMe: Map<string, Kinship> | null = null;

  private constructor(private readonly db: IDBPDatabase<GeographyDB>) {}

  static async load(): Promise<AppStore> {
    const store = new AppStore(await openDatabase());
    const [people, relations, groups, suggestions, settings] = await Promise.all([
      store.db.getAll('people'),
      store.db.getAll('relations'),
      store.db.getAll('groups'),
      store.db.getAll('suggestions'),
      store.db.get('settings', 'settings'),
    ]);
    store.fillMemory({ people, relations, groups, suggestions, settings: settings ?? null });
    return store;
  }

  // ---------- reading ----------

  get isOnboarded(): boolean {
    return this.currentSettings !== null;
  }

  get settings(): Settings {
    return required(this.currentSettings, 'settings (finish onboarding first)');
  }

  get meId(): string {
    return this.settings.meId;
  }

  person(id: string): Person {
    return required(this.people.get(id), `person ${id}`);
  }

  group(id: string): Group {
    return required(this.groups.get(id), `group ${id}`);
  }

  get index(): GraphIndex {
    this.cachedIndex ??= new GraphIndex(this.people.keys(), this.relations.values());
    return this.cachedIndex;
  }

  /** How a person is related to me by family links, or null. One BFS for everyone, cached. */
  kinshipToMe(personId: string): Kinship | null {
    if (this.cachedKinshipToMe === null) {
      const walks = familyWalksFrom(this.index, this.meId);
      this.cachedKinshipToMe = new Map([...walks].map(([id, walk]) => [id, classifyWalk(walk)]));
    }
    return this.cachedKinshipToMe.get(personId) ?? null;
  }

  peopleSorted(): Person[] {
    return [...this.people.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---------- onboarding & settings ----------

  async createMe(name: string, language: Language, phones: string[]): Promise<void> {
    assert(this.currentSettings === null, 'onboarding already done');
    const me = this.buildPerson({ name, gender: 'unknown', phones, emails: [], groupIds: [], notes: '', source: 'self' });
    const settings: Settings = { meId: me.id, language };
    const tx = this.db.transaction(['people', 'settings'], 'readwrite');
    await Promise.all([tx.objectStore('people').put(me), tx.objectStore('settings').put(settings, 'settings'), tx.done]);
    this.people.set(me.id, me);
    this.currentSettings = settings;
    this.changed();
  }

  async setLanguage(language: Language): Promise<void> {
    const settings: Settings = { ...this.settings, language };
    await this.db.put('settings', settings, 'settings');
    this.currentSettings = settings;
    this.changed();
  }

  // ---------- people ----------

  async addPerson(draft: PersonDraft): Promise<Person> {
    const person = this.buildPerson(draft);
    await this.db.put('people', person);
    this.people.set(person.id, person);
    this.changed();
    return person;
  }

  async updatePerson(person: Person): Promise<void> {
    assert(this.people.has(person.id), `cannot update unknown person ${person.id}`);
    assert(person.name.trim() !== '', 'a person needs a name');
    await this.db.put('people', person);
    this.people.set(person.id, person);
    this.changed();
  }

  /** Deletes people with every relation and suggestion that touches them. Returns what to restore for Undo. */
  async deletePeople(ids: readonly string[]): Promise<Snapshot> {
    const doomed = new Set(ids);
    assert(!doomed.has(this.meId), 'you cannot delete yourself');
    const snapshot: Snapshot = {
      ...EMPTY_SNAPSHOT,
      people: [...doomed].map((id) => this.person(id)),
      relations: [...this.relations.values()].filter((r) => doomed.has(r.from) || doomed.has(r.to)),
      suggestions: [...this.suggestions.values()].filter((s) => doomed.has(s.from) || doomed.has(s.to)),
    };
    const tx = this.db.transaction(['people', 'relations', 'suggestions'], 'readwrite');
    await Promise.all([
      ...snapshot.people.map((p) => tx.objectStore('people').delete(p.id)),
      ...snapshot.relations.map((r) => tx.objectStore('relations').delete(r.id)),
      ...snapshot.suggestions.map((s) => tx.objectStore('suggestions').delete(s.id)),
      tx.done,
    ]);
    snapshot.people.forEach((p) => this.people.delete(p.id));
    snapshot.relations.forEach((r) => this.relations.delete(r.id));
    snapshot.suggestions.forEach((s) => this.suggestions.delete(s.id));
    this.changed();
    return snapshot;
  }

  /** Puts back everything a delete removed (the Undo in the toast). */
  async restore(snapshot: Snapshot): Promise<void> {
    const tx = this.db.transaction(['people', 'relations', 'groups', 'suggestions'], 'readwrite');
    await Promise.all([
      ...snapshot.people.map((p) => tx.objectStore('people').put(p)),
      ...snapshot.relations.map((r) => tx.objectStore('relations').put(r)),
      ...snapshot.groups.map((g) => tx.objectStore('groups').put(g)),
      ...snapshot.suggestions.map((s) => tx.objectStore('suggestions').put(s)),
      tx.done,
    ]);
    snapshot.people.forEach((p) => this.people.set(p.id, p));
    snapshot.relations.forEach((r) => this.relations.set(r.id, r));
    snapshot.groups.forEach((g) => this.groups.set(g.id, g));
    snapshot.suggestions.forEach((s) => this.suggestions.set(s.id, s));
    this.changed();
  }

  // ---------- relations ----------

  async addRelation(draft: RelationDraft): Promise<Relation> {
    this.person(draft.from);
    this.person(draft.to);
    const problem = relationProblem(draft, this.relations.values());
    assert(problem === null, `relation rejected: ${problem}`);
    const relation: Relation = { id: newId(), ...draft, label: draft.label.trim(), createdAt: Date.now() };
    await this.db.put('relations', relation);
    this.relations.set(relation.id, relation);
    this.changed();
    return relation;
  }

  async deleteRelation(id: string): Promise<Snapshot> {
    const relation = required(this.relations.get(id), `relation ${id}`);
    await this.db.delete('relations', id);
    this.relations.delete(id);
    this.changed();
    return { ...EMPTY_SNAPSHOT, relations: [relation] };
  }

  // ---------- groups ----------

  async createGroup(name: string): Promise<Group> {
    assert(name.trim() !== '', 'a group needs a name');
    const group: Group = { id: newId(), name: name.trim(), color: nextGroupColor([...this.groups.values()].map((g) => g.color)) };
    await this.saveGroup(group);
    return group;
  }

  async saveGroup(group: Group): Promise<void> {
    assert(group.name.trim() !== '', 'a group needs a name');
    await this.db.put('groups', group);
    this.groups.set(group.id, group);
    this.changed();
  }

  async deleteGroup(id: string): Promise<Snapshot> {
    const group = this.group(id);
    const members = [...this.people.values()].filter((p) => p.groupIds.includes(id));
    const updated = members.map((p) => ({ ...p, groupIds: p.groupIds.filter((g) => g !== id) }));
    const tx = this.db.transaction(['groups', 'people'], 'readwrite');
    await Promise.all([tx.objectStore('groups').delete(id), ...updated.map((p) => tx.objectStore('people').put(p)), tx.done]);
    this.groups.delete(id);
    updated.forEach((p) => this.people.set(p.id, p));
    this.changed();
    return { ...EMPTY_SNAPSHOT, groups: [group], people: members };
  }

  async addPeopleToGroup(personIds: readonly string[], groupId: string): Promise<void> {
    this.group(groupId);
    const updated = personIds
      .map((id) => this.person(id))
      .filter((p) => !p.groupIds.includes(groupId))
      .map((p) => ({ ...p, groupIds: [...p.groupIds, groupId] }));
    await this.putPeople(updated);
    this.changed();
  }

  // ---------- import & suggestions ----------

  /** Adds contacts as people, optionally into a group, then proposes links from their names. */
  async importContacts(contacts: readonly RawContact[], source: PersonSource, groupId: string | null): Promise<{ added: number; suggested: number }> {
    if (groupId !== null) {
      this.group(groupId);
    }
    const added = contacts.map((contact) =>
      this.buildPerson({ ...contact, gender: 'unknown', groupIds: groupId === null ? [] : [groupId], notes: '', source }),
    );
    await this.putPeople(added);
    added.forEach((p) => this.people.set(p.id, p));

    const everyone = [...this.people.values()];
    const suggestions = added.flatMap((person) => suggestionsFromName(person, everyone, this.meId));
    const fresh = suggestions.filter((s) => relationProblem(s, this.relations.values()) === null);
    const tx = this.db.transaction('suggestions', 'readwrite');
    await Promise.all([...fresh.map((s) => tx.store.put(s)), tx.done]);
    fresh.forEach((s) => this.suggestions.set(s.id, s));
    this.changed();
    return { added: added.length, suggested: fresh.length };
  }

  /** Applies the gender hint, adds the link and removes the suggestion — one transaction, one re-render. */
  async acceptSuggestion(id: string): Promise<void> {
    const suggestion = required(this.suggestions.get(id), `suggestion ${id}`);
    const subject = this.person(suggestion.subjectId);
    const updatedSubject =
      subject.gender === 'unknown' && suggestion.genderHint !== 'unknown' ? { ...subject, gender: suggestion.genderHint } : null;
    const relation: Relation | null =
      relationProblem(suggestion, this.relations.values()) === null
        ? { id: newId(), from: suggestion.from, to: suggestion.to, type: suggestion.type, label: suggestion.label.trim(), createdAt: Date.now() }
        : null;

    const tx = this.db.transaction(['people', 'relations', 'suggestions'], 'readwrite');
    await Promise.all([
      updatedSubject === null ? Promise.resolve() : tx.objectStore('people').put(updatedSubject),
      relation === null ? Promise.resolve() : tx.objectStore('relations').put(relation),
      tx.objectStore('suggestions').delete(id),
      tx.done,
    ]);
    if (updatedSubject !== null) this.people.set(updatedSubject.id, updatedSubject);
    if (relation !== null) this.relations.set(relation.id, relation);
    this.suggestions.delete(id);
    this.changed();
  }

  async dismissSuggestion(id: string): Promise<Snapshot> {
    const suggestion = required(this.suggestions.get(id), `suggestion ${id}`);
    await this.db.delete('suggestions', id);
    this.suggestions.delete(id);
    this.changed();
    return { ...EMPTY_SNAPSHOT, suggestions: [suggestion] };
  }

  // ---------- comparing with a friend (stage 2) ----------

  /**
   * Records the result of comparing graphs: the friend (existing or new) is linked to me,
   * and to each confirmed person we both know with a "knows" link (unless already linked).
   * Everything is written in one transaction. Returns the friend's id.
   */
  async applyComparison(comparison: Comparison): Promise<string> {
    const friend =
      comparison.friendId !== null
        ? this.person(comparison.friendId)
        : this.buildPerson({ ...comparison.newFriend, gender: 'unknown', groupIds: [], notes: '', source: 'compare' });
    comparison.commonIds.forEach((id) => this.person(id));

    const isLinked = (a: string, b: string): boolean =>
      [...this.relations.values()].some((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
    const drafts: RelationDraft[] = [
      ...(isLinked(this.meId, friend.id) ? [] : [{ from: this.meId, to: friend.id, type: comparison.relationType, label: comparison.label }]),
      ...comparison.commonIds
        .filter((id) => id !== friend.id && !isLinked(friend.id, id))
        .map((id): RelationDraft => ({ from: friend.id, to: id, type: 'knows', label: '' })),
    ];
    drafts.forEach((draft) => assert(relationProblem(draft, this.relations.values()) === null, 'comparison produced an invalid link'));
    const relations = drafts.map((draft): Relation => ({ id: newId(), ...draft, label: draft.label.trim(), createdAt: Date.now() }));

    const tx = this.db.transaction(['people', 'relations'], 'readwrite');
    await Promise.all([
      tx.objectStore('people').put(friend),
      ...relations.map((r) => tx.objectStore('relations').put(r)),
      tx.done,
    ]);
    this.people.set(friend.id, friend);
    relations.forEach((r) => this.relations.set(r.id, r));
    this.changed();
    return friend.id;
  }

  // ---------- backup ----------

  exportBackup(): Backup {
    return {
      app: 'jewish-geography',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.settings,
      people: [...this.people.values()],
      relations: [...this.relations.values()],
      groups: [...this.groups.values()],
      suggestions: [...this.suggestions.values()],
    };
  }

  /** Replaces all data with the backup. Validates the file before touching anything. */
  async restoreBackup(json: string): Promise<void> {
    const backup = parseBackup(json);
    const tx = this.db.transaction([...DATA_STORES, 'settings' as const], 'readwrite');
    await Promise.all(DATA_STORES.map((name) => tx.objectStore(name).clear()));
    await Promise.all([
      ...backup.people.map((p) => tx.objectStore('people').put(p)),
      ...backup.relations.map((r) => tx.objectStore('relations').put(r)),
      ...backup.groups.map((g) => tx.objectStore('groups').put(g)),
      ...backup.suggestions.map((s) => tx.objectStore('suggestions').put(s)),
      tx.objectStore('settings').put(backup.settings, 'settings'),
      tx.done,
    ]);
    this.fillMemory(backup);
    this.changed();
  }

  // ---------- internals ----------

  private fillMemory(data: Pick<Backup, 'people' | 'relations' | 'groups' | 'suggestions'> & { settings: Settings | null }): void {
    this.people.clear();
    this.relations.clear();
    this.groups.clear();
    this.suggestions.clear();
    data.people.forEach((p) => this.people.set(p.id, p));
    data.relations.forEach((r) => this.relations.set(r.id, r));
    data.groups.forEach((g) => this.groups.set(g.id, g));
    data.suggestions.forEach((s) => this.suggestions.set(s.id, s));
    this.currentSettings = data.settings;
  }

  private buildPerson(draft: PersonDraft): Person {
    assert(draft.name.trim() !== '', 'a person needs a name');
    return { id: newId(), ...draft, name: draft.name.trim(), createdAt: Date.now() };
  }

  private async putPeople(people: readonly Person[]): Promise<void> {
    const tx = this.db.transaction('people', 'readwrite');
    await Promise.all([...people.map((p) => tx.store.put(p)), tx.done]);
    people.forEach((p) => this.people.set(p.id, p));
  }

  private changed(): void {
    this.cachedIndex = null;
    this.cachedKinshipToMe = null;
    this.listeners.forEach((listener) => listener());
  }
}

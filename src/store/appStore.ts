import type { IDBPDatabase } from 'idb';
import { GraphIndex } from '../graph/graphIndex';
import { classifyWalk, familyWalksFrom, type Kinship } from '../graph/kinship';
import { jointSuggestions, splitEvidence, splitJointContact, suggestionsFromName } from '../importers/nameHints';
import type { RawContact } from '../importers/rawContact';
import { assert, newId, required } from '../model/assert';
import { nextGroupColor } from '../model/groupColors';
import { normalizeName } from '../model/identity';
import { planNameGroups } from '../model/nameGroups';
import { relationProblem } from '../model/relationRules';
import type { EndpointChoice, FamilyKind, Gender, Group, Language, Person, PersonSource, Relation, RelationType, Settings, Suggestion } from '../model/types';
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

export interface ImportOptions {
  /** Put everyone imported into this group (or null). */
  groupId: string | null;
  /** Name for the group of service contacts (taxis, deliveries…), in the user's language. */
  servicesGroupName: string;
}

export interface ImportResult {
  added: number;
  suggested: number;
  groups: number;
}

type Listener = () => void;

/**
 * Data saved by earlier versions lacks newer fields; fill them with what was true then
 * (suggestions were all resolved and never asked for a kind; nobody had other names).
 */
function upgradeSuggestion(suggestion: Suggestion): Suggestion {
  const saved = suggestion as Partial<Suggestion> & Omit<Suggestion, 'unresolved' | 'askKind'>;
  return { ...saved, unresolved: saved.unresolved ?? null, askKind: saved.askKind ?? false };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** Me, with another person's identifiers and (if new) their name added as another name of mine. */
function withIdentityOf(me: Person, name: string, phones: readonly string[], emails: readonly string[]): Person {
  const isNewName = normalizeName(name) !== normalizeName(me.name) && !me.otherNames.some((other) => normalizeName(other) === normalizeName(name));
  return {
    ...me,
    phones: unique([...me.phones, ...phones]),
    emails: unique([...me.emails, ...emails]),
    otherNames: isNewName ? [...me.otherNames, name] : me.otherNames,
  };
}

function upgradePerson(person: Person): Person {
  const saved = person as Partial<Person> & Omit<Person, 'otherNames'>;
  return { ...saved, otherNames: saved.otherNames ?? [] };
}

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

  /**
   * Adds contacts as people and, in one transaction:
   *  - splits two-person contacts ("פני וגרי סבא וסבתא") into two linked people,
   *  - proposes links from names (ambiguous ones wait for the user to pick on the card),
   *  - groups everyone by the labels in their names (מדמ"ח, אלתא…) and puts services in their own group.
   */
  async importContacts(contacts: readonly RawContact[], source: PersonSource, options: ImportOptions): Promise<ImportResult> {
    if (options.groupId !== null) {
      this.group(options.groupId);
    }
    const draft = (contact: RawContact): Person =>
      this.buildPerson({ ...contact, gender: 'unknown', groupIds: options.groupId === null ? [] : [options.groupId], notes: '', source });

    let me = this.person(this.meId);
    const evidence = splitEvidence([...contacts.map((contact) => contact.name), ...[...this.people.values()].map((person) => person.name)], me);
    const added: Person[] = [];
    const jointSuggestionList: Suggestion[] = [];
    const singles: Person[] = [];
    for (const contact of contacts) {
      if (this.isMe(contact)) {
        me = withIdentityOf(me, contact.name, contact.phones, contact.emails);
        continue;
      }
      const joint = splitJointContact(contact, evidence);
      if (joint === null) {
        const person = draft(contact);
        added.push(person);
        singles.push(person);
      } else {
        const first = draft(joint.first);
        const second = draft(joint.second);
        added.push(first, second);
        singles.push(first, second); // their new names may carry hints too ("פני מיירס" shares my surname)
        jointSuggestionList.push(...jointSuggestions(first, second, joint.role, contact.name, this.meId));
      }
    }
    added.forEach((person) => this.people.set(person.id, person));
    this.people.set(me.id, me);

    const scan = await this.commitNameScan([...added, me], jointSuggestionList, singles, options.servicesGroupName);
    return { added: added.length, ...scan };
  }

  /**
   * A contact is me when it carries one of my names ("אמיתי מיירס"). A shared phone is not enough:
   * family members share a home landline. Anything else is merged by hand ("This is me").
   */
  private isMe(contact: { name: string }): boolean {
    const me = this.person(this.meId);
    const wanted = normalizeName(contact.name);
    return [me.name, ...me.otherNames].some((name) => normalizeName(name) === wanted);
  }

  /**
   * "This is me": folds a duplicate of me into my own node. Its phones, emails, groups and name
   * (as another name of mine) move to me; its connections are re-pointed to me. Cannot be undone.
   */
  async mergeIntoMe(personId: string): Promise<void> {
    await this.applyMergeIntoMe(personId);
    this.changed();
  }

  private async applyMergeIntoMe(personId: string): Promise<void> {
    assert(personId !== this.meId, 'cannot merge me into myself');
    const duplicate = this.person(personId);
    const me = withIdentityOf({ ...this.person(this.meId), groupIds: unique([...this.person(this.meId).groupIds, ...duplicate.groupIds]) }, duplicate.name, duplicate.phones, duplicate.emails);
    const merged: Person = { ...me, otherNames: unique([...me.otherNames, ...duplicate.otherNames]) };

    const touching = [...this.relations.values()].filter((r) => r.from === personId || r.to === personId);
    const kept = [...this.relations.values()].filter((r) => r.from !== personId && r.to !== personId);
    const repointed: Relation[] = [];
    for (const relation of touching) {
      const moved: Relation = {
        ...relation,
        id: newId(),
        from: relation.from === personId ? this.meId : relation.from,
        to: relation.to === personId ? this.meId : relation.to,
      };
      if (relationProblem(moved, [...kept, ...repointed]) === null) repointed.push(moved);
    }
    const staleSuggestions = [...this.suggestions.values()].filter((x) => [x.from, x.to, x.subjectId].includes(personId));

    const tx = this.db.transaction(['people', 'relations', 'suggestions'], 'readwrite');
    await Promise.all([
      tx.objectStore('people').put(merged),
      tx.objectStore('people').delete(personId),
      ...touching.map((r) => tx.objectStore('relations').delete(r.id)),
      ...repointed.map((r) => tx.objectStore('relations').put(r)),
      ...staleSuggestions.map((x) => tx.objectStore('suggestions').delete(x.id)),
      tx.done,
    ]);
    this.people.set(merged.id, merged);
    this.people.delete(personId);
    touching.forEach((r) => this.relations.delete(r.id));
    repointed.forEach((r) => this.relations.set(r.id, r));
    staleSuggestions.forEach((x) => this.suggestions.delete(x.id));
  }

  /**
   * Looks for patterns in everyone's names again — for contacts imported before a rule existed.
   * Suggestions still waiting for review are replaced by fresh ones (older rules may have read them
   * wrongly); links that already exist are not suggested again.
   */
  async rescanNames(servicesGroupName: string): Promise<Omit<ImportResult, 'added'>> {
    for (const duplicate of [...this.people.values()].filter((person) => person.id !== this.meId && this.isMe(person))) {
      await this.applyMergeIntoMe(duplicate.id);
    }
    // Only suggestions that came from a person's current name are re-derived (older rules may have read
    // them wrongly); ones from a split contact ("פני וגרי סבא וסבתא") cannot be re-derived, so they stay.
    const stale = [...this.suggestions.values()].filter((x) => this.people.get(x.subjectId)?.name === x.evidence);
    const tx = this.db.transaction('suggestions', 'readwrite');
    await Promise.all([...stale.map((suggestion) => tx.store.delete(suggestion.id)), tx.done]);
    stale.forEach((suggestion) => this.suggestions.delete(suggestion.id));

    // Contacts imported before two-person names were split ("מיירס פני וג'רי") are split now:
    // the existing node keeps its links and becomes the first person.
    const evidence = splitEvidence([...this.people.values()].map((person) => person.name), this.person(this.meId));
    const changedPeople: Person[] = [];
    const jointSuggestionList: Suggestion[] = [];
    for (const person of [...this.people.values()].filter((p) => p.id !== this.meId)) {
      const joint = splitJointContact(person, evidence);
      if (joint === null) continue;
      const first: Person = { ...person, name: joint.first.name, otherNames: unique([...person.otherNames, person.name]) };
      const second = this.buildPerson({ ...joint.second, gender: 'unknown', groupIds: person.groupIds, notes: '', source: person.source });
      this.people.set(first.id, first);
      this.people.set(second.id, second);
      changedPeople.push(first, second);
      jointSuggestionList.push(...jointSuggestions(first, second, joint.role, person.name, this.meId));
    }
    const subjects = [...this.people.values()].filter((person) => person.id !== this.meId);
    return this.commitNameScan([...changedPeople, this.person(this.meId)], jointSuggestionList, subjects, servicesGroupName);
  }

  /** Name-based suggestions for `subjects` plus label/services groups for everyone, written with `newPeople` in one transaction. */
  private async commitNameScan(
    newPeople: Person[],
    extraSuggestions: Suggestion[],
    subjects: Person[],
    servicesGroupName: string,
  ): Promise<Omit<ImportResult, 'added'>> {
    const everyone = [...this.people.values()];
    const pendingKey = (suggestion: Suggestion): string => `${suggestion.subjectId}|${suggestion.type}|${suggestion.evidence}`;
    const pending = new Set([...this.suggestions.values()].map(pendingKey));
    const suggestions = [...extraSuggestions, ...subjects.flatMap((person) => suggestionsFromName(person, everyone, this.meId))].filter(
      (suggestion) => !pending.has(pendingKey(suggestion)) && !this.alreadyLinked(suggestion),
    );
    const grouping = planNameGroups(everyone, [...this.groups.values()], this.meId, servicesGroupName);

    const toWrite = new Map(newPeople.map((person) => [person.id, person]));
    grouping.updatedPeople.forEach((person) => toWrite.set(person.id, person));
    const tx = this.db.transaction(['people', 'groups', 'suggestions'], 'readwrite');
    await Promise.all([
      ...grouping.newGroups.map((group) => tx.objectStore('groups').put(group)),
      ...[...toWrite.values()].map((person) => tx.objectStore('people').put(person)),
      ...suggestions.map((suggestion) => tx.objectStore('suggestions').put(suggestion)),
      tx.done,
    ]);
    grouping.newGroups.forEach((group) => this.groups.set(group.id, group));
    grouping.updatedPeople.forEach((person) => this.people.set(person.id, person));
    suggestions.forEach((suggestion) => this.suggestions.set(suggestion.id, suggestion));
    this.changed();
    return { suggested: suggestions.length, groups: grouping.newGroups.length };
  }

  /** True when the suggested link (or, for an unresolved one, a link of that kind from its subject) already exists. */
  private alreadyLinked(suggestion: Suggestion): boolean {
    if (suggestion.unresolved === null) {
      return relationProblem(suggestion, this.relations.values()) !== null;
    }
    const knownSide = suggestion.unresolved.side === 'from' ? 'to' : 'from';
    return [...this.relations.values()].some((relation) => relation.type === suggestion.type && relation[knownSide] === suggestion[knownSide]);
  }

  /**
   * Applies the gender hint, adds the link and removes the suggestion — one transaction, one re-render.
   * An unresolved suggestion needs `choice`: the person the contact meant, or a new person to add.
   */
  async acceptSuggestion(id: string, choice: EndpointChoice | null, kind: FamilyKind | null): Promise<void> {
    const suggestion = required(this.suggestions.get(id), `suggestion ${id}`);
    let from = suggestion.from;
    let to = suggestion.to;
    let type = suggestion.type;
    if (suggestion.askKind) {
      assert(kind !== null, 'choose how you are related first');
      // The subject is `from`, I am `to`: "my child" turns the parent link around.
      if (kind === 'child') [from, to] = [to, from];
      type = kind === 'child' ? 'parent' : kind;
    } else {
      assert(kind === null, 'this suggestion does not ask for a relation');
    }
    let newPerson: Person | null = null;
    if (suggestion.unresolved === null) {
      assert(choice === null, 'this suggestion is already resolved');
    } else {
      assert(choice !== null, `choose who “${suggestion.unresolved.name}” is first`);
      let endpointId: string;
      if ('personId' in choice) {
        endpointId = this.person(choice.personId).id;
      } else {
        assert(suggestion.unresolved.canCreate, 'this suggestion cannot add a new person');
        newPerson = this.buildPerson({ name: choice.newPersonName, gender: 'unknown', phones: [], emails: [], groupIds: [], notes: '', source: 'manual' });
        endpointId = newPerson.id;
      }
      if (suggestion.unresolved.side === 'from') from = endpointId;
      else to = endpointId;
    }

    const subject = this.person(suggestion.subjectId);
    const updatedSubject =
      subject.gender === 'unknown' && suggestion.genderHint !== 'unknown' ? { ...subject, gender: suggestion.genderHint } : null;
    const draft = { from, to, type, label: type === 'relative' || type === 'custom' ? suggestion.label.trim() : '' };
    const relation: Relation | null = relationProblem(draft, this.relations.values()) === null ? { id: newId(), ...draft, createdAt: Date.now() } : null;

    const tx = this.db.transaction(['people', 'relations', 'suggestions'], 'readwrite');
    await Promise.all([
      ...[newPerson, updatedSubject].filter((person): person is Person => person !== null).map((person) => tx.objectStore('people').put(person)),
      relation === null ? Promise.resolve() : tx.objectStore('relations').put(relation),
      tx.objectStore('suggestions').delete(id),
      tx.done,
    ]);
    if (newPerson !== null) this.people.set(newPerson.id, newPerson);
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
    data.people.forEach((p) => this.people.set(p.id, upgradePerson(p)));
    data.relations.forEach((r) => this.relations.set(r.id, r));
    data.groups.forEach((g) => this.groups.set(g.id, g));
    data.suggestions.forEach((s) => this.suggestions.set(s.id, upgradeSuggestion(s)));
    this.currentSettings = data.settings;
  }

  private buildPerson(draft: PersonDraft): Person {
    assert(draft.name.trim() !== '', 'a person needs a name');
    // A newly created person has no other names yet; they are added by merging or editing.
    return { id: newId(), ...draft, name: draft.name.trim(), otherNames: [], createdAt: Date.now() };
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

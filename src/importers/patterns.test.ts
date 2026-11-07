import { describe, expect, it } from 'vitest';
import { nextGroupColor } from '../model/groupColors';
import { planNameGroups } from '../model/nameGroups';
import type { Group, Person } from '../model/types';
import { detectLabels, isServiceName } from './labels';
import { parseNameHints, splitJointContact, suggestionsFromName } from './nameHints';

function person(id: string, name: string, groupIds: string[] = []): Person {
  return { id, name, gender: 'unknown', phones: [], emails: [], groupIds, notes: '', source: 'manual', createdAt: 0 };
}

describe('more name patterns', () => {
  it.each([
    ['נעמה של ניצן', 'spouse', 'ניצן'],
    ['אביב דקל של גלינה', 'spouse', 'גלינה'],
    ['לילך בת דודה', 'relative', null],
    ['אווה שכנה של קרן', 'neighbor', 'קרן'],
    ['רינת מזכירה של אריה', 'work', 'אריה'],
  ])('%s → %s of %s', (name, kind, anchor) => {
    const [hint] = parseNameHints(name);
    expect(hint?.entry.kind).toBe(kind);
    expect(hint?.anchorName).toBe(anchor);
  });

  it.each(['יואל גבע כפר סבא', 'סניף כפר סבא יואל גבע', 'גל דוד'])('finds nothing in "%s"', (name) => {
    expect(parseNameHints(name)).toEqual([]);
  });

  it('labels a trailing kinship word for me', () => {
    const lilach = person('l', 'לילך בת דודה');
    expect(suggestionsFromName(lilach, [lilach], 'me')[0]).toMatchObject({ from: 'l', to: 'me', type: 'relative', label: 'בת דודה' });
  });
});

describe('ambiguous and missing names', () => {
  const people = [person('me', 'Me'), person('r1', 'רז'), person('r2', 'רז לוי'), person('r3', 'רז כהן')];

  it('asks which Raz when several people share the name', () => {
    const mom = person('m', 'אמא של רז');
    const [suggestion] = suggestionsFromName(mom, [...people, mom], 'me');
    expect(suggestion).toMatchObject({ from: 'm', to: '', type: 'parent' });
    expect(suggestion?.unresolved).toEqual({ side: 'to', name: 'רז', candidateIds: ['r1', 'r2', 'r3'], canCreate: true });
  });

  it('offers to add a child who is not in the contacts', () => {
    const maya = person('m', 'מאיה אמא של יושו');
    expect(suggestionsFromName(maya, [...people, maya], 'me')[0]?.unresolved).toEqual({ side: 'to', name: 'יושו', candidateIds: [], canCreate: true });
  });

  it('offers a contact whose nickname in parentheses matches', () => {
    const noa = person('noa', 'נועה (צ׳יקה)');
    const bar = person('bar', 'בר אבא של צ׳יקה');
    expect(suggestionsFromName(bar, [...people, noa, bar], 'me')[0]?.unresolved?.candidateIds).toEqual(['noa']);
  });

  it('reads "מאמא של בר" as Bar\'s mother', () => {
    expect(parseNameHints('מאמא של בר')[0]).toMatchObject({ word: 'מאמא', anchorName: 'בר' });
  });

  it('never invents a person for non-family patterns', () => {
    const genius = person('g', 'הגאונה של פיזיקה');
    expect(suggestionsFromName(genius, [...people, genius], 'me')).toEqual([]);
  });
});

describe('splitJointContact', () => {
  it('splits two people who share a kinship phrase', () => {
    const joint = splitJointContact({ name: 'פני וגרי סבא וסבתא', phones: ['050-1'], emails: [] });
    expect(joint).toEqual({
      first: { name: 'פני', phones: ['050-1'], emails: [] },
      second: { name: 'גרי', phones: [], emails: [] },
      role: 'סבא וסבתא',
    });
  });

  it.each(['יואב וולף קרוספיט', 'דני ורונית כהן', 'מגי ותולי'])('keeps "%s" as one contact', (name) => {
    expect(splitJointContact({ name, phones: [], emails: [] })).toBeNull();
  });
});

describe('labels and groups', () => {
  const firstNames = ['תומר', 'גל', 'נועה', 'יובל', 'עידן', 'שני', 'דור'];
  const names = [
    ...firstNames.map((first) => `${first} מדמ"ח`),
    ...firstNames.slice(0, 5).map((first) => `${first} אלתא`),
    ...firstNames.slice(0, 5).map((first) => `${first} כהן`),
    ...firstNames.slice(0, 5).map((first) => `${first} באר שבע`),
    'גל', 'גל לוי', 'גל שמש', 'גל פרי', 'גל צור',
    'רמי מונית', 'אלכס שליח',
  ];

  it('finds shared labels, not first names or common surnames, and joins two-word places', () => {
    expect(detectLabels(names.filter((name) => !isServiceName(name))).map((label) => `${label.display}:${label.count}`)).toEqual([
      'מדמ"ח:7',
      'אלתא:5',
      'באר שבע:5',
    ]);
  });

  it('plans label groups and a services group, reusing groups that already exist', () => {
    const people = [person('me', 'Me'), ...names.map((name, i) => person(`p${i}`, name))];
    const existing: Group[] = [{ id: 'g-elta', name: 'אלתא', color: '#2f6fdf' }];
    const plan = planNameGroups(people, existing, 'me', 'Services');
    expect(plan.newGroups.map((group) => group.name)).toEqual(['מדמ"ח', 'באר שבע', 'Services']);
    expect(plan.updatedPeople.get('p7')?.groupIds).toEqual(['g-elta']);
    const services = plan.newGroups.find((group) => group.name === 'Services') as Group;
    expect(plan.updatedPeople.get(`p${names.indexOf('רמי מונית')}`)?.groupIds).toEqual([services.id]);
    expect(plan.updatedPeople.has(`p${names.indexOf('גל')}`)).toBe(false); // "גל" alone: no label
  });

  it('keeps inventing distinct hex colours after the presets run out', () => {
    const used: string[] = [];
    for (let i = 0; i < 40; i++) used.push(nextGroupColor(used));
    expect(new Set(used).size).toBe(40);
    used.forEach((color) => expect(color).toMatch(/^#[0-9a-f]{6}$/));
  });
});

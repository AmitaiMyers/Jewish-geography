import { describe, expect, it } from 'vitest';
import { planImport } from './importPlan';
import { relationProblem } from './relationRules';
import type { Person, Relation } from './types';

function person(id: string, name: string, phones: string[] = []): Person {
  return { id, name, gender: 'unknown', phones, emails: [], groupIds: [], otherNames: [], notes: '', source: 'manual', createdAt: 0 };
}

const existing = (from: string, to: string, type: Relation['type'], label = ''): Relation => ({
  id: `${from}-${to}-${type}`,
  from,
  to,
  type,
  label,
  createdAt: 0,
});

describe('planImport', () => {
  const people = [person('a', 'Moshe Cohen', ['054-123-4567']), person('b', 'Sarah')];

  it('matches by phone across formats, by name when there is no phone, and drops batch duplicates', () => {
    const plan = planImport(
      [
        { name: 'Moshe C.', phones: ['+972 54 123 4567'], emails: [] },
        { name: 'sarah', phones: [], emails: [] },
        { name: 'Dina', phones: ['052-000-0000'], emails: [] },
        { name: 'Dina again', phones: ['052 000 0000'], emails: [] },
      ],
      people,
    );
    expect(plan.map((c) => [c.contact.name, c.existingPersonId, c.reason])).toEqual([
      ['Moshe C.', 'a', 'identifier'],
      ['sarah', 'b', 'name'],
      ['Dina', null, 'none'],
    ]);
  });
});

describe('relationProblem', () => {
  const relations = [existing('a', 'b', 'friend'), existing('p', 'c', 'parent'), existing('x', 'y', 'custom', 'Chavrusa')];

  it.each([
    [{ from: 'a', to: 'a', type: 'friend', label: '' }, 'self'],
    [{ from: 'a', to: 'b', type: 'relative', label: ' ' }, 'missingLabel'],
    [{ from: 'b', to: 'a', type: 'friend', label: '' }, 'duplicate'],
    [{ from: 'c', to: 'p', type: 'parent', label: '' }, 'parentCycle'],
    [{ from: 'y', to: 'x', type: 'custom', label: 'chavrusa' }, 'duplicate'],
    [{ from: 'x', to: 'y', type: 'custom', label: 'Neighbour' }, null],
    [{ from: 'a', to: 'b', type: 'work', label: '' }, null],
  ] as const)('%o → %s', (candidate, problem) => {
    expect(relationProblem(candidate, relations)).toBe(problem);
  });
});

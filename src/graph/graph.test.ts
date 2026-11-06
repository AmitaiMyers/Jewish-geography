import { describe, expect, it } from 'vitest';
import type { Relation, RelationType } from '../model/types';
import { GraphIndex } from './graphIndex';
import { classifyWalk, kinshipBetween, familyWalksFrom } from './kinship';

let relationCounter = 0;
function rel(from: string, to: string, type: RelationType): Relation {
  relationCounter++;
  return { id: `r${relationCounter}`, from, to, type, label: '', createdAt: 0 };
}

function buildIndex(people: string[], relations: Relation[]): GraphIndex {
  return new GraphIndex(people, relations);
}

describe('GraphIndex.shortestPath', () => {
  const people = ['a', 'b', 'c', 'd', 'e', 'x'];
  const relations = [rel('a', 'b', 'friend'), rel('b', 'c', 'work'), rel('c', 'd', 'shul'), rel('a', 'e', 'camp'), rel('e', 'd', 'friend')];
  const index = buildIndex(people, relations);

  it('finds the shortest chain, not just any chain', () => {
    const path = index.shortestPath('a', 'd');
    expect(path?.personIds).toEqual(['a', 'e', 'd']);
    expect(path?.relations.map((r) => r.type)).toEqual(['camp', 'friend']);
  });

  it('returns a single-node path to self', () => {
    expect(index.shortestPath('a', 'a')).toEqual({ personIds: ['a'], relations: [] });
  });

  it('returns null for disconnected people', () => {
    expect(index.shortestPath('a', 'x')).toBeNull();
  });

  it('respects the relation filter', () => {
    const path = index.shortestPath('a', 'd', (r) => r.type !== 'camp');
    expect(path?.personIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('fails fast on unknown people', () => {
    expect(() => index.shortestPath('a', 'nobody')).toThrow(/not in the graph/);
  });

  it('is correct on a long chain and agrees with path length from both ends', () => {
    const n = 2000;
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const chain = ids.slice(1).map((id, i) => rel(ids[i] as string, id, 'friend'));
    const big = buildIndex(ids, chain);
    expect(big.shortestPath('p0', `p${n - 1}`)?.personIds.length).toBe(n);
    expect(big.shortestPath(`p${n - 1}`, 'p0')?.personIds.length).toBe(n);
  });
});

describe('GraphIndex.mutualConnections', () => {
  it('lists people connected to both, once each', () => {
    const index = buildIndex(['a', 'b', 'm', 'n'], [rel('a', 'm', 'friend'), rel('a', 'm', 'shul'), rel('b', 'm', 'work'), rel('a', 'n', 'friend')]);
    expect(index.mutualConnections('a', 'b')).toEqual(['m']);
  });
});

describe('kinship', () => {
  // Family:
  //   grandpa ── grandma
  //       │
  //   ┌───┴────────┐
  //   dad ── mom   uncle ── auntByMarriage
  //   │            │
  //   me ── wife   cousin
  //   │            │
  //   son          cousinKid
  //   brother is my sibling (recorded directly, parents unknown)
  //   wifeDad is wife's parent; son ── daughterInLaw; daughterInLaw's parent = machatan
  const people = [
    'grandpa', 'grandma', 'dad', 'mom', 'uncle', 'auntByMarriage', 'me', 'wife', 'cousin',
    'son', 'cousinKid', 'brother', 'wifeDad', 'daughterInLaw', 'machatan', 'wifeSister',
  ];
  const relations = [
    rel('grandpa', 'grandma', 'spouse'),
    rel('grandpa', 'dad', 'parent'),
    rel('grandpa', 'uncle', 'parent'),
    rel('dad', 'mom', 'spouse'),
    rel('dad', 'me', 'parent'),
    rel('mom', 'me', 'parent'),
    rel('uncle', 'auntByMarriage', 'spouse'),
    rel('uncle', 'cousin', 'parent'),
    rel('cousin', 'cousinKid', 'parent'),
    rel('me', 'wife', 'spouse'),
    rel('me', 'son', 'parent'),
    rel('me', 'brother', 'sibling'),
    rel('wifeDad', 'wife', 'parent'),
    rel('wife', 'wifeSister', 'sibling'),
    rel('son', 'daughterInLaw', 'spouse'),
    rel('machatan', 'daughterInLaw', 'parent'),
  ];
  const index = buildIndex(people, relations);
  const kin = (to: string) => kinshipBetween(index, 'me', to);

  it.each([
    ['dad', { kind: 'named', term: 'parent', greats: 0 }],
    ['son', { kind: 'named', term: 'child', greats: 0 }],
    ['wife', { kind: 'named', term: 'spouse', greats: 0 }],
    ['brother', { kind: 'named', term: 'sibling', greats: 0 }],
    ['grandpa', { kind: 'named', term: 'grandparent', greats: 0 }],
    ['uncle', { kind: 'named', term: 'auntUncle', greats: 0 }],
    ['auntByMarriage', { kind: 'named', term: 'auntUncle', greats: 0 }],
    ['cousin', { kind: 'cousin', degree: 1, removed: 0 }],
    ['cousinKid', { kind: 'cousin', degree: 1, removed: 1 }],
    ['wifeDad', { kind: 'named', term: 'parentInLaw', greats: 0 }],
    ['wifeSister', { kind: 'named', term: 'siblingInLaw', greats: 0 }],
    ['daughterInLaw', { kind: 'named', term: 'childInLaw', greats: 0 }],
    ['machatan', { kind: 'named', term: 'coParentInLaw', greats: 0 }],
  ])('me → %s', (target, expected) => {
    expect(kin(target)).toEqual(expected);
  });

  it('uncle sees me as a nephew', () => {
    expect(kinshipBetween(index, 'uncle', 'me')).toEqual({ kind: 'named', term: 'nieceNephew', greats: 0 });
  });

  it('a recorded sibling shares my parents', () => {
    expect(kinshipBetween(index, 'brother', 'dad')).toEqual({ kind: 'named', term: 'parent', greats: 0 });
    expect(kinshipBetween(index, 'brother', 'son')).toEqual({ kind: 'named', term: 'nieceNephew', greats: 0 });
  });

  it('describes unnamed shapes literally', () => {
    expect(classifyWalk({ steps: ['up', 'spouse'], personIds: ['me', 'dad', 'stepMom'] })).toEqual({
      kind: 'chain',
      steps: ['up', 'spouse'],
      personIds: ['me', 'dad', 'stepMom'],
    });
  });

  it('names great-grandparents and second cousins', () => {
    expect(classifyWalk({ steps: ['up', 'up', 'up'], personIds: ['a', 'b', 'c', 'd'] })).toEqual({
      kind: 'named',
      term: 'grandparent',
      greats: 1,
    });
    expect(
      classifyWalk({ steps: ['up', 'up', 'up', 'down', 'down', 'down'], personIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
    ).toEqual({ kind: 'cousin', degree: 2, removed: 0 });
  });

  it('ignores social links', () => {
    const social = buildIndex(['a', 'b'], [rel('a', 'b', 'friend')]);
    expect(kinshipBetween(social, 'a', 'b')).toBeNull();
  });

  it('labels every relative in one pass', () => {
    const walks = familyWalksFrom(index, 'me');
    expect(walks.size).toBe(people.length);
  });
});

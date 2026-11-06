import { assert } from '../model/assert';
import { isFamilyPrimitive, type Relation } from '../model/types';
import type { GraphIndex } from './graphIndex';

/**
 * Kinship inference.
 *
 * Only three family primitives are stored: parent (directed), spouse, sibling.
 * Everything else (uncle, cousin, in-law, mechutan...) is derived by walking
 * those links and classifying the walk:
 *
 *   1. Translate each hop into a step: up (to a parent), down (to a child),
 *      spouse, sibling.
 *   2. Expand sibling into a "virtual" up+down through an unrecorded shared parent,
 *      then cancel any down→up pair that passes through a virtual step
 *      (my sibling's parent is my parent; my child's sibling is my child).
 *   3. A walk shaped [spouse] up^u down^d [spouse] maps to a named term;
 *      anything else is described literally ("father's wife").
 */

export type Step = 'up' | 'down' | 'spouse' | 'sibling';

export type KinTerm =
  | 'spouse'
  | 'parent'
  | 'child'
  | 'sibling'
  | 'grandparent'
  | 'grandchild'
  | 'auntUncle'
  | 'nieceNephew'
  | 'parentInLaw'
  | 'childInLaw'
  | 'siblingInLaw'
  | 'coParentInLaw';

export type Kinship =
  | { kind: 'self' }
  | { kind: 'named'; term: KinTerm; greats: number }
  | { kind: 'cousin'; degree: number; removed: number }
  /** personIds[i + 1] is reached from personIds[i] by steps[i]. */
  | { kind: 'chain'; steps: Step[]; personIds: string[] };

export interface FamilyWalk {
  steps: Step[];
  personIds: string[];
}

export const isFamilyRelation = (relation: Relation): boolean => isFamilyPrimitive(relation.type);

export function stepAlong(relation: Relation, fromPersonId: string): Step {
  assert(
    relation.from === fromPersonId || relation.to === fromPersonId,
    `relation ${relation.id} does not touch ${fromPersonId}`,
  );
  switch (relation.type) {
    case 'parent':
      return relation.from === fromPersonId ? 'down' : 'up';
    case 'spouse':
      return 'spouse';
    case 'sibling':
      return 'sibling';
    default:
      throw new Error(`relation type "${relation.type}" is not a family primitive`);
  }
}

/** Shortest family walk between two people, or null when they are not family. */
export function familyWalkBetween(index: GraphIndex, from: string, to: string): FamilyWalk | null {
  const path = index.shortestPath(from, to, isFamilyRelation);
  if (path === null) {
    return null;
  }
  const steps = path.relations.map((relation, i) => stepAlong(relation, path.personIds[i] as string));
  return { steps, personIds: path.personIds };
}

/**
 * One BFS from `source` over family links: the walk to every relative.
 * Used to label everyone's relation to "me" in a single O(V + E) pass.
 */
export function familyWalksFrom(index: GraphIndex, source: string): Map<string, FamilyWalk> {
  const walks = new Map<string, FamilyWalk>([[source, { steps: [], personIds: [source] }]]);
  const queue = [source];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as string;
    const walk = walks.get(current) as FamilyWalk;
    for (const { personId, relation } of index.neighbors(current)) {
      if (!isFamilyRelation(relation) || walks.has(personId)) {
        continue;
      }
      walks.set(personId, {
        steps: [...walk.steps, stepAlong(relation, current)],
        personIds: [...walk.personIds, personId],
      });
      queue.push(personId);
    }
  }
  return walks;
}

interface Token {
  direction: 'up' | 'down' | 'spouse';
  virtual: boolean;
}

function expandSiblings(steps: readonly Step[]): Token[] {
  return steps.flatMap((step): Token[] =>
    step === 'sibling'
      ? [
          { direction: 'up', virtual: true },
          { direction: 'down', virtual: true },
        ]
      : [{ direction: step, virtual: false }],
  );
}

function cancelVirtualRoundTrips(tokens: Token[]): Token[] {
  const result = [...tokens];
  let i = 0;
  while (i < result.length - 1) {
    const a = result[i] as Token;
    const b = result[i + 1] as Token;
    if (a.direction === 'down' && b.direction === 'up' && (a.virtual || b.virtual)) {
      result.splice(i, 2);
      i = Math.max(0, i - 1);
    } else {
      i++;
    }
  }
  return result;
}

function bloodTerm(ups: number, downs: number): Kinship {
  assert(ups + downs > 0, 'blood relation needs at least one generation step');
  if (downs === 0) {
    return ups === 1 ? named('parent') : named('grandparent', ups - 2);
  }
  if (ups === 0) {
    return downs === 1 ? named('child') : named('grandchild', downs - 2);
  }
  if (ups === 1 && downs === 1) {
    return named('sibling');
  }
  if (downs === 1) {
    return named('auntUncle', ups - 2);
  }
  if (ups === 1) {
    return named('nieceNephew', downs - 2);
  }
  return { kind: 'cousin', degree: Math.min(ups, downs) - 1, removed: Math.abs(ups - downs) };
}

function named(term: KinTerm, greats = 0): Kinship {
  return { kind: 'named', term, greats };
}

/** Counts a strictly "up* down*" sequence, or returns null for any other shape. */
function countGenerations(directions: readonly Token['direction'][]): { ups: number; downs: number } | null {
  let ups = 0;
  let downs = 0;
  for (const direction of directions) {
    if (direction === 'up' && downs === 0) {
      ups++;
    } else if (direction === 'down') {
      downs++;
    } else {
      return null;
    }
  }
  return { ups, downs };
}

export function classifyWalk(walk: FamilyWalk): Kinship {
  assert(walk.personIds.length === walk.steps.length + 1, 'walk must have one more person than steps');
  if (walk.steps.length === 0) {
    return { kind: 'self' };
  }
  const chain: Kinship = { kind: 'chain', steps: walk.steps, personIds: walk.personIds };
  const directions = cancelVirtualRoundTrips(expandSiblings(walk.steps)).map((token) => token.direction);

  if (directions.length === 0) {
    return chain;
  }
  if (directions.length === 1 && directions[0] === 'spouse') {
    return named('spouse');
  }
  if (directions.join(',') === 'down,spouse,up') {
    return named('coParentInLaw');
  }

  const leadingSpouse = directions[0] === 'spouse';
  const trailingSpouse = directions[directions.length - 1] === 'spouse';
  const core = directions.slice(leadingSpouse ? 1 : 0, trailingSpouse ? -1 : undefined);
  const generations = countGenerations(core);
  if (generations === null || core.length === 0) {
    return chain;
  }
  const { ups, downs } = generations;

  if (!leadingSpouse && !trailingSpouse) {
    return bloodTerm(ups, downs);
  }
  if (leadingSpouse && !trailingSpouse) {
    if (ups === 1 && downs === 0) return named('parentInLaw');
    if (ups === 1 && downs === 1) return named('siblingInLaw');
    return chain;
  }
  if (!leadingSpouse && trailingSpouse) {
    if (ups === 0 && downs === 1) return named('childInLaw');
    if (ups === 1 && downs === 1) return named('siblingInLaw');
    if (ups >= 2 && downs === 1) return named('auntUncle', ups - 2);
    return chain;
  }
  return chain;
}

export function kinshipBetween(index: GraphIndex, from: string, to: string): Kinship | null {
  const walk = familyWalkBetween(index, from, to);
  return walk === null ? null : classifyWalk(walk);
}

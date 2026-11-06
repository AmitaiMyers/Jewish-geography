import { isLabelledType, type Relation } from './types';

/** Why a new relation cannot be added; the UI shows this instead of saving. */
export type RelationProblem = 'self' | 'missingLabel' | 'duplicate' | 'parentCycle';

type NewRelation = Pick<Relation, 'from' | 'to' | 'type' | 'label'>;

function sameEndpoints(a: NewRelation, b: NewRelation, directed: boolean): boolean {
  const forward = a.from === b.from && a.to === b.to;
  const backward = a.from === b.to && a.to === b.from;
  return directed ? forward : forward || backward;
}

export function relationProblem(candidate: NewRelation, existing: Iterable<Relation>): RelationProblem | null {
  if (candidate.from === candidate.to) {
    return 'self';
  }
  if (isLabelledType(candidate.type) && candidate.label.trim() === '') {
    return 'missingLabel';
  }
  for (const relation of existing) {
    if (relation.type !== candidate.type) {
      continue;
    }
    if (candidate.type === 'parent' && sameEndpoints(relation, { ...candidate, from: candidate.to, to: candidate.from }, true)) {
      return 'parentCycle';
    }
    const sameLabel = relation.label.trim().toLowerCase() === candidate.label.trim().toLowerCase();
    if (sameEndpoints(relation, candidate, candidate.type === 'parent') && sameLabel) {
      return 'duplicate';
    }
  }
  return null;
}

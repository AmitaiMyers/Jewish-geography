import { assert } from '../model/assert';
import type { Relation } from '../model/types';

/**
 * Adjacency-list index over the relation graph.
 * Built in O(V + E); every query below is linear or better,
 * which keeps the app instant for thousands of people.
 */

export interface Neighbor {
  personId: string;
  relation: Relation;
}

export interface Path {
  /** Person ids from start to end, inclusive. */
  personIds: string[];
  /** relations[i] links personIds[i] and personIds[i + 1]. */
  relations: Relation[];
}

export type RelationFilter = (relation: Relation) => boolean;

const ACCEPT_ALL: RelationFilter = () => true;

export class GraphIndex {
  private readonly adjacency = new Map<string, Neighbor[]>();

  constructor(personIds: Iterable<string>, relations: Iterable<Relation>) {
    for (const id of personIds) {
      this.adjacency.set(id, []);
    }
    for (const relation of relations) {
      this.neighborList(relation.from).push({ personId: relation.to, relation });
      this.neighborList(relation.to).push({ personId: relation.from, relation });
    }
  }

  has(personId: string): boolean {
    return this.adjacency.has(personId);
  }

  neighbors(personId: string): readonly Neighbor[] {
    return this.neighborList(personId);
  }

  degree(personId: string): number {
    return this.neighborList(personId).length;
  }

  /** People directly connected to both a and b. O(deg(a) + deg(b)). */
  mutualConnections(a: string, b: string): string[] {
    const ofA = new Set(this.neighborList(a).map((n) => n.personId));
    const mutual = new Set<string>();
    for (const neighbor of this.neighborList(b)) {
      if (ofA.has(neighbor.personId) && neighbor.personId !== a) {
        mutual.add(neighbor.personId);
      }
    }
    return [...mutual];
  }

  /**
   * Shortest chain of relations between two people (bidirectional BFS).
   * Searching from both ends explores roughly 2·b^(d/2) nodes instead of b^d.
   * Returns null when the two people are not connected.
   */
  shortestPath(start: string, end: string, accept: RelationFilter = ACCEPT_ALL): Path | null {
    this.neighborList(start);
    this.neighborList(end);
    if (start === end) {
      return { personIds: [start], relations: [] };
    }

    const fromStart = new Map<string, Visit>([[start, ROOT_VISIT]]);
    const fromEnd = new Map<string, Visit>([[end, ROOT_VISIT]]);
    let frontierStart = [start];
    let frontierEnd = [end];

    while (frontierStart.length > 0 && frontierEnd.length > 0) {
      const expandStartSide = frontierStart.length <= frontierEnd.length;
      const own = expandStartSide ? fromStart : fromEnd;
      const other = expandStartSide ? fromEnd : fromStart;
      const frontier = expandStartSide ? frontierStart : frontierEnd;

      const { next, meeting } = this.expandLevel(frontier, own, other, accept);
      if (meeting !== null) {
        return joinPaths(meeting, fromStart, fromEnd);
      }
      if (expandStartSide) {
        frontierStart = next;
      } else {
        frontierEnd = next;
      }
    }
    return null;
  }

  /** Expands one full BFS level and returns the best meeting point, if any. */
  private expandLevel(
    frontier: string[],
    own: Map<string, Visit>,
    other: Map<string, Visit>,
    accept: RelationFilter,
  ): { next: string[]; meeting: string | null } {
    const next: string[] = [];
    let meeting: string | null = null;
    let bestLength = Number.POSITIVE_INFINITY;

    for (const current of frontier) {
      const currentDepth = visitOf(own, current).depth;
      for (const { personId, relation } of this.neighborList(current)) {
        if (!accept(relation) || own.has(personId)) {
          continue;
        }
        own.set(personId, { previous: current, via: relation, depth: currentDepth + 1 });
        next.push(personId);
        const otherVisit = other.get(personId);
        if (otherVisit !== undefined && currentDepth + 1 + otherVisit.depth < bestLength) {
          bestLength = currentDepth + 1 + otherVisit.depth;
          meeting = personId;
        }
      }
    }
    return { next, meeting };
  }

  private neighborList(personId: string): Neighbor[] {
    const list = this.adjacency.get(personId);
    assert(list !== undefined, `person ${personId} is not in the graph`);
    return list;
  }
}

interface Visit {
  previous: string | null;
  via: Relation | null;
  depth: number;
}

const ROOT_VISIT: Visit = { previous: null, via: null, depth: 0 };

function visitOf(visits: Map<string, Visit>, personId: string): Visit {
  const visit = visits.get(personId);
  assert(visit !== undefined, `person ${personId} was not visited`);
  return visit;
}

/** Walks back from the meeting point to both roots and stitches the halves together. */
function joinPaths(meeting: string, fromStart: Map<string, Visit>, fromEnd: Map<string, Visit>): Path {
  const personIds: string[] = [meeting];
  const relations: Relation[] = [];

  let visit = visitOf(fromStart, meeting);
  while (visit.previous !== null && visit.via !== null) {
    personIds.unshift(visit.previous);
    relations.unshift(visit.via);
    visit = visitOf(fromStart, visit.previous);
  }

  visit = visitOf(fromEnd, meeting);
  while (visit.previous !== null && visit.via !== null) {
    personIds.push(visit.previous);
    relations.push(visit.via);
    visit = visitOf(fromEnd, visit.previous);
  }
  return { personIds, relations };
}

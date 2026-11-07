import type { Point } from './hull';

/**
 * Deterministic cluster layout for large graphs, O(n):
 *   - me at the centre;
 *   - people linked but in no group (family, friends) in a disc around me;
 *   - each group as its own disc on an outer ring, discs sized by member count and never overlapping.
 * Inside every disc people sit on a sunflower (golden-angle) spiral, which spaces them evenly.
 * A person in several groups is drawn in the first one; their ring of colours shows the rest.
 */

export interface ClusterInput {
  meId: string;
  groups: { id: string; memberIds: string[] }[];
  /** Connected people who are in no group (and not me). */
  ungroupedIds: string[];
}

export interface ClusterResult {
  positions: Map<string, Point>;
  groupCenters: Map<string, Point>;
}

/** Distance unit between neighbours on a spiral (≈ 1.8 × this between node centres). */
export const SPACING = 26;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const ME_CLEARANCE = 60;
const CLUSTER_GAP = 40;

/** Position of the i-th of n points in a sunflower disc that starts `innerRadius` from the centre. */
export function sunflower(i: number, innerRadius: number): Point {
  const radius = innerRadius + SPACING * Math.sqrt(i + 0.5);
  const angle = i * GOLDEN_ANGLE;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export function discRadius(count: number, innerRadius = 0): number {
  return innerRadius + SPACING * Math.sqrt(Math.max(count, 1)) + SPACING / 2;
}

export function clusterLayout(input: ClusterInput): ClusterResult {
  const positions = new Map<string, Point>([[input.meId, { x: 0, y: 0 }]]);
  const groupCenters = new Map<string, Point>();

  input.ungroupedIds.forEach((id, i) => positions.set(id, sunflower(i, ME_CLEARANCE)));
  const innerRadius = discRadius(input.ungroupedIds.length, ME_CLEARANCE);

  // Each person goes to the first (largest) group that lists them.
  const placed = new Set(positions.keys());
  const clusters = [...input.groups]
    .sort((a, b) => b.memberIds.length - a.memberIds.length)
    .map((group) => {
      const members = group.memberIds.filter((id) => !placed.has(id));
      members.forEach((id) => placed.add(id));
      return { id: group.id, members, radius: discRadius(members.length) };
    });

  const circumference = clusters.reduce((sum, cluster) => sum + 2 * cluster.radius + CLUSTER_GAP, 0);
  const largest = Math.max(0, ...clusters.map((cluster) => cluster.radius));
  const ringRadius = Math.max(innerRadius + largest + CLUSTER_GAP, circumference / (2 * Math.PI));

  let travelled = 0;
  for (const cluster of clusters) {
    const angle = ((travelled + cluster.radius + CLUSTER_GAP / 2) / circumference) * 2 * Math.PI;
    travelled += 2 * cluster.radius + CLUSTER_GAP;
    const center = { x: ringRadius * Math.cos(angle), y: ringRadius * Math.sin(angle) };
    groupCenters.set(cluster.id, center);
    cluster.members.forEach((id, i) => {
      const offset = sunflower(i, 0);
      positions.set(id, { x: center.x + offset.x, y: center.y + offset.y });
    });
  }
  return { positions, groupCenters };
}

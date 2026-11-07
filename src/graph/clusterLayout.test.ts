import { describe, expect, it } from 'vitest';
import { clusterLayout, discRadius } from './clusterLayout';

const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('clusterLayout', () => {
  const groups = [
    { id: 'big', memberIds: ids('b', 47) },
    { id: 'mid', memberIds: [...ids('m', 20), 'b0'] }, // b0 is in two groups
    ...Array.from({ length: 29 }, (_, g) => ({ id: `g${g}`, memberIds: ids(`g${g}-`, 5) })),
  ];
  const result = clusterLayout({ meId: 'me', groups, ungroupedIds: ids('family', 6) });

  it('places me at the centre and everyone exactly once', () => {
    expect(result.positions.get('me')).toEqual({ x: 0, y: 0 });
    expect(result.positions.size).toBe(1 + 6 + 47 + 20 + 29 * 5);
  });

  it('never overlaps two group discs', () => {
    const centers = [...result.groupCenters];
    const radius = (id: string): number => {
      const group = groups.find((g) => g.id === id) as (typeof groups)[number];
      return discRadius(id === 'mid' ? 20 : group.memberIds.length);
    };
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const [a, pa] = centers[i] as [string, { x: number; y: number }];
        const [b, pb] = centers[j] as [string, { x: number; y: number }];
        expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeGreaterThanOrEqual(radius(a) + radius(b));
      }
    }
  });

  it('keeps ungrouped (family) people closer to me than any group', () => {
    const familyDistance = Math.max(...ids('family', 6).map((id) => Math.hypot(result.positions.get(id)!.x, result.positions.get(id)!.y)));
    const nearestGroup = Math.min(...[...result.groupCenters.values()].map((c) => Math.hypot(c.x, c.y)));
    expect(familyDistance).toBeLessThan(nearestGroup);
  });
});

import { describe, expect, it } from 'vitest';
import { convexHull } from './hull';

describe('convexHull', () => {
  it('keeps the corners and drops interior and collinear points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 },
    ];
    expect(convexHull(points)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it('returns tiny inputs unchanged (one or two members still get a blob)', () => {
    expect(convexHull([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
    expect(convexHull([])).toEqual([]);
  });
});

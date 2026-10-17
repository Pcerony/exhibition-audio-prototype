import { describe, expect, it } from 'vitest';
import { MAP_PIECE_VERSION, mapPieceLabelPoint, mapPieces, type MapPoint } from './mapPieces';
import { MAP_PIECE_CODES } from './mapPieceCodes';

const expectedCodes = [
  ...'ABDEFGH'.split('').flatMap((row) => Array.from({ length: 9 }, (_, index) => `${row}${index + 1}`)),
  ...Array.from({ length: 10 }, (_, index) => `C${index + 1}`),
].sort();

describe('Fukuoka map piece geometry', () => {
  it('contains the 73 uniquely numbered, closed v13 plate polygons', () => {
    expect(MAP_PIECE_VERSION).toBe('fukuoka-road-73-v13');
    expect(mapPieces).toHaveLength(73);
    expect(mapPieces.map((piece) => piece.code).sort()).toEqual(expectedCodes);
    expect(MAP_PIECE_CODES.slice().sort()).toEqual(expectedCodes);
    expect(new Set(mapPieces.map((piece) => piece.code)).size).toBe(73);

    for (const piece of mapPieces) {
      expect(piece.geometry.type).toBe('Polygon');
      expect(piece.geometry.coordinates).toHaveLength(1);
      const ring = piece.geometry.coordinates[0];
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring.at(-1));
      for (const [x, y] of ring) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1500);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1320);
      }
    }
  });

  it('places every map label at an interior polygon centroid', () => {
    const inside = (point: MapPoint, ring: readonly MapPoint[]) => {
      let contained = false;
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
        const [x, y] = ring[index];
        const [previousX, previousY] = ring[previous];
        if ((y > point[1]) !== (previousY > point[1])
          && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x) contained = !contained;
      }
      return contained;
    };
    for (const piece of mapPieces) {
      expect(inside(mapPieceLabelPoint(piece), piece.geometry.coordinates[0]), piece.code).toBe(true);
    }
  });
});

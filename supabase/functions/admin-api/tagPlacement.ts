import { MAP_PIECE_VERSION, mapPieces, type MapPoint } from '../../../src/domain/mapPieces.ts';

export function validPlacement(body: Record<string, unknown>): boolean {
  const { pieceCode, mapVersion, x, y, expectedVersion } = body;
  if (mapVersion !== MAP_PIECE_VERSION || typeof x !== 'number' || typeof y !== 'number'
    || !Number.isFinite(x) || !Number.isFinite(y) || typeof expectedVersion !== 'number'
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= 2147483647) return false;
  const piece = mapPieces.find(p => p.code === pieceCode);
  if (!piece) return false;
  function inside(ring: MapPoint[], px: number, py: number) {
    let hit = false;
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1], [bx, by] = ring[i];
      if ((ay > py) !== (by > py) && px < (bx - ax) * (py - ay) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  }
  const [outer, ...holes] = piece.geometry.coordinates;
  return inside(outer, x, y) && !holes.some(ring => inside(ring, x, y));
}

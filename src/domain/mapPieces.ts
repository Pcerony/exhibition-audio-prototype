import geometry from './map-piece-geometry-v13.json' with { type: 'json' };
import { MAP_PIECE_VERSION } from './mapPieceVersion';

if (geometry.version !== MAP_PIECE_VERSION) throw new Error('MAP_GEOMETRY_VERSION_MISMATCH');

export type MapPieceCode = string;
export type MapPoint = readonly [x: number, y: number];
export type MapPiece = {
  code: MapPieceCode;
  geometry: {
    type: 'Polygon';
    coordinates: MapPoint[][];
  };
};

export { MAP_PIECE_VERSION };
export const MAP_PIECE_SIZE = geometry.size as unknown as readonly [number, number];
export const mapPieces = geometry.pieces as unknown as MapPiece[];

export function mapPieceLabelPoint(piece: MapPiece): MapPoint {
  const ring = piece.geometry.coordinates[0];
  let twiceArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    weightedX += (x1 + x2) * cross;
    weightedY += (y1 + y2) * cross;
  }
  if (!twiceArea) return ring[0];
  return [weightedX / (3 * twiceArea), weightedY / (3 * twiceArea)];
}

import geometry from './map-piece-geometry-v13.json' with { type: 'json' };

export type MapPieceCode = string;
export type MapPoint = readonly [x: number, y: number];
export type MapPiece = {
  code: MapPieceCode;
  geometry: {
    type: 'Polygon';
    coordinates: MapPoint[][];
  };
};

export const MAP_PIECE_VERSION = geometry.version;
export const MAP_PIECE_SIZE = geometry.size as unknown as readonly [number, number];
export const mapPieces = geometry.pieces as unknown as MapPiece[];

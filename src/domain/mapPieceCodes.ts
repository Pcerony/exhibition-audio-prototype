export const MAP_PIECE_CODES = [
  ...['A', 'B', 'D', 'E', 'F', 'G', 'H'].flatMap((row) => Array.from({ length: 9 }, (_, index) => `${row}${index + 1}`)),
  ...Array.from({ length: 10 }, (_, index) => `C${index + 1}`),
];

const mapPieceCodeSet = new Set<string>(MAP_PIECE_CODES);

export function isMapPieceCode(value: unknown): value is string {
  return typeof value === 'string' && mapPieceCodeSet.has(value);
}

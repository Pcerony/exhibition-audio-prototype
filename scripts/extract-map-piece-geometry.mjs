import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const expectedSha256 = 'ac6efa9aa3a8ae1f1f5aad60302a11d7c5bc6df208a5b07d3ad3a9d1999da8a1';
const sourceCommit = 'a4270a1b2ee0a150997fde0d69fe1ca033e536a9';
const inputPath = process.argv[2];
if (!inputPath) throw new Error('Usage: node scripts/extract-map-piece-geometry.mjs <pinned-index.html>');

const source = readFileSync(inputPath, 'utf8');
const sourceHash = createHash('sha256').update(source).digest('hex');
if (sourceHash !== expectedSha256) throw new Error('MAP_SOURCE_HASH_MISMATCH');

const embedded = source.match(/<script id="partition-data" type="application\/json">([\s\S]*?)<\/script>/);
if (!embedded) throw new Error('MAP_PARTITION_DATA_MISSING');
const preview = JSON.parse(embedded[1]);
const layout = preview.layouts.find((candidate) => candidate.key === 'station_priority');
if (!layout || layout.pieces.length !== 73) throw new Error('MAP_LAYOUT_INVALID');

const expectedCodes = [
  ...'ABDEFGH'.split('').flatMap((row) => Array.from({ length: 9 }, (_, index) => `${row}${index + 1}`)),
  ...Array.from({ length: 10 }, (_, index) => `C${index + 1}`),
].sort();
const pieces = layout.pieces.map(({ name, geometry }) => {
  if (!/^(?:[A-H][1-9]|C10)$/.test(name) || geometry?.type !== 'Polygon' || geometry.coordinates.length !== 1) {
    throw new Error('MAP_PIECE_INVALID');
  }
  const ring = geometry.coordinates[0];
  if (ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) {
    throw new Error('MAP_RING_INVALID');
  }
  for (const point of ring) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)
      || point[0] < 0 || point[0] > preview.width || point[1] < 0 || point[1] > preview.height) {
      throw new Error('MAP_COORDINATE_INVALID');
    }
  }
  return { code: name, geometry };
});
if (JSON.stringify(pieces.map((piece) => piece.code).sort()) !== JSON.stringify(expectedCodes)) {
  throw new Error('MAP_PIECE_CODES_INVALID');
}

const output = {
  version: 'fukuoka-road-73-v13',
  sourceCommit,
  units: 'mm',
  size: [preview.width, preview.height],
  pieces,
};
const outputPath = resolve('src/domain/map-piece-geometry-v13.json');
writeFileSync(outputPath, `${JSON.stringify(output)}\n`);
process.stdout.write(`Wrote ${pieces.length} map pieces to ${outputPath}\n`);

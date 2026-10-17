import proj4 from 'proj4';
import { mapPieces, type MapPiece, type MapPieceCode, type MapPoint } from './mapPieces.ts';

const WGS84 = 'EPSG:4326';
const FUKUOKA_PLANE = 'EPSG:6670';
const BOUNDARY_REVIEW_METERS = 25;

proj4.defs(
  FUKUOKA_PLANE,
  '+proj=tmerc +lat_0=33 +lon_0=131 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
);

const controlPoints = [
  {
    location: { lng: 130.3986370049, lat: 33.5912638547 },
    map: [206.62921348314543, 948.1789886226901] as const,
  },
  {
    location: { lng: 130.4205670075, lat: 33.5899988528 },
    map: [1240.786516853931, 853.9689494938127] as const,
  },
] as const;

function projectToPlane(location: { lng: number; lat: number }): readonly [number, number] | null {
  if (!Number.isFinite(location.lng) || !Number.isFinite(location.lat)
    || Math.abs(location.lng) > 180 || Math.abs(location.lat) > 90) return null;
  try {
    const [east, north] = proj4(WGS84, FUKUOKA_PLANE, [location.lng, location.lat]);
    return Number.isFinite(east) && Number.isFinite(north) ? [east, north] : null;
  } catch {
    return null;
  }
}

const projectedControls = controlPoints.map((point) => {
  const plane = projectToPlane(point.location);
  if (!plane) throw new Error('MAP_CONTROL_POINT_INVALID');
  return { plane, map: point.map };
});
const [controlA, controlB] = projectedControls;
const planeDelta: MapPoint = [
  controlB.plane[0] - controlA.plane[0],
  controlB.plane[1] - controlA.plane[1],
];
const mapDelta: MapPoint = [
  controlB.map[0] - controlA.map[0],
  controlB.map[1] - controlA.map[1],
];
const planeLength = Math.hypot(...planeDelta);
const mapLength = Math.hypot(...mapDelta);
const scale = mapLength / planeLength;
const cosine = (planeDelta[0] * mapDelta[0] + planeDelta[1] * mapDelta[1]) / (planeLength * mapLength);
const sine = (planeDelta[0] * mapDelta[1] - planeDelta[1] * mapDelta[0]) / (planeLength * mapLength);
const boundaryToleranceMm = BOUNDARY_REVIEW_METERS * scale;

type PieceBounds = { piece: MapPiece; ring: MapPoint[]; minX: number; minY: number; maxX: number; maxY: number };
const piecesWithBounds: PieceBounds[] = mapPieces.map((piece) => {
  const ring = piece.geometry.coordinates[0];
  return {
    piece,
    ring,
    minX: Math.min(...ring.map(([x]) => x)),
    minY: Math.min(...ring.map(([, y]) => y)),
    maxX: Math.max(...ring.map(([x]) => x)),
    maxY: Math.max(...ring.map(([, y]) => y)),
  };
});

export type MapPieceAssignment = {
  state: 'assigned' | 'needs_review' | 'outside_map';
  pieceCode: MapPieceCode | null;
};

export function projectLocationToMapMm(location: { lng: number; lat: number }): MapPoint | null {
  const plane = projectToPlane(location);
  if (!plane) return null;
  const east = plane[0] - controlA.plane[0];
  const north = plane[1] - controlA.plane[1];
  return [
    controlA.map[0] + scale * (cosine * east - sine * north),
    controlA.map[1] + scale * (sine * east + cosine * north),
  ];
}

function distanceToSegment(point: MapPoint, start: MapPoint, end: MapPoint) {
  const [dx, dy] = [end[0] - start[0], end[1] - start[1]];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const projection = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
  ));
  return Math.hypot(point[0] - start[0] - projection * dx, point[1] - start[1] - projection * dy);
}

function containsPoint(point: MapPoint, ring: MapPoint[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    if ((y > point[1]) !== (previousY > point[1])
      && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

export function classifyMapPoint(point: MapPoint): MapPieceAssignment {
  if (!point.every(Number.isFinite)) return { state: 'needs_review', pieceCode: null };
  const matches: MapPiece[] = [];
  let nearBoundary = false;
  for (const item of piecesWithBounds) {
    const withinBounds = point[0] >= item.minX - boundaryToleranceMm && point[0] <= item.maxX + boundaryToleranceMm
      && point[1] >= item.minY - boundaryToleranceMm && point[1] <= item.maxY + boundaryToleranceMm;
    if (!withinBounds) continue;
    if (containsPoint(point, item.ring)) matches.push(item.piece);
    for (let index = 1; index < item.ring.length; index++) {
      if (distanceToSegment(point, item.ring[index - 1], item.ring[index]) <= boundaryToleranceMm) {
        nearBoundary = true;
        break;
      }
    }
  }
  if (matches.length > 1) return { state: 'needs_review', pieceCode: null };
  if (nearBoundary) return { state: 'needs_review', pieceCode: matches[0]?.code ?? null };
  if (matches.length === 1) return { state: 'assigned', pieceCode: matches[0].code };
  return { state: 'outside_map', pieceCode: null };
}

export function classifyMapLocation(location: { lng: number; lat: number }): MapPieceAssignment {
  const point = projectLocationToMapMm(location);
  return point ? classifyMapPoint(point) : { state: 'needs_review', pieceCode: null };
}

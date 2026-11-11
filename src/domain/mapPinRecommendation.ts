import { classifyMapPoint, projectLocationToMapMm } from './mapPieceAssignment.ts';
import type { MapPoint } from './location.ts';

export function mapPinRecommendation(location: MapPoint) {
  const point = projectLocationToMapMm(location);
  const assignment = point ? classifyMapPoint(point) : { state: 'needs_review' as const, pieceCode: null };
  if (!point || !assignment.pieceCode) return { ...assignment, x: null, y: null };
  return { ...assignment, x: point[0], y: point[1] };
}

import { describe, expect, it } from 'vitest';
import { mapPieces } from './mapPieces';
import {
  classifyMapLocation,
  classifyMapPoint,
  projectLocationToMapMm,
} from './mapPieceAssignment';

const anchors = [
  { location: { lng: 130.3986370049, lat: 33.5912638547 }, map: [206.62921348314543, 948.1789886226901] },
  { location: { lng: 130.4205670075, lat: 33.5899988528 }, map: [1240.786516853931, 853.9689494938127] },
] as const;

describe('Fukuoka map piece assignment', () => {
  it('fits the pinned Tenjin and Hakata source anchors', () => {
    for (const anchor of anchors) {
      const point = projectLocationToMapMm(anchor.location);
      expect(point?.[0]).toBeCloseTo(anchor.map[0], 6);
      expect(point?.[1]).toBeCloseTo(anchor.map[1], 6);
    }
  });

  it('places independent central station checks in the expected map pieces', () => {
    const checks = [
      [{ lng: 130.4063520063, lat: 33.5946138544 }, { state: 'assigned', pieceCode: 'B4' }], // Nakasu-Kawabata
      [{ lng: 130.4143920072, lat: 33.5940738537 }, { state: 'assigned', pieceCode: 'B6' }], // Gion
      [{ lng: 130.4023837602, lat: 33.5884642502 }, { state: 'assigned', pieceCode: 'D3' }], // Tenjin-minami
      [{ lng: 130.4049620049, lat: 33.5840688536 }, { state: 'needs_review', pieceCode: 'E3' }], // Watanabe-dori
    ] as const;

    for (const [location, expected] of checks) {
      expect(classifyMapLocation(location)).toEqual(expected);
    }
  });

  it('does not invent a piece outside the mapped city extent', () => {
    expect(classifyMapLocation({ lng: 130.4661420185, lat: 33.6351188528 })).toEqual({ state: 'outside_map', pieceCode: null });
  });

  it('keeps polygon edges reviewable instead of choosing a neighboring piece', () => {
    const edge = mapPieces[0].geometry.coordinates[0][0];
    expect(classifyMapPoint(edge).state).toBe('needs_review');
  });

  it('fails closed for invalid geographic coordinates', () => {
    expect(classifyMapLocation({ lng: Number.NaN, lat: 33.59 })).toEqual({ state: 'needs_review', pieceCode: null });
  });
});

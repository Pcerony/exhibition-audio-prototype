import { describe, expect, it } from 'vitest';
import { memoryLocationUrl, parseMemoryLocation } from './location';

describe('memory location', () => {
  it('builds safe Google Maps links for points and place IDs', () => {
    expect(memoryLocationUrl(null)).toBeNull();
    const point = new URL(memoryLocationUrl({ source: 'pin', lat: 33, lng: 130 })!);
    expect(point.searchParams.get('query')).toBe('33,130');
    const place = new URL(memoryLocationUrl({ source: 'place', placeId: 'example&extra' })!);
    expect(place.origin).toBe('https://www.google.com');
    expect(place.searchParams.get('query_place_id')).toBe('example&extra');
  });
  it('supports skipping and old recordings', () => {
    expect(parseMemoryLocation(undefined)).toBeNull();
    expect(parseMemoryLocation(null)).toBeNull();
  });
  it('keeps a manually confirmed point', () => {
    expect(parseMemoryLocation({ source: 'pin', lat: 33.59, lng: 130.4 })).toEqual({ source: 'pin', lat: 33.59, lng: 130.4 });
  });
  it('stores only the place ID from search, not Google content', () => {
    expect(parseMemoryLocation({ source: 'place', placeId: 'example-place', lat: 33, displayName: 'Google name' })).toEqual({ source: 'place', placeId: 'example-place' });
  });
  it.each([
    {}, [], 'point', { source: 'gps', lat: 33, lng: 130 },
    { source: 'pin', lat: 91, lng: 130 }, { source: 'pin', lat: 33, lng: -181 },
    { source: 'pin', lat: NaN, lng: 130 }, { source: 'pin', lat: '33', lng: 130 },
    { source: 'place', placeId: '' }, { source: 'place', placeId: 'x'.repeat(301) },
  ])('rejects invalid input %j', (value) => {
    expect(() => parseMemoryLocation(value)).toThrow('INVALID_LOCATION');
  });
});

import { describe, expect, it } from 'vitest';
import { parseMemoryLocation } from './location';

describe('memory location', () => {
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

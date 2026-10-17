export type MemoryLocation =
  | { source: 'pin'; lat: number; lng: number }
  | { source: 'place'; placeId: string };

export type MapPoint = { lat: number; lng: number };

export function memoryLocationUrl(location: MemoryLocation | null | undefined): string | null {
  if (!location) return null;
  const query = new URLSearchParams({ api: '1', query: location.source === 'pin' ? `${location.lat},${location.lng}` : 'place' });
  if (location.source === 'place') query.set('query_place_id', location.placeId);
  return `https://www.google.com/maps/search/?${query}`;
}

export function parseMemoryLocation(value: unknown): MemoryLocation | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_LOCATION');
  const input = value as Record<string, unknown>;
  if (input.source === 'pin'
    && typeof input.lat === 'number' && Number.isFinite(input.lat) && Math.abs(input.lat) <= 90
    && typeof input.lng === 'number' && Number.isFinite(input.lng) && Math.abs(input.lng) <= 180) {
    return { source: 'pin', lat: input.lat, lng: input.lng };
  }
  if (input.source === 'place' && typeof input.placeId === 'string'
    && input.placeId.trim().length > 0 && input.placeId.length <= 300) {
    return { source: 'place', placeId: input.placeId.trim() };
  }
  throw new Error('INVALID_LOCATION');
}

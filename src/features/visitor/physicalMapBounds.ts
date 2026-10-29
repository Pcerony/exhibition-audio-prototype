export const physicalMapPolygon: google.maps.LatLngLiteral[] = [
  { lat: 33.575298803592645, lng: 130.42562375513583 },
  { lat: 33.59750820115585, lng: 130.42547657152724 },
  { lat: 33.59736364193326, lng: 130.3951457652568 },
  { lat: 33.57515436521987, lng: 130.3953007180021 },
];

const latitudes = physicalMapPolygon.map(({ lat }) => lat);
const longitudes = physicalMapPolygon.map(({ lng }) => lng);
export const physicalMapBounds: google.maps.LatLngBoundsLiteral = {
  north: Math.max(...latitudes),
  south: Math.min(...latitudes),
  east: Math.max(...longitudes),
  west: Math.min(...longitudes),
};

export function isWithinPhysicalMap(point: { lat: number; lng: number }) {
  if (point.lat < physicalMapBounds.south || point.lat > physicalMapBounds.north
    || point.lng < physicalMapBounds.west || point.lng > physicalMapBounds.east) return false;

  let inside = false;
  for (let current = 0, previous = physicalMapPolygon.length - 1; current < physicalMapPolygon.length; previous = current++) {
    const a = physicalMapPolygon[previous];
    const b = physicalMapPolygon[current];
    const cross = (point.lng - a.lng) * (b.lat - a.lat) - (point.lat - a.lat) * (b.lng - a.lng);
    const onEdge = Math.abs(cross) < 1e-12
      && point.lng >= Math.min(a.lng, b.lng) && point.lng <= Math.max(a.lng, b.lng)
      && point.lat >= Math.min(a.lat, b.lat) && point.lat <= Math.max(a.lat, b.lat);
    if (onEdge) return true;

    const crossesRay = (a.lat > point.lat) !== (b.lat > point.lat)
      && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crossesRay) inside = !inside;
  }
  return inside;
}

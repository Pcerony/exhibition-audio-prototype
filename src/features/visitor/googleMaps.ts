import type { MemoryLocation } from '../../domain/location';
import { isWithinPhysicalMap, physicalMapBounds, physicalMapPolygon } from './physicalMapBounds';

export type MapPointWgs84 = { lat: number; lng: number };
export type LocationSelection = { location: MemoryLocation; mapPoint: MapPointWgs84 };

let loading: Promise<void> | undefined;
function loadMaps(language: string): Promise<void> {
  if (loading) return loading;
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.reject(new Error('MAPS_CONFIG_MISSING'));
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const callback = '__voiceMapsReady';
    const globals = window as unknown as Record<string, unknown>;
    const timer = window.setTimeout(() => fail(), 15000);
    const fail = () => {
      clearTimeout(timer);
      delete globals[callback];
      script.remove();
      reject(new Error('MAPS_UNAVAILABLE'));
    };
    globals[callback] = () => { clearTimeout(timer); delete globals[callback]; resolve(); };
    const query = new URLSearchParams({ key, loading: 'async', callback, v: 'quarterly', language, region: 'JP', libraries: 'places' });
    script.src = `https://maps.googleapis.com/maps/api/js?${query}`;
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

function coordinatesOf(location: google.maps.LatLng | google.maps.LatLngLiteral) {
  const lat = location.lat;
  const lng = location.lng;
  return {
    lat: typeof lat === 'number' ? lat : lat.call(location),
    lng: typeof lng === 'number' ? lng : lng.call(location),
  };
}

export async function mountLocationMap(options: {
  mapElement: HTMLElement; searchElement: HTMLElement; language: string;
  onSelect: (selection: LocationSelection | null) => void; onError: () => void;
}): Promise<() => void> {
  await loadMaps(options.language);
  const center = {
    lat: (physicalMapBounds.north + physicalMapBounds.south) / 2,
    lng: (physicalMapBounds.east + physicalMapBounds.west) / 2,
  };
  const map = new google.maps.Map(options.mapElement, {
    center, zoom: 13, mapTypeControl: false, streetViewControl: false,
    fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy',
  });
  const boundary = new google.maps.Polygon({
    paths: physicalMapPolygon,
    strokeColor: '#526d20', strokeOpacity: 0.95, strokeWeight: 3,
    fillColor: '#b2d249', fillOpacity: 0.12, clickable: false,
  });
  boundary.setMap(map);
  let disposed = false;
  let mapInitialized = false;
  let selectionRevision = 0;
  let programmatic = false;
  let lastCenter = center;
  const selectCenter = () => {
    selectionRevision++;
    const point = map.getCenter();
    if (!point || disposed) return;
    const mapPoint = { lat: point.lat(), lng: point.lng() };
    options.onSelect(isWithinPhysicalMap(mapPoint) ? { location: { source: 'pin', ...mapPoint }, mapPoint } : null);
  };
  const drag = map.addListener('dragend', selectCenter);
  const idle = map.addListener('idle', () => { mapInitialized = true; });
  const centerChange = map.addListener('center_changed', () => {
    const point = map.getCenter();
    if (!point) return;
    const next = { lat: point.lat(), lng: point.lng() };
    const changed = Math.abs(next.lat - lastCenter.lat) > 1e-9 || Math.abs(next.lng - lastCenter.lng) > 1e-9;
    lastCenter = next;
    if (changed && mapInitialized && !programmatic) selectCenter();
  });
  const click = map.addListener('click', (event: google.maps.MapMouseEvent) => {
    if (!event.latLng) return;
    const coordinates = { lat: event.latLng.lat(), lng: event.latLng.lng() };
    if (!isWithinPhysicalMap(coordinates)) { options.onSelect(null); return; }
    programmatic = true;
    lastCenter = coordinates;
    try { map.setCenter(event.latLng); }
    finally { programmatic = false; }
    selectCenter();
  });
  const search = new google.maps.places.PlaceAutocompleteElement({
    locationRestriction: physicalMapBounds,
  });
  options.searchElement.append(search);
  const choose = async (event: Event) => {
    const revision = ++selectionRevision;
    options.onSelect(null);
    try {
      const place = (event as google.maps.places.PlacePredictionSelectEvent).placePrediction.toPlace();
      await place.fetchFields({ fields: ['location'] });
      if (disposed || revision !== selectionRevision) return;
      if (!place.location || !place.id) throw new Error('PLACE_UNAVAILABLE');
      const coordinates = coordinatesOf(place.location);
      if (!isWithinPhysicalMap(coordinates)) return;
      programmatic = true;
      lastCenter = coordinates;
      try {
        map.setCenter(place.location);
        map.setZoom(16);
      } finally { programmatic = false; }
      options.onSelect({
        location: { source: 'place', placeId: place.id },
        mapPoint: coordinates,
      });
    } catch { if (!disposed && revision === selectionRevision) options.onError(); }
  };
  const error = () => { if (!disposed) options.onError(); };
  search.addEventListener('gmp-select', choose);
  search.addEventListener('gmp-error', error);
  return () => {
    disposed = true;
    drag.remove(); idle.remove(); click.remove(); centerChange.remove();
    boundary.setMap(null);
    search.removeEventListener('gmp-select', choose);
    search.removeEventListener('gmp-error', error);
    search.remove();
  };
}

export async function mountMemoryLocationMap(options: {
  mapElement: HTMLElement; location: MemoryLocation; language: string; onReady: () => void; onError: () => void;
  onPoint?: (point:MapPointWgs84)=>void;
}): Promise<() => void> {
  await loadMaps(options.language);
  let disposed = false;
  const point = options.location.source === 'pin'
    ? { lat: options.location.lat, lng: options.location.lng }
    : { lat: 33.5902, lng: 130.4017 };
  const map = new google.maps.Map(options.mapElement, {
    center: point, zoom: options.location.source === 'pin' ? 16 : 13,
    disableDefaultUI: true, clickableIcons: false, gestureHandling: 'none',
  });

  if (options.location.source === 'pin') {options.onReady();options.onPoint?.(point);}
  else {
    const place = new google.maps.places.Place({ id: options.location.placeId });
    void place.fetchFields({ fields: ['location'] }).then(() => {
      if (disposed) return;
      if (place.location) {
        map.setCenter(place.location);
        map.setZoom(16);
        options.onPoint?.({lat:place.location.lat(),lng:place.location.lng()});
        options.onReady();
      } else options.onError();
    }).catch(() => { if (!disposed) options.onError(); });
  }

  return () => { disposed = true; };
}

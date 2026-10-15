import type { MemoryLocation } from '../../domain/location';

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

export async function mountLocationMap(options: {
  mapElement: HTMLElement; searchElement: HTMLElement; language: string;
  onSelect: (location: MemoryLocation) => void; onError: () => void;
}): Promise<() => void> {
  await loadMaps(options.language);
  const center = { lat: 33.5902, lng: 130.4017 };
  const map = new google.maps.Map(options.mapElement, {
    center, zoom: 13, mapTypeControl: false, streetViewControl: false,
    fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy',
  });
  let disposed = false;
  let selectionRevision = 0;
  const selectCenter = () => {
    selectionRevision++;
    const point = map.getCenter();
    if (point && !disposed) options.onSelect({ source: 'pin', lat: point.lat(), lng: point.lng() });
  };
  const drag = map.addListener('dragend', selectCenter);
  const click = map.addListener('click', (event: google.maps.MapMouseEvent) => {
    if (event.latLng) { map.setCenter(event.latLng); selectCenter(); }
  });
  const search = new google.maps.places.PlaceAutocompleteElement({
    locationBias: { center, radius: 25000 },
  });
  options.searchElement.append(search);
  const choose = async (event: Event) => {
    const revision = ++selectionRevision;
    try {
      const place = (event as google.maps.places.PlacePredictionSelectEvent).placePrediction.toPlace();
      await place.fetchFields({ fields: ['location'] });
      if (disposed || revision !== selectionRevision) return;
      if (!place.location || !place.id) throw new Error('PLACE_UNAVAILABLE');
      map.setCenter(place.location);
      map.setZoom(16);
      options.onSelect({ source: 'place', placeId: place.id });
    } catch { if (!disposed && revision === selectionRevision) options.onError(); }
  };
  const error = () => { if (!disposed) options.onError(); };
  search.addEventListener('gmp-select', choose);
  search.addEventListener('gmp-error', error);
  return () => {
    disposed = true;
    drag.remove(); click.remove();
    search.removeEventListener('gmp-select', choose);
    search.removeEventListener('gmp-error', error);
    search.remove();
  };
}

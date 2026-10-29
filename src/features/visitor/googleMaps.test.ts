import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let center = { lat: 33.5902, lng: 130.4017 };
let listeners: Record<string, (...args: unknown[]) => void>;
let mapOptions: google.maps.MapOptions;
let placeFields: string[];
let autocompleteOptions: google.maps.places.PlaceAutocompleteElementOptions;
let polygonOptions: google.maps.PolygonOptions;
let polygonDetached: boolean;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key');
  listeners = {};
  center = { lat: 33.5902, lng: 130.4017 };
  mapOptions = {};
  placeFields = [];
  autocompleteOptions = {};
  polygonOptions = {};
  polygonDetached = false;
  vi.stubGlobal('google', { maps: {
    Map: class {
      constructor(_element: HTMLElement, options: google.maps.MapOptions) {
        mapOptions = options;
        center = options.center as typeof center;
      }
      getCenter() { return { lat: () => center.lat, lng: () => center.lng }; }
      addListener(name: string, callback: (...args: unknown[]) => void) { listeners[name] = callback; return { remove() {} }; }
      setCenter(value: typeof center | { lat: () => number; lng: () => number }) {
        if (typeof (value as { lat: unknown }).lat === 'function') {
          const point = value as { lat: () => number; lng: () => number };
          center = { lat: point.lat(), lng: point.lng() };
        } else center = value as typeof center;
        listeners.center_changed?.();
      }
      setZoom() {}
    },
    Polygon: class {
      constructor(options: google.maps.PolygonOptions) { polygonOptions = options; }
      setMap(map: google.maps.Map | null) { if (!map) polygonDetached = true; }
    },
    places: {
      PlaceAutocompleteElement: class { constructor(options: google.maps.places.PlaceAutocompleteElementOptions) { autocompleteOptions = options; return document.createElement('div'); } },
      Place: class {
        location = { lat: () => 33.61, lng: () => 130.43 };
        constructor(_options: { id: string }) {}
        async fetchFields(options: { fields: string[] }) { placeFields = options.fields; }
      },
    },
  } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); document.head.querySelectorAll('script').forEach((script) => script.remove()); });

async function mount() {
  const { mountLocationMap } = await import('./googleMaps');
  const onSelect = vi.fn();
  const search = document.createElement('div');
  const result = mountLocationMap({ mapElement: document.createElement('div'), searchElement: search, language: 'ja', onSelect, onError: vi.fn() });
  (window as unknown as Record<string, () => void>).__voiceMapsReady();
  return { onSelect, search, dispose: await result };
}

it('tracks keyboard/camera center movement without selecting the initial center', async () => {
  const map = await mount();
  center = { lat: 33.59, lng: 130.42 };
  listeners.center_changed?.();
  expect(map.onSelect).not.toHaveBeenCalled();
  listeners.idle?.();
  expect(map.onSelect).not.toHaveBeenCalled();
  center = { lat: 33.591, lng: 130.421 };
  listeners.center_changed?.();
  listeners.idle?.();
  expect(map.onSelect).toHaveBeenLastCalledWith({ location: { source: 'pin', ...center }, mapPoint: center });
  map.dispose();
});

it('keeps the physical boundary visible and restricts place search without clamping map movement', async () => {
  const map = await mount();
  const { isWithinPhysicalMap, physicalMapBounds, physicalMapPolygon } = await import('./physicalMapBounds');

  expect(physicalMapBounds).toEqual({
    north: 33.59750820115585,
    south: 33.57515436521987,
    east: 130.42562375513583,
    west: 130.3951457652568,
  });
  expect(mapOptions.restriction).toBeUndefined();
  expect(mapOptions.zoom).toBe(13);
  expect(autocompleteOptions).toEqual({ locationRestriction: physicalMapBounds });
  expect(polygonOptions.paths).toEqual(physicalMapPolygon);
  expect(isWithinPhysicalMap(physicalMapPolygon[0])).toBe(true);
  expect(isWithinPhysicalMap({ lat: 33.586, lng: 130.41 })).toBe(true);
  expect(isWithinPhysicalMap({ lat: 33.5975, lng: 130.4256 })).toBe(false);
  map.dispose();
  expect(polygonDetached).toBe(true);
});

it('allows panning beyond the footprint but selects only points inside its edge', async () => {
  const map = await mount();
  const { physicalMapPolygon } = await import('./physicalMapBounds');
  listeners.idle?.();
  center = { lat: 33.6, lng: 130.41 };
  listeners.center_changed?.();
  expect(map.onSelect).toHaveBeenLastCalledWith(null);

  center = physicalMapPolygon[0];
  listeners.center_changed?.();

  expect(map.onSelect).toHaveBeenLastCalledWith({ location: { source: 'pin', ...physicalMapPolygon[0] }, mapPoint: physicalMapPolygon[0] });
  map.dispose();
});

it('does not select map clicks outside the physical map footprint', async () => {
  const map = await mount();
  const outside = { lat: () => 33.5975, lng: () => 130.4256 } as google.maps.LatLng;
  listeners.click?.({ latLng: outside } as google.maps.MapMouseEvent);

  expect(map.onSelect).toHaveBeenLastCalledWith(null);
  expect(center).toEqual({ lat: 33.58633128318786, lng: 130.41038476019634 });
  map.dispose();
});

it('ignores a place result outside the physical map footprint', async () => {
  const map = await mount();
  const event = Object.assign(new Event('gmp-select'), { placePrediction: { toPlace: () => ({
    id: 'outside-place', location: { lat: 33.5975, lng: 130.4256 }, fetchFields: async () => {},
  }) } });
  map.search.firstElementChild!.dispatchEvent(event);
  await vi.waitFor(() => expect(map.onSelect).toHaveBeenLastCalledWith(null));
  expect(center).toEqual({ lat: 33.58633128318786, lng: 130.41038476019634 });
  map.dispose();
});

it('invalidates the previous point while a search result is loading', async () => {
  const map = await mount();
  center = { lat: 33.59, lng: 130.42 };
  listeners.dragend?.();
  const event = Object.assign(new Event('gmp-select'), { placePrediction: { toPlace: () => ({ fetchFields: () => new Promise(() => {}) }) } });
  map.search.firstElementChild!.dispatchEvent(event);
  expect(map.onSelect).toHaveBeenLastCalledWith(null);
  map.dispose();
});

it('keeps a resolved search result as a place rather than converting it to a pin', async () => {
  const map = await mount();
  const event = Object.assign(new Event('gmp-select'), { placePrediction: { toPlace: () => ({
    id: 'synthetic-place', location: { lat: () => 33.59, lng: () => 130.42 }, fetchFields: async () => {},
  }) } });
  map.search.firstElementChild!.dispatchEvent(event);
  await vi.waitFor(() => expect(map.onSelect).toHaveBeenLastCalledWith({
    location: { source: 'place', placeId: 'synthetic-place' }, mapPoint: { lat: 33.59, lng: 130.42 },
  }));
  map.dispose();
});

it('centers a read-only memory map on a manually selected point', async () => {
  const { mountMemoryLocationMap } = await import('./googleMaps');
  const onPoint=vi.fn();
  const result = mountMemoryLocationMap({
    mapElement: document.createElement('div'), language: 'ja',
    location: { source: 'pin', lat: 33.6, lng: 130.42 }, onReady: vi.fn(), onError: vi.fn(),onPoint,
  });
  (window as unknown as Record<string, () => void>).__voiceMapsReady();
  const dispose = await result;

  expect(mapOptions.center).toEqual({ lat: 33.6, lng: 130.42 });
  expect(mapOptions.gestureHandling).toBe('none');
  expect(onPoint).toHaveBeenCalledWith({lat:33.6,lng:130.42});
  dispose();
});

it('resolves a selected place ID to a map center without requesting or storing its name', async () => {
  const { mountMemoryLocationMap } = await import('./googleMaps');
  const onPoint=vi.fn(),before=JSON.stringify(localStorage);
  const result = mountMemoryLocationMap({
    mapElement: document.createElement('div'), language: 'ja',
    location: { source: 'place', placeId: 'selected-place' }, onReady: vi.fn(), onError: vi.fn(),onPoint,
  });
  (window as unknown as Record<string, () => void>).__voiceMapsReady();
  const dispose = await result;
  await vi.waitFor(() => expect(center).toEqual({ lat: 33.61, lng: 130.43 }));

  expect(placeFields).toEqual(['location']);
  expect(onPoint).toHaveBeenCalledWith({lat:33.61,lng:130.43});
  expect(JSON.stringify(localStorage)).toBe(before);
  dispose();
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let center = { lat: 33.5902, lng: 130.4017 };
let listeners: Record<string, () => void>;
let mapOptions: google.maps.MapOptions;
let placeFields: string[];
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key');
  listeners = {};
  center = { lat: 33.5902, lng: 130.4017 };
  mapOptions = {};
  placeFields = [];
  vi.stubGlobal('google', { maps: {
    Map: class {
      constructor(_element: HTMLElement, options: google.maps.MapOptions) {
        mapOptions = options;
        center = options.center as typeof center;
      }
      getCenter() { return { lat: () => center.lat, lng: () => center.lng }; }
      addListener(name: string, callback: () => void) { listeners[name] = callback; return { remove() {} }; }
      setCenter(value: typeof center) { center = value; listeners.center_changed?.(); }
      setZoom() {}
    },
    places: {
      PlaceAutocompleteElement: class { constructor() { return document.createElement('div'); } },
      Place: class {
        location = { lat: 33.61, lng: 130.43 };
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
  listeners.idle?.();
  expect(map.onSelect).not.toHaveBeenCalled();
  center = { lat: 33.6, lng: 130.42 };
  listeners.center_changed?.();
  listeners.idle?.();
  expect(map.onSelect).toHaveBeenLastCalledWith({ source: 'pin', ...center });
  map.dispose();
});

it('invalidates the previous point while a search result is loading', async () => {
  const map = await mount();
  center = { lat: 33.6, lng: 130.42 };
  listeners.dragend?.();
  const event = Object.assign(new Event('gmp-select'), { placePrediction: { toPlace: () => ({ fetchFields: () => new Promise(() => {}) }) } });
  map.search.firstElementChild!.dispatchEvent(event);
  expect(map.onSelect).toHaveBeenLastCalledWith(null);
  map.dispose();
});

it('keeps a resolved search result as a place rather than converting it to a pin', async () => {
  const map = await mount();
  const event = Object.assign(new Event('gmp-select'), { placePrediction: { toPlace: () => ({
    id: 'synthetic-place', location: { lat: 33.61, lng: 130.43 }, fetchFields: async () => {},
  }) } });
  map.search.firstElementChild!.dispatchEvent(event);
  await vi.waitFor(() => expect(map.onSelect).toHaveBeenLastCalledWith({ source: 'place', placeId: 'synthetic-place' }));
  map.dispose();
});

it('centers a read-only memory map on a manually selected point', async () => {
  const { mountMemoryLocationMap } = await import('./googleMaps');
  const result = mountMemoryLocationMap({
    mapElement: document.createElement('div'), language: 'ja',
    location: { source: 'pin', lat: 33.6, lng: 130.42 }, onReady: vi.fn(), onError: vi.fn(),
  });
  (window as unknown as Record<string, () => void>).__voiceMapsReady();
  const dispose = await result;

  expect(mapOptions.center).toEqual({ lat: 33.6, lng: 130.42 });
  expect(mapOptions.gestureHandling).toBe('none');
  dispose();
});

it('resolves a selected place ID to a map center without requesting or storing its name', async () => {
  const { mountMemoryLocationMap } = await import('./googleMaps');
  const result = mountMemoryLocationMap({
    mapElement: document.createElement('div'), language: 'ja',
    location: { source: 'place', placeId: 'selected-place' }, onReady: vi.fn(), onError: vi.fn(),
  });
  (window as unknown as Record<string, () => void>).__voiceMapsReady();
  const dispose = await result;
  await vi.waitFor(() => expect(center).toEqual({ lat: 33.61, lng: 130.43 }));

  expect(placeFields).toEqual(['location']);
  dispose();
});

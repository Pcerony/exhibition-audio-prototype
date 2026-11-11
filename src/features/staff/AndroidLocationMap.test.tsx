import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { mountMemoryLocationMap } from '../visitor/googleMaps';
import AndroidLocationMap from './AndroidLocationMap';

vi.mock('../visitor/googleMaps', () => ({
  mountMemoryLocationMap: vi.fn(async (options: { onReady: () => void }) => {
    options.onReady();
    return () => {};
  }),
}));

it('renders a Google Maps link for a stored point', () => {
  const location = { source: 'pin', lat: 33.59, lng: 130.4 };
  render(<AndroidLocationMap hash={`#/android-location?lang=zh&location=${encodeURIComponent(JSON.stringify(location))}`} />);
  const href = new URL(screen.getByRole('link', { name: '在 Google 地图打开' }).getAttribute('href')!);
  expect(href.host).toBe('www.google.com');
  expect(href.searchParams.get('query')).toBe('33.59,130.4');
});

it('requires an explicit pick before offering confirmation for a Place ID', () => {
  const location = { source: 'place', placeId: 'synthetic-place' };
  render(<AndroidLocationMap hash={`#/android-location?pick=1&lang=en&location=${encodeURIComponent(JSON.stringify(location))}`} />);
  expect(screen.queryByRole('link', { name: 'Confirm point' })).toBeNull();
  act(() => vi.mocked(mountMemoryLocationMap).mock.lastCall![0].onPick!({ lat: 33.59, lng: 130.4 }));
  expect(screen.getByRole('link', { name: 'Confirm point' })).toHaveAttribute('href', './?confirmLat=33.59&confirmLng=130.4');
});

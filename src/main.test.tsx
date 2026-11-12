import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('react-dom/client', async (original) => {
  const actual = await original<typeof import('react-dom/client')>();
  return { ...actual, default: { createRoot: () => ({ render }) } };
});
vi.mock('./features/visitor/googleMaps', () => ({
  mountMemoryLocationMap: vi.fn(async ({ onError }: { onError: () => void }) => {
    onError();
    return () => {};
  }),
}));

it('boots the Android preview when the WebView denies DOM storage', async () => {
  const location = encodeURIComponent(JSON.stringify({ source: 'pin', lat: 33.59, lng: 130.4 }));
  window.history.replaceState(null, '', `/#/android-location?lang=en&location=${location}`);
  const container = document.createElement('div');
  container.id = 'root';
  document.body.append(container);
  const storage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Storage disabled', 'SecurityError');
  });
  try {
    await import('./main');
    expect(await screen.findByRole('link', { name: 'Open in Google Maps' })).toBeVisible();
    expect(storage).not.toHaveBeenCalled();
  } finally {
    storage.mockRestore();
    container.remove();
    window.history.replaceState(null, '', '/');
  }
});

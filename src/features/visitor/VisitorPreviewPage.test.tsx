import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { VisitorPreviewPage, createPreviewRepository } from './VisitorPreviewPage';

it('always starts fresh and offers an explicit restart without network storage', async () => {
  localStorage.setItem('exhibition-audio-language-v2', 'en');
  const fetch = vi.spyOn(globalThis, 'fetch');
  render(<I18nProvider><VisitorPreviewPage /></I18nProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Begin' }));
  expect(screen.getByRole('heading', { name: 'What is your memory about?' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
  expect(await screen.findByRole('button', { name: 'Begin' })).toBeVisible();
  expect(screen.getByText('Preview · No upload')).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});

it('keeps simulated submissions in this run only', async () => {
  const first = createPreviewRepository();
  const tag = await first.getTag('preview');
  expect(tag?.recording).toBeNull();
  expect((await first.claim('preview', { id: 'fixture', blob: new Blob(['test']), nickname: '', duration: 1 })).status).toBe('claimed');
  expect((await first.getTag('preview'))?.recording).not.toBeNull();
  expect((await createPreviewRepository().getTag('preview'))?.recording).toBeNull();
});

it('simulates recording and submission, then restarts unbound without uploading', async () => {
  localStorage.setItem('exhibition-audio-language-v2', 'en');
  vi.stubGlobal('MediaRecorder', class {
    state = 'inactive'; mimeType = 'audio/webm';
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['fixture']) }); this.onstop?.(); }
  });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
  } });
  const fetch = vi.spyOn(globalThis, 'fetch');
  render(<I18nProvider><VisitorPreviewPage /></I18nProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Begin' }));
  fireEvent.click(screen.getByRole('button', { name: 'Food' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Skip to recording' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Finish recording' }));
  fireEvent.click(screen.getByRole('button', { name: 'Leave this voice' }));
  expect(await screen.findByLabelText('Play recording')).toHaveAttribute('src', expect.stringContaining('blob:'));
  expect(fetch.mock.calls.some(([url]) => String(url).includes('.supabase.co'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
  expect(await screen.findByRole('button', { name: 'Begin' })).toBeVisible();
  expect(screen.queryByLabelText('Play recording')).not.toBeInTheDocument();
  fetch.mockRestore();
  vi.unstubAllGlobals();
});

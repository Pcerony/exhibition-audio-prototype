import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n/I18nProvider';
import { SoundMapPage } from './SoundMapPage';
import type { SoundMapEntry, SoundMapRepository } from '../../../storage/soundMapRepository';

vi.mock('./scene', () => ({ topicColors: {}, mountSoundMap: vi.fn().mockRejectedValue(new Error('No WebGL in test')) }));
const entry: SoundMapEntry = { id: 'fictional-recording', token: 'a'.repeat(48), label: 'TEST-A001', categoryCode: 'A',
  durationSeconds: 12, createdAt: '2026-10-16T23:30:00Z', location: null };
beforeEach(() => { localStorage.setItem('exhibition-audio-language-v2', 'zh-CN'); });
it('uses a human description in the list and player, never the internal tag number', async () => {
  const repository: SoundMapRepository = { list: vi.fn().mockResolvedValue([entry]), playback: vi.fn().mockResolvedValue(null) };
  render(<I18nProvider><SoundMapPage repository={repository} onClose={vi.fn()} /></I18nProvider>);
  const button = await screen.findByRole('button', { name: /某位参与者于10月17日留下的关于美食的留言/ });
  expect(screen.queryByText('TEST-A001')).not.toBeInTheDocument();
  fireEvent.click(button);
  expect(screen.getByRole('heading', { name: '某位参与者于10月17日留下的关于美食的留言' })).toBeVisible();
  expect(screen.queryByText('TEST-A001')).not.toBeInTheDocument();
});

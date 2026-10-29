import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AudioReviewPanel } from './AudioReviewPanel';
import type { AudioAdminRepository } from '../../storage/audioAdminRepository';
import { decodeReviewAudio } from '../../domain/audioEditing';
vi.mock('../../domain/audioEditing', async importOriginal => ({ ...await importOriginal<object>(), decodeReviewAudio: vi.fn(async () => ({ samples: new Float32Array(16000 * 6).fill(.2), meanDb: -14 })) }));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
function fixture() {
  const detail = { originalUrl: 'https://example.invalid/original', revision: 0, activeVersionId: null, versions: [] };
  const repo: AudioAdminRepository = { list: vi.fn(async () => [{ id: 'r1', label: 'SYNTHETIC-A001', createdAt: '2026-10-18T03:00:00Z', reportedDuration: 30, sizeBytes: 100, revision: 0, activeVersionId: null, measuredDuration: null, meanDb: null }]), detail: vi.fn(async () => detail), measure: vi.fn(async () => {}), save: vi.fn(async () => {}), restore: vi.fn(async () => {}) };
  return repo;
}
it('loads original waveform, records measured duration and saves an explicit selected range', async () => {
  const repository = fixture(); render(<AudioReviewPanel repository={repository} onClose={() => {}} onAuthError={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /SYNTHETIC-A001/ }));
  await screen.findByRole('slider', { name: '剪辑起点 / 開始' });
  await waitFor(() => expect(repository.measure).toHaveBeenCalledWith('r1', 6, -14));
  fireEvent.keyDown(screen.getByRole('slider', { name: '剪辑终点 / 終了' }), { key: 'ArrowLeft' });
  fireEvent.click(screen.getByRole('button', { name: /保存为主音频/ }));
  await waitFor(() => expect(repository.save).toHaveBeenCalled());
  expect(vi.mocked(repository.save).mock.calls[0][0]).toMatchObject({ recordingId: 'r1', revision: 0, start: 0, end: 5.9 });
  expect(screen.getByText(/主音频已更新/)).toBeInTheDocument();
});
it('surfaces version conflicts and never claims a failed save succeeded', async () => {
  const repository = fixture(); vi.mocked(repository.save).mockRejectedValue(Error('AUDIO_VERSION_CONFLICT'));
  render(<AudioReviewPanel repository={repository} onClose={() => {}} onAuthError={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /SYNTHETIC-A001/ }));
  await screen.findByRole('slider', { name: '剪辑起点 / 開始' });
  await waitFor(() => expect(screen.getByRole('button', { name: /保存为主音频/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /保存为主音频/ }));
  await screen.findByRole('alert'); expect(screen.queryByText(/主音频已更新/)).not.toBeInTheDocument();
});

it('clears prior audio and waveform when another recording cannot be decoded', async () => {
  const repository = fixture();
  const first = (await repository.list())[0]; vi.mocked(repository.list).mockResolvedValue([first, { ...first, id: 'r2', label: 'SYNTHETIC-B002' }]);
  render(<AudioReviewPanel repository={repository} onClose={() => {}} onAuthError={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /SYNTHETIC-A001/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: '试听选段 / 選択範囲を再生' })).toBeEnabled());
  vi.mocked(decodeReviewAudio).mockRejectedValueOnce(Error('DECODE_FAILED'));
  fireEvent.click(screen.getByRole('button', { name: /SYNTHETIC-B002/ }));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: '试听选段 / 選択範囲を再生' })).toBeDisabled();
  expect(screen.queryByRole('slider', { name: '剪辑起点 / 開始' })).not.toBeInTheDocument();
  expect(document.querySelector('.ar-editor>audio')).not.toHaveAttribute('src');
});

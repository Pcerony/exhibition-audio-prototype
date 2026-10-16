import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TranscriptionDialog } from './TranscriptionDialog';

const transcription = { recordingId: 'r1', status: 'ready' as const, text: '元の文章', published: false, version: 3, errorCode: null, updatedAt: '2026-10-17T00:00:00Z' };
function setup(options = {}) {
  const repository = {
    getTranscription: vi.fn().mockResolvedValue({ configured: true, consented: true, transcription, ...options }),
    retryTranscription: vi.fn().mockResolvedValue(undefined),
    saveTranscription: vi.fn().mockResolvedValue(undefined),
  };
  const onAuthError = vi.fn();
  const onClose = vi.fn();
  render(<TranscriptionDialog repository={repository} recordingId="r1" label="A001" locale="ja-JP" onAuthError={onAuthError} onClose={onClose} />);
  return { repository, onAuthError, onClose };
}
it('shows missing configuration and never starts a provider request on opening', async () => {
  const { repository } = setup({ configured: false });
  expect(await screen.findByText('AI文字起こしが未設定です。')).toBeVisible();
  expect(screen.getByRole('button', { name: '再試行' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '公開' })).toBeEnabled();
  expect(repository.retryTranscription).not.toHaveBeenCalled();
});
it('does not infer consent or create a task for an old recording', async () => {
  const { repository } = setup({ consented: false, transcription: null });
  expect(await screen.findByText('この録音にはAI文字起こしの同意がありません。')).toBeVisible();
  expect(screen.getByRole('button', { name: '再試行' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '公開' })).toBeDisabled();
  expect(repository.retryTranscription).not.toHaveBeenCalled();
});
it('saves edits as a draft and publishes or hides only through explicit actions', async () => {
  const { repository } = setup();
  const field = await screen.findByRole('textbox', { name: '文字' });
  fireEvent.change(field, { target: { value: '<b>校正した文章</b>' } });
  repository.getTranscription.mockResolvedValue({ configured: true, consented: true, transcription: { ...transcription, text: '<b>校正した文章</b>', version: 4 } });
  fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));
  await waitFor(() => expect(repository.saveTranscription).toHaveBeenCalledWith('r1', 3, '<b>校正した文章</b>', false));
  await waitFor(() => expect(screen.getByRole('button', { name: '公開' })).toBeEnabled());
  repository.getTranscription.mockResolvedValue({ configured: true, consented: true, transcription: { ...transcription, text: '<b>校正した文章</b>', published: true, version: 5 } });
  fireEvent.click(screen.getByRole('button', { name: '公開' }));
  await waitFor(() => expect(screen.getByText(/· 公開中/)).toBeVisible());
  expect(screen.queryByText('校正した文章', { selector: 'b' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '非公開にする' }));
  await waitFor(() => expect(repository.saveTranscription).toHaveBeenLastCalledWith('r1', 5, '<b>校正した文章</b>', false));
});
it('retries only the selected task version and refreshes its state', async () => {
  const { repository } = setup({ transcription: { ...transcription, status: 'failed', errorCode: 'PROVIDER_FAILED' } });
  fireEvent.click(await screen.findByRole('button', { name: '再試行' }));
  await waitFor(() => expect(repository.retryTranscription).toHaveBeenCalledWith('r1', 3));
  await waitFor(() => expect(repository.getTranscription).toHaveBeenCalledTimes(2));
});
it('preserves edits on stale errors and requires refresh before saving again', async () => {
  const { repository } = setup();
  const field = await screen.findByRole('textbox', { name: '文字' });
  fireEvent.change(field, { target: { value: '残す校正' } });
  repository.saveTranscription.mockRejectedValueOnce(new Error('VERSION_CONFLICT'));
  fireEvent.click(screen.getByRole('button', { name: '公開' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('更新');
  expect(field).toHaveValue('残す校正');
  expect(screen.getByRole('button', { name: '公開' })).toBeDisabled();
  repository.getTranscription.mockResolvedValue({ configured: true, consented: true, transcription: { ...transcription, version: 4 } });
  fireEvent.click(screen.getByRole('button', { name: '更新' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '公開' })).toBeEnabled());
  expect(field).toHaveValue('残す校正');
  fireEvent.click(screen.getByRole('button', { name: '公開' }));
  await waitFor(() => expect(repository.saveTranscription).toHaveBeenLastCalledWith('r1', 4, '残す校正', true));
});
it('contains errors and preserves edits after failed saves', async () => {
  const { repository } = setup();
  const field = await screen.findByRole('textbox', { name: '文字' });
  fireEvent.change(field, { target: { value: '保存前' } });
  repository.saveTranscription.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DETAIL'));
  fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));
  expect(await screen.findByRole('alert')).not.toHaveTextContent('PRIVATE_PROVIDER_DETAIL');
  expect(field).toHaveValue('保存前');
  expect(screen.getByRole('button', { name: '下書き保存' })).toBeEnabled();
});
it('disallows blank publication but permits a blank hidden draft', async () => {
  setup();
  fireEvent.change(await screen.findByRole('textbox', { name: '文字' }), { target: { value: '  ' } });
  expect(screen.getByRole('button', { name: '公開' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '下書き保存' })).toBeEnabled();
});
it('delegates revoked authentication without displaying private data errors', async () => {
  const { repository, onAuthError } = setup();
  await screen.findByRole('textbox', { name: '文字' });
  repository.getTranscription.mockRejectedValueOnce(new Error('AUTH_REQUIRED'));
  fireEvent.click(screen.getByRole('button', { name: '更新' }));
  await waitFor(() => expect(onAuthError).toHaveBeenCalled());
});
it('keeps focus in the loading dialog and includes the editor in its focus loop', async () => {
  setup();
  expect(screen.getByRole('dialog')).toHaveFocus();
  const field = await screen.findByRole('textbox', { name: '文字' });
  const publish = screen.getByRole('button', { name: '公開' });
  publish.focus();
  fireEvent.keyDown(publish, { key: 'Tab' });
  expect(field).toHaveFocus();
  fireEvent.keyDown(field, { key: 'Tab', shiftKey: true });
  expect(publish).toHaveFocus();
});
it('requires a task even when configuration and consent are present', async () => {
  const { repository } = setup({ transcription: null });
  expect(await screen.findByText('文字起こしのタスクがありません。')).toBeVisible();
  expect(screen.getByRole('button', { name: '再試行' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '下書き保存' })).toBeDisabled();
  expect(repository.retryTranscription).not.toHaveBeenCalled();
});
it('allows explicit manual correction while an AI task is processing', async () => {
  const { repository } = setup({ transcription: { ...transcription, status: 'processing', text: null } });
  fireEvent.change(await screen.findByRole('textbox', { name: '文字' }), { target: { value: '手動校正' } });
  fireEvent.click(screen.getByRole('button', { name: '公開' }));
  await waitFor(() => expect(repository.saveTranscription).toHaveBeenCalledWith('r1', 3, '手動校正', true));
});
it('does not reuse a consumed version after a save succeeds but its follow-up read fails', async () => {
  const { repository } = setup();
  const field = await screen.findByRole('textbox', { name: '文字' });
  fireEvent.change(field, { target: { value: '校正を保つ' } });
  repository.getTranscription.mockRejectedValueOnce(new Error('NETWORK'));
  fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));
  await screen.findByRole('alert');
  expect(field).toHaveValue('校正を保つ');
  expect(screen.getByRole('button', { name: '公開' })).toBeDisabled();
});
it('refreshes saved text from the server after a successful save', async () => {
  const { repository } = setup();
  const field = await screen.findByRole('textbox', { name: '文字' });
  fireEvent.change(field, { target: { value: '保存する校正' } });
  repository.getTranscription.mockResolvedValue({ configured: true, consented: true, transcription: { ...transcription, text: '保存する校正', version: 4 } });
  fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));
  await screen.findByText('保存しました。');
  repository.getTranscription.mockResolvedValue({ configured: true, consented: true, transcription: { ...transcription, text: '別の担当者の校正', version: 5 } });
  fireEvent.click(screen.getByRole('button', { name: '更新' }));
  await waitFor(() => expect(field).toHaveValue('別の担当者の校正'));
});
it('shows retried AI text before publishing instead of retaining the previous draft', async () => {
  const { repository } = setup();
  const field = await screen.findByRole('textbox', { name: '文字' });
  fireEvent.change(field, { target: { value: '古い校正' } });
  repository.getTranscription.mockResolvedValue({ configured: true, consented: true, transcription: { ...transcription, text: '古い校正', version: 4 } });
  fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));
  await screen.findByText('保存しました。');
  fireEvent.change(field, { target: { value: '再試行前の未保存文字' } });
  repository.getTranscription.mockResolvedValue({ configured: true, consented: true, transcription: { ...transcription, status: 'pending', text: null, version: 5 } });
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  await waitFor(() => expect(field).toHaveValue(''));
  repository.getTranscription.mockResolvedValue({ configured: true, consented: true, transcription: { ...transcription, text: '新しいAIの文字', version: 6 } });
  fireEvent.click(screen.getByRole('button', { name: '更新' }));
  await waitFor(() => expect(field).toHaveValue('新しいAIの文字'));
  fireEvent.click(screen.getByRole('button', { name: '公開' }));
  await waitFor(() => expect(repository.saveTranscription).toHaveBeenLastCalledWith('r1', 6, '新しいAIの文字', true));
});
it('preserves unsaved text across a failed retry and refresh', async () => {
  const { repository } = setup();
  const field = await screen.findByRole('textbox', { name: '文字' });
  fireEvent.change(field, { target: { value: '未保存文字' } });
  repository.retryTranscription.mockRejectedValueOnce(new Error('NETWORK'));
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  await screen.findByRole('alert');
  repository.getTranscription.mockResolvedValue({ configured: true, consented: true, transcription: { ...transcription, text: 'サーバー文字', version: 4 } });
  fireEvent.click(screen.getByRole('button', { name: '更新' }));
  await waitFor(() => expect(repository.getTranscription).toHaveBeenCalledTimes(2));
  expect(field).toHaveValue('未保存文字');
});

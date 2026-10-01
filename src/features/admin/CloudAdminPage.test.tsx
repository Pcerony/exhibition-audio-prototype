import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminRepository, ManagedTag } from '../../storage/adminRepository';
import { I18nProvider } from '../../i18n/I18nProvider';
import { CloudAdminPage } from './CloudAdminPage';

const tag: ManagedTag = { id: 'tag-1', token: 'opaque-token', label: 'A01', batch: 'Spring', createdAt: '2026-01-01', status: 'bound', provisioning: null, recording: { id: 'rec-1', nickname: 'Guest', duration: 4, mimeType: 'audio/webm', createdAt: '2026-01-01' } };
function repository(): AdminRepository {
  return { getSession: vi.fn().mockResolvedValue({ userId: 'operator', role: 'operator' }), signIn: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined), listTags: vi.fn().mockResolvedValue({ tags: [tag], total: 51 }), createBatch: vi.fn().mockResolvedValue({ tags: [tag] }), resetTag: vi.fn().mockResolvedValue(undefined), setEnabled: vi.fn(), getPlaybackUrl: vi.fn().mockRejectedValue(new Error('SECRET')), listJobs: vi.fn().mockResolvedValue([]), provision: vi.fn(), getAudit: vi.fn().mockResolvedValue([]), maintenance: vi.fn().mockResolvedValue({ removed: 0, pending: 0 }) };
}
function show(repo: AdminRepository) { render(<I18nProvider><CloudAdminPage repository={repo} baseUrl="https://museum.example/" /></I18nProvider>); }
beforeEach(() => { localStorage.clear(); vi.stubGlobal('confirm', vi.fn(() => true)); });
describe('cloud operator dashboard', () => {
  it('loads no operator data before authentication', async () => {
    const repo = repository(); vi.mocked(repo.getSession).mockResolvedValue(null); show(repo);
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeInTheDocument();
    expect(repo.listTags).not.toHaveBeenCalled();
  });
  it('shows a safe login denial', async () => {
    const repo = repository(); vi.mocked(repo.getSession).mockResolvedValue(null); vi.mocked(repo.signIn).mockRejectedValue(new Error('SECRET')); show(repo);
    fireEvent.change(await screen.findByLabelText('メールアドレス'), { target: { value: 'operator@example.test' } });
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('SECRET'); expect(repo.listTags).not.toHaveBeenCalled();
  });
  it('creates labels through the server and paginates', async () => {
    const repo = repository(); show(repo); await screen.findByText('A01');
    fireEvent.change(screen.getByLabelText('タグ名'), { target: { value: 'A02' } }); fireEvent.click(screen.getByRole('button', { name: '追加' }));
    await waitFor(() => expect(repo.createBatch).toHaveBeenCalledWith([{ label: 'A02', batch: '' }], expect.any(String)));
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    await waitFor(() => expect(repo.listTags).toHaveBeenCalledWith(expect.objectContaining({ offset: 50 })));
  });
  it('resets using internal id only after confirmation', async () => {
    const repo = repository(); show(repo); fireEvent.click(await screen.findByRole('button', { name: 'リセット' }));
    await waitFor(() => expect(repo.resetTag).toHaveBeenCalledWith('tag-1')); expect(confirm).toHaveBeenCalled();
  });
  it('contains signed playback failures', async () => {
    const repo = repository(); show(repo); fireEvent.click(await screen.findByRole('button', { name: '試聴' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('SECRET'); expect(repo.getPlaybackUrl).toHaveBeenCalledWith('rec-1');
  });
  it('retries an uncertain create with exactly the same request key', async () => {
    const repo = repository(); vi.mocked(repo.createBatch).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ tags: [tag] }); show(repo); await screen.findByText('A01');
    fireEvent.change(screen.getByLabelText('タグ名'), { target: { value: 'A02' } }); fireEvent.click(screen.getByRole('button', { name: '追加' }));
    await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: '作成を再試行' }));
    await waitFor(() => expect(repo.createBatch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(repo.createBatch).mock.calls[0]).toEqual(vi.mocked(repo.createBatch).mock.calls[1]);
  });
  it('exports all pages rather than the visible page', async () => {
    const repo = repository(); show(repo); await screen.findByText('A01');
    vi.mocked(repo.listTags).mockResolvedValueOnce({ tags: Array.from({ length: 50 }, (_, index) => ({ ...tag, id: String(index) })), total: 51 }).mockResolvedValueOnce({ tags: [tag], total: 51 });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:csv'), revokeObjectURL: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: '全タグCSV' }));
    await waitFor(() => expect(repo.listTags).toHaveBeenCalledWith({ offset: 50, limit: 50 }));
  });
  it('allows cancelling a failed batch to correct the next request', async () => {
    const repo = repository(); vi.mocked(repo.createBatch).mockRejectedValueOnce(new Error('LABEL_DUPLICATE')); show(repo); await screen.findByText('A01');
    fireEvent.change(screen.getByLabelText('タグ名'), { target: { value: 'A02' } }); fireEvent.click(screen.getByRole('button', { name: '追加' }));
    await screen.findByRole('alert'); expect(screen.getByLabelText('タグ名')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '作成を取り消す' }));
    expect(screen.getByLabelText('タグ名')).toBeEnabled(); expect(screen.getByRole('button', { name: 'CSVインポート' })).toBeEnabled();
  });
  it('removes protected data when authentication expires during an action', async () => {
    const repo = repository(); vi.mocked(repo.resetTag).mockRejectedValue(new Error('AUTH_REQUIRED')); show(repo);
    fireEvent.click(await screen.findByRole('button', { name: 'リセット' }));
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeInTheDocument(); expect(screen.queryByText('A01')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument(); expect(screen.getByRole('alert')).toHaveTextContent('セッション');
  });
  it('removes protected data on role denial while fetching search results', async () => {
    const repo = repository(); show(repo); await screen.findByText('A01'); vi.mocked(repo.listTags).mockRejectedValueOnce(new Error('OPERATOR_REQUIRED'));
    fireEvent.change(screen.getByLabelText('検索'), { target: { value: 'denied' } });
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeInTheDocument(); expect(screen.queryByText('A01')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('権限');
  });
  it('shows login credentials failure separately from connection failures', async () => {
    const repo = repository(); vi.mocked(repo.getSession).mockResolvedValue(null); vi.mocked(repo.signIn).mockRejectedValue(new Error('LOGIN_FAILED')); show(repo);
    fireEvent.change(await screen.findByLabelText('メールアドレス'), { target: { value: 'operator@example.test' } }); fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password' } }); fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('パスワード');
  });
});

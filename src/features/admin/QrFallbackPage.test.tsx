import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QrEntry } from '../../storage/adminRepository';
import { I18nProvider } from '../../i18n/I18nProvider';
import { QrFallbackPage } from './QrFallbackPage';

function repository(entries: QrEntry[]) {
  return {
    getSession: vi.fn().mockResolvedValue({ userId: 'operator', role: 'operator' as const }),
    signIn: vi.fn(),
    signOut: vi.fn(),
    createQrEntry: vi.fn().mockImplementation(async () => entries.shift()),
  };
}

function show(repo: ReturnType<typeof repository>, options: { loginMode?: 'operator' | 'staff'; backHref?: string } = {}) {
  const view = render(<I18nProvider><QrFallbackPage repository={repo} {...options} /></I18nProvider>);
  return view;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('QR fallback page', () => {
  it('renders a server-issued QR and replaces it only after explicitly starting the next participant', async () => {
    const repo = repository([
      { id: 'tag-1', label: 'U000010', entryChannel: 'qr', visitorUrl: 'https://voice.heisei.space/#/t/token-1' },
      { id: 'tag-2', label: 'U000011', entryChannel: 'qr', visitorUrl: 'https://voice.heisei.space/#/t/token-2' },
    ]);
    const { container } = show(repo);

    const create = await screen.findByRole('button', { name: '次の参加者用にQRコードを作成' });
    expect(container.querySelector('.qr-fallback-code svg')).toBeNull();
    fireEvent.click(create);
    expect(await screen.findByRole('img', { name: 'QRコード U000010' })).toBeVisible();
    expect(repo.createQrEntry).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '次の参加者' }));
    expect(await screen.findByRole('img', { name: 'QRコード U000011' })).toBeVisible();
    expect(repo.createQrEntry).toHaveBeenCalledTimes(2);
    expect(repo.createQrEntry.mock.calls[0][0]).not.toBe(repo.createQrEntry.mock.calls[1][0]);
  });

  it('retries an uncertain issuance with the same key and restores the current QR after reload', async () => {
    const entry = { id: 'tag-1', label: 'U000010', entryChannel: 'qr' as const, visitorUrl: 'https://voice.heisei.space/#/t/token-1' };
    const repo = repository([entry]);
    repo.createQrEntry.mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValueOnce(entry);
    const first = show(repo);
    fireEvent.click(await screen.findByRole('button', { name: '次の参加者用にQRコードを作成' }));
    fireEvent.click(await screen.findByRole('button', { name: '再試行' }));
    await screen.findByRole('img', { name: 'QRコード U000010' });
    expect(repo.createQrEntry.mock.calls[0][0]).toBe(repo.createQrEntry.mock.calls[1][0]);

    first.unmount();
    const restoredRepo = repository([entry]);
    show(restoredRepo);
    await waitFor(() => expect(restoredRepo.createQrEntry).toHaveBeenCalledWith(repo.createQrEntry.mock.calls[0][0]));
    expect(await screen.findByRole('img', { name: 'QRコード U000010' })).toBeVisible();
  });

  it('fails closed when it cannot persist the idempotency key', async () => {
    const repo = repository([{ id: 'tag-1', label: 'U000010', entryChannel: 'qr', visitorUrl: 'https://voice.heisei.space/#/t/token-1' }]);
    show(repo);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });

    fireEvent.click(await screen.findByRole('button', { name: '次の参加者用にQRコードを作成' }));

    expect(repo.createQrEntry).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('操作を完了できませんでした。接続を確認して再試行してください。');
  });

  it('uses the existing shared staff login and returns to the staff portal', async () => {
    const repo = repository([]);
    localStorage.setItem('exhibition-audio-language-v2', 'zh-CN');
    repo.getSession.mockResolvedValue(null);
    repo.signIn.mockResolvedValue({ userId: 'staff-user', role: 'staff' });
    repo.createQrEntry.mockResolvedValue({
      id: 'staff-qr',
      label: 'U000020',
      entryChannel: 'qr',
      visitorUrl: 'https://voice.heisei.space/#/t/staff-opaque-token',
    });
    show(repo, { loginMode: 'staff', backHref: '#/staff' });
    expect(await screen.findByLabelText('账号名')).toHaveValue('staff');
    expect(screen.getByRole('link', { name: '返回工作人员页面' })).toHaveAttribute('href', '#/staff');
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(repo.signIn).toHaveBeenCalledWith('staff', 'secret'));
    fireEvent.click(await screen.findByRole('button', { name: '为下一位参与者生成二维码' }));
    expect(await screen.findByRole('img', { name: '二维码 U000020' })).toBeVisible();
    expect(repo.createQrEntry).toHaveBeenCalledOnce();
  });
});

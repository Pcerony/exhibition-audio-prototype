import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '../../i18n/I18nProvider';
import type {
  StaffCard,
  StaffRepository,
  StaffSession,
} from '../../storage/staffRepository';
import { StaffPage } from './StaffPage';
import { QrFallbackPage } from '../admin/QrFallbackPage';
vi.mock('../visitor/MemoryLocationMap', () => ({
  MemoryLocationMap: () => <div>Google map</div>,
}));
const session: StaffSession = {
  userId: 'shared',
  role: 'staff',
  members: [
    { id: 'member-a', name: 'Staff A' },
    { id: 'member-b', name: 'Staff B' },
  ],
};
const card: StaffCard = {
  id: 'tag-a',
  label: '261017-A001',
  inventoryLabel: 'U000001',
  createdAt: '2026-10-16T01:00:00Z',
  status: 'bound',
  categoryCode: 'C',
  recording: {
    id: 'recording-a',
    duration: 12,
    createdAt: '2026-10-17T06:30:42Z',
    transcriptionConsent: true,
    location: { source: 'pin', lat: 33.59, lng: 130.4 },
    transcription: {
      status: 'ready',
      text: 'Synthetic memory at the riverside.',
      version: 1,
      published: false,
      updatedAt: '2026-10-17T06:31:00Z',
    },
    pieceAssignment: {
      state: 'assigned',
      pieceCode: 'C3',
      source: 'automatic',
      mapVersion: 'fukuoka-road-73-v13',
      version: 1,
      updatedAt: null,
    },
    latestReview: null,
  },
};
const publishedCard: StaffCard = {
  ...card,
  id: 'tag-published',
  label: '261017-B002',
  categoryCode: 'B',
  recording: {
    ...card.recording!,
    id: 'recording-published',
    transcription: {
      ...card.recording!.transcription!,
      text: 'Already published memory.',
      published: true,
    },
  },
};
function repository(): StaffRepository {
  return {
    identityScope: 'test-backend',
    getSession: vi.fn(async () => session),
    signIn: vi.fn(async () => session),
    signOut: vi.fn(async () => {}),
    createQrEntry: vi.fn(async () => ({
      id: 'qr-tag',
      label: 'U000010',
      entryChannel: 'qr' as const,
      visitorUrl: 'https://voice.heisei.space/#/t/opaque-token',
    })),
    list: vi.fn(async () => ({ cards: [card], total: 1 })),
    save: vi.fn(async () => {}),
    retryTranscription: vi.fn(async () => {}),
    playback: vi.fn(async () => 'https://example.invalid/audio'),
    history: vi.fn(async () => [
      {
        id: 1,
        action: 'staff_approve',
        memberName: 'Staff B',
        createdAt: '2026-10-17T07:00:00Z',
      },
    ]),
    viewLocation: vi.fn(async () => {}),
  };
}
const memoryKey = 'staff-member-v1:test-backend:shared';
function show(repo: StaffRepository) {
  return render(
    <I18nProvider>
      <StaffPage repository={repo} />
    </I18nProvider>,
  );
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('exhibition-audio-language-v2', 'zh-CN');
  vi.restoreAllMocks();
});
describe('staff website', () => {
  it('clears all QR fallback state after an initial staff session role denial', async () => {
    sessionStorage.setItem('exhibition-qr-history-v1:previous-user', 'history');
    sessionStorage.setItem('exhibition-qr-current-request-v1:previous-user', 'current');
    sessionStorage.setItem('exhibition-qr-pending-request-v1:previous-user', 'pending');
    const repo = repository();
    vi.mocked(repo.getSession).mockRejectedValueOnce(new Error('STAFF_REQUIRED'));
    show(repo);
    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible();
    expect(sessionStorage.getItem('exhibition-qr-history-v1:previous-user')).toBeNull();
    expect(sessionStorage.getItem('exhibition-qr-current-request-v1:previous-user')).toBeNull();
    expect(sessionStorage.getItem('exhibition-qr-pending-request-v1:previous-user')).toBeNull();
  });
  it('offers the isolated QR page to authenticated staff before member selection', async () => {
    const repo = repository();
    show(repo);
    const link = await screen.findByRole('link', { name: '二维码备用入口' });
    expect(link).toHaveAttribute('href', '#/staff/qr');
    expect(repo.list).not.toHaveBeenCalled();
  });
  it('confirms a selected source language and requeues AI without approving it', async () => {
    localStorage.setItem(memoryKey,'member-a');
    vi.spyOn(window,'confirm').mockReturnValue(true);
    const repo=repository(),user=userEvent.setup();show(repo);
    await user.click(await screen.findByRole('button',{name:'审核 261017-A001'}));
    expect(screen.getByLabelText('录音语言')).toHaveValue('ja');
    await user.selectOptions(screen.getByLabelText('录音语言'),'ko');
    await user.click(screen.getByRole('button',{name:'重新 AI 转写'}));
    await waitFor(()=>expect(repo.retryTranscription).toHaveBeenCalledWith('recording-a','member-a',1,'ko'));
    expect(repo.save).not.toHaveBeenCalled();
    expect(await screen.findByText('已排队重新转写，完成后需要再次审核。')).toBeVisible();
  });
  it('does not requeue when confirmation is cancelled', async()=>{
    localStorage.setItem(memoryKey,'member-a');vi.spyOn(window,'confirm').mockReturnValue(false);
    const repo=repository(),user=userEvent.setup();show(repo);
    await user.click(await screen.findByRole('button',{name:'审核 261017-A001'}));
    await user.click(screen.getByRole('button',{name:'重新 AI 转写'}));
    expect(repo.retryTranscription).not.toHaveBeenCalled();
  });
  it('immediately marks a retried card pending while the list refresh is still in flight',async()=>{
    localStorage.setItem(memoryKey,'member-a');vi.spyOn(window,'confirm').mockReturnValue(true);
    const repo=repository(),user=userEvent.setup();show(repo);
    await user.click(await screen.findByRole('button',{name:'审核 261017-A001'}));
    vi.mocked(repo.list).mockImplementation(()=>new Promise(()=>{}));
    await user.click(screen.getByRole('button',{name:'重新 AI 转写'}));
    await screen.findByText('已排队重新转写，完成后需要再次审核。');
    await user.click(screen.getByRole('button',{name:'审核 261017-A001'}));
    expect(screen.getByRole('button',{name:'确认并发布'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'重新 AI 转写'})).toBeDisabled();
  });
  it('retains edited text and language after a retry version conflict',async()=>{
    localStorage.setItem(memoryKey,'member-a');vi.spyOn(window,'confirm').mockReturnValue(true);
    const repo=repository();vi.mocked(repo.retryTranscription).mockRejectedValue(Error('VERSION_CONFLICT'));
    const user=userEvent.setup();show(repo);
    await user.click(await screen.findByRole('button',{name:'审核 261017-A001'}));
    await user.clear(screen.getByLabelText('转写文字'));
    await user.type(screen.getByLabelText('转写文字'),'Unsaved review');
    await user.selectOptions(screen.getByLabelText('录音语言'),'es');
    await user.click(screen.getByRole('button',{name:'重新 AI 转写'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('已被其他工作人员更新');
    expect(screen.getByLabelText('转写文字')).toHaveValue('Unsaved review');
    expect(screen.getByLabelText('录音语言')).toHaveValue('es');
    expect(screen.getByRole('button',{name:'重新 AI 转写'})).toBeDisabled();
  });
  it('does not approve or requeue the retained old text while AI is processing',async()=>{
    localStorage.setItem(memoryKey,'member-a');const repo=repository();
    vi.mocked(repo.list).mockResolvedValue({cards:[{...card,recording:{...card.recording!,transcription:{...card.recording!.transcription!,status:'processing'}}}],total:1});
    const user=userEvent.setup();show(repo);
    await user.click(await screen.findByRole('button',{name:'审核 261017-A001'}));
    expect(screen.getByLabelText('转写文字')).toHaveValue('Synthetic memory at the riverside.');
    expect(screen.getByLabelText('转写文字')).toBeDisabled();
    expect(screen.getByRole('button',{name:'确认并发布'})).toBeDisabled();
    expect(screen.getByRole('button',{name:'重新 AI 转写'})).toBeDisabled();
  });
  it('shared login asks only for one account then remembers the chosen member on that device', async () => {
    const repo = repository();
    vi.mocked(repo.getSession).mockResolvedValue(null);
    const user = userEvent.setup();
    const view = show(repo);
    await user.type(
      await screen.findByLabelText('账号名'),
      'staff',
    );
    await user.type(screen.getByLabelText('密码'), 'secret');
    await user.click(screen.getByRole('button', { name: '登录' }));
    expect(repo.signIn).toHaveBeenCalledWith('staff', 'secret');
    await user.selectOptions(
      await screen.findByLabelText('工作人员'),
      'member-a',
    );
    await user.click(screen.getByRole('button', { name: '进入工作台' }));
    expect(
      await screen.findByText('Synthetic memory at the riverside.'),
    ).toBeVisible();
    expect(localStorage.getItem(memoryKey)).toBe('member-a');
    view.unmount();
    vi.mocked(repo.getSession).mockResolvedValue(session);
    show(repo);
    expect(
      await screen.findByText('Synthetic memory at the riverside.'),
    ).toBeVisible();
    expect(screen.queryByLabelText('工作人员')).not.toBeInTheDocument();
  });
  it('shows inline draft, exact Tokyo recording time and no destructive admin tools', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    show(repository());
    expect(
      await screen.findByText('Synthetic memory at the riverside.'),
    ).toBeVisible();
    expect(screen.getByText('2026/10/17 15:30:42')).toBeVisible();
    expect(screen.getAllByText('待修正').length).toBeGreaterThan(0);
    for (const label of ['删除', '重置', '开卡', '导出'])
      expect(
        screen.queryByRole('button', { name: label }),
      ).not.toBeInTheDocument();
  });
  it('keeps the compact account header without the product or lab brand', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    show(repository());
    await screen.findByText('Synthetic memory at the riverside.');
    const header = document.querySelector('.staff-header');
    expect(header).toHaveTextContent('中文');
    expect(header).toHaveTextContent('日本語');
    expect(header).toHaveTextContent('Staff A');
    expect(header).not.toHaveTextContent('WakuWaku Map');
    expect(header).not.toHaveTextContent('SoDesLab');
  });
  it('switches the staff page to English', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    show(repository());
    const user = userEvent.setup();
    await screen.findByText('Synthetic memory at the riverside.');
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(await screen.findByRole('tab', { name: 'All cards' })).toBeVisible();
    expect(
      screen.getByRole('searchbox', { name: 'Search label or transcript' }),
    ).toBeVisible();
  });
  it('filters to one of the four memory categories on the server', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    const repo = repository();
    show(repo);
    const user = userEvent.setup();
    await screen.findByText('Synthetic memory at the riverside.');
    await user.selectOptions(screen.getByLabelText('分类'), 'B');
    await waitFor(() =>
      expect(repo.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ categoryCode: 'B', offset: 0 }),
      ),
    );
    expect(screen.getByRole('option', { name: '美食' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '旅行' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '相遇' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: '其他回忆' }),
    ).toBeInTheDocument();
  });
  it('uses distinct card backgrounds for correction drafts and published cards', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    const repo = repository();
    vi.mocked(repo.list).mockResolvedValue({
      cards: [card, publishedCard],
      total: 2,
    });
    show(repo);
    const draft = await screen.findByText('Synthetic memory at the riverside.');
    const published = await screen.findByText('Already published memory.');
    expect(draft.closest('.staff-record')).toHaveClass('is-draft');
    expect(published.closest('.staff-record')).toHaveClass('is-approved');
    expect(
      draft.closest('.staff-record')?.querySelector('.staff-status'),
    ).toHaveClass('staff-sr-only');
    expect(
      published.closest('.staff-record')?.querySelector('.staff-status'),
    ).toHaveClass('staff-sr-only');
  });
  it('searches visible transcript text and filters on the server', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    const repo = repository();
    show(repo);
    const user = userEvent.setup();
    await screen.findByText('Synthetic memory at the riverside.');
    await user.type(screen.getByRole('searchbox'), 'riverside');
    await user.click(screen.getByRole('tab', { name: '待修正' }));
    await waitFor(() =>
      expect(repo.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: 'riverside',
          reviewState: 'unreviewed',
          offset: 0,
        }),
      ),
    );
  });
  it('edits and approves the text with the selected member and original version', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    const repo = repository();
    show(repo);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: '审核 261017-A001' }),
    );
    const editor = await screen.findByLabelText('转写文字');
    await user.clear(editor);
    await user.type(editor, 'Corrected memory.');
    await user.click(screen.getByRole('button', { name: '确认并发布' }));
    await waitFor(() =>
      expect(repo.save).toHaveBeenCalledWith(
        'recording-a',
        'member-a',
        1,
        'Corrected memory.',
        true,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });
  it('preserves edited text on concurrent review conflicts until an explicit reload', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    const repo = repository();
    vi.mocked(repo.save).mockRejectedValue(Error('VERSION_CONFLICT'));
    show(repo);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: '审核 261017-A001' }),
    );
    const editor = await screen.findByLabelText('转写文字');
    await user.clear(editor);
    await user.type(editor, 'My unsaved edit');
    await user.click(screen.getByRole('button', { name: '确认并发布' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '已被其他工作人员更新',
    );
    expect(editor).toHaveValue('My unsaved edit');
    expect(screen.getByRole('button', { name: '确认并发布' })).toBeDisabled();
  });
  it('opens Google/73-piece location and shows per-card history', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    const repo = repository();
    show(repo);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: '地点 261017-A001' }),
    );
    expect(
      await screen.findByRole('link', { name: '在 Google 地图打开' }),
    ).toHaveAttribute('href', expect.stringContaining('33.59'));
    expect(await screen.findByLabelText('73块实体地图')).toBeVisible();
    await waitFor(() =>
      expect(repo.viewLocation).toHaveBeenCalledWith('recording-a', 'member-a'),
    );
    await user.click(screen.getByRole('tab', { name: '操作记录' }));
    expect(
      await within(screen.getByRole('dialog')).findByText('Staff B'),
    ).toBeVisible();
  });
  it('does not silently reuse an identity from another account and clears it on logout', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    sessionStorage.setItem('exhibition-qr-history-v1:shared', JSON.stringify([
      { id: 'qr-tag', label: 'U000010', entryChannel: 'qr', visitorUrl: 'https://voice.heisei.space/#/t/opaque-token' },
    ]));
    sessionStorage.setItem('exhibition-qr-current-request-v1:shared', 'request-current');
    sessionStorage.setItem('exhibition-qr-pending-request-v1:shared', 'request-pending');
    const repo = repository();
    show(repo);
    const user = userEvent.setup();
    await screen.findByText('Synthetic memory at the riverside.');
    await user.click(screen.getByRole('button', { name: '退出登录' }));
    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible();
    expect(localStorage.getItem(memoryKey)).toBeNull();
    expect(sessionStorage.getItem('exhibition-qr-history-v1:shared')).toBeNull();
    expect(sessionStorage.getItem('exhibition-qr-current-request-v1:shared')).toBeNull();
    expect(sessionStorage.getItem('exhibition-qr-pending-request-v1:shared')).toBeNull();
    render(<I18nProvider><QrFallbackPage repository={repo} loginMode="staff" /></I18nProvider>);
    expect(await screen.findByRole('button', { name: '为下一位参与者生成二维码' })).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(repo.createQrEntry).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('exhibition-qr-current-request-v1:shared')).toBeNull();
    expect(sessionStorage.getItem('exhibition-qr-pending-request-v1:shared')).toBeNull();
  });
  it('refreshes other staff updates on focus without overwriting an open edit', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    const repo = repository();
    show(repo);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: '审核 261017-A001' }),
    );
    const editor = await screen.findByLabelText('转写文字');
    await user.clear(editor);
    await user.type(editor, 'Local edit stays');
    vi.mocked(repo.list).mockResolvedValue({
      cards: [
        {
          ...card,
          recording: {
            ...card.recording!,
            transcription: {
              ...card.recording!.transcription!,
              text: 'Other staff update',
              version: 2,
            },
          },
        },
      ],
      total: 1,
    });
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('Other staff update')).toBeVisible();
    expect(editor).toHaveValue('Local edit stays');
  });
  it('clears private records when the shared account loses authorization', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    const repo = repository();
    show(repo);
    const user = userEvent.setup();
    await screen.findByText('Synthetic memory at the riverside.');
    vi.mocked(repo.list).mockRejectedValue(Error('AUTH_REQUIRED'));
    await user.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByRole('button', { name: '登录' })).toBeVisible();
    expect(
      screen.queryByText('Synthetic memory at the riverside.'),
    ).not.toBeInTheDocument();
  });
  it('immediately drops an open editor when another tab replaces the authenticated account', async () => {
    localStorage.setItem(memoryKey, 'member-a');
    const repo = repository();
    let changed: ((id: string | null) => void) | undefined;
    repo.subscribeAuth = (listener) => {
      changed = listener;
      return () => {};
    };
    show(repo);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: '审核 261017-A001' }),
    );
    await act(async () => changed?.('another-account'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Synthetic memory at the riverside.'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeVisible();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRepository } from '../../storage/repository';
import { VisitorPage } from './VisitorPage';
import { I18nProvider } from '../../i18n/I18nProvider';
import { visitorMessages } from '../../i18n/visitorMessages';
import type { MapPoint, MemoryLocation } from '../../domain/location';

const mapsMock = vi.hoisted(() => ({
  mountLocationMap: vi.fn(),
  mountMemoryLocationMap: vi.fn(),
}));

vi.mock('./googleMaps', () => mapsMock);

const repository = createMemoryRepository();

beforeEach(async () => {
  vi.restoreAllMocks();
  mapsMock.mountLocationMap.mockReset().mockImplementation((options: unknown) => {
    (options as { onSelect: (selection: { location: MemoryLocation; mapPoint: MapPoint }) => void }).onSelect({
      location: { source: 'pin', lat: 33.59, lng: 130.4 }, mapPoint: { lat: 33.59, lng: 130.4 },
    });
    return Promise.resolve(() => {});
  });
  mapsMock.mountMemoryLocationMap.mockReset().mockImplementation((options: unknown) => {
    (options as { onReady: () => void }).onReady();
    return Promise.resolve(() => {});
  });
  localStorage.setItem('exhibition-audio-language-v2', 'zh-CN');
  for (const tag of await repository.listTags()) await repository.resetTag(tag.token);
  if (!(await repository.getTag('visitor-token'))) {
    await repository.createTag({ id: 'tag-1', token: 'visitor-token', label: '展签 01' });
  }
});

async function enterMap() {
  fireEvent.click(await screen.findByRole('button', { name: '开始' }));
  fireEvent.click(screen.getByRole('button', { name: /美食/ }));
}

describe('visitor page', () => {
  it.each(['en', 'ko', 'zh-TW'] as const)('translates all steps and preserves a take across language changes: %s', async locale => {
    localStorage.setItem('exhibition-audio-language-v2', locale);
    const copy = visitorMessages[locale];
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
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    expect(await screen.findByRole('link', { name: copy['policy.groqPrivacy'] })).toHaveAttribute('href', 'https://groq.com/privacy-policy/');
    expect(screen.queryByText(copy['transcription.notice'])).not.toBeInTheDocument();
    expect(screen.queryByText(copy['flow.introBody'])).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy['flow.begin'] })).toBeEnabled();
    fireEvent.click(await screen.findByRole('button', { name: copy['flow.begin'] }));
    expect(screen.getByRole('heading', { name: copy['flow.themeTitle'] })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: copy['flow.food'] }));
    fireEvent.click(await screen.findByRole('button', { name: copy['location.skip'] }));
    fireEvent.click(screen.getByRole('button', { name: copy['visitor.start'] }));
    fireEvent.click(await screen.findByRole('button', { name: copy['visitor.stop'] }));
    expect(screen.getByRole('heading', { name: copy['flow.preview'] })).toBeVisible();
    expect(screen.getByRole('heading', { name: copy['flow.reviewAgainTitle'], level: 2 })).toBeVisible();
    expect(screen.getByTestId('review-category')).toHaveTextContent(copy['flow.food']);
    const audio = document.querySelector('.visitor-audio-player audio')!;
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const url = audio.getAttribute('src');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ja-JP' } });
    expect(document.querySelector('.visitor-audio-player audio')).toHaveAttribute('src', url);
    expect(screen.getByRole('heading', { name: 'もう一度確認しますか？', level: 2 })).toBeVisible();
    expect(screen.getByRole('button', { name: '録音を試聴' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'この録音を送信' })).toBeEnabled();
    const claim = vi.spyOn(repository, 'claim');
    fireEvent.click(screen.getByRole('button', { name: 'この録音を送信' }));
    expect(claim).toHaveBeenCalledWith('visitor-token', expect.objectContaining({ transcriptionConsent: true }));
    await screen.findByRole('heading', { name: 'あなたの声を、福岡に残しました。' });
  }, 10_000);
  it('keeps maps out of the introduction and numbers the theme step', async () => {
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    expect(await screen.findByRole('button', { name: '开始' })).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Groq 隐私政策' })).toBeVisible();
    expect(screen.queryByText('分享一段属于你与这座城市的记忆。')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始' })).toBeEnabled();
    expect(screen.getByTestId('visitor-tag-number')).toHaveTextContent('展签 01');
    expect(screen.queryByLabelText('福冈市地图')).not.toBeInTheDocument();
    expect(screen.getByAltText('SoDesLab')).toBeVisible();
    expect(document.querySelector('.outdoor-header')!.compareDocumentPosition(document.querySelector('.intro-step')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始' }));
    expect(screen.getByRole('heading', { name: '你想分享哪种回忆？' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '你想分享哪种回忆？' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '其他回忆' })).toBeVisible();
    expect(screen.queryByTestId('visitor-tag-number')).toHaveClass('visitor-tag-number-corner');
    expect(screen.queryByTestId('visitor-tag-number')).toHaveTextContent('展签 01');
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(document.querySelector('.theme-options')!.compareDocumentPosition(document.querySelector('.outdoor-flow-footer')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const back = screen.getByRole('button', { name: '返回' });
    expect(back.compareDocumentPosition(document.querySelector('.step-number')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(back).toHaveTextContent('返回');
    expect(window.getComputedStyle(back).borderTopWidth).toBe('0px');
    expect(window.getComputedStyle(back).flexDirection).toBe('column');
    const progress = screen.getByRole('progressbar', { name: '流程进度' });
    expect(progress).toHaveAttribute('aria-valuenow', '2');
    expect(progress.querySelectorAll('.outdoor-progress-segment.is-complete')).toHaveLength(2);
    const progressMeta = document.querySelector('.outdoor-progress-meta')!;
    expect(window.getComputedStyle(progressMeta).alignItems).toBe('flex-end');
    expect(window.getComputedStyle(progressMeta).textAlign).toBe('right');
    expect(window.getComputedStyle(document.querySelector('.step-number')!).textAlign).toBe('right');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('lets a visitor return to the location step without losing the recording flow', async () => {
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    await enterMap();
    fireEvent.click(await screen.findByRole('button', { name: '跳过，直接录音' }));
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.getByRole('heading', { name: '这段回忆，发生在哪里？' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '跳过，直接录音' }));
    expect(screen.getByRole('button', { name: '开始录音' })).toBeVisible();
  });
  it('offers recording and explains public playback for an unbound tag', async () => {
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    expect(await screen.findByRole('button', { name: '开始' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /开始录音/ })).not.toBeInTheDocument();
    await enterMap();
    fireEvent.click(screen.getByRole('button', { name: '跳过，直接录音' }));
    expect(await screen.findByRole('button', { name: /开始录音/ })).toBeInTheDocument();
    expect(screen.getByText(/扫描这枚展签的人都可以收听/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '开始留言吧' })).toBeInTheDocument();
    expect(screen.queryByText(/iPhone Chrome 没有出现授权弹窗/)).not.toBeInTheDocument();
  });

  it('shows the bound recording instead of recording controls', async () => {
    await repository.claim('visitor-token', {
      id: 'audio-1',
      blob: new Blob(['audio'], { type: 'audio/webm' }),
      nickname: '小林',
      duration: 12,
      categoryCode: 'B',
    });

    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    expect(await screen.findByRole('heading', { name: '小林留下的福冈回忆' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /开始录音/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '播放录音' })).toBeInTheDocument();
    expect(screen.getByTestId('visitor-tag-number').textContent).toMatch(/\d{6}-B001$/);
  });

  it('shows an unavailable state for an unknown token', async () => {
    render(<I18nProvider><VisitorPage repository={repository} token="missing-token" /></I18nProvider>);

    expect(await screen.findByText('没有找到这枚展签')).toBeInTheDocument();
  });

  it('allows a listener to refresh a failed or expired playback link', async () => {
    await repository.claim('visitor-token', { id: 'playback-fixture', blob: new Blob(['audio']), nickname: '', duration: 1 });
    vi.spyOn(repository, 'getVisitorPlaybackUrl').mockRejectedValueOnce(new Error('NETWORK_ERROR')).mockResolvedValueOnce('https://example.invalid/signed-audio');
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '重新加载录音' }));
    expect(await screen.findByRole('button', { name: '播放录音' })).toBeInTheDocument();
    expect(document.querySelector('.visitor-audio-player audio')).toHaveAttribute('src', 'https://example.invalid/signed-audio');
  });

  it('does not show the previous tag while a new NFC token is loading', async () => {
    await repository.claim('visitor-token', {
      id: 'audio-2',
      blob: new Blob(['audio'], { type: 'audio/webm' }),
      nickname: '旧标签',
      duration: 12,
    });
    const previousTag = await repository.getTag('visitor-token');
    vi.spyOn(repository, 'getTag').mockImplementation((token) => token === 'visitor-token'
      ? Promise.resolve(previousTag)
      : new Promise(() => {}));
    const view = render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    expect(await screen.findByRole('heading', { name: '旧标签留下的福冈回忆' })).toBeInTheDocument();
    view.rerender(<I18nProvider><VisitorPage repository={repository} token="next-token" /></I18nProvider>);

    expect(screen.queryByRole('heading', { name: '旧标签留下的福冈回忆' })).not.toBeInTheDocument();
    expect(screen.getByText(/正在打开 WakuWaku Map/)).toBeInTheDocument();
  });

  it('translates recording controls on the visitor page', async () => {
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    await enterMap();
    fireEvent.click(await screen.findByRole('button', { name: '跳过，直接录音' }));
    await screen.findByRole('button', { name: /开始录音/ });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ja-JP' } });
    expect(await screen.findByRole('heading', { name: 'メッセージを残しましょう' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '録音を開始' })).toBeInTheDocument();
  });

  it('discards the previous recording when opening another NFC tag', async () => {
    await repository.createTag({ id: 'next-tag', token: 'new-recording-token', label: 'New tag' });
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
    const view = render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    await enterMap();
    fireEvent.click(await screen.findByRole('button', { name: '跳过，直接录音' }));
    fireEvent.click(await screen.findByRole('button', { name: /开始录音/ }));
    fireEvent.click(await screen.findByRole('button', { name: /完成录音/ }));
    expect(await screen.findByRole('button', { name: /重录/ })).toBeInTheDocument();
    view.rerender(<I18nProvider><VisitorPage repository={repository} token="new-recording-token" /></I18nProvider>);
    await enterMap();
    fireEvent.click(await screen.findByRole('button', { name: '跳过，直接录音' }));
    expect(await screen.findByRole('button', { name: /开始录音/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重录/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /开始录音/ }));
    fireEvent.click(await screen.findByRole('button', { name: /完成录音/ }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows separate confirmation without nickname and locks the take while uploading', async () => {
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
    let failUpload!: (reason: Error) => void;
    vi.spyOn(repository, 'claim').mockReturnValue(new Promise((_, reject) => { failUpload = reject; }));
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    await enterMap();
    fireEvent.click(await screen.findByRole('button', { name: '跳过，直接录音' }));
    fireEvent.click(await screen.findByRole('button', { name: /开始录音/ }));
    fireEvent.click(await screen.findByRole('button', { name: /完成录音/ }));
    expect(screen.getByRole('heading', { name: '请确认你的录音' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '开始录音' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /发送这段声音/ }));
    expect(repository.claim).toHaveBeenCalledWith('visitor-token', expect.objectContaining({ categoryCode: 'A', nickname: '', transcriptionConsent: true }));
    expect(screen.getByRole('button', { name: /重录/ })).toBeDisabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
    const { act } = await import('@testing-library/react');
    await act(async () => failUpload(new Error('offline')));
    expect(await screen.findByText('Could not save. Keep your recording and try again.')).toBeVisible();
  });

  it('lets visitors review and change the category and selected location before submitting', async () => {
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
    const claim = vi.spyOn(repository, 'claim');
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    await enterMap();
    fireEvent.click(await screen.findByRole('button', { name: '确认地点' }));
    fireEvent.click(await screen.findByRole('button', { name: '开始录音' }));
    fireEvent.click(await screen.findByRole('button', { name: '完成录音' }));

    expect(screen.getByTestId('review-category')).toHaveTextContent('美食');
    expect(screen.getByTestId('review-location')).toBeVisible();
    expect(screen.getByRole('region', { name: '福冈市地图' })).toBeVisible();
    expect(screen.getByRole('button', { name: '发送这段声音' }).compareDocumentPosition(screen.getByTestId('review-category')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(window.getComputedStyle(document.querySelector('.review-public-notice')!).marginBottom).toBe('96px');
    expect(screen.getByRole('heading', { name: '还想再确认一遍吗？', level: 2 })).toBeVisible();
    expect(screen.getByRole('heading', { name: '还想再确认一遍吗？', level: 2 }).compareDocumentPosition(document.querySelector('.review-audio-actions')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const reviewAudio = document.querySelector('.review-audio-actions')!;
    expect(reviewAudio).toContainElement(document.querySelector('.visitor-audio-player')!);
    expect(reviewAudio).toContainElement(screen.getByRole('button', { name: '重录' }));
    expect(screen.getByRole('heading', { name: '请确认你的录音' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '修改分类' }));
    expect(screen.getByRole('dialog', { name: '修改分类' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '旅行' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('review-category')).toHaveTextContent('旅行');

    fireEvent.click(screen.getByRole('button', { name: '重新选择地点' }));
    expect(screen.getByRole('heading', { name: '这段回忆，发生在哪里？' })).toBeVisible();
    const mapOptions = mapsMock.mountLocationMap.mock.calls[0][0] as { onSelect: (value: { location: MemoryLocation; mapPoint: MapPoint }) => void };
    await act(async () => mapOptions.onSelect({ location: { source: 'pin', lat: 33.61, lng: 130.42 }, mapPoint: { lat: 33.61, lng: 130.42 } }));
    fireEvent.click(screen.getByRole('button', { name: '确认地点' }));
    expect(screen.getByRole('heading', { name: '请确认你的录音' })).toBeVisible();
    expect(mapsMock.mountMemoryLocationMap).toHaveBeenLastCalledWith(expect.objectContaining({
      location: { source: 'pin', lat: 33.61, lng: 130.42 },
    }));
    fireEvent.click(screen.getByRole('button', { name: '发送这段声音' }));
    await screen.findByRole('heading', { name: '你的声音，已留在福冈。' });
    expect(claim).toHaveBeenCalledWith('visitor-token', expect.objectContaining({
      categoryCode: 'B', location: { source: 'pin', lat: 33.61, lng: 130.42 },
      mapPoint: { lat: 33.61, lng: 130.42 },
    }));
  });

  it('omits the location confirmation when the visitor skipped the map', async () => {
    mapsMock.mountLocationMap.mockImplementation(() => Promise.resolve(() => {}));
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
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    await enterMap();
    fireEvent.click(await screen.findByRole('button', { name: '跳过，直接录音' }));
    fireEvent.click(await screen.findByRole('button', { name: '开始录音' }));
    fireEvent.click(await screen.findByRole('button', { name: '完成录音' }));

    expect(screen.getByTestId('review-category')).toHaveTextContent('美食');
    expect(screen.queryByTestId('review-location')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '福冈市地图' })).not.toBeInTheDocument();
  });

  it('shows the placement page after saving, with the updated tag number and selected map', async () => {
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
    const getPlayback = vi.spyOn(repository, 'getVisitorPlaybackUrl');
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    expect(await screen.findByTestId('visitor-tag-number')).toHaveTextContent('展签 01');
    await enterMap();
    fireEvent.click(await screen.findByRole('button', { name: '确认地点' }));
    fireEvent.click(await screen.findByRole('button', { name: '开始录音' }));
    fireEvent.click(await screen.findByRole('button', { name: '完成录音' }));
    fireEvent.click(screen.getByRole('button', { name: '发送这段声音' }));

    expect(await screen.findByRole('heading', { name: '你的声音，已留在福冈。' })).toBeVisible();
    const tag = await repository.getTag('visitor-token');
    expect(tag?.serialNumber).toBeTruthy();
    expect(screen.getByTestId('visitor-tag-number')).toHaveTextContent(tag!.serialNumber!);
    expect(screen.getByText('如果现场有实体地图，也可以把卡片放在地图上。')).toBeVisible();
    expect(screen.getByRole('region', { name: '福冈市地图' })).toBeVisible();
    expect(screen.getByRole('link', { name: '在地图中打开' })).toHaveAttribute('href', expect.stringContaining('google.com/maps'));
    expect(screen.queryByLabelText('试听录音')).not.toBeInTheDocument();
    expect(getPlayback).not.toHaveBeenCalled();
    expect(mapsMock.mountMemoryLocationMap).toHaveBeenCalledWith(expect.objectContaining({
      location: { source: 'pin', lat: 33.59, lng: 130.4 },
    }));
  });

  it('omits the placement map when no location was selected', async () => {
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
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    await enterMap();
    fireEvent.click(await screen.findByRole('button', { name: '跳过，直接录音' }));
    fireEvent.click(await screen.findByRole('button', { name: '开始录音' }));
    fireEvent.click(await screen.findByRole('button', { name: '完成录音' }));
    fireEvent.click(screen.getByRole('button', { name: '发送这段声音' }));

    expect(await screen.findByRole('heading', { name: '你的声音，已留在福冈。' })).toBeVisible();
    expect(screen.queryByRole('region', { name: '福冈市地图' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '在地图中打开' })).not.toBeInTheDocument();
    expect(mapsMock.mountMemoryLocationMap).not.toHaveBeenCalled();
  });

  it('explains how to recover when the browser blocks microphone permission', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    vi.stubGlobal('MediaRecorder', class { });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    await enterMap();
    fireEvent.click(await screen.findByRole('button', { name: '跳过，直接录音' }));
    fireEvent.click(await screen.findByRole('button', { name: /开始录音/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/iPhone「设置 > Chrome > 麦克风」/);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access is blocked.');
  });

  it('shows only server-published transcript as plain text in a collapsed disclosure', async () => {
    const tag = await repository.getTag('visitor-token');
    vi.spyOn(repository, 'getTag').mockResolvedValue({ ...tag!, status: 'bound', recording: {
      id: 'text-fixture', nickname: '', duration: 2, mimeType: 'audio/webm', createdAt: new Date().toISOString(),
      transcript: '<img src=x onerror=alert(1)> 福冈回忆',
    } });
    vi.spyOn(repository, 'getVisitorPlaybackUrl').mockResolvedValue('https://example.invalid/audio');
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    const summary = await screen.findByText('查看文字');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('<img src=x onerror=alert(1)> 福冈回忆')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('translates published text only after a visitor chooses a language and presses the button', async () => {
    localStorage.setItem('exhibition-audio-language-v2', 'en');
    const tag = await repository.getTag('visitor-token');
    vi.spyOn(repository, 'getTag').mockResolvedValue({ ...tag!, status: 'bound', recording: {
      id: 'text-fixture', nickname: '', duration: 2, mimeType: 'audio/webm', createdAt: new Date().toISOString(),
      transcript: 'Original Japanese transcript',
    } });
    vi.spyOn(repository, 'getVisitorPlaybackUrl').mockResolvedValue('https://example.invalid/audio');
    const translate = vi.spyOn(repository, 'translateTranscript').mockResolvedValue('福岡の思い出');
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    fireEvent.click(await screen.findByText('Read transcript'));
    const language = screen.getByRole('combobox', { name: 'Translation language' });
    expect(language).toHaveValue('en');
    expect(screen.getByText('Original Japanese transcript')).toBeVisible();
    expect(translate).not.toHaveBeenCalled();

    fireEvent.change(language, { target: { value: 'ja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(translate).toHaveBeenCalledWith('visitor-token', 'ja');
    expect(await screen.findByText('福岡の思い出')).toBeVisible();
    expect(screen.getByText('Original Japanese transcript')).toBeVisible();
  });

  it('shows a recoverable message when on-demand translation fails', async () => {
    const tag = await repository.getTag('visitor-token');
    vi.spyOn(repository, 'getTag').mockResolvedValue({ ...tag!, status: 'bound', recording: {
      id: 'text-fixture', nickname: '', duration: 2, mimeType: 'audio/webm', createdAt: new Date().toISOString(),
      transcript: 'Original Japanese transcript',
    } });
    vi.spyOn(repository, 'getVisitorPlaybackUrl').mockResolvedValue('https://example.invalid/audio');
    vi.spyOn(repository, 'translateTranscript').mockRejectedValue(new Error('TRANSLATION_UNAVAILABLE'));
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    fireEvent.click(await screen.findByText('查看文字'));
    fireEvent.click(screen.getByRole('button', { name: '翻译' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('翻译暂时不可用');
    expect(screen.getByText('Original Japanese transcript')).toBeVisible();
  });
});

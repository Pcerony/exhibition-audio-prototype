import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRepository } from '../../storage/repository';
import { VisitorPage } from './VisitorPage';
import { I18nProvider } from '../../i18n/I18nProvider';

const repository = createMemoryRepository();

beforeEach(async () => {
  vi.restoreAllMocks();
  localStorage.setItem('exhibition-audio-language-v2', 'zh-CN');
  for (const tag of await repository.listTags()) await repository.resetTag(tag.token);
  if (!(await repository.getTag('visitor-token'))) {
    await repository.createTag({ id: 'tag-1', token: 'visitor-token', label: '展签 01' });
  }
});

describe('visitor page', () => {
  it('offers recording and explains public playback for an unbound tag', async () => {
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    expect(await screen.findByRole('button', { name: /开始录音/ })).toBeInTheDocument();
    expect(screen.getByText(/扫描这枚展签的人都可以收听/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '你和福冈市，有怎样的回忆？' })).toBeInTheDocument();
    expect(screen.getByText(/iPhone Chrome 没有出现授权弹窗/)).toBeInTheDocument();
  });

  it('shows the bound recording instead of recording controls', async () => {
    await repository.claim('visitor-token', {
      id: 'audio-1',
      blob: new Blob(['audio'], { type: 'audio/webm' }),
      nickname: '小林',
      duration: 12,
    });

    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    expect(await screen.findByRole('heading', { name: '小林留下的福冈回忆' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /开始录音/ })).not.toBeInTheDocument();
    expect(await screen.findByLabelText('播放录音')).toBeInTheDocument();
  });

  it('shows an unavailable state for an unknown token', async () => {
    render(<I18nProvider><VisitorPage repository={repository} token="missing-token" /></I18nProvider>);

    expect(await screen.findByText('没有找到这枚展签')).toBeInTheDocument();
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
    expect(screen.getByText(/正在打开声音档案/)).toBeInTheDocument();
  });

  it('translates recording controls on the visitor page', async () => {
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);
    await screen.findByRole('button', { name: /开始录音/ });
    fireEvent.click(screen.getByRole('button', { name: '日本語' }));
    expect(await screen.findByRole('heading', { name: '福岡市との思い出を聞かせてください。' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '録音を開始' })).toBeInTheDocument();
  });

  it('explains how to recover when the browser blocks microphone permission', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    vi.stubGlobal('MediaRecorder', class { });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    render(<I18nProvider><VisitorPage repository={repository} token="visitor-token" /></I18nProvider>);

    fireEvent.click(await screen.findByRole('button', { name: /开始录音/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/iPhone「设置 > Chrome > 麦克风」/);
  });
});

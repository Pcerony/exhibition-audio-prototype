import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { VisitorAudioPlayer } from './VisitorAudioPlayer';

function renderPlayer(purpose: 'recording' | 'preview' = 'recording') {
  localStorage.setItem('exhibition-audio-language-v2', 'zh-CN');
  return render(<I18nProvider><VisitorAudioPlayer src="blob:voice" purpose={purpose} /></I18nProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe('visitor audio player', () => {
  it('pauses the captured audio element when the player is removed', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const { container, unmount } = renderPlayer();
    const audio = container.querySelector('audio')!;
    unmount();
    expect(pause).toHaveBeenCalledOnce();
    expect(pause.mock.contexts[0]).toBe(audio);
  });
  it('provides a prominent play action and a seekable timeline instead of native controls', () => {
    const { container } = renderPlayer();
    const audio = container.querySelector('audio');

    expect(screen.getByRole('button', { name: '播放录音' })).toHaveClass('visitor-audio-toggle');
    expect(screen.getByRole('slider', { name: '定位播放进度' })).toBeInTheDocument();
    expect(audio).not.toHaveAttribute('controls');
  });

  it('toggles playback and offers replay after the audio ends', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const { container } = renderPlayer();
    const audio = container.querySelector('audio')!;

    fireEvent.click(screen.getByRole('button', { name: '播放录音' }));
    expect(await screen.findByRole('button', { name: '暂停播放' })).toBeInTheDocument();
    expect(play).toHaveBeenCalledOnce();

    fireEvent.ended(audio);
    expect(screen.getByRole('button', { name: '重播录音' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重播录音' }));
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('labels replay of the visitor take separately and seeks to the selected time', () => {
    const { container } = renderPlayer('preview');
    const audio = container.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 90 });
    Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 });
    fireEvent.loadedMetadata(audio);

    expect(screen.getByRole('button', { name: '试听录音' })).toBeInTheDocument();
    expect(screen.getByText('00:00')).toBeInTheDocument();
    expect(screen.getByText('01:30')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: '定位播放进度' }), { target: { value: '32' } });
    expect(audio.currentTime).toBe(32);

    fireEvent.ended(audio);
    expect(screen.getByRole('button', { name: '重播刚录的录音' })).toBeInTheDocument();
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { useRecorder } from './useRecorder';

class FakeMediaRecorder {
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio'], { type: this.mimeType }) } as BlobEvent);
    this.onstop?.();
  });
  start() { this.state = 'recording'; }
}

describe('useRecorder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('cancels a pending microphone request when the page is hidden', async () => {
    let resolve!: (stream: MediaStream) => void;
    const stopTrack = vi.fn();
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn().mockReturnValue(new Promise<MediaStream>((done) => { resolve = done; })),
    } });
    const { result } = renderHook(() => useRecorder(), { wrapper: I18nProvider });
    let start!: Promise<void>;
    act(() => { start = result.current.start(); });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { resolve({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream); await start; });
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('idle');
    expect(result.current.starting).toBe(false);
  });

  it('automatically stops at the 60-second upload limit', async () => {
    vi.useFakeTimers();
    const mediaRecorder = new FakeMediaRecorder();
    vi.stubGlobal('MediaRecorder', class extends FakeMediaRecorder {
      constructor() { super(); return mediaRecorder as unknown as this; }
    });
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    const { result } = renderHook(() => useRecorder(), { wrapper: I18nProvider });

    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe('recording');

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    expect(mediaRecorder.stop).toHaveBeenCalledOnce();
    expect(result.current.state).toBe('ready');
    expect(result.current.duration).toBe(60);
  });

  it('ignores a late stop event after the user discards a take', async () => {
    const mediaRecorder = new FakeMediaRecorder();
    mediaRecorder.stop.mockImplementation(() => { mediaRecorder.state = 'inactive'; });
    vi.stubGlobal('MediaRecorder', class extends FakeMediaRecorder {
      constructor() { super(); return mediaRecorder as unknown as this; }
    });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    } });
    const { result } = renderHook(() => useRecorder(), { wrapper: I18nProvider });
    await act(async () => { await result.current.start(); });
    act(() => result.current.discard());
    act(() => mediaRecorder.onstop?.());
    expect(result.current.state).toBe('idle');
    expect(result.current.blob).toBeNull();
  });

  it('releases microphone access if permission resolves after unmount', async () => {
    let resolve!: (stream: MediaStream) => void;
    const stopTrack = vi.fn();
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn().mockReturnValue(new Promise<MediaStream>((done) => { resolve = done; })),
    } });
    const { result, unmount } = renderHook(() => useRecorder(), { wrapper: I18nProvider });
    let start!: Promise<void>;
    act(() => { start = result.current.start(); });
    unmount();
    await act(async () => { resolve({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream); await start; });
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it('releases the stream if MediaRecorder construction fails', async () => {
    const stopTrack = vi.fn();
    vi.stubGlobal('MediaRecorder', class { constructor() { throw new Error('Unsupported codec'); } });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
    } });
    const { result } = renderHook(() => useRecorder(), { wrapper: I18nProvider });
    await act(async () => { await result.current.start(); });
    expect(result.current.state).toBe('error');
    expect(stopTrack).toHaveBeenCalledOnce();
  });
});

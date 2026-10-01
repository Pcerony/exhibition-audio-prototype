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
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
});

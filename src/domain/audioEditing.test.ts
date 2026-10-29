import { expect, it } from 'vitest';
import { encodeAudioClip, waveformPeaks } from './audioEditing';
it('exports only selected mono 16k PCM samples with correct WAV lengths', () => {
  const data = new Float32Array(32000).fill(.5);
  const blob = encodeAudioClip(data, .5, 1.5);
  expect(blob.size).toBe(32044);
});
it('rejects invalid ranges and clips longer than five minutes', () => {
  expect(() => encodeAudioClip(new Float32Array(16000), 1, 0)).toThrow();
  expect(() => encodeAudioClip(new Float32Array(16000), 0, 2)).toThrow();
});
it('preserves peaks while limiting drawing size', () => {
  const data = new Float32Array(10000); data[5000] = -.9;
  const peaks = waveformPeaks(data, 100);
  expect(peaks.length).toBe(100); expect(Math.max(...peaks)).toBeCloseTo(.9);
});

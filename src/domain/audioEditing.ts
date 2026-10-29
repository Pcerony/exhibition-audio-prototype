export function waveformPeaks(samples: Float32Array, count = 1200): number[] {
  const step = Math.max(1, Math.ceil(samples.length / count)), peaks: number[] = [];
  for (let i = 0; i < samples.length; i += step) {
    let peak = 0; for (let j = i; j < Math.min(samples.length, i + step); j++) peak = Math.max(peak, Math.abs(samples[j]));
    peaks.push(peak);
  }
  return peaks;
}

export function encodeAudioClip(samples: Float32Array, start: number, end: number): Blob {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 300 || end > samples.length / 16000 + .0001) throw Error('AUDIO_RANGE_INVALID');
  const first = Math.round(start * 16000), last = Math.min(samples.length, Math.round(end * 16000));
  const buffer = new ArrayBuffer(44 + (last - first) * 2), view = new DataView(buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, buffer.byteLength - 44, true);
  for (let i = first; i < last; i++) { const value = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + (i - first) * 2, value < 0 ? value * 32768 : value * 32767, true); }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function decodeReviewAudio(url: string): Promise<{ samples: Float32Array; meanDb: number }> {
  const response = await fetch(url); if (!response.ok) throw Error('AUDIO_DOWNLOAD_FAILED');
  const bytes = await response.arrayBuffer(); if (bytes.byteLength > 32 * 1024 * 1024) throw Error('AUDIO_TOO_LARGE');
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(bytes);
    if (decoded.duration > 10800) throw Error('AUDIO_TOO_LONG');
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const mono = await offline.startRendering(), samples = mono.getChannelData(0).slice();
    let power = 0; for (const value of samples) power += value * value;
    return { samples, meanDb: Math.max(-200, 10 * Math.log10(power / samples.length || 1e-20)) };
  } finally { await context.close(); }
}

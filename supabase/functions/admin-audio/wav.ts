export function validateWav(bytes: Uint8Array): number {
  if (bytes.length < 46 || bytes.length > 9600044) throw Error('AUDIO_INVALID');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) => new TextDecoder().decode(bytes.subarray(offset, offset + length));
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE' || text(12, 4) !== 'fmt ' || text(36, 4) !== 'data'
    || v.getUint32(4, true) !== bytes.length - 8 || v.getUint32(16, true) !== 16
    || v.getUint16(20, true) !== 1 || v.getUint16(22, true) !== 1 || v.getUint32(24, true) !== 16000
    || v.getUint32(28, true) !== 32000 || v.getUint16(32, true) !== 2 || v.getUint16(34, true) !== 16
    || v.getUint32(40, true) !== bytes.length - 44 || (bytes.length - 44) % 2 !== 0) throw Error('AUDIO_INVALID');
  return (bytes.length - 44) / 32000;
}

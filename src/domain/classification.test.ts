import { describe, expect, it } from 'vitest';
import { formatMemorySerial, memoryBatchDate } from './classification';

describe('recording identity display', () => {
  it('uses the submission date in Japan, including the UTC midnight boundary', () => {
    expect(memoryBatchDate('2026-10-16T15:00:00Z')).toBe('2026-10-17');
    expect(memoryBatchDate('2026-10-16T14:59:59Z')).toBe('2026-10-16');
  });
  it('does not truncate a sequence after 999', () => {
    expect(formatMemorySerial('2026-10-17', 'A', 3)).toBe('261017-A003');
    expect(formatMemorySerial('2026-10-17', 'D', 1000)).toBe('261017-D1000');
  });
});

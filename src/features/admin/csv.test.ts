import { describe, expect, it } from 'vitest';
import { parseTagCsv, serializeTags } from './csv';
import { createTag } from '../../domain/tags';

describe('tag CSV', () => {
  it('parses labels and batch names from a quoted CSV file', () => {
    expect(parseTagCsv('展签编号,批次\n"入口,左侧",秋季展\n展签 02,秋季展')).toEqual([
      { label: '入口,左侧', batch: '秋季展' },
      { label: '展签 02', batch: '秋季展' },
    ]);
  });

  it('rejects empty rows and duplicate labels', () => {
    expect(() => parseTagCsv('展签编号,批次\n展签 01,A\n展签 01,A')).toThrow('CSV_DUPLICATE_LABEL');
    expect(() => parseTagCsv('展签编号,批次\n,A')).toThrow('CSV_EMPTY_LABEL');
  });

  it('exports each tag with a usable visitor URL', () => {
    const tag = createTag('internal-1', '展签 01', 'token-1', '秋季展');
    expect(serializeTags([tag], 'https://museum.example')).toContain('https://museum.example/#/t/token-1');
  });

  it('exports Japanese headers and reads them back', () => {
    const tag = createTag('internal-1', '展示 01', 'token-2', '秋季展');
    const csv = serializeTags([tag], 'https://museum.example/exhibition-audio-prototype/', 'ja-JP');
    expect(csv).toContain('展示タグ番号,バッチ,URL');
    expect(csv).toContain('https://museum.example/exhibition-audio-prototype/#/t/token-2');
    expect(parseTagCsv(csv)).toEqual([{ label: '展示 01', batch: '秋季展' }]);
  });
});

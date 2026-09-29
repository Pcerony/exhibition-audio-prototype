import { describe, expect, it } from 'vitest';
import { claimTag, createTag, resetTag } from './tags';

describe('tag state', () => {
  it('creates a tag without a recording', () => {
    expect(createTag('tag-1', '展签 01').recording).toBeNull();
  });

  it('allows only the first recording to claim a tag', () => {
    const tag = createTag('tag-1', '展签 01');
    const recording = { id: 'audio-1', nickname: '', duration: 2, mimeType: 'audio/webm', createdAt: 'now' };
    const claimed = claimTag(tag, recording);

    expect(claimed.recording?.id).toBe('audio-1');
    expect(() => claimTag(claimed, { ...recording, id: 'audio-2' })).toThrow('TAG_ALREADY_BOUND');
  });

  it('makes a reset tag available for recording again', () => {
    const tag = claimTag(createTag('tag-1', '展签 01'), {
      id: 'audio-1', nickname: '', duration: 2, mimeType: 'audio/webm', createdAt: 'now',
    });

    expect(resetTag(tag).recording).toBeNull();
  });
});

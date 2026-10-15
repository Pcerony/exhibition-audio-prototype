import { describe, expect, it } from 'vitest';
import { createMemoryRepository } from './repository';

describe('memory repository', () => {
  it('preserves the winning location and clears it on reset', async () => {
    const repo = createMemoryRepository();
    await repo.createTag({ id: 'location-tag', token: 'location-token', label: 'L001' });
    const candidate = { id: 'location-audio', blob: new Blob(['audio']), nickname: '', duration: 2,
      location: { source: 'pin' as const, lat: 33.59, lng: 130.4 } };
    await repo.claim('location-token', candidate);
    await repo.claim('location-token', { ...candidate, id: 'loser', location: { source: 'pin', lat: 0, lng: 0 } });
    expect((await repo.getTag('location-token'))?.recording).toHaveProperty('location', candidate.location);
    await repo.resetTag('location-token');
    expect((await repo.getTag('location-token'))?.recording).toBeNull();
  });
  it('keeps the first submitted recording and rejects a later claim', async () => {
    const repository = createMemoryRepository();
    await repository.createTag({ id: 'tag-1', token: 'public-token', label: '展签 01' });

    const first = await repository.claim('public-token', {
      id: 'audio-1',
      blob: new Blob(['first'], { type: 'audio/webm' }),
      nickname: '小林',
      duration: 4,
    });
    const second = await repository.claim('public-token', {
      id: 'audio-2',
      blob: new Blob(['second'], { type: 'audio/webm' }),
      nickname: '',
      duration: 3,
    });

    expect(first.status).toBe('claimed');
    expect(second.status).toBe('already-bound');
    expect((await repository.getTag('public-token'))?.recording?.id).toBe('audio-1');
  });

  it('removes the active recording when an operator resets a tag', async () => {
    const repository = createMemoryRepository();
    await repository.createTag({ id: 'tag-1', token: 'public-token', label: '展签 01' });
    await repository.claim('public-token', {
      id: 'audio-1',
      blob: new Blob(['audio'], { type: 'audio/webm' }),
      nickname: '',
      duration: 3,
    });

    await repository.resetTag('public-token');

    expect((await repository.getTag('public-token'))?.recording).toBeNull();
    expect(await repository.getAudio('audio-1')).toBeNull();
  });

  it('allows exactly one winner when two visitors submit at the same time', async () => {
    const repository = createMemoryRepository();
    await repository.createTag({ id: 'tag-1', token: 'public-token', label: '展签 01' });

    const results = await Promise.all(['audio-1', 'audio-2'].map((id) => repository.claim('public-token', {
      id,
      blob: new Blob([id], { type: 'audio/webm' }),
      nickname: '',
      duration: 2,
    })));

    expect(results.map((result) => result.status).sort()).toEqual(['already-bound', 'claimed']);
    expect((await repository.getTag('public-token'))?.recording?.id).toBe('audio-1');
  });
});

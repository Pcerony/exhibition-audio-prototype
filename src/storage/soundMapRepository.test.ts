import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseSoundMapRepository } from './soundMapRepository';
import { createMemoryRepository } from './repository';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const entry = { id: '00000000-0000-4000-8000-000000000020', token: 'a'.repeat(48), label: 'TEST-A001', categoryCode: 'A',
  durationSeconds: 12, createdAt: '2026-01-01T00:00:00Z', location: { source: 'pin', lat: 33.59, lng: 130.4 } };
function setup() {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fictional.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'fictional-public-key');
  vi.stubEnv('VITE_SOUND_MAP_LOCAL_API', '');
  return createSupabaseSoundMapRepository(createMemoryRepository());
}
describe('sound-map catalog contract', () => {
  it('follows cursor pages and retains unlocated entries without creating fake coordinates', async () => {
    const repository = setup();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [entry], nextCursor: '00000000-0000-4000-8000-000000000010' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ ...entry, id: 'another-recording', location: null }], nextCursor: null })));
    vi.stubGlobal('fetch', fetcher);
    const items = await repository.list();
    expect(items).toHaveLength(2); expect(items[1].location).toBeNull();
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('cursor')).toBe('00000000-0000-4000-8000-000000000010');
  });
  it('fails rather than showing a partial catalog when the response or cursor is invalid', async () => {
    const repository = setup();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ items: [entry], nextCursor: 'same-cursor' }))));
    await expect(repository.list()).rejects.toThrow('MAP_CATALOG_INVALID');
  });
  it('does not request playback after a catalog item has been reset or replaced', async () => {
    const repository = setup();
    await expect(repository.playback({ ...entry, categoryCode: 'A', location: null })).rejects.toThrow('MAP_RECORDING_CHANGED');
  });
});

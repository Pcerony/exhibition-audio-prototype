import { afterEach, expect, it, vi } from 'vitest';

const upload = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: upload }) } }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

it('sends the chosen classification and reads the server-allocated serial without client numbering', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-fixture');
  const tag = { id: 't1', label: '261017-C003', status: 'bound', serialNumber: '261017-C003', batchDate: '2026-10-17', categoryCode: 'C', inventoryLabel: 'U000001',
    recording: { id: 'r1', nickname: '', durationSeconds: 1, createdAt: '2026-10-16T15:00:00Z' } };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ uploadId: 'fixture', path: 'fixture', storageToken: 'test', claimToken: 'test' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'claimed' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(tag)));
  vi.stubGlobal('fetch', fetcher);
  const { createSupabaseVisitorRepository } = await import('./supabaseVisitorRepository');
  const repo = createSupabaseVisitorRepository();
  const result = await repo.claim('opaque-fixture', { id: 'r1', blob: new Blob(['test'], { type: 'audio/wav' }), nickname: '', duration: 1, categoryCode: 'C' });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ categoryCode: 'C' });
  expect(result.tag).toMatchObject({ serialNumber: '261017-C003', batchDate: '2026-10-17', categoryCode: 'C', inventoryLabel: 'U000001' });
  const before = fetcher.mock.calls.length;
  await expect(repo.claim('opaque-fixture', { id: 'invalid', blob: new Blob(['test']), nickname: '', duration: 1 })).rejects.toThrow('CATEGORY_REQUIRED');
  expect(fetcher).toHaveBeenCalledTimes(before);
});

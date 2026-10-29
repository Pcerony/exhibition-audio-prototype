import { afterEach, expect, it, vi } from 'vitest';

const upload = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: upload }) } }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

it('sends the chosen classification and reads the server-allocated serial without client numbering', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-fixture');
  const tag = { id: 't1', label: '261017-C003', status: 'bound', serialNumber: '261017-C003', batchDate: '2026-10-17', categoryCode: 'C', inventoryLabel: 'U000001',
    recording: { id: 'r1', nickname: '', durationSeconds: 1, createdAt: '2026-10-16T15:00:00Z', transcriptionConsent: true, transcript: 'Published plain text.' } };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ uploadId: 'fixture', path: 'fixture', storageToken: 'test', claimToken: 'test' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'claimed' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(tag)));
  vi.stubGlobal('fetch', fetcher);
  const { createSupabaseVisitorRepository } = await import('./supabaseVisitorRepository');
  const repo = createSupabaseVisitorRepository();
  const result = await repo.claim('opaque-fixture', { id: 'r1', blob: new Blob(['test'], { type: 'audio/wav' }), nickname: '', duration: 1, categoryCode: 'C', transcriptionConsent: true, transcriptionLanguage:'ko' });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ categoryCode: 'C', transcriptionConsent: true, transcriptionLanguage:'ko' });
  expect(result.tag).toMatchObject({ serialNumber: '261017-C003', batchDate: '2026-10-17', categoryCode: 'C', inventoryLabel: 'U000001' });
  expect(result.tag?.recording).toMatchObject({ transcriptionConsent: true, transcript: 'Published plain text.' });
  const before = fetcher.mock.calls.length;
  await expect(repo.claim('opaque-fixture', { id: 'invalid', blob: new Blob(['test']), nickname: '', duration: 1 })).rejects.toThrow('CATEGORY_REQUIRED');
  expect(fetcher).toHaveBeenCalledTimes(before);
});

it('sends a selected Place coordinate only as a transient map point, not as persisted location data', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-fixture');
  const tag = { id: 't1', label: '261017-A004', status: 'bound', recording: { id: 'r1', nickname: '', durationSeconds: 1, createdAt: '2026-10-17T01:00:00Z' } };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ uploadId: 'fixture', path: 'fixture', storageToken: 'test', claimToken: 'test' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'claimed', recordingId: 'r1' })))
    .mockResolvedValueOnce(new Response(JSON.stringify(tag)));
  vi.stubGlobal('fetch', fetcher);
  const { createSupabaseVisitorRepository } = await import('./supabaseVisitorRepository');
  const repo = createSupabaseVisitorRepository();
  await repo.claim('opaque-fixture', {
    id: 'r1', blob: new Blob(['test'], { type: 'audio/wav' }), nickname: '', duration: 1, categoryCode: 'A',
    location: { source: 'place', placeId: 'selected-place' }, mapPoint: { lat: 33.5946138544, lng: 130.4063520063 },
  });
  const claim = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(claim.location).toEqual({ source: 'place', placeId: 'selected-place' });
  expect(claim.mapPoint).toEqual({ lat: 33.5946138544, lng: 130.4063520063 });
  expect(JSON.stringify(claim.location)).not.toContain('33.5946138544');
});

it('requests a selected public transcript translation on demand', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-fixture');
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ translation: 'A Fukuoka memory', targetLanguage: 'en', cached: false })));
  vi.stubGlobal('fetch', fetcher);
  const { createSupabaseVisitorRepository } = await import('./supabaseVisitorRepository');
  const repo = createSupabaseVisitorRepository();

  await expect(repo.translateTranscript('opaque-fixture', 'en')).resolves.toBe('A Fukuoka memory');
  expect(String(fetcher.mock.calls[0][0])).toBe('https://fixture.invalid/functions/v1/public-translate');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ token: 'opaque-fixture', targetLanguage: 'en' });
});

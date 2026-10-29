import { expect, it, vi } from 'vitest';
import { createAudioAdminRepository } from './audioAdminRepository';
it('uses bearer authentication and multipart bytes, not any service key or object path', async () => {
  const fetcher = vi.fn(async () => Response.json({ versionId: 'v1' }));
  const repo = createAudioAdminRepository({ url: 'https://example.invalid', key: 'public', getToken: async () => 'operator-token', fetcher });
  await repo.save({ recordingId: 'r1', revision: 2, requestKey: 'key', start: 0, end: 1, audio: new Blob(['wav']) });
  const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain('/functions/v1/admin-audio'); expect(request.headers).toMatchObject({ authorization: 'Bearer operator-token' });
  expect(request.body).toBeInstanceOf(FormData); expect((request.body as FormData).get('revision')).toBe('2');
});
it('refuses missing sessions before network access', async () => {
  const fetcher = vi.fn(); const repo = createAudioAdminRepository({ url: '', key: '', getToken: async () => undefined, fetcher });
  await expect(repo.list()).rejects.toThrow('AUTH_REQUIRED'); expect(fetcher).not.toHaveBeenCalled();
});

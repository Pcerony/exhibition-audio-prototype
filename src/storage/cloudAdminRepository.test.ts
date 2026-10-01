import { describe, expect, it, vi } from 'vitest';
import { createCloudAdminRepository, type AdminAuth } from './cloudAdminRepository';

function setup(loggedIn = true) {
  const auth: AdminAuth = {
    getSession: vi.fn().mockResolvedValue(loggedIn ? { accessToken: 'user-jwt', userId: 'operator-id', email: 'operator@example.invalid' } : null),
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
  };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ userId: 'operator-id', role: 'operator' }), { status: 200 }));
  const repository = createCloudAdminRepository({ url: 'https://example.invalid', key: 'public-key', auth, fetcher });
  return { repository, auth, fetcher };
}

describe('cloud admin repository', () => {
  it('does not send anonymous management requests', async () => {
    const { repository, fetcher } = setup(false);
    expect(await repository.getSession()).toBeNull();
    await expect(repository.listTags()).rejects.toThrow('AUTH_REQUIRED');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates operator membership on the server with the user JWT', async () => {
    const { repository, fetcher } = setup();
    expect(await repository.getSession()).toEqual({ userId: 'operator-id', role: 'operator', email: 'operator@example.invalid' });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe('https://example.invalid/functions/v1/admin-api');
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer user-jwt');
    expect(new Headers(options?.headers).get('apikey')).toBe('public-key');
    expect(JSON.parse(options?.body as string)).toEqual({ action: 'session' });
  });

  it('sends pagination and search through the shared API', async () => {
    const { repository, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ tags: [], total: 0 })));
    expect(await repository.listTags({ search: 'Fukuoka', status: 'bound', offset: 50, limit: 50 })).toEqual({ tags: [], total: 0 });
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ action: 'list', search: 'Fukuoka', status: 'bound', offset: 50, limit: 50 });
  });

  it('preserves the batch idempotency key and never generates public tokens', async () => {
    const { repository, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ tags: [] })));
    await repository.createBatch([{ label: 'Test 01', batch: 'Fixture' }], 'request-id');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ action: 'createBatch', rows: [{ label: 'Test 01', batch: 'Fixture' }], requestKey: 'request-id' });
  });

  it('exposes stable error codes, not server diagnostics', async () => {
    const { repository, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'OPERATOR_REQUIRED', message: 'sensitive SQL details' }), { status: 403 }));
    await expect(repository.getSession()).rejects.toThrow('OPERATOR_REQUIRED');
  });

  it('uses server-issued provisioning URLs unchanged', async () => {
    const { repository, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    const job = { id: 'job-id', tagId: 'tag-id', label: 'Test 01', batch: '', visitorUrl: 'https://voice.heisei.space/#/t/opaque', version: 1, status: 'pending' as const, errorCode: null };
    await repository.provision(job, 'verified');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ action: 'provision', jobId: job.id, version: 1, visitorUrl: job.visitorUrl, status: 'verified' });
  });
});

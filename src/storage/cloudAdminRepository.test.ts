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
  it('uses server categories and automatic card numbering without client-generated labels', async () => {
    const { repository, fetcher } = setup();
    const category = { id: 'category-id', name: 'Food', code: 'A', nextNumber: 1 };
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ categories: [category] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ category })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tags: [] })));
    expect(await repository.listCategories()).toEqual([category]);
    expect(await repository.createCategory('Food', 'key-1')).toEqual(category);
    await repository.createCards(category.id, 30, 'key-2');
    expect(JSON.parse(fetcher.mock.calls[2][1]?.body as string)).toEqual({ action: 'createCards', categoryId: category.id, count: 30, requestKey: 'key-2' });
  });

  it('sends server preview versions and distinct group confirmation unchanged', async () => {
    const { repository, fetcher } = setup();
    const cards = [{ id: 'tag-id', version: 3, label: 'A001' }];
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ groups: [{ kind: 'recorded', cards, recordingCount: 1 }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    const preview = await repository.previewBulk(['tag-id'], 'move', 'target-id');
    await repository.applyBulk({ operation: 'move', cards: preview.groups[0].cards, kind: 'recorded', targetCategoryId: 'target-id', requestKey: 'retry-key' });
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({ action: 'bulkApply', operation: 'move', cards, kind: 'recorded', targetCategoryId: 'target-id', requestKey: 'retry-key' });
  });
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

  it('keeps category filtering and recording-time sorting on the server', async () => {
    const { repository, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ tags: [], total: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    await repository.listTags({ categoryId: 'category-id', sort: 'recorded_asc', offset: 0, limit: 50 });
    await repository.renameCategory('category-id', 'Places');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ action: 'list', categoryId: 'category-id', sort: 'recorded_asc', offset: 0, limit: 50 });
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({ action: 'renameCategory', categoryId: 'category-id', name: 'Places' });
  });

  it('does not retry ambiguous destructive requests with a new idempotency key', async () => {
    const { repository, fetcher } = setup();
    fetcher.mockRejectedValueOnce(new TypeError('Network unavailable'));
    await expect(repository.applyBulk({ operation: 'delete', cards: [{ id: 'tag-id', version: 2, label: 'A001' }], kind: 'empty', requestKey: 'same-key' })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).requestKey).toBe('same-key');
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
    await repository.provision(job, 'verified', 'server-lease-token');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({ action: 'provision', jobId: job.id, version: 1, visitorUrl: job.visitorUrl, status: 'verified', protocolVersion: 2, leaseToken: 'server-lease-token' });
  });
});

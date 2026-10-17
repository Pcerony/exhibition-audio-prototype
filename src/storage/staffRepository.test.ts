import { describe, it, expect, vi } from 'vitest';
import { createCloudStaffRepository } from './staffRepository';

function fixture() {
  const auth = {
    getSession: vi.fn(async () => ({
      accessToken: 'synthetic',
      userId: 'account',
    })),
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
  };
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          userId: 'account',
          role: 'staff',
          members: [{ id: 'member', name: 'Test staff' }],
        }),
        { status: 200 },
      ),
  );
  const repository = createCloudStaffRepository({
    url: 'https://example.invalid',
    key: 'public',
    auth,
    fetcher,
  });
  return { repository, auth, fetcher };
}
describe('staff repository', () => {
  it('restores the authorized shared session and signs in without storing passwords', async () => {
    const f = fixture();
    expect((await f.repository.getSession())?.members[0].name).toBe(
      'Test staff',
    );
    await f.repository.signIn(' STAFF ', 'secret');
    expect(f.auth.signIn).toHaveBeenCalledWith(
      'staff-portal@staff.invalid',
      'secret',
    );
    const [url, options] = f.fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://example.invalid/functions/v1/staff-api');
    expect(options.headers).toMatchObject({
      authorization: 'Bearer synthetic',
    });
    expect(options.body).not.toContain('secret');
  });
  it('rejects other usernames and email identifiers before authentication', async () => {
    for (const name of ['other', 'admin@example.invalid', '']) {
      const f = fixture();
      await expect(f.repository.signIn(name, 'secret')).rejects.toThrow('LOGIN_FAILED');
      expect(f.auth.signIn).not.toHaveBeenCalled();
      expect(f.fetcher).not.toHaveBeenCalled();
    }
  });
  it('signs out if the shared identifier was incorrectly granted elevated permissions', async () => {
    const f = fixture();
    f.fetcher.mockImplementation(async () => new Response(JSON.stringify({
      userId: 'account', role: 'admin', members: [],
    }), { status: 200 }));
    await expect(f.repository.signIn('staff', 'secret')).rejects.toThrow('STAFF_REQUIRED');
    expect(f.auth.signOut).toHaveBeenCalledOnce();
  });
  it('passes member selection and version but never grants admin operations', async () => {
    const f = fixture();
    await f.repository.save('recording', 'member', 3, 'corrected', true);
    expect(
      JSON.parse(
        String(
          (f.fetcher.mock.calls.at(-1) as unknown as [string, RequestInit])[1]
            .body,
        ),
      ),
    ).toEqual({
      action: 'save',
      recordingId: 'recording',
      memberId: 'member',
      version: 3,
      text: 'corrected',
      published: true,
    });
    expect('resetTag' in f.repository).toBe(false);
    expect('createCards' in f.repository).toBe(false);
  });
  it('preserves stable conflict codes and scopes member memory by backend', async () => {
    const f = fixture();
    f.fetcher.mockImplementation(
      async () =>
        new Response(JSON.stringify({ code: 'VERSION_CONFLICT' }), {
          status: 409,
        }),
    );
    await expect(
      f.repository.save('r', 'member', 1, 'edit', true),
    ).rejects.toThrow('VERSION_CONFLICT');
    expect(f.repository.identityScope).toBe('https://example.invalid');
  });
  it('does not send an existing staff selection with another account bearer after cross-tab sign-in', async () => {
    const f = fixture();
    await f.repository.getSession();
    f.fetcher.mockClear();
    f.auth.getSession.mockResolvedValue({
      accessToken: 'other-token',
      userId: 'other-account',
    });
    await expect(
      f.repository.save('recording', 'member', 1, 'old editor', true),
    ).rejects.toThrow('AUTH_REQUIRED');
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});

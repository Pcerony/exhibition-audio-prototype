import { createClient } from '@supabase/supabase-js';
import type { AdminRepository, AuditEntry, ManagedTag, OperatorSession, ProvisioningJob } from './adminRepository';
export type AdminAuth = {
  getSession(): Promise<{ accessToken: string; userId: string; email?: string } | null>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
};
export function createCloudAdminRepository(config: { url: string; key: string; auth: AdminAuth; fetcher?: typeof fetch }): AdminRepository {
  const fetcher = config.fetcher ?? fetch;
  async function request<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
    const session = await config.auth.getSession();
    if (!session) throw new Error('AUTH_REQUIRED');
    const response = await fetcher(`${config.url.replace(/\/$/, '')}/functions/v1/admin-api`, {
      method: 'POST',
      headers: { apikey: config.key, authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof result?.code === 'string' ? result.code : 'SERVICE_UNAVAILABLE');
    if (!result || typeof result !== 'object') throw new Error('RESPONSE_INVALID');
    return result as T;
  }
  async function getSession(): Promise<OperatorSession | null> {
    const session = await config.auth.getSession();
    if (!session) return null;
    const membership = await request<OperatorSession>('session');
    if (membership.role !== 'operator' && membership.role !== 'admin') throw new Error('OPERATOR_REQUIRED');
    return { ...membership, email: session.email };
  }
  return {
    getSession,
    async signIn(email, password) {
      await config.auth.signIn(email.trim(), password);
      const session = await getSession();
      if (!session) throw new Error('AUTH_REQUIRED');
      return session;
    },
    signOut: () => config.auth.signOut(),
    listTags: (query = {}) => request<{ tags: ManagedTag[]; total: number }>('list', query),
    createBatch: (rows, requestKey) => request<{ tags: ManagedTag[] }>('createBatch', { rows, requestKey }),
    async resetTag(tagId) { await request('reset', { tagId }); },
    async setEnabled(tagId, enabled) { await request('setEnabled', { tagId, enabled }); },
    async getPlaybackUrl(recordingId) { return (await request<{ url: string }>('playback', { recordingId })).url; },
    async listJobs(query = {}) {
      const jobs: ProvisioningJob[] = [];
      while (true) {
        const page = await request<{ jobs: ProvisioningJob[]; total: number }>('jobs', { ...query, offset: jobs.length, limit: 500 });
        jobs.push(...page.jobs);
        if (jobs.length >= page.total) return jobs;
        if (!page.jobs.length) throw new Error('INCOMPLETE_EXPORT');
      }
    },
    async provision(job, status, errorCode) {
      await request('provision', { jobId: job.id, version: job.version, visitorUrl: job.visitorUrl, status, ...(errorCode ? { errorCode } : {}) });
    },
    async getAudit() { return (await request<{ entries: AuditEntry[] }>('audit')).entries; },
    maintenance: () => request<{ removed: number; pending: number }>('maintenance'),
  };
}

export function createConfiguredCloudAdminRepository(): AdminRepository {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_CONFIG_MISSING');
  const client = createClient(url, key, {
    auth: { storageKey: 'exhibition-operator-session-v1', detectSessionInUrl: false },
  });
  return createCloudAdminRepository({ url, key, auth: {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error('AUTH_REQUIRED');
      return data.session ? { accessToken: data.session.access_token, userId: data.session.user.id, email: data.session.user.email } : null;
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error('LOGIN_FAILED');
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw new Error('SIGNOUT_FAILED');
    },
  } });
}

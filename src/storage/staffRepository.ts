import { createClient } from '@supabase/supabase-js';
import type { AdminAuth } from './cloudAdminRepository';
import type { PieceAssignmentSummary } from './adminRepository';
import type { MemoryLocation } from '../domain/location';
import type { MemoryCategoryCode } from '../domain/classification';

const STAFF_USERNAME = 'staff';
// This is an Auth identifier, not a mailbox or a secret.
const STAFF_AUTH_IDENTIFIER = 'staff-portal@staff.invalid';

export type StaffMember = { id: string; name: string };
export type StaffSession = {
  userId: string;
  role: 'staff' | 'operator' | 'admin';
  members: StaffMember[];
};
export type StaffReview = {
  memberName: string;
  createdAt: string;
  action: string;
};
export type StaffTranscript = {
  status: 'pending' | 'processing' | 'ready' | 'failed';
  text: string | null;
  published: boolean;
  version: number;
  updatedAt: string;
};
export type StaffCard = {
  id: string;
  label: string;
  inventoryLabel: string;
  status: 'bound' | 'unbound' | 'disabled';
  categoryCode: MemoryCategoryCode | null;
  createdAt: string;
  recording: null | {
    id: string;
    duration: number;
    createdAt: string;
    location: MemoryLocation | null;
    transcriptionConsent: boolean;
    transcription: StaffTranscript | null;
    pieceAssignment: PieceAssignmentSummary | null;
    latestReview: StaffReview | null;
  };
};
export type StaffQuery = {
  tagId?: string;
  search?: string;
  reviewState?: 'all' | 'unreviewed' | 'approved' | 'empty';
  categoryCode?: MemoryCategoryCode;
  batchDate?: string;
  offset?: number;
  limit?: number;
};
export type StaffHistory = StaffReview & { id: number };
export interface StaffRepository {
  identityScope: string;
  getSession(): Promise<StaffSession | null>;
  signIn(username: string, password: string): Promise<StaffSession>;
  signOut(): Promise<void>;
  list(query: StaffQuery): Promise<{ cards: StaffCard[]; total: number }>;
  save(
    recordingId: string,
    memberId: string,
    version: number,
    text: string,
    published: boolean,
  ): Promise<void>;
  playback(recordingId: string, memberId: string): Promise<string>;
  history(tagId: string): Promise<StaffHistory[]>;
  viewLocation(recordingId: string, memberId: string): Promise<void>;
  subscribeAuth?: (listener: (userId: string | null) => void) => () => void;
}

export function createCloudStaffRepository(config: {
  url: string;
  key: string;
  auth: AdminAuth & {
    onSessionChange?: (listener: (userId: string | null) => void) => () => void;
  };
  fetcher?: typeof fetch;
}): StaffRepository {
  const fetcher = config.fetcher ?? fetch;
  const url = config.url.replace(/\/$/, '');
  let acceptedUserId: string | null = null;
  async function request<T>(
    action: string,
    body: Record<string, unknown> = {},
  ): Promise<T> {
    const session = await config.auth.getSession();
    if (!session || (acceptedUserId && acceptedUserId !== session.userId))
      throw Error('AUTH_REQUIRED');
    acceptedUserId = session.userId;
    const response = await fetcher(`${url}/functions/v1/staff-api`, {
      method: 'POST',
      headers: {
        apikey: config.key,
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ action, ...body }),
    });
    const result = await response.json().catch(() => null);
    const current = await config.auth.getSession();
    if (!current || current.userId !== session.userId)
      throw Error('AUTH_REQUIRED');
    if (!response.ok)
      throw Error(
        typeof result?.code === 'string' ? result.code : 'SERVICE_UNAVAILABLE',
      );
    if (!result || typeof result !== 'object') throw Error('RESPONSE_INVALID');
    return result as T;
  }
  async function getSession() {
    if (!(await config.auth.getSession())) return null;
    try {
      const session = await request<StaffSession>('session');
      if (session.role !== 'staff' || !Array.isArray(session.members))
        throw Error('STAFF_REQUIRED');
      return session;
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'STAFF_REQUIRED') {
        await config.auth.signOut().catch(() => {});
        acceptedUserId = null;
      }
      throw cause;
    }
  }
  return {
    identityScope: url,
    getSession,
    async signIn(username, password) {
      if (username.trim().toLowerCase() !== STAFF_USERNAME)
        throw Error('LOGIN_FAILED');
      await config.auth.signIn(STAFF_AUTH_IDENTIFIER, password);
      acceptedUserId = null;
      try {
        const session = await getSession();
        if (!session) throw Error('AUTH_REQUIRED');
        return session;
      } catch (cause) {
        if (!(cause instanceof Error && cause.message === 'STAFF_REQUIRED'))
          await config.auth.signOut().catch(() => {});
        acceptedUserId = null;
        throw cause;
      }
    },
    async signOut() {
      await config.auth.signOut();
      acceptedUserId = null;
    },
    subscribeAuth: config.auth.onSessionChange,
    list: (query) => request('list', query),
    async save(recordingId, memberId, version, text, published) {
      await request('save', {
        recordingId,
        memberId,
        version,
        text,
        published,
      });
    },
    async playback(recordingId, memberId) {
      return (
        await request<{ url: string }>('playback', { recordingId, memberId })
      ).url;
    },
    async history(tagId) {
      return (await request<{ entries: StaffHistory[] }>('history', { tagId }))
        .entries;
    },
    async viewLocation(recordingId, memberId) {
      await request('activity', {
        recordingId,
        memberId,
        event: 'location_viewed',
      });
    },
  };
}

export function createConfiguredStaffRepository(): StaffRepository {
  const url = import.meta.env.VITE_SUPABASE_URL,
    key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw Error('SUPABASE_CONFIG_MISSING');
  const client = createClient(url, key, {
    auth: {
      storageKey: 'exhibition-staff-session-v1',
      detectSessionInUrl: false,
    },
  });
  return createCloudStaffRepository({
    url,
    key,
    auth: {
      async getSession() {
        const { data, error } = await client.auth.getSession();
        if (error) throw Error('AUTH_REQUIRED');
        return data.session
          ? {
              accessToken: data.session.access_token,
              userId: data.session.user.id,
            }
          : null;
      },
      async signIn(email, password) {
        const { error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw Error('LOGIN_FAILED');
      },
      async signOut() {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw Error('SIGNOUT_FAILED');
      },
      onSessionChange(listener) {
        const { data } = client.auth.onAuthStateChange((_event, session) =>
          listener(session?.user.id ?? null),
        );
        return () => data.subscription.unsubscribe();
      },
    },
  });
}

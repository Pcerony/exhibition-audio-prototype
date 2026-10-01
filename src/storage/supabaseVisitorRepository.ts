import { createClient } from '@supabase/supabase-js';
import type { Tag } from '../domain/tags';
import type { ClaimResult, NewRecording, VisitorRepository } from './repository';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const BUCKET = 'recordings';

type CloudTag = {
  id: string;
  label: string;
  batch?: string;
  status: Tag['status'];
  createdAt?: string;
  recording: null | { id: string; nickname: string; durationSeconds: number; createdAt: string };
};

type UploadGrant = { uploadId: string; path: string; storageToken: string; claimToken: string };

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export function createSupabaseVisitorRepository(): VisitorRepository {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('SUPABASE_CONFIG_MISSING');
  const client = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function request<T>(functionName: string, options: { method: 'GET' | 'POST'; query?: Record<string, string>; body?: unknown; headers?: HeadersInit }): Promise<T> {
    const url = new URL(`${SUPABASE_URL}/functions/v1/${functionName}`);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    const headers = new Headers(options.headers);
    headers.set('apikey', SUPABASE_KEY);
    if (options.body) headers.set('content-type', 'application/json');
    const response = await fetch(url, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof result.code === 'string' ? result.code : 'CLOUD_REQUEST_FAILED');
    return result as T;
  }

  function mapTag(token: string, value: CloudTag): Tag {
    return {
      id: value.id,
      token,
      label: value.label,
      batch: value.batch ?? '',
      createdAt: value.createdAt ?? new Date().toISOString(),
      status: value.status,
      recording: value.recording ? {
        id: value.recording.id,
        nickname: value.recording.nickname,
        duration: value.recording.durationSeconds,
        mimeType: '',
        createdAt: value.recording.createdAt,
      } : null,
    };
  }

  async function getTag(token: string): Promise<Tag | null> {
    try {
      const value = await request<CloudTag>('public-tag', { method: 'GET', query: { token } });
      return mapTag(token, value);
    } catch (error) {
      if (error instanceof Error && error.message === 'TAG_NOT_FOUND') return null;
      throw error;
    }
  }

  return {
    getTag,
    async getVisitorPlaybackUrl(token) {
      const result = await request<{ url: string }>('public-playback-url', { method: 'POST', body: { token } });
      return result.url;
    },
    async claim(token, recording: NewRecording): Promise<ClaimResult> {
      const mimeType = recording.blob.type.split(';')[0].trim().toLowerCase();
      let grant: UploadGrant;
      try {
        grant = await request<UploadGrant>('public-upload-init', {
          method: 'POST',
          body: { token, mimeType, sizeBytes: recording.blob.size },
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'ALREADY_BOUND') {
          return { status: 'already-bound', tag: await getTag(token) };
        }
        throw error;
      }
      const { error: uploadError } = await client.storage.from(BUCKET).uploadToSignedUrl(
        grant.path,
        grant.storageToken,
        recording.blob,
        { contentType: mimeType, upsert: false },
      );
      if (uploadError) throw new Error('UPLOAD_FAILED');

      try {
        await request('public-upload-claim', {
          method: 'POST',
          body: { uploadId: grant.uploadId, nickname: recording.nickname, durationSeconds: recording.duration },
          headers: { 'x-upload-token': grant.claimToken },
        });
        return { status: 'claimed', tag: await getTag(token) };
      } catch (error) {
        if (error instanceof Error && error.message === 'ALREADY_BOUND') {
          return { status: 'already-bound', tag: await getTag(token) };
        }
        throw error;
      }
    },
  };
}

export type AudioReviewItem = {
  id: string; label: string; createdAt: string; reportedDuration: number; sizeBytes: number;
  revision: number; activeVersionId: string | null; measuredDuration: number | null; meanDb: number | null;
};
export type AudioDetail = { originalUrl: string; revision: number; activeVersionId: string | null; versions: { id: string; duration: number; start_seconds: number; end_seconds: number; created_at: string; url?: string }[] };
export interface AudioAdminRepository {
  list(): Promise<AudioReviewItem[]>;
  detail(recordingId: string): Promise<AudioDetail>;
  measure(recordingId: string, duration: number, meanDb: number): Promise<void>;
  save(input: { recordingId: string; revision: number; requestKey: string; start: number; end: number; audio: Blob }): Promise<void>;
  restore(recordingId: string, revision: number): Promise<void>;
}

export function createAudioAdminRepository(config: { url: string; key: string; getToken: () => Promise<string | undefined>; fetcher?: typeof fetch }): AudioAdminRepository {
  const fetcher = config.fetcher ?? fetch;
  async function call<T>(body: Record<string, unknown> | FormData): Promise<T> {
    const token = await config.getToken(); if (!token) throw Error('AUTH_REQUIRED');
    const multipart = body instanceof FormData;
    const response = await fetcher(`${config.url.replace(/\/$/, '')}/functions/v1/admin-audio`, { method: 'POST', headers: { apikey: config.key, authorization: `Bearer ${token}`, ...(!multipart ? { 'content-type': 'application/json' } : {}) }, body: multipart ? body : JSON.stringify(body) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw Error(result?.code ?? 'SERVICE_UNAVAILABLE');
    return result;
  }
  return {
    async list() { const items: AudioReviewItem[] = []; while (true) { const page = await call<{ items: AudioReviewItem[]; total: number }>({ action: 'list', offset: items.length, limit: 100 }); items.push(...page.items); if (items.length >= page.total) return items; if (!page.items.length) throw Error('INCOMPLETE_EXPORT'); } },
    detail: recordingId => call({ action: 'detail', recordingId }),
    async measure(recordingId, duration, meanDb) { await call({ action: 'measure', recordingId, duration, meanDb }); },
    async save(input) { const form = new FormData(); form.set('action', 'save'); for (const key of ['recordingId', 'revision', 'requestKey', 'start', 'end'] as const) form.set(key, String(input[key])); form.set('audio', input.audio, 'clip.wav'); await call(form); },
    async restore(recordingId, revision) { await call({ action: 'restore', recordingId, revision }); },
  };
}

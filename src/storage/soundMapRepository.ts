import { parseMemoryLocation, type MemoryLocation } from '../domain/location';
import { isMemoryCategoryCode, type MemoryCategoryCode } from '../domain/classification';
import type { TagRepository, VisitorRepository } from './repository';

export type SoundMapEntry = {
  id: string; token: string; label: string; categoryCode: MemoryCategoryCode | null;
  durationSeconds: number; createdAt: string; location: MemoryLocation | null;
};
export interface SoundMapRepository {
  list(signal?: AbortSignal): Promise<SoundMapEntry[]>;
  playback(entry: SoundMapEntry): Promise<string | null>;
}

export function createSupabaseSoundMapRepository(visitor: VisitorRepository): SoundMapRepository {
  return {
    async list(signal) {
      const base = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!base || !key) throw Error('SUPABASE_CONFIG_MISSING');
      const endpoint = import.meta.env.DEV && import.meta.env.VITE_SOUND_MAP_LOCAL_API
        ? new URL(import.meta.env.VITE_SOUND_MAP_LOCAL_API, window.location.origin)
        : new URL(`${base}/functions/v1/public-map`);
      const result = new Map<string, SoundMapEntry>();
      const cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const url = new URL(endpoint);
        url.searchParams.set('limit', '100');
        if (cursor) url.searchParams.set('cursor', cursor);
        const response = await fetch(url, { headers: { apikey: key }, signal, cache: 'no-store' });
        if (!response.ok) throw Error('MAP_CATALOG_UNAVAILABLE');
        const page = await response.json();
        if (!Array.isArray(page.items) || page.items.length > 100) throw Error('MAP_CATALOG_INVALID');
        for (const item of page.items) {
          if (typeof item.id !== 'string' || typeof item.token !== 'string' || !/^[a-f0-9]{48}$/.test(item.token)
            || typeof item.label !== 'string' || !Number.isFinite(item.durationSeconds) || typeof item.createdAt !== 'string') throw Error('MAP_CATALOG_INVALID');
          result.set(item.id, { id: item.id, token: item.token, label: item.label,
            categoryCode: isMemoryCategoryCode(item.categoryCode) ? item.categoryCode : null,
            durationSeconds: item.durationSeconds, createdAt: item.createdAt, location: parseMemoryLocation(item.location) });
        }
        cursor = page.nextCursor;
        if (cursor !== null && (typeof cursor !== 'string' || cursors.has(cursor) || cursors.size >= 100)) throw Error('MAP_CATALOG_INVALID');
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return [...result.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async playback(entry) {
      const current = await visitor.getTag(entry.token);
      if (current?.status === 'disabled' || current?.recording?.id !== entry.id) throw Error('MAP_RECORDING_CHANGED');
      return visitor.getVisitorPlaybackUrl(entry.token);
    },
  };
}

export function createLocalSoundMapRepository(repository: TagRepository): SoundMapRepository {
  return {
    async list() {
      return (await repository.listTags()).flatMap(tag => tag.status !== 'disabled' && tag.recording ? [{
        id: tag.recording.id, token: tag.token, label: tag.serialNumber ?? tag.label,
        categoryCode: tag.categoryCode ?? null, durationSeconds: tag.recording.duration,
        createdAt: tag.recording.createdAt, location: tag.recording.location ?? null,
      }] : []);
    },
    async playback(entry) {
      const current = await repository.getTag(entry.token);
      if (current?.status === 'disabled' || current?.recording?.id !== entry.id) throw Error('MAP_RECORDING_CHANGED');
      return repository.getVisitorPlaybackUrl(entry.token);
    },
  };
}

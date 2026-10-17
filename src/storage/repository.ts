import { claimTag, createTag, resetTag, type RecordingInfo, type Tag } from '../domain/tags';
import { indexedDbAudioStore, type AudioStore } from './indexedDb';
import { parseMemoryLocation, type MapPoint, type MemoryLocation } from '../domain/location';
import { MEMORY_CATEGORIES, formatMemorySerial, isMemoryCategoryCode, memoryBatchDate, type MemoryCategoryCode } from '../domain/classification';

type NewTag = { id: string; token: string; label: string; batch?: string };
export type NewRecording = { id: string; blob: Blob; nickname: string; duration: number; location?: MemoryLocation | null; mapPoint?: MapPoint | null; categoryCode?: MemoryCategoryCode; transcriptionConsent?: boolean };
export type ClaimResult = { status: 'claimed' | 'already-bound' | 'not-found'; tag: Tag | null };

export interface TagRepository {
  listTags(): Promise<Tag[]>;
  getTag(token: string): Promise<Tag | null>;
  createTag(input: NewTag): Promise<Tag>;
  claim(token: string, recording: NewRecording): Promise<ClaimResult>;
  getAudio(recordingId: string): Promise<Blob | null>;
  getVisitorPlaybackUrl(token: string): Promise<string | null>;
  resetTag(token: string): Promise<void>;
}

export type VisitorRepository = Pick<TagRepository, 'getTag' | 'claim' | 'getVisitorPlaybackUrl'>;

interface MetadataStore {
  read(): Tag[];
  write(tags: Tag[]): void;
  nextSerial(key: string): number;
}

const STORAGE_KEY = 'exhibition-audio-tags-v1';
const SERIAL_KEY = 'exhibition-audio-serial-counters-v3';

function localMetadataStore(): MetadataStore {
  return {
    read() {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Tag[];
      } catch {
        return [];
      }
    },
    write(tags) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
    },
    nextSerial(key) {
      const saved = JSON.parse(localStorage.getItem(SERIAL_KEY) ?? '{}');
      const previous = saved[key] ?? 0;
      if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) throw new Error('LOCAL_SEQUENCE_INVALID');
      const next = previous + 1;
      localStorage.setItem(SERIAL_KEY, JSON.stringify({ ...saved, [key]: next }));
      return next;
    },
  };
}

function buildRepository(metadata: MetadataStore, audio: AudioStore): TagRepository {
  let claimQueue = Promise.resolve();
  return {
    async listTags() {
      return metadata.read().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getTag(token) {
      return metadata.read().find((tag) => tag.token === token) ?? null;
    },
    async createTag(input) {
      const tags = metadata.read();
      if (tags.some((tag) => tag.token === input.token)) throw new Error('TAG_TOKEN_EXISTS');
      if (tags.some((tag) => tag.label.toLocaleLowerCase() === input.label.trim().toLocaleLowerCase())) throw new Error('TAG_LABEL_EXISTS');
      const tag = createTag(input.id, input.label, input.token, input.batch);
      metadata.write([tag, ...tags]);
      return tag;
    },
    async claim(token, candidate) {
      let resolveResult!: (result: ClaimResult) => void;
      let rejectResult!: (error: unknown) => void;
      const result = new Promise<ClaimResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
      claimQueue = claimQueue.then(async () => {
        try {
          const tags = metadata.read();
          const index = tags.findIndex((tag) => tag.token === token);
          if (index < 0) {
            resolveResult({ status: 'not-found', tag: null });
            return;
          }
          if (tags[index].recording) {
            resolveResult({ status: 'already-bound', tag: tags[index] });
            return;
          }
          const recording: RecordingInfo = {
            id: candidate.id,
            nickname: candidate.nickname.trim(),
            duration: candidate.duration,
            mimeType: candidate.blob.type,
            createdAt: new Date().toISOString(),
            location: parseMemoryLocation(candidate.location),
            transcriptionConsent: candidate.transcriptionConsent === true,
            transcript: null,
          };
          await audio.set(candidate.id, candidate.blob);
          tags[index] = claimTag(tags[index], recording);
          if (isMemoryCategoryCode(candidate.categoryCode)) {
            const batchDate = memoryBatchDate(recording.createdAt);
            const key = `${batchDate}:${candidate.categoryCode}`;
            const number = metadata.nextSerial(key);
            const serialNumber = formatMemorySerial(batchDate, candidate.categoryCode, number);
            tags[index] = { ...tags[index], categoryCode: candidate.categoryCode,
              categoryId: MEMORY_CATEGORIES.find(category => category.code === candidate.categoryCode)!.id,
              batchDate, batch: batchDate, serialNumber, label: serialNumber };
          }
          metadata.write(tags);
          resolveResult({ status: 'claimed', tag: tags[index] });
        } catch (error) {
          rejectResult(error);
        }
      });
      return result;
    },
    async getAudio(recordingId) {
      return audio.get(recordingId);
    },
    async getVisitorPlaybackUrl(token) {
      const tag = metadata.read().find((item) => item.token === token);
      if (!tag?.recording) return null;
      const blob = await audio.get(tag.recording.id);
      return blob ? URL.createObjectURL(blob) : null;
    },
    async resetTag(token) {
      const tags = metadata.read();
      const index = tags.findIndex((tag) => tag.token === token);
      if (index < 0) return;
      const recordingId = tags[index].recording?.id;
      tags[index] = resetTag(tags[index]);
      metadata.write(tags);
      if (recordingId) await audio.delete(recordingId);
    },
  };
}

export function createBrowserRepository(): TagRepository {
  return buildRepository(localMetadataStore(), indexedDbAudioStore);
}

export function createMemoryRepository(): TagRepository {
  const tags: Tag[] = [];
  const blobs = new Map<string, Blob>();
  const serials = new Map<string, number>();
  const metadata: MetadataStore = { read: () => tags.map((tag) => ({ ...tag })), write: (next) => { tags.splice(0, tags.length, ...next); },
    nextSerial(key) { const next = (serials.get(key) ?? 0) + 1; serials.set(key, next); return next; } };
  const audio: AudioStore = {
    async set(id, blob) { blobs.set(id, blob); },
    async get(id) { return blobs.get(id) ?? null; },
    async delete(id) { blobs.delete(id); },
  };
  return buildRepository(metadata, audio);
}

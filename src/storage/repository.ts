import { claimTag, createTag, resetTag, type RecordingInfo, type Tag } from '../domain/tags';
import { indexedDbAudioStore, type AudioStore } from './indexedDb';

type NewTag = { id: string; token: string; label: string; batch?: string };
type NewRecording = { id: string; blob: Blob; nickname: string; duration: number };
export type ClaimResult = { status: 'claimed' | 'already-bound' | 'not-found'; tag: Tag | null };

export interface TagRepository {
  listTags(): Promise<Tag[]>;
  getTag(token: string): Promise<Tag | null>;
  createTag(input: NewTag): Promise<Tag>;
  claim(token: string, recording: NewRecording): Promise<ClaimResult>;
  getAudio(recordingId: string): Promise<Blob | null>;
  resetTag(token: string): Promise<void>;
}

interface MetadataStore {
  read(): Tag[];
  write(tags: Tag[]): void;
}

const STORAGE_KEY = 'exhibition-audio-tags-v1';

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
          };
          await audio.set(candidate.id, candidate.blob);
          tags[index] = claimTag(tags[index], recording);
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
  const metadata: MetadataStore = { read: () => tags.map((tag) => ({ ...tag })), write: (next) => { tags.splice(0, tags.length, ...next); } };
  const audio: AudioStore = {
    async set(id, blob) { blobs.set(id, blob); },
    async get(id) { return blobs.get(id) ?? null; },
    async delete(id) { blobs.delete(id); },
  };
  return buildRepository(metadata, audio);
}

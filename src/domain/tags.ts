import type { MemoryLocation } from './location';
import type { MemoryCategoryCode } from './classification';

export type RecordingInfo = {
  id: string;
  nickname: string;
  duration: number;
  mimeType: string;
  createdAt: string;
  location?: MemoryLocation | null;
  transcriptionConsent?: boolean;
  transcript?: string | null;
};

export type Tag = {
  id: string;
  token: string;
  label: string;
  batch: string;
  createdAt: string;
  status?: 'unbound' | 'bound' | 'disabled';
  recording: RecordingInfo | null;
  inventoryLabel?: string;
  categoryId?: string | null;
  categoryCode?: MemoryCategoryCode | null;
  batchDate?: string | null;
  serialNumber?: string | null;
};

export function createTag(id: string, label: string, token = id, batch = ''): Tag {
  return { id, token, label, inventoryLabel: label, batch, createdAt: new Date().toISOString(), status: 'unbound', recording: null, categoryId: null, categoryCode: null, batchDate: null, serialNumber: null };
}

export function claimTag(tag: Tag, recording: RecordingInfo): Tag {
  if (tag.recording) throw new Error('TAG_ALREADY_BOUND');
  return { ...tag, status: 'bound', recording };
}

export function resetTag(tag: Tag): Tag {
  return { ...tag, status: 'unbound', recording: null, label: tag.inventoryLabel ?? tag.label, batch: '', categoryId: null, categoryCode: null, batchDate: null, serialNumber: null };
}

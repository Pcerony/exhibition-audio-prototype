export type RecordingInfo = {
  id: string;
  nickname: string;
  duration: number;
  mimeType: string;
  createdAt: string;
};

export type Tag = {
  id: string;
  token: string;
  label: string;
  batch: string;
  createdAt: string;
  recording: RecordingInfo | null;
};

export function createTag(id: string, label: string, token = id, batch = ''): Tag {
  return { id, token, label, batch, createdAt: new Date().toISOString(), recording: null };
}

export function claimTag(tag: Tag, recording: RecordingInfo): Tag {
  if (tag.recording) throw new Error('TAG_ALREADY_BOUND');
  return { ...tag, recording };
}

export function resetTag(tag: Tag): Tag {
  return { ...tag, recording: null };
}

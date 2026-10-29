import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';
import { primaryAudio } from '../_shared/primaryAudio.ts';

export function createHandler(getClient: () => SupabaseClient) { return async (request: Request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);

  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!/^[a-f0-9]{48}$/.test(token)) return json({ code: 'TAG_NOT_FOUND' }, 404);

  const client = getClient();
  const { data: tag, error } = await client.from('tags')
    .select('id,label,batch,status,created_at,topic_id,inventory_label,batch_date,serial_number,memory_topics(code),recordings(id,nickname,duration_seconds,created_at,location,transcription_consent)')
    .eq('public_token', token).is('deleted_at', null).maybeSingle();
  if (error) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
  if (!tag) return json({ code: 'TAG_NOT_FOUND' }, 404);

  const recording = Array.isArray(tag.recordings) ? tag.recordings[0] ?? null : tag.recordings ?? null;
  const topic = Array.isArray(tag.memory_topics) ? tag.memory_topics[0] ?? null : tag.memory_topics ?? null;
  let transcript: string | null = null;
  let duration = recording?.duration_seconds;
  if (tag.status === 'bound' && recording) {
    try { duration = (await primaryAudio(client, recording.id, '')).duration ?? duration; }
    catch { return json({ code: 'SERVICE_UNAVAILABLE' }, 503); }
  }
  if (tag.status === 'bound' && recording?.transcription_consent) {
    const { data, error: transcriptError } = await client.from('recording_transcriptions').select('text')
      .eq('recording_id', recording.id).eq('status', 'ready').eq('published', true).maybeSingle();
    // Optional text must fail closed without breaking the original audio experience.
    if (!transcriptError) transcript = data?.text ?? null;
  }
  return json({
    id: tag.id,
    label: tag.serial_number ?? tag.label,
    batch: tag.batch_date ?? tag.batch,
    categoryId: tag.topic_id,
    categoryCode: topic?.code ?? null,
    inventoryLabel: tag.inventory_label,
    batchDate: tag.batch_date,
    serialNumber: tag.serial_number,
    status: tag.status,
    createdAt: tag.created_at,
    recording: recording && tag.status === 'bound' ? {
      id: recording.id,
      nickname: recording.nickname,
      durationSeconds: duration,
      createdAt: recording.created_at,
      location: recording.location,
      transcriptionConsent: recording.transcription_consent,
      transcript,
    } : null,
  });
}; }

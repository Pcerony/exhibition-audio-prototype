import { adminClient } from '../_shared/client.ts';
import { json, preflight } from '../_shared/http.ts';

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);

  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!/^[a-f0-9]{48}$/.test(token)) return json({ code: 'TAG_NOT_FOUND' }, 404);

  const client = adminClient();
  const { data: tag, error } = await client.from('tags')
    .select('id,label,batch,status,created_at,recordings(id,nickname,duration_seconds,created_at)')
    .eq('public_token', token).maybeSingle();
  if (error) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
  if (!tag) return json({ code: 'TAG_NOT_FOUND' }, 404);

  const recording = Array.isArray(tag.recordings) ? tag.recordings[0] ?? null : tag.recordings ?? null;
  return json({
    id: tag.id,
    label: tag.label,
    batch: tag.batch,
    status: tag.status,
    createdAt: tag.created_at,
    recording: recording ? {
      id: recording.id,
      nickname: recording.nickname,
      durationSeconds: recording.duration_seconds,
      createdAt: recording.created_at,
    } : null,
  });
});

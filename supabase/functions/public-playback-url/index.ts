import { adminClient } from '../_shared/client.ts';
import { json, preflight, readJson } from '../_shared/http.ts';

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await readJson(request);
  const token = typeof body?.token === 'string' ? body.token : '';
  if (!/^[a-f0-9]{48}$/.test(token)) return json({ code: 'TAG_NOT_FOUND' }, 404);

  const client = adminClient();
  const { data: tag, error } = await client.from('tags')
    .select('status,recordings(object_path)').eq('public_token', token).maybeSingle();
  if (error) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
  if (!tag) return json({ code: 'TAG_NOT_FOUND' }, 404);
  if (tag.status === 'disabled') return json({ code: 'TAG_UNAVAILABLE' }, 410);
  const recording = Array.isArray(tag.recordings) ? tag.recordings[0] : tag.recordings;
  if (!recording) return json({ code: 'RECORDING_NOT_FOUND' }, 404);

  const { data, error: signedError } = await client.storage.from('recordings').createSignedUrl(recording.object_path, 120);
  if (signedError || !data?.signedUrl) return json({ code: 'PLAYBACK_UNAVAILABLE' }, 503);
  return json({ url: data.signedUrl, expiresInSeconds: 120 });
});

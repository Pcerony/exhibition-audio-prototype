import { adminClient } from '../_shared/client.ts';
import { json, preflight, readJson, randomToken, sha256 } from '../_shared/http.ts';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav', 'audio/aac']);

Deno.serve(async (request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await readJson(request);
  const token = typeof body?.token === 'string' ? body.token : '';
  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.split(';')[0].trim().toLowerCase() : '';
  const sizeBytes = Number(body?.sizeBytes);
  if (!/^[a-f0-9]{48}$/.test(token)) return json({ code: 'TAG_NOT_FOUND' }, 404);
  if (!ALLOWED_MIME.has(mimeType) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_AUDIO_BYTES) {
    return json({ code: 'RECORDING_INVALID' }, 400);
  }

  const client = adminClient();
  const { data: tag, error: tagError } = await client.from('tags')
    .select('id,status').eq('public_token', token).maybeSingle();
  if (tagError) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
  if (!tag) return json({ code: 'TAG_NOT_FOUND' }, 404);
  if (tag.status === 'disabled') return json({ code: 'TAG_UNAVAILABLE' }, 410);
  if (tag.status === 'bound') return json({ code: 'ALREADY_BOUND' }, 409);
  const { count, error: limitError } = await client.from('upload_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('tag_id', tag.id)
    .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (limitError) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
  if ((count ?? 0) >= 8) return json({ code: 'RATE_LIMITED' }, 429);

  const uploadId = crypto.randomUUID();
  const objectPath = `${tag.id}/${uploadId}`;
  const claimToken = randomToken();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000 + 60 * 1000).toISOString();
  const { error: insertError } = await client.from('upload_sessions').insert({
    id: uploadId,
    tag_id: tag.id,
    object_path: objectPath,
    claim_token_hash: await sha256(claimToken),
    mime_type: mimeType,
    size_bytes: sizeBytes,
    expires_at: expiresAt,
  });
  if (insertError) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);

  const { data: signed, error: signedError } = await client.storage.from('recordings').createSignedUploadUrl(objectPath);
  if (signedError || !signed) {
    await client.from('upload_sessions').delete().eq('id', uploadId);
    return json({ code: 'UPLOAD_UNAVAILABLE' }, 503);
  }
  return json({ uploadId, path: signed.path, storageToken: signed.token, claimToken, expiresAt }, 201);
});

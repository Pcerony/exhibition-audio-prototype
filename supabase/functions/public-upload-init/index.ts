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
  const uploadId = crypto.randomUUID();
  const claimToken = randomToken();
  const { data: session, error: insertError } = await client.rpc('initialize_upload', {
    p_token: token, p_id: uploadId, p_hash: await sha256(claimToken), p_mime: mimeType, p_size: sizeBytes,
  });
  if (insertError || !session) {
    const code = ['TAG_NOT_FOUND', 'TAG_UNAVAILABLE', 'ALREADY_BOUND', 'RATE_LIMITED'].find((value) => insertError?.message.includes(value));
    return json({ code: code ?? 'SERVICE_UNAVAILABLE' }, code === 'TAG_NOT_FOUND' ? 404 : code === 'TAG_UNAVAILABLE' ? 410 : code === 'ALREADY_BOUND' ? 409 : code === 'RATE_LIMITED' ? 429 : 503);
  }
  const objectPath = session.objectPath;
  const { data: signed, error: signedError } = await client.storage.from('recordings').createSignedUploadUrl(objectPath);
  const { data: expiresAt, error: deadlineError } = await client.rpc('upload_signing_completed', { p_upload_id: uploadId });
  if (signedError || !signed || deadlineError || !expiresAt) {
    // Signing can fail ambiguously; retain its deadline for safe eventual cleanup.
    await client.rpc('invalidate_upload', { p_upload_id: uploadId, p_claim_token: claimToken });
    return json({ code: 'UPLOAD_UNAVAILABLE' }, 503);
  }
  return json({ uploadId, path: signed.path, storageToken: signed.token, claimToken, expiresAt }, 201);
});

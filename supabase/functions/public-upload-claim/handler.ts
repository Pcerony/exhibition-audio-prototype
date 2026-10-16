import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight, readJson, sha256 } from '../_shared/http.ts';
import { parseMemoryLocation } from '../../../src/domain/location.ts';

export function createHandler(getClient: () => SupabaseClient) { return async (request: Request) => {
  const options = preflight(request);
  if (options) return options;
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await readJson(request);
  const categoryCode = body?.categoryCode;
  if (categoryCode === undefined || categoryCode === null || categoryCode === '') return json({ code: 'CATEGORY_REQUIRED' }, 400);
  if (typeof categoryCode !== 'string' || !['A', 'B', 'C', 'D'].includes(categoryCode)) return json({ code: 'CATEGORY_INVALID' }, 400);
  const uploadId = typeof body?.uploadId === 'string' ? body.uploadId : '';
  const nickname = typeof body?.nickname === 'string' ? body.nickname.trim() : '';
  const durationSeconds = Number(body?.durationSeconds);
  const claimToken = request.headers.get('x-upload-token') ?? '';
  let location;
  try { location = parseMemoryLocation(body?.location); }
  catch { return json({ code: 'INVALID_LOCATION' }, 400); }
  if (!/^[0-9a-f-]{36}$/i.test(uploadId) || !claimToken) {
    return json({ code: 'REQUEST_INVALID' }, 400);
  }

  const client = getClient();
  const { data: upload, error: lookupError } = await client.from('upload_sessions')
    .select('object_path,mime_type,size_bytes,expires_at,claimed_at,claim_token_hash,invalidated_at')
    .eq('id', uploadId).maybeSingle();
  if (lookupError) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
  if (!upload || upload.claim_token_hash !== await sha256(claimToken)) return json({ code: 'UPLOAD_TOKEN_INVALID' }, 401);
  if (upload.claimed_at || upload.invalidated_at) return json({ code: 'UPLOAD_SESSION_INVALID' }, 410);
  if (Date.parse(upload.expires_at) <= Date.now()) {
    await client.rpc('invalidate_upload', { p_upload_id: uploadId, p_claim_token: claimToken });
    return json({ code: 'UPLOAD_SESSION_INVALID' }, 410);
  }
  if (!Number.isInteger(durationSeconds) || nickname.length > 24 || durationSeconds < 1 || durationSeconds > 60) {
    await client.rpc('invalidate_upload', { p_upload_id: uploadId, p_claim_token: claimToken });
    return json({ code: 'RECORDING_INVALID' }, 400);
  }

  const { data: info, error: infoError } = await client.storage.from('recordings').info(upload.object_path);
  if (infoError || !info) return json({ code: 'UPLOAD_MISSING' }, 400);
  const actualMime = (info.contentType ?? '').split(';')[0].trim().toLowerCase();
  const actualSize = Number(info.size);
  const { data: claim, error: claimError } = await client.rpc('claim_recording_classified', {
    p_upload_id: uploadId,
    p_claim_token: claimToken,
    p_nickname: nickname,
    p_duration_seconds: durationSeconds,
    p_actual_size_bytes: actualSize,
    p_actual_mime_type: actualMime,
    p_location: location,
    p_category_code: categoryCode,
  }).maybeSingle<{ claim_status: string; recording_id: string; recording_created_at: string }>();
  if (claimError) {
    const code = claimError.message.includes('CATEGORY_REQUIRED') ? 'CATEGORY_REQUIRED'
      : claimError.message.includes('CATEGORY_INVALID') ? 'CATEGORY_INVALID'
      : claimError.message.includes('UPLOAD_SESSION_INVALID') ? 'UPLOAD_SESSION_INVALID'
      : claimError.message.includes('TOKEN_INVALID') ? 'UPLOAD_TOKEN_INVALID'
      : claimError.message.includes('TAG_UNAVAILABLE') ? 'TAG_UNAVAILABLE'
      : claimError.message.includes('RECORDING_INVALID') ? 'RECORDING_INVALID'
      : 'SERVICE_UNAVAILABLE';
    if (code === 'UPLOAD_SESSION_INVALID' || code === 'TAG_UNAVAILABLE' || code === 'RECORDING_INVALID') {
      await client.rpc('invalidate_upload', { p_upload_id: uploadId, p_claim_token: claimToken });
    }
    const status = code === 'SERVICE_UNAVAILABLE' ? 503 : code === 'UPLOAD_TOKEN_INVALID' ? 401
      : code === 'UPLOAD_SESSION_INVALID' || code === 'TAG_UNAVAILABLE' ? 410
      : 400;
    return json({ code }, status);
  }
  if (claim?.claim_status === 'already-bound') {
    return json({ code: 'ALREADY_BOUND', status: 'already-bound' }, 409);
  }
  if (claim?.claim_status !== 'claimed') return json({ code: 'CLAIM_FAILED' }, 500);
  return json({ status: 'claimed', recordingId: claim.recording_id, createdAt: claim.recording_created_at });
}; }

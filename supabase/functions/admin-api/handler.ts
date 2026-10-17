import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight, readJson } from '../_shared/http.ts';
import { runMaintenance } from '../_shared/maintenance.ts';
import { parseMemoryLocation } from '../../../src/domain/location.ts';

const actions = new Set(['session', 'list', 'createBatch', 'reset', 'setEnabled', 'playback', 'jobs', 'provision', 'audit', 'maintenance', 'categories', 'createCategory', 'renameCategory', 'createCards', 'bulkPreview', 'bulkApply', 'leaseJob', 'nextJob', 'releaseJob', 'getTranscription', 'retryTranscription', 'saveTranscription']);
actions.add('prepareWrite');
actions.add('setPieceAssignment');
const transcriptionStates = new Set(['not_consented', 'pending', 'processing', 'draft', 'published', 'failed']);
const mapPieceCode = /^(?:[ABDEFGH][1-9]|C(?:[1-9]|10))$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors: Record<string, number> = {
  REQUEST_INVALID: 400, OPERATOR_REQUIRED: 403, TAG_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404, RECORDING_NOT_FOUND: 404, REQUEST_KEY_CONFLICT: 409, JOB_CONFLICT: 409, TAG_LABEL_EXISTS: 409,
  CATEGORY_NOT_FOUND: 404, CATEGORY_NAME_EXISTS: 409, CATEGORIES_FIXED: 409, CATEGORY_UNASSIGNED: 409, VERSION_CONFLICT: 409, GROUP_CONFLICT: 409,
  LEASE_CONFLICT: 409, LEASE_EXPIRED: 409, CLIENT_UPGRADE_REQUIRED: 426, JOB_INELIGIBLE: 409,
  TRANSCRIPTION_CONSENT_REQUIRED: 409, TRANSCRIPTION_NOT_FOUND: 404, TRANSCRIPTION_RATE_LIMITED: 429,
  MAP_ASSIGNMENT_INVALID: 400,
};

export function createHandler(getClient: () => SupabaseClient, isTranscriptionConfigured = () => !!Deno.env.get('GROQ_API_KEY')) {
  return async (request: Request): Promise<Response> => {
    const options = preflight(request);
    if (options) return options;
    if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
    const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer) return json({ code: 'AUTH_REQUIRED' }, 401);
    try {
      const client = getClient();
      // getUser verifies the access token with Auth; never trust locally decoded claims.
      const { data: identity, error: authError } = await client.auth.getUser(bearer);
      if (authError || !identity.user) return json({ code: 'AUTH_REQUIRED' }, 401);
      const { data: profile, error: profileError } = await client.from('operator_profiles')
        .select('role').eq('user_id', identity.user.id).maybeSingle();
      if (profileError) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
      if (!profile || !['operator', 'admin'].includes(profile.role)) return json({ code: 'OPERATOR_REQUIRED' }, 403);
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || !actions.has(body.action)) return json({ code: 'REQUEST_INVALID' }, 400);
      if (body.action === 'list' && body.transcriptionState !== undefined
        && (typeof body.transcriptionState !== 'string' || !transcriptionStates.has(body.transcriptionState))) return json({ code: 'REQUEST_INVALID' }, 400);
      if (body.action === 'list' && body.pieceCode !== undefined && body.pieceCode !== ''
        && (typeof body.pieceCode !== 'string' || !mapPieceCode.test(body.pieceCode))) return json({ code: 'REQUEST_INVALID' }, 400);
      for (const field of ['tagId', 'recordingId', 'jobId', 'requestKey', 'categoryId', 'targetCategoryId']) {
        if (field in body && (typeof body[field] !== 'string' || !uuid.test(body[field]))) return json({ code: 'REQUEST_INVALID' }, 400);
      }
      if (body.action === 'prepareWrite' && (
        typeof body.deviceId !== 'string' || !body.deviceId.trim() || body.deviceId.length > 120
        || typeof body.requestKey !== 'string' || !uuid.test(body.requestKey)
      )) return json({ code: 'REQUEST_INVALID' }, 400);
      if (body.action === 'prepareWrite' && body.protocolVersion !== 3) return json({ code: 'CLIENT_UPGRADE_REQUIRED' }, 426);
      if (body.action === 'saveTranscription' && (
        typeof body.text !== 'string' || Array.from(body.text).length > 10000 || typeof body.published !== 'boolean'
        || !Number.isSafeInteger(body.version) || body.version < 1 || (body.published && !body.text.trim())
      )) return json({ code: 'REQUEST_INVALID' }, 400);
      if (body.action === 'setPieceAssignment') {
        const validState = ['assigned', 'needs_review', 'outside_map'].includes(body.state as string);
        const validPiece = body.pieceCode === null || (typeof body.pieceCode === 'string' && mapPieceCode.test(body.pieceCode));
        const pieceMatchesState = body.state === 'assigned' ? typeof body.pieceCode === 'string' && mapPieceCode.test(body.pieceCode)
          : body.pieceCode === null;
        if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1
          || !validState || !validPiece || !pieceMatchesState || body.mapVersion !== 'fukuoka-road-73-v13') return json({ code: 'REQUEST_INVALID' }, 400);
      }
      if (body.action === 'maintenance') return json(await runMaintenance(client));
      if (body.action === 'retryTranscription' && !isTranscriptionConfigured()) return json({ code: 'TRANSCRIPTION_NOT_CONFIGURED' }, 503);
      const { data, error } = body.action === 'setPieceAssignment'
        ? await client.rpc('set_manual_piece_assignment', {
          p_operator: identity.user.id, p_recording_id: body.recordingId, p_expected_version: body.expectedVersion,
          p_state: body.state, p_piece_code: body.pieceCode, p_map_version: body.mapVersion,
        })
        : await client.rpc(body.action === 'list' ? 'admin_list' : 'admin_action', { p_operator: identity.user.id, p_body: body });
      if (error) {
        const code = Object.keys(errors).find((value) => error.message.includes(value))
          ?? (['22P02', '22003', '22007', '22008', '22023', '23502'].includes(error.code) ? 'REQUEST_INVALID' : 'SERVICE_UNAVAILABLE');
        return json({ code }, errors[code] ?? 503);
      }
      if (body.action === 'getTranscription') return json({ ...data, configured: isTranscriptionConfigured() });
      if (['leaseJob', 'nextJob', 'prepareWrite'].includes(body.action) && data?.job) {
        const expiresAt = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : NaN;
        if (!Number.isFinite(expiresAt)) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
        // Older Android Instant.parse requires Z, not PostgreSQL's +00:00 offset.
        return json({ ...data, expiresAt: new Date(expiresAt).toISOString() });
      }
      if (body.action === 'playback') {
        const { data: signed, error: signError } = await client.storage.from('recordings').createSignedUrl(data.objectPath, 120);
        if (signError || !signed) return json({ code: 'PLAYBACK_UNAVAILABLE' }, 503);
        return json({ url: signed.signedUrl, expiresInSeconds: 120 });
      }
      if (body.action === 'list' && Array.isArray(data?.tags)) {
        const ids = data.tags.flatMap((tag: { recording?: { id: string } | null }) => tag.recording ? [tag.recording.id] : []);
        if (ids.length) {
          const [recordingsResult, transcriptionResult, assignmentResult] = await Promise.all([
            client.from('recordings').select('id,location,transcription_consent').in('id', ids),
            client.from('recording_transcriptions').select('recording_id,status,published').in('recording_id', ids),
            client.from('recording_piece_assignments').select('recording_id,assignment_state,piece_code,assignment_source,map_version,version,updated_at').in('recording_id', ids),
          ]);
          if (recordingsResult.error || transcriptionResult.error || assignmentResult.error) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
          const byRecordingId = new Map((recordingsResult.data ?? []).map((recording) => [recording.id, recording]));
          const byTranscriptionId = new Map((transcriptionResult.data ?? []).map((transcription) => [transcription.recording_id, transcription]));
          const byAssignmentId = new Map((assignmentResult.data ?? []).map((assignment) => [assignment.recording_id, assignment]));
          for (const tag of data.tags) if (tag.recording) {
            const recording = byRecordingId.get(tag.recording.id);
            const consented = recording?.transcription_consent === true;
            const transcription = consented ? byTranscriptionId.get(tag.recording.id) : null;
            try { tag.recording.location = parseMemoryLocation(recording?.location); }
            catch { tag.recording.location = null; }
            tag.recording.transcriptionSummary = {
              consented,
              status: transcription?.status ?? null,
              published: transcription?.published === true,
            };
            const assignment = byAssignmentId.get(tag.recording.id);
            if (assignment) tag.recording.pieceAssignment = {
              state: assignment.assignment_state, pieceCode: assignment.piece_code, source: assignment.assignment_source,
              mapVersion: assignment.map_version, version: assignment.version, updatedAt: assignment.updated_at,
            };
          }
        }
      }
      return json(data);
    } catch {
      return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
    }
  };
}

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { primaryAudio } from '../_shared/primaryAudio.ts';
import { json, preflight, readJson } from '../_shared/http.ts';
import { isTranscriptionLanguage } from '../_shared/transcriptionLanguage.ts';

const allowed = new Set([
  'session',
  'list',
  'history',
  'save',
  'playback',
  'activity',
  'retryTranscription',
  'createQrEntry',
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors: Record<string, number> = {
  STAFF_REQUIRED: 403,
  MEMBER_REQUIRED: 400,
  REQUEST_INVALID: 400,
  TAG_NOT_FOUND: 404,
  RECORDING_NOT_FOUND: 404,
  TRANSCRIPTION_NOT_FOUND: 404,
  TRANSCRIPTION_CONSENT_REQUIRED: 409,
  VERSION_CONFLICT: 409,
  TRANSCRIPTION_RATE_LIMITED: 429,
  TRANSCRIPTION_IN_PROGRESS: 409,
  REQUEST_KEY_CONFLICT: 409,
};

export function createHandler(getClient: () => SupabaseClient, isTranscriptionConfigured = () => !!Deno.env.get('GROQ_API_KEY')) {
  return async (request: Request): Promise<Response> => {
    const options = preflight(request);
    if (options) return options;
    if (request.method !== 'POST')
      return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
    const bearer = request.headers
      .get('authorization')
      ?.match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer) return json({ code: 'AUTH_REQUIRED' }, 401);
    try {
      const client = getClient();
      const { data: identity, error: authError } =
        await client.auth.getUser(bearer);
      if (authError || !identity.user)
        return json({ code: 'AUTH_REQUIRED' }, 401);
      const { data: profile, error: profileError } = await client
        .from('operator_profiles')
        .select('role')
        .eq('user_id', identity.user.id)
        .maybeSingle();
      if (profileError) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
      if (!profile || !['staff', 'operator', 'admin'].includes(profile.role))
        return json({ code: 'STAFF_REQUIRED' }, 403);
      const input = await readJson(request);
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        !allowed.has(input.action)
      )
        return json({ code: 'REQUEST_INVALID' }, 400);
      // Copy only contract fields; caller-supplied account/name/time never reach audit.
      const body: Record<string, unknown> = { action: input.action };
      for (const key of [
        'search',
        'reviewState',
        'categoryCode',
        'batchDate',
        'offset',
        'limit',
        'tagId',
        'recordingId',
        'memberId',
        'version',
        'text',
        'published',
        'event',
        'languageHint',
        'requestKey',
      ]) {
        if (key in input) body[key] = input[key];
      }
      if (
        input.action === 'createQrEntry' &&
        (typeof body.requestKey !== 'string' || !uuid.test(body.requestKey))
      )
        return json({ code: 'REQUEST_INVALID' }, 400);
      if (['save', 'playback', 'activity', 'retryTranscription'].includes(input.action)) {
        if (
          typeof body.recordingId !== 'string' ||
          !uuid.test(body.recordingId) ||
          typeof body.memberId !== 'string' ||
          !/^[a-z0-9-]{1,80}$/.test(body.memberId)
        )
          return json({ code: 'REQUEST_INVALID' }, 400);
      }
      if (
        (input.action === 'history' || body.tagId !== undefined) &&
        (typeof body.tagId !== 'string' || !uuid.test(body.tagId))
      )
        return json({ code: 'REQUEST_INVALID' }, 400);
      if (
        input.action === 'list' &&
        ((body.search !== undefined &&
          (typeof body.search !== 'string' || body.search.length > 120)) ||
          (body.reviewState !== undefined &&
            !['all', 'unreviewed', 'approved', 'empty'].includes(
              body.reviewState as string,
            )) ||
          (body.categoryCode !== undefined &&
            !['A', 'B', 'C', 'D'].includes(body.categoryCode as string)) ||
          (body.batchDate !== undefined &&
            (typeof body.batchDate !== 'string' ||
              !/^\d{4}-\d{2}-\d{2}$/.test(body.batchDate))) ||
          (body.offset !== undefined &&
            (!Number.isSafeInteger(body.offset) ||
              (body.offset as number) < 0)) ||
          (body.limit !== undefined &&
            (!Number.isSafeInteger(body.limit) ||
              (body.limit as number) < 1 ||
              (body.limit as number) > 50)))
      )
        return json({ code: 'REQUEST_INVALID' }, 400);
      if (
        input.action === 'save' &&
        (!Number.isSafeInteger(body.version) ||
          (body.version as number) < 1 ||
          typeof body.text !== 'string' ||
          Array.from(body.text).length > 10000 ||
          typeof body.published !== 'boolean' ||
          (body.published && !body.text.trim()))
      )
        return json({ code: 'REQUEST_INVALID' }, 400);
      if (input.action === 'activity' && body.event !== 'location_viewed')
        return json({ code: 'REQUEST_INVALID' }, 400);
      if (input.action === 'retryTranscription') {
        if (!Number.isSafeInteger(body.version) || (body.version as number) < 1 || !isTranscriptionLanguage(body.languageHint))
          return json({ code: 'REQUEST_INVALID' }, 400);
        if (!isTranscriptionConfigured()) return json({ code: 'TRANSCRIPTION_NOT_CONFIGURED' }, 503);
        delete body.text;
        delete body.published;
      }
      const { data, error } = await client.rpc('staff_action', {
        p_operator: identity.user.id,
        p_body: body,
      });
      if (error) {
        const code =
          Object.keys(errors).find((code) => error.message.includes(code)) ??
          (['22P02', '22003', '22007', '22008', '22023'].includes(error.code)
            ? 'REQUEST_INVALID'
            : 'SERVICE_UNAVAILABLE');
        return json({ code }, errors[code] ?? 503);
      }
      if (input.action === 'playback') {
        if (typeof data?.objectPath !== 'string')
          return json({ code: 'PLAYBACK_UNAVAILABLE' }, 503);
        const audio = await primaryAudio(client, input.recordingId, data.objectPath);
        const { data: signed, error: signError } = await client.storage
          .from('recordings')
          .createSignedUrl(audio.path, 120);
        if (signError || !signed)
          return json({ code: 'PLAYBACK_UNAVAILABLE' }, 503);
        return json({ url: signed.signedUrl, expiresInSeconds: 120 });
      }
      return json(data);
    } catch {
      return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
    }
  };
}

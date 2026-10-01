import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight, readJson } from '../_shared/http.ts';
import { runMaintenance } from '../_shared/maintenance.ts';

const actions = new Set(['session', 'list', 'createBatch', 'reset', 'setEnabled', 'playback', 'jobs', 'provision', 'audit', 'maintenance']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errors: Record<string, number> = {
  REQUEST_INVALID: 400, OPERATOR_REQUIRED: 403, TAG_NOT_FOUND: 404,
  JOB_NOT_FOUND: 404, RECORDING_NOT_FOUND: 404, REQUEST_KEY_CONFLICT: 409, JOB_CONFLICT: 409, TAG_LABEL_EXISTS: 409,
};

export function createHandler(getClient: () => SupabaseClient) {
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
      for (const field of ['tagId', 'recordingId', 'jobId', 'requestKey']) {
        if (field in body && (typeof body[field] !== 'string' || !uuid.test(body[field]))) return json({ code: 'REQUEST_INVALID' }, 400);
      }
      if (body.action === 'maintenance') return json(await runMaintenance(client));
      const { data, error } = await client.rpc('admin_action', { p_operator: identity.user.id, p_body: body });
      if (error) {
        const code = Object.keys(errors).find((value) => error.message.includes(value))
          ?? (['22P02', '22003', '22023', '23502'].includes(error.code) ? 'REQUEST_INVALID' : 'SERVICE_UNAVAILABLE');
        return json({ code }, errors[code] ?? 503);
      }
      if (body.action === 'playback') {
        const { data: signed, error: signError } = await client.storage.from('recordings').createSignedUrl(data.objectPath, 120);
        if (signError || !signed) return json({ code: 'PLAYBACK_UNAVAILABLE' }, 503);
        return json({ url: signed.signedUrl, expiresInSeconds: 120 });
      }
      return json(data);
    } catch {
      return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
    }
  };
}

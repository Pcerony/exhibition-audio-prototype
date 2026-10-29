import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight, readJson } from '../_shared/http.ts';
import { validateWav } from './wav.ts';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (value: any) => Array.isArray(value) ? value[0] : value;
const check = (error: any) => { if (error) throw Error(error.message ?? 'SERVICE_UNAVAILABLE'); };

export function createHandler(getClient: () => SupabaseClient) {
  return async (request: Request): Promise<Response> => {
    const options = preflight(request); if (options) return options;
    if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
    try {
      const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) return json({ code: 'AUTH_REQUIRED' }, 401);
      const client = getClient();
      const { data: identity, error: authError } = await client.auth.getUser(token);
      if (authError || !identity.user) return json({ code: 'AUTH_REQUIRED' }, 401);
      const { data: profile, error: roleError } = await client.from('operator_profiles').select('role').eq('user_id', identity.user.id).maybeSingle();
      check(roleError); if (profile?.role !== 'admin') return json({ code: 'ADMIN_REQUIRED' }, 403);
      const multipart = request.headers.get('content-type')?.startsWith('multipart/form-data');
      if (Number(request.headers.get('content-length')) > 9700000) return json({ code: 'AUDIO_INVALID' }, 400);
      const form = multipart ? await request.formData() : null;
      const body = form ? Object.fromEntries(form.entries()) : await readJson(request);
      if (!body || !['list', 'detail', 'measure', 'save', 'restore'].includes(body.action)) return json({ code: 'REQUEST_INVALID' }, 400);
      if (body.action === 'list') {
        const offset = Number(body.offset ?? 0), limit = Math.min(100, Number(body.limit ?? 100));
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) return json({ code: 'REQUEST_INVALID' }, 400);
        const { data, error, count } = await client.from('recordings').select('id,duration_seconds,size_bytes,mime_type,created_at,tags!inner(label,serial_number,inventory_label,deleted_at),recording_audio_state(revision,active_version_id,measured_duration,mean_db,measured_at)', { count: 'exact' }).is('tags.deleted_at', null).order('created_at').order('id').range(offset, offset + limit - 1);
        check(error);
        return json({ items: (data ?? []).map(r => ({ id: r.id, label: one(r.tags)?.serial_number ?? one(r.tags)?.label, createdAt: r.created_at, reportedDuration: r.duration_seconds, sizeBytes: r.size_bytes, mimeType: r.mime_type, revision: one(r.recording_audio_state)?.revision ?? 0, activeVersionId: one(r.recording_audio_state)?.active_version_id ?? null, measuredDuration: one(r.recording_audio_state)?.measured_duration ?? null, meanDb: one(r.recording_audio_state)?.mean_db ?? null })), total: count });
      }
      if (!uuid.test(body.recordingId ?? '')) return json({ code: 'REQUEST_INVALID' }, 400);
      const { data: recording, error: recordingError } = await client.from('recordings').select('id,object_path,tags!inner(deleted_at)').eq('id', body.recordingId).is('tags.deleted_at', null).maybeSingle();
      check(recordingError); if (!recording) return json({ code: 'RECORDING_NOT_FOUND' }, 404);
      if (body.action === 'detail') {
        const { data: state, error: stateError } = await client.from('recording_audio_state').select('*').eq('recording_id', body.recordingId).maybeSingle(); check(stateError);
        const { data: versions, error: versionsError } = await client.from('recording_audio_versions').select('id,duration,start_seconds,end_seconds,created_at,object_path').eq('recording_id', body.recordingId).order('created_at', { ascending: false }); check(versionsError);
        const playable = await Promise.all((versions ?? []).map(async ({ object_path, ...version }) => { const { data, error } = await client.storage.from('recordings').createSignedUrl(object_path, 120); check(error); return { ...version, url: data!.signedUrl }; }));
        const { data: signed, error } = await client.storage.from('recordings').createSignedUrl(recording.object_path, 120); check(error);
        return json({ originalUrl: signed!.signedUrl, revision: state?.revision ?? 0, activeVersionId: state?.active_version_id ?? null, versions: playable });
      }
      if (body.action === 'measure') {
        if (!Number.isFinite(body.duration) || body.duration <= 0 || body.duration > 10800 || !Number.isFinite(body.meanDb) || body.meanDb < -200 || body.meanDb > 10) return json({ code: 'REQUEST_INVALID' }, 400);
        check((await client.from('recording_audio_state').upsert({ recording_id: body.recordingId }, { onConflict: 'recording_id', ignoreDuplicates: true })).error);
        check((await client.from('recording_audio_state').update({ measured_duration: body.duration, mean_db: body.meanDb, measured_at: new Date().toISOString() }).eq('recording_id', body.recordingId)).error);
        return json({ ok: true });
      }
      const revision = Number(body.revision);
      if (!Number.isSafeInteger(revision) || revision < 0) return json({ code: 'REQUEST_INVALID' }, 400);
      if (body.action === 'restore') {
        const { data, error } = await client.rpc('audio_primary_change', { p_operator: identity.user.id, p_recording: body.recordingId, p_revision: revision, p_restore: true }); check(error); return json(data);
      }
      if (!form || !uuid.test(body.requestKey ?? '') || !(body.audio instanceof File)) return json({ code: 'REQUEST_INVALID' }, 400);
      const start = Number(body.start), end = Number(body.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 300.1 || body.audio.size > 9600044) return json({ code: 'AUDIO_INVALID' }, 400);
      const bytes = new Uint8Array(await body.audio.arrayBuffer()), duration = validateWav(bytes);
      if (Math.abs(duration - (end - start)) > .35) return json({ code: 'AUDIO_INVALID' }, 400);
      const { data: existing, error: existingError } = await client.from('recording_audio_versions').select('id,operator_id,recording_id,start_seconds,end_seconds,size_bytes').eq('request_key', body.requestKey).maybeSingle();check(existingError);
      if (existing) {
        if (existing.operator_id !== identity.user.id || existing.recording_id !== body.recordingId || existing.start_seconds !== start || existing.end_seconds !== end || existing.size_bytes !== bytes.length) return json({ code: 'REQUEST_KEY_CONFLICT' }, 409);
        return json({ versionId: existing.id, replayed: true });
      }
      const id = crypto.randomUUID(), objectPath = `edits/${body.recordingId}/${id}.wav`;
      // Queue before uploading: a crashed/failed request remains reclaimable after its deadline.
      check((await client.from('storage_cleanup_queue').insert({ object_path: objectPath, not_before: new Date(Date.now() + 86400000).toISOString() })).error);
      const { error: uploadError } = await client.storage.from('recordings').upload(objectPath, bytes, { contentType: 'audio/wav', upsert: false }); check(uploadError);
      const { data, error } = await client.rpc('audio_commit_version', { p_operator: identity.user.id, p_recording: body.recordingId, p_revision: revision, p_version: id, p_request: body.requestKey, p_path: objectPath, p_duration: duration, p_start: start, p_end: end, p_size: bytes.length });
      check(error); return json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = ['AUDIO_VERSION_CONFLICT', 'REQUEST_KEY_CONFLICT', 'RECORDING_NOT_FOUND', 'ADMIN_REQUIRED', 'AUDIO_INVALID'].find(c => message.includes(c)) ?? 'SERVICE_UNAVAILABLE';
      return json({ code }, code.endsWith('CONFLICT') ? 409 : code === 'RECORDING_NOT_FOUND' ? 404 : code === 'ADMIN_REQUIRED' ? 403 : code === 'AUDIO_INVALID' ? 400 : 503);
    }
  };
}

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json, preflight } from '../_shared/http.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createHandler(getClient: () => SupabaseClient) {
  return async (request: Request) => {
    const options = preflight(request);
    if (options) return options;
    if (request.method !== 'GET') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
    const params = new URL(request.url).searchParams;
    const cursor = params.get('cursor');
    const limit = Number(params.get('limit') ?? 100);
    if ((cursor && !uuid.test(cursor)) || !Number.isInteger(limit) || limit < 1 || limit > 100) return json({ code: 'REQUEST_INVALID' }, 400);
    try {
      const client = getClient();
      let query = client.from('tags')
        .select('id,public_token,label,serial_number,status,memory_topics(code),recordings!inner(id,duration_seconds,created_at,location)')
        .eq('status', 'bound').is('deleted_at', null).order('id').limit(limit + 1);
      if (cursor) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error || !data) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
      const page = data.slice(0, limit);
      const recordingIds = page.flatMap(tag => {
        const recording = Array.isArray(tag.recordings) ? tag.recordings[0] : tag.recordings;
        return recording ? [recording.id] : [];
      });
      const durations = new Map<string, number>();
      if (recordingIds.length) {
        const { data: states, error: stateError } = await client.from('recording_audio_state')
          .select('recording_id,active_version_id').in('recording_id', recordingIds);
        if (stateError || !states) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
        const active = states.filter(state => state.active_version_id);
        if (active.length) {
          const { data: versions, error: versionError } = await client.from('recording_audio_versions')
            .select('id,recording_id,duration').in('id', active.map(state => state.active_version_id));
          if (versionError || !versions) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
          for (const state of active) {
            const version = versions.find(value => value.id === state.active_version_id && value.recording_id === state.recording_id);
            if (!version) return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
            durations.set(state.recording_id, version.duration);
          }
        }
      }
      const items = page.flatMap(tag => {
        const recording = Array.isArray(tag.recordings) ? tag.recordings[0] : tag.recordings;
        const topic = Array.isArray(tag.memory_topics) ? tag.memory_topics[0] : tag.memory_topics;
        if (!recording || tag.status !== 'bound') return [];
        return [{ id: recording.id, token: tag.public_token, label: tag.serial_number ?? tag.label,
          categoryCode: topic?.code ?? null, durationSeconds: durations.get(recording.id) ?? recording.duration_seconds,
          createdAt: recording.created_at, location: recording.location ?? null }];
      });
      return json({ items, nextCursor: data.length > limit ? page.at(-1)!.id : null });
    } catch {
      return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
    }
  };
}

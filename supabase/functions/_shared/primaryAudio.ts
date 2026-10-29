import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function primaryAudio(client: SupabaseClient, recordingId: string, originalPath: string) {
  const { data: state, error } = await client.from('recording_audio_state').select('active_version_id').eq('recording_id', recordingId).maybeSingle();
  if (error) throw Error('PLAYBACK_UNAVAILABLE');
  if (!state?.active_version_id) return { path: originalPath, duration: null };
  const { data: version, error: versionError } = await client.from('recording_audio_versions').select('object_path,duration').eq('id', state.active_version_id).eq('recording_id', recordingId).maybeSingle();
  if (versionError || !version) throw Error('PLAYBACK_UNAVAILABLE');
  return { path: version.object_path, duration: version.duration };
}

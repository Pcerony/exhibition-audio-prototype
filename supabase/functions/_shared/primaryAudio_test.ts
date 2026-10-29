import { primaryAudio } from './primaryAudio.ts';
Deno.test('primary audio preserves original fallback and scopes selected versions to recording', async () => {
  const filters: string[] = [];
  const client = (active: string | null) => ({ from: (table: string) => { const q = { select: () => q, eq: (key: string, value: string) => { filters.push(key + ':' + value); return q; }, maybeSingle: async () => ({ data: table === 'recording_audio_state' ? { active_version_id: active } : { object_path: 'clip', duration: 3 }, error: null }) }; return q; } });
  if ((await primaryAudio(client(null) as never, 'r', 'original')).path !== 'original') throw Error('fallback');
  if ((await primaryAudio(client('v') as never, 'r', 'original')).path !== 'clip') throw Error('selection');
  if (!filters.includes('recording_id:r')) throw Error('unscoped');
});

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export async function runMaintenance(client: SupabaseClient): Promise<{ removed: number; pending: number }> {
  const { data: candidates, error } = await client.rpc('cleanup_candidates');
  if (error) throw new Error('MAINTENANCE_UNAVAILABLE');
  let removed = 0;
  for (const candidate of candidates ?? []) {
    // Candidates are permanently invalidated and all signed upload tokens expired.
    // A duplicate worker can delete the same immutable path safely.
    const { error: deleteError } = await client.storage.from('recordings').remove([candidate.object_path]);
    if (deleteError) continue;
    const { error: acknowledgeError } = await client.from('storage_cleanup_queue').delete().eq('object_path', candidate.object_path);
    if (!acknowledgeError) removed++;
  }
  const { count, error: countError } = await client.from('storage_cleanup_queue').select('object_path', { count: 'exact', head: true });
  if (countError) throw new Error('MAINTENANCE_UNAVAILABLE');
  return { removed, pending: count ?? 0 };
}

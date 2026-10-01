import { createClient } from 'npm:@supabase/supabase-js@2';
import { publicSupabase } from './http.ts';

export function adminClient() {
  const { url, key } = publicSupabase();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

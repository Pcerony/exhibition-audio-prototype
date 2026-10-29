import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
Deno.test('audio versions preserve identity, serialize edits, revoke transcripts, restore and clean up', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;
      create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create function extensions.gen_random_bytes(n integer) returns bytea language sql as 'select decode(left(string_agg(md5(random()::text),''''),n*2),''hex'') from generate_series(1,(n+15)/16)';
      create function extensions.digest(v bytea,algorithm text) returns bytea language sql immutable as 'select decode(md5(v)||md5(v),''hex'')';
      create function extensions.digest(v text,algorithm text) returns bytea language sql immutable as 'select extensions.digest(convert_to(v,''UTF8''),algorithm)';`);
    for (const file of [...Deno.readDirSync('supabase/migrations')].map(r => r.name).sort().filter(r => r.endsWith('.sql'))) await db.exec((await Deno.readTextFile('supabase/migrations/' + file)).replace('create extension if not exists pgcrypto with schema extensions;', ''));
    const admin = crypto.randomUUID(), operator = crypto.randomUUID(), tag = crypto.randomUUID(), upload = crypto.randomUUID();
    await db.query('insert into auth.users(id) values($1),($2)', [admin, operator]);
    await db.query("insert into public.operator_profiles(user_id,role) values($1,'admin'),($2,'operator')", [admin, operator]);
    await db.query("insert into public.tags(id,label,inventory_label,public_token) values($1,'AUDIO-TEST','AUDIO-TEST',repeat('8',48))", [tag]);
    await db.query("select public.initialize_upload(repeat('8',48),$1,encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10)", [upload]);
    await db.query("select * from public.claim_recording_classified($1,'test','',1,10,'audio/wav',null,'A')", [upload]);
    const r = (await db.query<{ id: string; object_path: string }>('select id,object_path from public.recordings where tag_id=$1', [tag])).rows[0];
    await db.query('update public.recordings set transcription_consent=true where id=$1', [r.id]);
    await db.query("insert into public.recording_transcriptions(recording_id,status,text,published,version) values($1,'ready','Synthetic text',true,1)", [r.id]);
    const commit = (who: string, revision: number, version: string, request = crypto.randomUUID()) => db.query('select public.audio_commit_version($1,$2,$3,$4,$5,$6,2,0,2,64044) result', [who, r.id, revision, version, request, `edits/${r.id}/${version}.wav`]);
    let rejected = false; try { await commit(operator, 0, crypto.randomUUID()); } catch { rejected = true; } assert(rejected, 'operator saved audio');
    const staleLease = crypto.randomUUID();
    await db.query("update public.recording_transcriptions set published=false,status='processing',lease_token=$2,lease_expires_at=now()+interval '1 minute' where recording_id=$1", [r.id, staleLease]);
    const v1 = crypto.randomUUID(), key = crypto.randomUUID(); await commit(admin, 0, v1, key); await commit(admin, 0, v1, key);
    const state = (await db.query<{ revision: number; active_version_id: string }>('select * from public.recording_audio_state where recording_id=$1', [r.id])).rows[0];
    assert(state.revision === 1 && state.active_version_id === v1, 'idempotent save changed revision');
    const transcript = (await db.query<{ published: boolean; text: string; version: number }>('select * from public.recording_transcriptions where recording_id=$1', [r.id])).rows[0];
    assert(!transcript.published && transcript.text === 'Synthetic text' && transcript.version === 2, 'transcript not safely revoked');
    const stale = await db.query<{ accepted: boolean }>("select public.finish_transcription($1,$2,1,'stale text',null,0) accepted", [r.id, staleLease]);
    assert(!stale.rows[0].accepted, 'stale worker overwrote draft after audio change');
    const results = await Promise.allSettled([commit(admin, 1, crypto.randomUUID()), commit(admin, 1, crypto.randomUUID())]);
    assert(results.filter(r => r.status === 'fulfilled').length === 1, 'concurrent edits both won');
    assert((await db.query('select * from public.recording_audio_versions')).rows.length === 2, 'conflict left committed version');
    await db.query("update public.recording_transcriptions set status='pending',next_attempt_at=now(),attempts=0 where recording_id=$1", [r.id]);
    const task = (await db.query<{ task: { objectPath: string; mimeType: string } }>('select public.claim_transcription() task')).rows[0].task;
    assert(task.objectPath.startsWith(`edits/${r.id}/`) && task.mimeType === 'audio/wav', 'new transcription does not use primary audio');
    await db.query('select public.audio_primary_change($1,$2,2,null,true)', [admin, r.id]);
    assert((await db.query<{ active_version_id: string | null }>('select active_version_id from public.recording_audio_state')).rows[0].active_version_id === null, 'restore failed');
    assert((await db.query<{ object_path: string }>('select object_path from public.recordings where id=$1', [r.id])).rows[0].object_path === r.object_path, 'original overwritten');
    const grants = (await db.query<{ allowed: boolean; rls: boolean }>("select has_table_privilege('anon','public.recording_audio_versions','SELECT') allowed,(select relrowsecurity from pg_class where oid='public.recording_audio_versions'::regclass) rls")).rows[0]; assert(!grants.allowed && grants.rls, 'unsafe grants');
    await db.query("insert into public.storage_cleanup_queue(object_path,not_before) select object_path,now()-interval '1 second' from public.recording_audio_versions");
    assert((await db.query("select * from public.cleanup_candidates() where object_path like 'edits/%'")).rows.length === 0, 'cleanup deletes retained version');
    await db.query('delete from public.recordings where id=$1', [r.id]);
    assert((await db.query('select * from public.recording_audio_versions')).rows.length === 0, 'versions did not cascade');
    assert((await db.query("select * from public.storage_cleanup_queue where object_path like 'edits/%'")).rows.length === 2, 'deleted versions not queued');
  } finally { await db.close(); }
});

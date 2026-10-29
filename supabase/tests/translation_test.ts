import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

Deno.test('public translation cache is private, versioned, invalidated, and cascades with recordings', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;
      create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create function extensions.gen_random_bytes(n integer) returns bytea language sql as 'select decode(left(string_agg(md5(random()::text),''''),n*2),''hex'') from generate_series(1,(n+15)/16)';
      create function extensions.digest(v bytea,algorithm text) returns bytea language sql immutable as 'select decode(md5(v)||md5(v),''hex'')';
      create function extensions.digest(v text,algorithm text) returns bytea language sql immutable as 'select extensions.digest(convert_to(v,''UTF8''),algorithm)';`);
    for (const entry of [...Deno.readDirSync('supabase/migrations')].map((item) => item.name).sort()) {
      if (!entry.endsWith('.sql')) continue;
      await db.exec((await Deno.readTextFile(`supabase/migrations/${entry}`))
        .replace('create extension if not exists pgcrypto with schema extensions;', ''));
    }

    const tagId = '20000000-0000-4000-8000-000000000099';
    const uploadId = '30000000-0000-4000-8000-000000000099';
    await db.query('insert into public.tags(id,label,inventory_label,public_token) values($1,$2,$2,$3)', [tagId, 'TRANSLATION-TEST', '9'.repeat(48)]);
    await db.query("select public.initialize_upload($1,$2,encode(extensions.digest('test','sha256'),'hex'),$3,$4)", [
      '9'.repeat(48), uploadId, 'audio/wav', 10,
    ]);
    await db.query("select * from public.claim_recording_classified($1,'test','',1,10,'audio/wav',null,'A')", [uploadId]);
    const recording = await db.query<{ id: string }>('select id from public.recordings where tag_id=$1', [tagId]);
    const recordingId = recording.rows[0].id;
    await db.query('update public.recordings set transcription_consent=true where id=$1', [recordingId]);
    await db.query("insert into public.recording_transcriptions(recording_id,status,text,published,version) values($1,'ready','福岡の思い出',true,1)", [recordingId]);

    const firstLeaseToken = '40000000-0000-4000-8000-000000000001';
    const competingLeaseToken = '40000000-0000-4000-8000-000000000002';
    const firstLease = await db.query<{ acquired: boolean }>(
      'select public.acquire_recording_translation_lease($1,1,$2,$3) as acquired', [recordingId, 'fr', firstLeaseToken],
    );
    if (!firstLease.rows[0].acquired) throw new Error('first translation request could not acquire its lease');
    const competingLease = await db.query<{ acquired: boolean }>(
      'select public.acquire_recording_translation_lease($1,1,$2,$3) as acquired', [recordingId, 'fr', competingLeaseToken],
    );
    if (competingLease.rows[0].acquired) throw new Error('concurrent translation request acquired an active lease');
    const wrongRelease = await db.query<{ released: boolean }>(
      'select public.release_recording_translation_lease($1,1,$2,$3) as released', [recordingId, 'fr', competingLeaseToken],
    );
    if (wrongRelease.rows[0].released) throw new Error('a non-owner released another request lease');
    const release = await db.query<{ released: boolean }>(
      'select public.release_recording_translation_lease($1,1,$2,$3) as released', [recordingId, 'fr', firstLeaseToken],
    );
    if (!release.rows[0].released) throw new Error('lease owner could not release its request lease');
    await db.query('select public.acquire_recording_translation_lease($1,1,$2,$3)', [recordingId, 'fr', firstLeaseToken]);
    await db.query("update public.recording_translation_leases set lease_expires_at=now()-interval '1 second' where recording_id=$1", [recordingId]);
    const reclaimedLease = await db.query<{ acquired: boolean }>(
      'select public.acquire_recording_translation_lease($1,1,$2,$3) as acquired', [recordingId, 'fr', competingLeaseToken],
    );
    if (!reclaimedLease.rows[0].acquired) throw new Error('expired translation lease could not be reclaimed');
    const staleOwnerCommit = await db.query<{ committed: boolean }>(
      'select public.complete_recording_translation($1,1,$2,$3,$4) as committed', [recordingId, 'fr', firstLeaseToken, 'stale translation'],
    );
    if (staleOwnerCommit.rows[0].committed) throw new Error('expired lease owner could still commit after another request reclaimed it');
    const currentOwnerCommit = await db.query<{ committed: boolean }>(
      'select public.complete_recording_translation($1,1,$2,$3,$4) as committed', [recordingId, 'fr', competingLeaseToken, 'current translation'],
    );
    if (!currentOwnerCommit.rows[0].committed) throw new Error('current lease owner could not atomically commit its translation');

    await db.query("insert into public.recording_translations(recording_id,source_version,target_language,translated_text) values($1,1,'en','A Fukuoka memory')", [recordingId]);
    const grants = await db.query<{ anon_select: boolean; service_select: boolean; rls: boolean }>(
      `select has_table_privilege('anon','public.recording_translations','SELECT') as anon_select,
        has_table_privilege('service_role','public.recording_translations','SELECT') as service_select,
        (select relrowsecurity from pg_class where oid='public.recording_translations'::regclass) as rls`,
    );
    if (grants.rows[0].anon_select || !grants.rows[0].service_select || !grants.rows[0].rls) throw new Error('translation cache grants or RLS are unsafe');
    const leaseGrants = await db.query<{ anon_select: boolean; service_select: boolean; rls: boolean }>(
      `select has_table_privilege('anon','public.recording_translation_leases','SELECT') as anon_select,
        has_table_privilege('service_role','public.recording_translation_leases','SELECT') as service_select,
        (select relrowsecurity from pg_class where oid='public.recording_translation_leases'::regclass) as rls`,
    );
    if (leaseGrants.rows[0].anon_select || !leaseGrants.rows[0].service_select || !leaseGrants.rows[0].rls) throw new Error('translation lease grants or RLS are unsafe');
    const leaseFunctionGrants = await db.query<{
      anon_acquire: boolean; service_acquire: boolean; anon_complete: boolean; service_complete: boolean; anon_release: boolean; service_release: boolean;
    }>(`select
      has_function_privilege('anon','public.acquire_recording_translation_lease(uuid,integer,text,uuid)','EXECUTE') as anon_acquire,
      has_function_privilege('service_role','public.acquire_recording_translation_lease(uuid,integer,text,uuid)','EXECUTE') as service_acquire,
      has_function_privilege('anon','public.complete_recording_translation(uuid,integer,text,uuid,text)','EXECUTE') as anon_complete,
      has_function_privilege('service_role','public.complete_recording_translation(uuid,integer,text,uuid,text)','EXECUTE') as service_complete,
      has_function_privilege('anon','public.release_recording_translation_lease(uuid,integer,text,uuid)','EXECUTE') as anon_release,
      has_function_privilege('service_role','public.release_recording_translation_lease(uuid,integer,text,uuid)','EXECUTE') as service_release`);
    if (leaseFunctionGrants.rows[0].anon_acquire || leaseFunctionGrants.rows[0].anon_complete || leaseFunctionGrants.rows[0].anon_release
      || !leaseFunctionGrants.rows[0].service_acquire || !leaseFunctionGrants.rows[0].service_complete || !leaseFunctionGrants.rows[0].service_release) {
      throw new Error('translation lease RPC grants are unsafe');
    }

    let duplicateRejected = false;
    try {
      await db.query("insert into public.recording_translations(recording_id,source_version,target_language,translated_text) values($1,1,'en','duplicate')", [recordingId]);
    } catch {
      duplicateRejected = true;
    }
    if (!duplicateRejected) throw new Error('translation cache did not enforce its version/language key');

    await db.query("update public.recording_transcriptions set text='Updated source',version=2 where recording_id=$1", [recordingId]);
    const afterEdit = await db.query<{ count: number }>('select count(*)::int as count from public.recording_translations where recording_id=$1', [recordingId]);
    if (afterEdit.rows[0].count !== 0) throw new Error('editing a transcript did not clear its translations');

    await db.query("insert into public.recording_translations(recording_id,source_version,target_language,translated_text) values($1,2,'en','Updated translation')", [recordingId]);
    await db.query('update public.recording_transcriptions set published=false where recording_id=$1', [recordingId]);
    const afterHide = await db.query<{ count: number }>('select count(*)::int as count from public.recording_translations where recording_id=$1', [recordingId]);
    if (afterHide.rows[0].count !== 0) throw new Error('hiding a transcript did not clear its translations');

    await db.query("insert into public.recording_translations(recording_id,source_version,target_language,translated_text) values($1,3,'en','A Fukuoka memory')", [recordingId]);
    await db.query('delete from public.recordings where id=$1', [recordingId]);
    const afterDelete = await db.query<{ count: number }>('select count(*)::int as count from public.recording_translations where recording_id=$1', [recordingId]);
    if (afterDelete.rows[0].count !== 0) throw new Error('deleting a recording did not cascade its translations');
    const afterLeaseDelete = await db.query<{ count: number }>('select count(*)::int as count from public.recording_translation_leases where recording_id=$1', [recordingId]);
    if (afterLeaseDelete.rows[0].count !== 0) throw new Error('deleting a recording did not cascade its translation lease');
  } finally {
    await db.close();
  }
});

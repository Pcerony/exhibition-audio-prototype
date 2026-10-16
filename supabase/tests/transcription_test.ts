import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

Deno.test('transcription migration: private queue, consent, optimistic edits and stale completion', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;
   create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create function extensions.gen_random_bytes(n integer) returns bytea language sql as 'select decode(left(string_agg(md5(random()::text),''''),n*2),''hex'') from generate_series(1,(n+15)/16)';
   create function extensions.digest(v bytea,algorithm text) returns bytea language sql immutable as 'select decode(md5(v)||md5(v),''hex'')';
   create function extensions.digest(v text,algorithm text) returns bytea language sql immutable as 'select extensions.digest(convert_to(v,''UTF8''),algorithm)';`);
  for (const file of ['202609290001_cloud_recording_core.sql','202610010001_operator_management.sql','202610010002_stable_job_order.sql','202610150002_visitor_location.sql','202610150001_categories_and_leases.sql','202610160001_post_recording_classification.sql']) {
   await db.exec((await Deno.readTextFile(`supabase/migrations/${file}`)).replace('create extension if not exists pgcrypto with schema extensions;',''));
  }
  await db.exec(`insert into public.tags(id,label,inventory_label,public_token) values('20000000-0000-4000-8000-000000000099','HISTORICAL','HISTORICAL',repeat('9',48));
   select public.initialize_upload(repeat('9',48),'30000000-0000-4000-8000-000000000099',encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10);
   select * from public.claim_recording_classified('30000000-0000-4000-8000-000000000099','test','',1,10,'audio/wav',null,'A');`);
  await db.exec(await Deno.readTextFile('supabase/migrations/202610170001_transcription.sql'));
  await db.exec(await Deno.readTextFile('supabase/tests/transcription.sql'));
 } finally { await db.close(); }
});

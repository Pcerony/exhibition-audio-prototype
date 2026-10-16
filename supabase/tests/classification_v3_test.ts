import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

Deno.test('V3 migration preserves legacy identities and atomically classifies only successful recordings', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema auth;create schema storage;create schema extensions;
   create table auth.users(id uuid primary key);
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create function extensions.gen_random_bytes(n integer) returns bytea language sql as
    'select decode(left(string_agg(md5(random()::text),''''),n*2),''hex'') from generate_series(1,(n+15)/16)';
   create function extensions.digest(v bytea,algorithm text) returns bytea language sql immutable as 'select decode(md5(v)||md5(v),''hex'')';
   create function extensions.digest(v text,algorithm text) returns bytea language sql immutable as 'select extensions.digest(convert_to(v,''UTF8''),algorithm)';`);
  for (const file of ['202609290001_cloud_recording_core.sql','202610010001_operator_management.sql','202610010002_stable_job_order.sql','202610150002_visitor_location.sql','202610150001_categories_and_leases.sql']) {
   await db.exec((await Deno.readTextFile(`supabase/migrations/${file}`)).replace('create extension if not exists pgcrypto with schema extensions;',''));
  }
  await db.exec(`insert into auth.users values('10000000-0000-4000-8000-000000000001');
   insert into public.operator_profiles(user_id,role) values('10000000-0000-4000-8000-000000000001','admin');
   select public.admin_action('10000000-0000-4000-8000-000000000001','{"action":"createCategory","name":"Legacy","requestKey":"10000000-0000-4000-8000-000000000002"}');
   insert into public.tags(id,label,batch,category_id,public_token) select '20000000-0000-4000-8000-000000000001','KEEP-001','Legacy',id,repeat('a',48) from public.categories limit 1;
   insert into public.provisioning_jobs(tag_id,visitor_url) values('20000000-0000-4000-8000-000000000001','https://voice.heisei.space/#/t/'||repeat('a',48));
   select public.initialize_upload(repeat('a',48),'30000000-0000-4000-8000-000000000001',encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10);
   select * from public.claim_recording_with_location('30000000-0000-4000-8000-000000000001','test','legacy',1,10,'audio/wav',null);`);
  await db.exec(`insert into public.tags(id,label,batch,category_id,public_token) select '20000000-0000-4000-8000-000000000002','EMPTY-OLD','Legacy',id,repeat('b',48) from public.categories limit 1;
   insert into public.provisioning_jobs(tag_id,visitor_url) values('20000000-0000-4000-8000-000000000002','https://voice.heisei.space/#/t/'||repeat('b',48));`);
  await db.exec(await Deno.readTextFile('supabase/migrations/202610160001_post_recording_classification.sql'));
  await db.exec(await Deno.readTextFile('supabase/tests/classification_v3.sql'));
 } finally { await db.close(); }
});

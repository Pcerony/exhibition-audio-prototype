import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

Deno.test('Postgres migrations and rollback behavioral contract', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users(id uuid primary key);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      -- The embedded runtime has no pgcrypto; these are test-only stand-ins.
      create function extensions.gen_random_bytes(n integer) returns bytea language sql as
        'select decode(left(string_agg(md5(random()::text),''''),n*2),''hex'') from generate_series(1,(n+15)/16)';
      create function extensions.digest(v bytea,algorithm text) returns bytea language sql immutable as
        'select decode(md5(v)||md5(v),''hex'')';
      create function extensions.digest(v text,algorithm text) returns bytea language sql immutable as
        'select extensions.digest(convert_to(v,''UTF8''),algorithm)';
    `);
    const core = await Deno.readTextFile('supabase/migrations/202609290001_cloud_recording_core.sql');
    await db.exec(core.replace('create extension if not exists pgcrypto with schema extensions;', ''));
    await db.exec(await Deno.readTextFile('supabase/migrations/202610010001_operator_management.sql'));
    await db.exec(await Deno.readTextFile('supabase/migrations/202610010002_stable_job_order.sql'));
    await db.exec(await Deno.readTextFile('supabase/tests/operator_management.sql'));
    await db.exec(await Deno.readTextFile('supabase/migrations/202610150002_visitor_location.sql'));
    await db.exec(await Deno.readTextFile('supabase/tests/visitor_location.sql'));
    await db.exec(await Deno.readTextFile('supabase/tests/operator_management.sql'));
    await db.exec(`
      insert into public.tags(id,label,batch,public_token) values
      ('20000000-0000-4000-8000-000000000001','KEEP-001',' Legacy ','111111111111111111111111111111111111111111111111'),
      ('20000000-0000-4000-8000-000000000002','KEEP-002','legacy','222222222222222222222222222222222222222222222222');
      insert into public.provisioning_jobs(tag_id,visitor_url) select id,'https://voice.heisei.space/#/t/'||public_token from public.tags;
      select public.initialize_upload('111111111111111111111111111111111111111111111111',
        '30000000-0000-4000-8000-000000000001',encode(extensions.digest(convert_to('test','UTF8'),'sha256'),'hex'),'audio/wav',10);
      select public.claim_recording_with_location('30000000-0000-4000-8000-000000000001','test','fictional',1,10,'audio/wav','{"source":"pin","lat":33.59,"lng":130.4}');
    `);
    await db.exec(await Deno.readTextFile('supabase/migrations/202610150001_categories_and_leases.sql'));
    await db.exec(`do $$ begin
      if (select count(distinct category_id) from public.tags)<>1 then raise exception 'casefold mapping failed';end if;
      if not exists(select 1 from public.tags where label='KEEP-001' and public_token='111111111111111111111111111111111111111111111111' and status='bound')
        or not exists(select 1 from public.recordings where nickname='fictional' and location='{"source":"pin","lat":33.59,"lng":130.4}'::jsonb) then raise exception 'legacy identity or location lost';end if;
    end $$;`);
    await db.exec(await Deno.readTextFile('supabase/tests/operator_v2.sql'));
  } finally { await db.close(); }
});

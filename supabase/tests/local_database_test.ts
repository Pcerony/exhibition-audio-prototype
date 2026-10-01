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
  } finally { await db.close(); }
});

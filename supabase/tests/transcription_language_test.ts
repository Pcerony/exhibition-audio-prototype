import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

Deno.test('language migration preserves history and staff retries are versioned, private and authorized', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create schema auth;create schema storage;create schema extensions;
   create table auth.users(id uuid primary key);
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create function extensions.gen_random_bytes(n integer) returns bytea language sql as 'select decode(left(string_agg(md5(random()::text),''''),n*2),''hex'') from generate_series(1,(n+15)/16)';
   create function extensions.digest(v bytea,algorithm text) returns bytea language sql immutable as 'select decode(md5(v)||md5(v),''hex'')';
   create function extensions.digest(v text,algorithm text) returns bytea language sql immutable as 'select extensions.digest(convert_to(v,''UTF8''),algorithm)';`);
  for(const file of [...Deno.readDirSync('supabase/migrations')].map(e=>e.name).sort()) {
   if(file==='202610170006_transcription_language.sql') continue;
   await db.exec((await Deno.readTextFile(`supabase/migrations/${file}`)).replace('create extension if not exists pgcrypto with schema extensions;',''));
  }
  await db.exec(await Deno.readTextFile('supabase/tests/transcription_language_fixture.sql'));
  await db.exec(await Deno.readTextFile('supabase/migrations/202610170006_transcription_language.sql'));
  await db.exec(await Deno.readTextFile('supabase/tests/transcription_language.sql'));
  // Model a reset deleting the transcription between the base list and metadata lookup.
  await db.exec(`
   alter function public.staff_action_before_language(uuid,jsonb) rename to staff_action_list_fixture;
   create function public.staff_action_before_language(p_operator uuid,p_body jsonb) returns jsonb
   language plpgsql security definer set search_path='' as $$
   declare result jsonb;begin
    result:=public.staff_action_list_fixture(p_operator,p_body);
    delete from public.recording_transcriptions;
    return result;
   end $$;
   do $$ declare result jsonb;begin
    result:=public.staff_action('10000000-0000-4000-8000-000000000021','{"action":"list"}');
    if result->'cards'->0 is null or result->'cards'->0='null'::jsonb
     or result->'cards'->0->'recording'->'transcription'->>'languageHint' is distinct from 'ja'
     then raise exception 'concurrent transcription deletion nullified list card';end if;
   end $$;`);
 } catch(error) {console.error((error as {where?:string}).where);throw error;} finally {await db.close();}
});

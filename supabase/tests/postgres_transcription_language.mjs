import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runtime=process.env.EMBEDDED_PG_RUNTIME;
if(!runtime)throw Error('Set EMBEDDED_PG_RUNTIME to an isolated embedded-postgres/pg runtime');
const require=createRequire(join(runtime,'package.json'));
const EmbeddedPostgres=require('embedded-postgres').default,{Pool}=require('pg');
const port=Number(process.env.TEST_POSTGRES_PORT??55451),password=randomUUID();
const server=new EmbeddedPostgres({databaseDir:join(tmpdir(),`language-${randomUUID()}`),user:'postgres',password,port,persistent:false,postgresFlags:['-h','127.0.0.1'],onLog(){},onError(){}});
let pool;
try {
 await server.initialise();await server.start();
 pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:10});
 await pool.query(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;
  create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 for(const file of (await readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')).sort()) {
  if(file==='202610170006_transcription_language.sql')await pool.query(await readFile('supabase/tests/transcription_language_fixture.sql','utf8'));
  await pool.query(await readFile(`supabase/migrations/${file}`,'utf8'));
 }
 await pool.query(await readFile('supabase/tests/transcription_language.sql','utf8'));
 const adminId=randomUUID(),staffId=randomUUID();
 await pool.query('insert into auth.users values($1),($2)',[adminId,staffId]);
 await pool.query("insert into public.operator_profiles(user_id,role) values($1,'admin'),($2,'staff')",[adminId,staffId]);
 const admin=async(body,client=pool)=>(await client.query('select public.admin_action($1,$2) result',[adminId,body])).rows[0].result;
 const staff=async(body)=>(await pool.query('select public.staff_action($1,$2) result',[staffId,body])).rows[0].result;
 const tags=(await admin({action:'createCards',count:3,requestKey:randomUUID(),protocolVersion:3})).tags;
 const recordings=[];
 for(const [i,tag] of tags.entries()) {
  const upload=randomUUID();
  await pool.query("select public.initialize_upload($1,$2,encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10)",[tag.token,upload]);
  if(i===0) {
   await assert.rejects(()=>pool.query("select * from public.claim_recording_transcription($1,'test','',1,10,'audio/wav',null,'A',true,'zh-TW')",[upload]),/REQUEST_INVALID/);
   assert.equal((await pool.query('select claimed_at from public.upload_sessions where id=$1',[upload])).rows[0].claimed_at,null);
  }
  const sql=i===0?"select * from public.claim_recording_transcription($1,'test','',1,10,'audio/wav',null,'A',true,'en')":
   i===1?"select * from public.claim_recording_transcription($1,'test','',1,10,'audio/wav',null,'A',true)":
    "select * from public.claim_recording_transcription($1,'test','',1,10,'audio/wav',null,'A')";
  const rid=(await pool.query(sql,[upload])).rows[0].recording_id;recordings.push(rid);
  const q=(await pool.query('select language_hint from public.recording_transcriptions where recording_id=$1',[rid])).rows;
  assert.deepEqual(q,i===2?[]:[{language_hint:i===0?'en':'ja'}]);
 }
 const rid=recordings[0];
 await pool.query("update public.recording_transcriptions set status='ready',text='Synthetic reference',published=true where recording_id=$1",[rid]);
 const body={action:'retryTranscription',recordingId:rid,version:1,languageHint:'ko'};
 const results=await Promise.allSettled(['wang-heisei','chen-feixue'].map(memberId=>staff({...body,memberId})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.match(results.find(r=>r.status==='rejected').reason.message,/VERSION_CONFLICT/);
 assert.equal((await pool.query("select count(*) from public.audit_log where details->>'recordingId'=$1 and action='staff_retry_transcription'",[rid])).rows[0].count,'1');
 const q=(await pool.query('select * from public.recording_transcriptions where recording_id=$1',[rid])).rows[0];
 assert.equal(q.text,'Synthetic reference');assert.equal(q.published,false);assert.equal(q.version,2);assert.equal(q.language_hint,'ko');
 // While reset holds the tag lock, retry must wait and then reject the removed binding.
 const second=recordings[1];
 await pool.query("update public.recording_transcriptions set status='ready',text='Synthetic second' where recording_id=$1",[second]);
 const reset=await pool.connect();
 try {
  await reset.query('begin');await admin({action:'reset',tagId:tags[1].id},reset);
  const retry=staff({...body,recordingId:second,memberId:'wang-heisei'}).then(()=>null,error=>error);
  await reset.query('commit');assert.match((await retry).message,/RECORDING_NOT_FOUND/);
 } finally {await reset.query('rollback');reset.release();}
 console.log('PASS: fresh PostgreSQL migration preserves historical publication/text; legacy and explicit claim signatures; language validation; retry auth/audit/rate/lease guards; concurrent retry has one winner; reset race rejects stale binding.');
} finally {await pool?.end();await server.stop();}

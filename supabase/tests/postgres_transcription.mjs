import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Disposable local server only. No cloud URL, audio or provider credentials are accepted.
const runtime=process.env.EMBEDDED_PG_RUNTIME;
if(!runtime)throw Error('Set EMBEDDED_PG_RUNTIME to a temporary prefix containing embedded-postgres and pg');
const require=createRequire(join(runtime,'package.json'));
const EmbeddedPostgres=require('embedded-postgres').default;const {Pool}=require('pg');
const port=Number(process.env.TEST_POSTGRES_PORT??55442),password=randomUUID();
const server=new EmbeddedPostgres({databaseDir:join(tmpdir(),`transcription-${randomUUID()}`),user:'postgres',password,port,persistent:false,postgresFlags:['-h','127.0.0.1'],onLog(){},onError(){}});
let pool;
try{
 await server.initialise();await server.start();
 pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:12});
 await pool.query(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;
  create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 for(const file of ['202609290001_cloud_recording_core.sql','202610010001_operator_management.sql','202610010002_stable_job_order.sql','202610150002_visitor_location.sql','202610150001_categories_and_leases.sql','202610160001_post_recording_classification.sql','202610170001_transcription.sql'])await pool.query(await readFile(`supabase/migrations/${file}`,'utf8'));
 const op=randomUUID();await pool.query('insert into auth.users values($1)',[op]);await pool.query("insert into public.operator_profiles(user_id,role) values($1,'admin')",[op]);
 const admin=async(body,client=pool)=>(await client.query('select public.admin_action($1,$2) result',[op,body])).rows[0].result;
 const tags=(await admin({action:'createCards',count:2,requestKey:randomUUID(),protocolVersion:3})).tags;
 for(const tag of tags){
  const id=randomUUID();await pool.query("select public.initialize_upload($1,$2,encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10)",[tag.token,id]);
  await pool.query("select * from public.claim_recording_transcription($1,'test','',1,10,'audio/wav',null,'A',true)",[id]);
 }
 const claims=await Promise.all(Array.from({length:8},async()=>(await pool.query('select public.claim_transcription() task')).rows[0].task));
 const tasks=claims.filter(Boolean);assert.equal(tasks.length,2);assert.equal(new Set(tasks.map(t=>t.recordingId)).size,2);assert.equal(new Set(tasks.map(t=>t.leaseToken)).size,2);
 const finish=async(task)=>(await pool.query('select public.finish_transcription($1,$2,$3,$4,null,0) accepted',[task.recordingId,task.leaseToken,task.version,'Late fake provider text'])).rows[0].accepted;
 const editing=await pool.connect();
 try{
  await editing.query('begin');
  await admin({action:'saveTranscription',recordingId:tasks[0].recordingId,version:1,text:'Human reviewed',published:true},editing);
  const late=finish(tasks[0]);await editing.query('commit');assert.equal(await late,false);
  const reviewed=await admin({action:'getTranscription',recordingId:tasks[0].recordingId});assert.equal(reviewed.transcription.text,'Human reviewed');
 }finally{await editing.query('rollback');editing.release();}
 const resetting=await pool.connect();
 try{
  const tag=(await pool.query('select tag_id from public.recordings where id=$1',[tasks[1].recordingId])).rows[0].tag_id;
  await resetting.query('begin');await admin({action:'reset',tagId:tag},resetting);
  const late=finish(tasks[1]);await resetting.query('commit');assert.equal(await late,false);
  assert.equal((await pool.query('select count(*) from public.recording_transcriptions where recording_id=$1',[tasks[1].recordingId])).rows[0].count,'0');
 }finally{await resetting.query('rollback');resetting.release();}
 console.log('PASS: real concurrent workers lease each recording once; committed edits/reset reject late worker completions. No provider calls.');
}finally{await pool?.end();await server.stop();}

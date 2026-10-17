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
const port=Number(process.env.TEST_POSTGRES_PORT??55448),password=randomUUID();
const server=new EmbeddedPostgres({databaseDir:join(tmpdir(),`staff-${randomUUID()}`),user:'postgres',password,port,persistent:false,postgresFlags:['-h','127.0.0.1'],onLog(){},onError(){}});
let pool;
try {
 await server.initialise();await server.start();
 pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:10});
 await pool.query(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;
  create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 for(const file of (await readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')).sort())await pool.query(await readFile(`supabase/migrations/${file}`,'utf8'));
 await pool.query(await readFile('supabase/tests/staff_portal.sql','utf8'));
 const adminId=randomUUID(),staffId=randomUUID();
 await pool.query('insert into auth.users values($1),($2)',[adminId,staffId]);
 await pool.query("insert into public.operator_profiles(user_id,role) values($1,'admin'),($2,'staff')",[adminId,staffId]);
 const admin=async(body,client=pool)=>(await client.query('select public.admin_action($1,$2) result',[adminId,body])).rows[0].result;
 const staff=async(body)=>(await pool.query('select public.staff_action($1,$2) result',[staffId,body])).rows[0].result;
 const tags=(await admin({action:'createCards',count:2,requestKey:randomUUID(),protocolVersion:3})).tags;
 const recordings=[];
 for(const tag of tags) {
  const upload=randomUUID();
  await pool.query("select public.initialize_upload($1,$2,encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10)",[tag.token,upload]);
  recordings.push((await pool.query("select * from public.claim_recording_transcription($1,'test','',1,10,'audio/wav',null,'A',true)",[upload])).rows[0].recording_id);
 }
 const task=(await pool.query('select public.claim_transcription() task')).rows[0].task;
 const result=await Promise.allSettled(['wang-heisei','chen-feixue'].map(memberId=>staff({action:'save',recordingId:task.recordingId,memberId,version:1,text:`Synthetic review ${memberId}`,published:true})));
 assert.equal(result.filter(value=>value.status==='fulfilled').length,1);
 assert.match(result.find(value=>value.status==='rejected').reason.message,/VERSION_CONFLICT/);
 assert.equal((await pool.query("select count(*) from public.audit_log where details->>'recordingId'=$1 and action='staff_approve'",[task.recordingId])).rows[0].count,'1');
 assert.equal((await pool.query('select public.finish_transcription($1,$2,1,\'Late AI\',null,0) accepted',[task.recordingId,task.leaseToken])).rows[0].accepted,false);
 const second=recordings.find(id=>id!==task.recordingId);
 const tagId=(await pool.query('select tag_id from public.recordings where id=$1',[second])).rows[0].tag_id;
 const resetting=await pool.connect();
 try {
  await resetting.query('begin');await admin({action:'reset',tagId},resetting);
  const saving=staff({action:'save',recordingId:second,memberId:'wang-heisei',version:1,text:'stale reset',published:true}).then(()=>null,error=>error);
  await resetting.query('commit');assert.match((await saving).message,/RECORDING_NOT_FOUND/);
 } finally {await resetting.query('rollback');resetting.release();}
 console.log('PASS: all migrations rehearsed on fresh PostgreSQL; concurrent shared-account reviewers have one winner; reset/late AI cannot overwrite; audit and authorization assertions passed.');
} finally {await pool?.end();await server.stop();}

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Local ephemeral PostgreSQL only. Never accepts a remote connection string.
const runtime=process.env.EMBEDDED_PG_RUNTIME;
if(!runtime) throw new Error('Set EMBEDDED_PG_RUNTIME to a temporary prefix containing embedded-postgres and pg');
const require=createRequire(join(runtime,'package.json'));
const EmbeddedPostgres=require('embedded-postgres').default;
const {Pool}=require('pg');
const password=randomUUID();
const port=Number(process.env.TEST_POSTGRES_PORT??55442);
const server=new EmbeddedPostgres({databaseDir:join(tmpdir(),`on-demand-writing-${randomUUID()}`),user:'postgres',password,port,persistent:false,postgresFlags:['-h','127.0.0.1'],onLog(){},onError(){}});
let pool;
try {
 await server.initialise();await server.start();
 pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:16});
 await pool.query(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;
  create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await pool.query(await readFile(`supabase/migrations/${file}`,'utf8'));
 await pool.query(await readFile('supabase/tests/on_demand_writing.sql','utf8'));
 const op=randomUUID();await pool.query('insert into auth.users values($1)',[op]);
 await pool.query("insert into public.operator_profiles(user_id,role) values($1,'operator')",[op]);
 const admin=async(body,operator=op)=>(await pool.query('select public.admin_action($1,$2) result',[operator,body])).rows[0].result;
 const prepare=(deviceId,requestKey=randomUUID())=>({action:'prepareWrite',deviceId,requestKey,protocolVersion:3});
 const count=async()=>Number((await pool.query('select count(*) from public.tags')).rows[0].count);
 const b=prepare('one-device');
 const replay=await Promise.all(Array.from({length:12},()=>admin(b)));
 assert.ok(replay.every(r=>r.job.id===replay[0].job.id&&r.leaseToken===replay[0].leaseToken));assert.equal(await count(),1);
 const newKeys=await Promise.all(Array.from({length:12},()=>admin(prepare('one-device'))));
 assert.ok(newKeys.every(r=>r.job.id===replay[0].job.id));assert.equal(await count(),1);
 const blocker=await pool.connect();
 try {
  await blocker.query('begin');await blocker.query('select 1 from public.tags where id=$1 for update',[replay[0].job.tagId]);
  let finished=false;const waiting=admin(prepare('one-device')).then(r=>{finished=true;return r;});
  await pool.query('select pg_sleep(0.1)');assert.equal(finished,false,'Current task must wait, not be skipped');
  await blocker.query('commit');assert.equal((await waiting).job.id,replay[0].job.id);assert.equal(await count(),1);
 } finally {await blocker.query('rollback');blocker.release();}
 const distinct=await Promise.all(Array.from({length:8},(_,i)=>admin(prepare(`independent-${i}`))));
 assert.equal(new Set(distinct.map(r=>r.job.id)).size,8);assert.equal(await count(),9);
 const competing=prepare('different-a');
 const collision=await Promise.allSettled([admin(competing),admin({...competing,deviceId:'different-b'})]);
 assert.equal(collision.filter(r=>r.status==='fulfilled').length,1);
 assert.match(collision.find(r=>r.status==='rejected').reason.message,/REQUEST_KEY_CONFLICT/);assert.equal(await count(),10);
 console.log('PASS: real sessions serialize same keys/devices; independent writers get distinct identities; cross-device key owner conflicts');
 await pool.query("update public.provisioning_jobs set lease_expires_at=now()-interval '1 second'");
 const expired=await admin(b);assert.equal(expired.job.id,replay[0].job.id);assert.notEqual(expired.leaseToken,replay[0].leaseToken);assert.equal(await count(),10);
 const fresh=await admin(prepare('new-after-uncertain'));assert.equal(await count(),11);assert.ok(!distinct.some(r=>r.job.id===fresh.job.id));
 const failure={action:'provision',jobId:expired.job.id,version:expired.job.version,visitorUrl:expired.job.visitorUrl,leaseToken:expired.leaseToken,protocolVersion:3,status:'failed',errorCode:'SYNTHETIC'};
 await admin(failure);await assert.rejects(admin(b),/JOB_INELIGIBLE/);
 const recovery=await admin({action:'leaseJob',jobId:expired.job.id,deviceId:'one-device',protocolVersion:3});assert.equal(recovery.job.id,expired.job.id);
 await admin({action:'provision',jobId:fresh.job.id,version:fresh.job.version,visitorUrl:fresh.job.visitorUrl,leaseToken:fresh.leaseToken,protocolVersion:3,status:'verified'});
 await assert.rejects(admin({...b,requestKey:b.requestKey}),/JOB_INELIGIBLE/);
 console.log('PASS: expired key renews only its task; uncertain/failed tasks are not recycled; explicit leaseJob recovery remains available');
 // Roll back the new migration and reapply it, confirming the prior transcription wrapper survives.
 const rollback=await pool.connect();
 try {
  await rollback.query('begin');
  await rollback.query('drop function public.admin_action(uuid,jsonb);alter function public.admin_action_transcription(uuid,jsonb) rename to admin_action;drop table public.write_preparations;grant execute on function public.admin_action(uuid,jsonb) to service_role;');
  const legacy=(await rollback.query("select pg_get_functiondef('public.admin_action(uuid,jsonb)'::regprocedure) definition")).rows[0].definition;
  assert.match(legacy,/getTranscription/);
  await rollback.query(await readFile('supabase/migrations/202610170002_on_demand_writing.sql','utf8'));
 } finally {await rollback.query('rollback');rollback.release();}
 console.log('PASS: migration rollback/reapply preserves transcription dispatch');
} finally {await pool?.end();await server.stop();}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated real PostgreSQL sessions only; no remote database URL is accepted.
const runtime = process.env.EMBEDDED_PG_RUNTIME;
if (!runtime) throw new Error('Set EMBEDDED_PG_RUNTIME to a temporary prefix containing embedded-postgres and pg');
const require = createRequire(join(runtime, 'package.json'));
const EmbeddedPostgres = require('embedded-postgres').default;
const { Pool } = require('pg');
const port = Number(process.env.TEST_POSTGRES_PORT ?? 55440);
const password = randomUUID();
const server = new EmbeddedPostgres({databaseDir:join(tmpdir(),`classification-v3-${randomUUID()}`),user:'postgres',password,port,persistent:false,postgresFlags:['-h','127.0.0.1'],onLog(){},onError(){}});
let pool;
try {
 await server.initialise();await server.start();
 pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',max:12});
 await pool.query(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;
  create table auth.users(id uuid primary key);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
 for(const file of ['202609290001_cloud_recording_core.sql','202610010001_operator_management.sql','202610010002_stable_job_order.sql','202610150002_visitor_location.sql','202610150001_categories_and_leases.sql','202610160001_post_recording_classification.sql']) await pool.query(await readFile(`supabase/migrations/${file}`,'utf8'));
 const op=randomUUID();await pool.query('insert into auth.users values($1)',[op]);await pool.query("insert into public.operator_profiles(user_id,role) values($1,'admin')",[op]);
 const admin=async(body,client=pool)=>(await client.query('select public.admin_action($1,$2) result',[op,body])).rows[0].result;
 const body={action:'createCards',count:8,requestKey:randomUUID(),protocolVersion:3};
 const retries=await Promise.all(Array.from({length:8},()=>admin(body)));
 assert.ok(retries.every(r=>r.tags[0].id===retries[0].tags[0].id));
 const tags=retries[0].tags;
 assert.equal(new Set(tags.map(t=>t.inventoryLabel)).size,8);
 const grant=async tag=>{const id=randomUUID();await pool.query("select public.initialize_upload($1,$2,encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10)",[tag.token,id]);return id;};
 const claim=async(id,code='A')=>(await pool.query("select * from public.claim_recording_classified($1,'test','fixture',1,10,'audio/wav',$2,$3)",[id,{source:'pin',lat:33,lng:130},code])).rows[0];
 const same=await Promise.all([grant(tags[0]),grant(tags[0])]);
 const claims=await Promise.all(same.map(id=>claim(id)));
 assert.deepEqual(claims.map(r=>r.claim_status).sort(),['already-bound','claimed']);
 assert.equal((await pool.query('select next_number from public.daily_topic_counters')).rows[0].next_number,'2');
 const uploads=await Promise.all(tags.slice(1).map(grant));
 assert.ok((await Promise.all(uploads.map(id=>claim(id)))).every(r=>r.claim_status==='claimed'));
 const assigned=(await pool.query('select label,public_token from public.tags order by label')).rows;
 assert.equal(new Set(assigned.map(t=>t.label)).size,8);
 assert.equal((await pool.query('select next_number from public.daily_topic_counters')).rows[0].next_number,'9');
 assert.deepEqual(new Set(assigned.map(t=>t.public_token)),new Set(tags.map(t=>t.token)));
 console.log('PASS: real concurrent sessions replay one empty batch, same-card losers allocate nothing, and different cards receive unique daily numbers');

 const empty=(await admin({action:'createCards',count:1,requestKey:randomUUID(),protocolVersion:3})).tags[0];
 const leases=await Promise.all(['writer-a','writer-b'].map(deviceId=>admin({action:'nextJob',deviceId,protocolVersion:3})));
 assert.equal(leases.filter(r=>r.job).length,1);
 assert.equal(leases.find(r=>r.job).job.tagId,empty.id);
 const stale=await grant(empty);
 await admin({action:'reset',tagId:empty.id});
 await assert.rejects(claim(stale),/UPLOAD_SESSION_INVALID/);
 assert.equal((await pool.query('select next_number from public.daily_topic_counters')).rows[0].next_number,'9');
 const fresh=await grant(empty);
 await assert.rejects(pool.query("select * from public.claim_recording_classified($1,'test','fixture',61,10,'audio/wav',null,'A')",[fresh]),/RECORDING_INVALID/);
 assert.equal((await pool.query('select next_number from public.daily_topic_counters')).rows[0].next_number,'9');
 console.log('PASS: unified writers exclude bound cards, reset invalidates old uploads, and failed validation allocates no number');
 const delayed=await pool.connect();
 try {
  await delayed.query('begin');
  await delayed.query('select pg_sleep(0.02)');
  const beforeCall=(await delayed.query('select clock_timestamp() ts')).rows[0].ts;
  const finalized=(await delayed.query("select * from public.claim_recording_classified($1,'test','fixture',1,10,'audio/wav',null,'B')",[fresh])).rows[0];
  assert.ok(finalized.recording_created_at>=beforeCall,'Recording time must reflect finalization, not transaction start');
  await delayed.query('commit');
 } finally {await delayed.query('rollback');delayed.release();}

 const current=(await admin({action:'list',search:tags[0].inventoryLabel})).tags[0];
 const deleting=await pool.connect();const enabling=await pool.connect();
 try {
  await deleting.query('begin');
  await admin({action:'bulkApply',operation:'delete',kind:'recorded',cards:[{id:current.id,version:current.version}],requestKey:randomUUID()},deleting);
  const pending=admin({action:'setEnabled',tagId:current.id,enabled:true},enabling).then(()=> 'accepted',error=>error.message);
  await deleting.query('commit');assert.match(await pending,/TAG_NOT_FOUND/);
  await assert.rejects(pool.query("select public.initialize_upload($1,$2,'hash','audio/wav',10)",[current.token,randomUUID()]),/TAG_UNAVAILABLE/);
 } finally {deleting.release();enabling.release();}
 console.log('PASS: concurrent enable cannot resurrect a deleted recording or authorize a stale upload');
} finally {await pool?.end();await server.stop();}

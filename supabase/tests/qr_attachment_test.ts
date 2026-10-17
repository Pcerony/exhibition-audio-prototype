import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

const op='10000000-0000-4000-8000-000000000001', other='10000000-0000-4000-8000-000000000002';
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }
Deno.test('QR attachment preserves identity, isolates stock, pins a single chip and protects reports', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create schema extensions;
   create table auth.users(id uuid primary key);
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create function extensions.gen_random_bytes(n integer) returns bytea language sql as 'select decode(left(string_agg(md5(random()::text),''''),n*2),''hex'') from generate_series(1,(n+15)/16)';
   create function extensions.digest(v bytea,algorithm text) returns bytea language sql immutable as 'select decode(md5(v)||md5(v),''hex'')';
   create function extensions.digest(v text,algorithm text) returns bytea language sql immutable as 'select extensions.digest(convert_to(v,''UTF8''),algorithm)';`);
  for(const file of [...Deno.readDirSync('supabase/migrations')].map(x=>x.name).sort()) await db.exec((await Deno.readTextFile(`supabase/migrations/${file}`)).replace('create extension if not exists pgcrypto with schema extensions;',''));
  await db.query('insert into auth.users(id) values($1),($2)',[op,other]);
  await db.query("insert into public.operator_profiles(user_id,role) values($1,'operator'),($2,'operator')",[op,other]);
  const admin=async(body:Record<string,unknown>,user=op)=>(await db.query<{r:any}>('select public.admin_action($1::uuid,$2::jsonb) r',[user,JSON.stringify(body)])).rows[0].r;
  const rejects=async(body:Record<string,unknown>,code:string,user=op)=>{let message='';try{await admin(body,user);}catch(e){message=String(e);}assert(message.includes(code),`Expected ${code}, got ${message}`);};
  const qr=await admin({action:'createQrEntry',requestKey:crypto.randomUUID()});
  const prepare={action:'prepareQrAttachment',tagId:qr.id,expectedVersion:1,deviceId:'device-a',protocolVersion:3};
  await rejects(prepare,'JOB_INELIGIBLE');
  const upload=crypto.randomUUID(),recording=crypto.randomUUID();
  await db.query("insert into public.upload_sessions(id,tag_id,object_path,claim_token_hash,mime_type,size_bytes,expires_at) values($1,$2,$3,'fake','audio/wav',12,now()+interval '1 hour')",[upload,qr.id,upload]);
  await db.query("insert into public.recordings(id,tag_id,upload_session_id,object_path,mime_type,size_bytes,duration_seconds) values($1,$2,$3::uuid,$3::text,'audio/wav',12,1)",[recording,qr.id,upload]);
  await db.query("update public.tags set status='bound' where id=$1",[qr.id]);
  prepare.expectedVersion=(await db.query<{version:number}>('select version::int from public.tags where id=$1',[qr.id])).rows[0].version;
  const lease=await admin(prepare), replay=await admin(prepare);
  assert(lease.job.id===replay.job.id && lease.leaseToken===replay.leaseToken,'lease replay changed');
  assert(lease.job.visitorUrl===qr.visitorUrl && lease.job.jobKind==='qr','wrong identity or kind');
  await rejects({...prepare,deviceId:'device-b'},'LEASE_CONFLICT',other);
  const list=await admin({action:'qrCards',status:'bound'});
  assert(list.total===1 && list.tags[0].attachment.id===lease.job.id,'QR list missing attachment');
  const normal=await db.query<{n:number}>('select count(*)::int n from public.provisioning_jobs where tag_id=$1',[qr.id]);
  assert(normal.rows[0].n===0,'QR entered normal stock');
  const report={action:'provisionQrAttachment',jobId:lease.job.id,leaseToken:lease.leaseToken,version:lease.job.version,visitorUrl:qr.visitorUrl,status:'verified',protocolVersion:3};
  await rejects(report,'JOB_INELIGIBLE');
  const begin={action:'beginQrAttachment',jobId:lease.job.id,leaseToken:lease.leaseToken,chipHash:'a'.repeat(64),protocolVersion:3};
  await admin(begin);await admin(begin);
  await rejects({...begin,chipHash:'b'.repeat(64)},'CHIP_CONFLICT');
  await rejects({...report,visitorUrl:qr.visitorUrl+'wrong'},'JOB_CONFLICT');
  await db.query("update public.qr_card_attachments set lease_expires_at=now()-interval '1 hour' where id=$1",[lease.job.id]);
  await rejects(begin,'LEASE_EXPIRED');
  const renewed=await admin({...prepare,deviceId:'recovery'},other);
  assert(renewed.job.id===lease.job.id,'recovery created another job');
  await rejects({...begin,leaseToken:renewed.leaseToken,chipHash:'b'.repeat(64)},'CHIP_CONFLICT',other);
  // The first verified report may arrive late, even after a different device recovered the same pinned chip.
  await admin(report);
  await db.query("update public.qr_card_attachments set lease_expires_at=now()-interval '1 hour' where id=$1",[lease.job.id]);
  await admin(report);
  await rejects({...report,status:'failed'},'JOB_CONFLICT');
  await rejects(prepare,'JOB_INELIGIBLE');
  const count=await db.query<{n:number}>('select count(*)::int n from public.recordings where id=$1 and tag_id=$2',[recording,qr.id]);
  assert(count.rows[0].n===1,'recording changed');
  await rejects({...prepare,tagId:crypto.randomUUID()},'TAG_NOT_FOUND');
  await db.query('delete from public.operator_profiles where user_id=$1',[other]);
  await rejects({action:'qrCards'},'OPERATOR_REQUIRED',other);
  for(const role of ['anon','authenticated']) {
   await db.exec(`set role ${role}`);let denied=false;
   try{await db.query('select * from public.qr_card_attachments');}catch{denied=true;}
   await db.exec('reset role');assert(denied,'private table readable');
  }
 } finally {await db.close();}
});

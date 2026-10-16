import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Owner-run deployed Edge check. All requests are prebound to owned fixture jobs;
// do not call new-key prepareWrite against a shared production pending pool.
const ref=process.argv[process.argv.indexOf('--project-ref')+1];
if(!process.argv.includes('--allow-remote-test')||!/^[a-z]{20}$/.test(ref??'')) throw Error('Usage: node scripts/verify-on-demand-writing.mjs --project-ref <ref> --allow-remote-test');
const binary=process.env.SUPABASE_CLI_BIN;
const cli=args=>execFileSync(binary??'npx',binary?args:['--','supabase',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:90000});
const origin=`https://${ref}.supabase.co`;
const tagId=randomUUID(),jobId=randomUUID(),requestKey=randomUUID(),deviceId=`fixture-${randomUUID()}`;
const token=randomBytes(24).toString('hex'),visitorUrl=`https://voice.heisei.space/#/t/${token}`;
let privileged,userId,jwt,publicKey,baseline,failed=false;
const check=error=>{if(error) throw Error('Owned fixture operation failed');};
const body={action:'prepareWrite',requestKey,deviceId,protocolVersion:3};
const endpoint=async(payload=body,auth=jwt)=>{
 const r=await fetch(`${origin}/functions/v1/admin-api`,{method:'POST',headers:{apikey:publicKey,'content-type':'application/json',...(auth?{authorization:`Bearer ${auth}`}:{})},body:JSON.stringify(payload)});
 return {status:r.status,body:await r.json()};
};
const snapshot=async()=>{
 const all=async(table,columns,excluded)=>{
  const rows=[];
  for(let offset=0;;offset+=500){
   const page=await privileged.from(table).select(columns).neq('id',excluded).order('id').range(offset,offset+499);check(page.error);
   rows.push(...page.data);if(page.data.length<500)return rows;
  }
 };
 return {
  tags:await all('tags','id,public_token,status,version,deleted_at',tagId),
  jobs:await all('provisioning_jobs','id,tag_id,visitor_url,status,version,lease_token,lease_expires_at',jobId),
 };
};
try {
 const keys=JSON.parse(cli(['projects','api-keys','--project-ref',ref,'-o','json']));
 publicKey=keys.find(k=>k.type==='publishable')?.api_key??keys.find(k=>k.name==='anon')?.api_key;
 const secret=keys.find(k=>k.name==='service_role')?.api_key;assert.ok(publicKey&&secret);
 const client=key=>createClient(origin,key,{auth:{persistSession:false,autoRefreshToken:false}});
 privileged=client(secret);baseline=await snapshot();
 const email=`on-demand-fixture-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url');
 const user=await privileged.auth.admin.createUser({email,password,email_confirm:true});check(user.error);userId=user.data.user.id;
 const login=await client(publicKey).auth.signInWithPassword({email,password});check(login.error);jwt=login.data.session.access_token;
 assert.equal((await endpoint()).status,403);assert.equal((await endpoint(body,null)).status,401);
 check((await privileged.from('operator_profiles').insert({user_id:userId,role:'operator'})).error);
 check((await privileged.from('tags').insert({id:tagId,label:`SYNTHETIC-${tagId}`,inventory_label:`SYNTHETIC-${tagId}`,public_token:token})).error);
 check((await privileged.from('provisioning_jobs').insert({id:jobId,tag_id:tagId,visitor_url:visitorUrl})).error);
 const tag=await privileged.from('tags').select('version').eq('id',tagId).single();check(tag.error);
 const job=await privileged.from('provisioning_jobs').select('version').eq('id',jobId).single();check(job.error);
 check((await privileged.from('write_preparations').insert({request_key:requestKey,operator_id:userId,device_id:deviceId,job_id:jobId,tag_version:tag.data.version,job_version:job.data.version})).error);
 const results=await Promise.all(Array.from({length:4},()=>endpoint()));
 for(const r of results){assert.equal(r.status,200);assert.equal(r.body.job.id,jobId);assert.equal(r.body.job.visitorUrl,visitorUrl);assert.match(r.body.expiresAt,/\.\d{3}Z$/);assert.equal(r.body.leaseToken,results[0].body.leaseToken);}
 assert.equal((await endpoint({...body,deviceId:`wrong-${deviceId}`})).body.code,'REQUEST_KEY_CONFLICT');
 check((await privileged.from('provisioning_jobs').update({lease_expires_at:new Date(Date.now()-1000).toISOString()}).eq('id',jobId)).error);
 const renewed=await endpoint();assert.equal(renewed.status,200);assert.equal(renewed.body.job.id,jobId);
 assert.notEqual(renewed.body.leaseToken,results[0].body.leaseToken);
 const provision={action:'provision',jobId,version:renewed.body.job.version,visitorUrl,leaseToken:renewed.body.leaseToken,status:'verified',protocolVersion:3};
 assert.equal((await endpoint(provision)).status,200);assert.equal((await endpoint(provision)).status,200);
 assert.equal((await endpoint()).body.code,'JOB_INELIGIBLE');
 const anonymous=await client(publicKey).from('write_preparations').select('*').eq('request_key',requestKey);
 assert.ok(anonymous.error||anonymous.data.length===0);
 console.log('PASS: owned synthetic cloud auth, replay, expiry, physical-report protocol and completed-key rejection. No NFC, audio, global pool or global maintenance used.');
} catch {
 failed=true;console.error('On-demand synthetic verification failed; sensitive diagnostics suppressed.');
} finally {
 if(privileged){
  for(const [table,column,id] of [['write_preparations','request_key',requestKey],['audit_log','tag_id',tagId],['provisioning_jobs','id',jobId],['label_history','tag_id',tagId],['tags','id',tagId]]) {
   if((await privileged.from(table).delete().eq(column,id)).error)failed=true;
  }
  if(userId&&(await privileged.auth.admin.deleteUser(userId)).error)failed=true;
  try {if(baseline)assert.deepEqual(await snapshot(),baseline);}catch{failed=true;console.error('Non-fixture snapshot changed or could not be verified.');}
 }
 if(failed)process.exitCode=1;
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Owner-run cloud DTO/privacy check. Never invokes worker/retry/provider or queues pending work.
const ref=process.argv[process.argv.indexOf('--project-ref')+1];
if(!process.argv.includes('--allow-remote-test')||!/^[a-z]{20}$/.test(ref??''))throw Error('Usage: node scripts/verify-transcription.mjs --project-ref <ref> --allow-remote-test');
const binary=process.env.SUPABASE_CLI_BIN;
const cli=(args)=>execFileSync(binary??'npx',binary?args:['--','supabase',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:90000});
const tagId=randomUUID(),uploadId=randomUUID(),recordingId=randomUUID(),token=randomBytes(24).toString('hex');
const path=`synthetic-transcription/${tagId}/${uploadId}.wav`;
let privileged,userId,operatorJwt,publicKey;const origin=`https://${ref}.supabase.co`;
const check=(error)=>{if(error)throw Error('Fixture operation failed');};
const endpoint=async(action,body={},jwt=operatorJwt)=>{
 const response=await fetch(`${origin}/functions/v1/admin-api`,{method:'POST',headers:{apikey:publicKey,'content-type':'application/json',...(jwt?{authorization:`Bearer ${jwt}`}:{})},body:JSON.stringify({action,recordingId,...body})});
 return {status:response.status,body:await response.json()};
};
const publicTag=async()=>{const r=await fetch(`${origin}/functions/v1/public-tag?token=${token}`,{headers:{apikey:publicKey}});return {status:r.status,body:await r.json()};};
let failed=false;
try{
 const keys=JSON.parse(cli(['projects','api-keys','--project-ref',ref,'-o','json']));
 publicKey=keys.find(k=>k.type==='publishable')?.api_key??keys.find(k=>k.name==='anon')?.api_key;
 const serviceKey=keys.find(k=>k.name==='service_role')?.api_key;
 assert.ok(publicKey&&serviceKey,'CLI credentials unavailable');
 const makeClient=(key)=>createClient(origin,key,{auth:{persistSession:false,autoRefreshToken:false}});
 privileged=makeClient(serviceKey);
 const email=`transcription-fixture-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url');
 const user=await privileged.auth.admin.createUser({email,password,email_confirm:true});check(user.error);userId=user.data.user.id;
 const login=await makeClient(publicKey).auth.signInWithPassword({email,password});check(login.error);operatorJwt=login.data.session.access_token;
 assert.equal((await endpoint('getTranscription')).status,403);
 check((await privileged.from('operator_profiles').insert({user_id:userId,role:'operator'})).error);
 assert.equal((await endpoint('getTranscription',{},null)).status,401);
 check((await privileged.from('tags').insert({id:tagId,label:`TRANSCRIPT-${tagId}`,inventory_label:`TRANSCRIPT-${tagId}`,public_token:token,status:'bound'})).error);
 check((await privileged.from('upload_sessions').insert({id:uploadId,tag_id:tagId,object_path:path,claim_token_hash:'synthetic-never-claim',mime_type:'audio/wav',size_bytes:44,expires_at:new Date().toISOString(),claimed_at:new Date().toISOString()})).error);
 check((await privileged.from('recordings').insert({id:recordingId,tag_id:tagId,upload_session_id:uploadId,object_path:path,nickname:'',mime_type:'audio/wav',size_bytes:44,duration_seconds:1})).error);
 assert.deepEqual((await endpoint('getTranscription')).body.transcription,null);
 assert.equal((await endpoint('saveTranscription',{version:1,text:'synthetic',published:false})).body.code,'TRANSCRIPTION_CONSENT_REQUIRED');
 // Only this owned fixture gets consent; insert READY, never pending, so cron cannot send it to AI.
 check((await privileged.from('recordings').update({transcription_consent:true}).eq('id',recordingId)).error);
 check((await privileged.from('recording_transcriptions').insert({recording_id:recordingId,status:'ready',text:'Synthetic manual draft',published:false})).error);
 assert.equal((await publicTag()).body.recording.transcript,null);
 assert.equal((await endpoint('saveTranscription',{version:1,text:'Synthetic <plain text> only',published:true})).status,200);
 assert.equal((await publicTag()).body.recording.transcript,'Synthetic <plain text> only');
 assert.equal((await endpoint('saveTranscription',{version:1,text:'stale',published:true})).body.code,'VERSION_CONFLICT');
 assert.equal((await endpoint('saveTranscription',{version:2,text:'Synthetic <plain text> only',published:false})).status,200);
 assert.equal((await publicTag()).body.recording.transcript,null);
 assert.equal((await endpoint('saveTranscription',{version:3,text:'Synthetic reviewed',published:true})).status,200);
 assert.equal((await endpoint('setEnabled',{tagId,enabled:false})).status,200);
 assert.equal((await publicTag()).body.recording,null);
 assert.equal((await endpoint('reset',{tagId})).status,200);
 assert.equal((await endpoint('getTranscription')).status,404);
 const remaining=await privileged.from('recording_transcriptions').select('recording_id').eq('recording_id',recordingId);check(remaining.error);assert.equal(remaining.data.length,0);
 const anonymous=await makeClient(publicKey).from('recording_transcriptions').select('*').limit(1);
 assert.ok(anonymous.error||anonymous.data.length===0);
 console.log('PASS: cloud auth, manual publish/hide, version, disabled and reset privacy; no AI calls or recognition-quality verification.');
}catch{
 failed=true;console.error('Transcription synthetic verification failed; sensitive diagnostics suppressed.');
}finally{
 if(privileged){
  // Never run global maintenance or touch any other card/audio. Leave a failure exit on incomplete cleanup.
  for(const [table,column,id] of [['recording_transcriptions','recording_id',recordingId],['recordings','id',recordingId],['storage_cleanup_queue','object_path',path],['audit_log','tag_id',tagId],['tags','id',tagId]]){
   const result=await privileged.from(table).delete().eq(column,id);if(result.error)failed=true;
  }
  if(userId&&(await privileged.auth.admin.deleteUser(userId)).error)failed=true;
 }
 if(failed)process.exitCode=1;
}

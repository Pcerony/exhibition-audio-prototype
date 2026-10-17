import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

const ref=process.argv[process.argv.indexOf('--project-ref')+1];
if(!process.argv.includes('--allow-remote-test')||!/^[a-z]{20}$/.test(ref??'')) throw Error('Pass --project-ref and --allow-remote-test for owned synthetic fixtures only');
const keys=JSON.parse(execFileSync('npx',['--','supabase','projects','api-keys','--project-ref',ref,'-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const publicKey=keys.find(k=>k.type==='publishable')?.api_key??keys.find(k=>k.name==='anon')?.api_key;
const secret=keys.find(k=>k.name==='service_role')?.api_key;assert.ok(publicKey&&secret);
const origin=`https://${ref}.supabase.co`,client=key=>createClient(origin,key,{auth:{persistSession:false,autoRefreshToken:false}});
const privileged=client(secret),requestKey=randomUUID();
let userId,tagId,jwt,path,failed=false,stage='fixture account';
const check=error=>{if(error)throw Error('FIXTURE_FAILED');};
const endpoint=async(name,body,bearer)=>{
 const response=await fetch(`${origin}/functions/v1/${name}`,{method:'POST',headers:{apikey:publicKey,'content-type':'application/json',...(bearer?{authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
};
const admin=(body,bearer=jwt)=>endpoint('admin-api',body,bearer);
try {
 const email=`qr-attachment-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url');
 const user=await privileged.auth.admin.createUser({email,password,email_confirm:true});check(user.error);userId=user.data.user.id;
 const login=await client(publicKey).auth.signInWithPassword({email,password});check(login.error);jwt=login.data.session.access_token;
 assert.equal((await admin({action:'qrCards'},null)).status,401);
 assert.equal((await admin({action:'qrCards'})).status,403);
 check((await privileged.from('operator_profiles').insert({user_id:userId,role:'operator'})).error);
 stage='QR issue and anonymous recording';
 const qr=await admin({action:'createQrEntry',requestKey});assert.equal(qr.status,200);tagId=qr.body.id;
 const token=qr.body.visitorUrl.split('/').at(-1);assert.match(token,/^[a-f0-9]{48}$/);
 const audio=new Uint8Array(3244),view=new DataView(audio.buffer);
 const text=(offset,s)=>[...s].forEach((c,i)=>audio[offset+i]=c.charCodeAt(0));
 text(0,'RIFF');view.setUint32(4,audio.length-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,audio.length-44,true);
 const init=await endpoint('public-upload-init',{token,mimeType:'audio/wav',sizeBytes:audio.length});assert.equal(init.status,201);path=init.body.path;
 check((await client(publicKey).storage.from('recordings').uploadToSignedUrl(path,init.body.storageToken,audio,{contentType:'audio/wav'})).error);
 const claim=await fetch(`${origin}/functions/v1/public-upload-claim`,{method:'POST',headers:{apikey:publicKey,'content-type':'application/json','x-upload-token':init.body.claimToken},body:JSON.stringify({uploadId:init.body.uploadId,durationSeconds:1,nickname:'',categoryCode:'D',transcriptionConsent:false})});
 assert.equal(claim.status,200);
 const cards=await admin({action:'qrCards',search:tagId});assert.equal(cards.status,200);assert.equal(cards.body.total,1);
 const card=cards.body.tags[0];assert.ok(card.recording.id);assert.equal(card.provisioning,null);
 const original=JSON.stringify({label:card.label,recording:card.recording.id,version:card.version});
 stage='same identity, lease, chip pin and report';
 const prepare={action:'prepareQrAttachment',tagId,expectedVersion:card.version,deviceId:'synthetic-qr-writer',protocolVersion:3};
 const leases=await Promise.all(Array.from({length:4},()=>admin(prepare)));
 assert.ok(leases.every(x=>x.status===200&&x.body.job.id===leases[0].body.job.id&&x.body.leaseToken===leases[0].body.leaseToken));
 const lease=leases[0].body;assert.equal(lease.job.visitorUrl,qr.body.visitorUrl);assert.match(lease.expiresAt,/\.\d{3}Z$/);
 const chipHash=createHash('sha256').update(randomBytes(16)).digest('hex');
 const begin={action:'beginQrAttachment',jobId:lease.job.id,leaseToken:lease.leaseToken,chipHash,protocolVersion:3};
 assert.equal((await admin(begin)).status,200);
 assert.equal((await admin({...begin,chipHash:'f'.repeat(64)})).body.code,'CHIP_CONFLICT');
 check((await privileged.from('qr_card_attachments').update({lease_expires_at:new Date(Date.now()-1000).toISOString()}).eq('id',lease.job.id)).error);
 const report={action:'provisionQrAttachment',jobId:lease.job.id,leaseToken:lease.leaseToken,version:lease.job.version,visitorUrl:qr.body.visitorUrl,status:'verified',protocolVersion:3};
 assert.equal((await admin(report)).status,200);assert.equal((await admin(report)).status,200);
 assert.equal((await admin(prepare)).body.code,'JOB_INELIGIBLE');
 const after=(await admin({action:'qrCards',search:tagId})).body.tags[0];
 assert.equal(JSON.stringify({label:after.label,recording:after.recording.id,version:after.version}),original);
 assert.equal(after.attachment.status,'verified');
 stage='independent visitor playback and privacy';
 const playback=await endpoint('public-playback-url',{token});assert.equal(playback.status,200);
 const downloaded=await fetch(playback.body.url);assert.equal(downloaded.status,200);assert.equal((await downloaded.arrayBuffer()).byteLength,audio.length);
 for(const table of ['qr_card_attachments','qr_attachment_leases']) {const r=await client(publicKey).from(table).select('*');assert.ok(r.error||r.data.length===0);}
 console.log('PASS: owned QR issuance, anonymous upload/claim, concurrent preparation, immutable chip, first late report, stable identity/recording and independent private-audio playback. Synthetic protocol only; no physical NFC or AI provider used.');
} catch {failed=true;console.error(`QR attachment verification failed at ${stage}; sensitive diagnostics suppressed.`);}
finally {
 if(tagId) {
  for(const [table,column,value] of [['qr_card_attachments','tag_id',tagId],['recordings','tag_id',tagId],['upload_sessions','tag_id',tagId],['audit_log','tag_id',tagId],['label_history','tag_id',tagId],['tags','id',tagId]]) if((await privileged.from(table).delete().eq(column,value)).error)failed=true;
 }
 if(path) {if((await privileged.storage.from('recordings').remove([path])).error)failed=true;if((await privileged.from('storage_cleanup_queue').delete().eq('object_path',path)).error)failed=true;}
 if((await privileged.from('management_requests').delete().eq('request_key',requestKey)).error)failed=true;
 if(userId&&(await privileged.auth.admin.deleteUser(userId)).error)failed=true;
 console.log(failed?'FAIL: check owned fixture cleanup before retrying.':'PASS: owned synthetic fixtures cleaned; no existing participant recordings modified.');
}
if(failed)process.exitCode=1;

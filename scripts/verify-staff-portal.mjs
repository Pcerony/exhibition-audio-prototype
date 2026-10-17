import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

const ref=process.argv[process.argv.indexOf('--project-ref')+1];
const handoff=process.env.STAFF_CREDENTIALS_FILE;
if(!process.argv.includes('--allow-remote-test')||!/^[a-z]{20}$/.test(ref??'')||!handoff)
 throw Error('Set STAFF_CREDENTIALS_FILE and pass --project-ref <ref> --allow-remote-test');
const tagId=randomUUID(),recordingId=randomUUID(),uploadId=randomUUID(),token=randomBytes(24).toString('hex');
const path=`synthetic-staff/${tagId}/${uploadId}.wav`;
const keys=JSON.parse(execFileSync('npx',['--','supabase','projects','api-keys','--project-ref',ref,'-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const publicKey=keys.find(k=>k.name==='anon').api_key,serviceKey=keys.find(k=>k.name==='service_role').api_key;
const origin=`https://${ref}.supabase.co`,options={auth:{persistSession:false,autoRefreshToken:false}};
const privileged=createClient(origin,serviceKey,options),account=createClient(origin,publicKey,options);
let jwt,failed=false,stage='login';
const check=error=>{if(error)throw Error('FIXTURE_OPERATION_FAILED');};
const endpoint=async(name,body,bearer=jwt)=>{
 const response=await fetch(`${origin}/functions/v1/${name}`,{method:'POST',headers:{apikey:publicKey,'content-type':'application/json',...(bearer?{authorization:`Bearer ${bearer}`}:{})},body:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
};
const publicCard=async()=>{
 const r=await fetch(`${origin}/functions/v1/public-tag?token=${token}`,{headers:{apikey:publicKey}});
 return r.json();
};
try {
 const password=readFileSync(handoff,'utf8').match(/^密码：(.+)$/m)?.[1];assert.ok(password);
 const login=await account.auth.signInWithPassword({email:'staff-portal@staff.invalid',password});check(login.error);jwt=login.data.session.access_token;
 stage='authorization';
 const session=await endpoint('staff-api',{action:'session'});assert.equal(session.status,200);assert.equal(session.body.role,'staff');assert.equal(session.body.members.length,8);
 assert.equal((await endpoint('staff-api',{action:'list'},null)).status,401);
 assert.equal((await endpoint('admin-api',{action:'session'})).status,403);
 assert.equal((await endpoint('admin-api',{action:'createCards',count:1,requestKey:randomUUID(),protocolVersion:3})).status,403);
 assert.equal((await endpoint('staff-api',{action:'reset',tagId})).status,400);
 stage='synthetic fixture';
 check((await privileged.from('tags').insert({id:tagId,label:`STAFF-TEST-${tagId}`,inventory_label:`STAFF-TEST-${tagId}`,public_token:token,status:'bound'})).error);
 const audio=new Uint8Array(3244),view=new DataView(audio.buffer);
 const text=(offset,value)=>[...value].forEach((c,i)=>audio[offset+i]=c.charCodeAt(0));
 text(0,'RIFF');view.setUint32(4,audio.length-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,audio.length-44,true);
 check((await privileged.storage.from('recordings').upload(path,audio,{contentType:'audio/wav'})).error);
 check((await privileged.from('upload_sessions').insert({id:uploadId,tag_id:tagId,object_path:path,claim_token_hash:'synthetic-never-claim',mime_type:'audio/wav',size_bytes:audio.length,expires_at:new Date().toISOString(),claimed_at:new Date().toISOString()})).error);
 check((await privileged.from('recordings').insert({id:recordingId,tag_id:tagId,upload_session_id:uploadId,object_path:path,nickname:'',mime_type:'audio/wav',size_bytes:audio.length,duration_seconds:1,location:{source:'pin',lat:33.59,lng:130.4}})).error);
 // Insert READY only after enabling this owned fixture; never enqueue an AI request.
 check((await privileged.from('recordings').update({transcription_consent:true}).eq('id',recordingId)).error);
 check((await privileged.from('recording_transcriptions').insert({recording_id:recordingId,status:'ready',text:'Synthetic staff review draft',published:false})).error);
 stage='private draft and list';
 assert.equal((await publicCard()).recording.transcript,null);
 const list=await endpoint('staff-api',{action:'list',tagId});assert.equal(list.status,200);assert.equal(list.body.total,1);assert.equal(list.body.cards[0].recording.transcription.text,'Synthetic staff review draft');
 assert.equal(list.body.cards[0].recording.pieceAssignment.state,'pending');
 assert.ok(!JSON.stringify(list.body).includes(path));
 const memberId=session.body.members[0].id;
 const playback=await endpoint('staff-api',{action:'playback',recordingId,memberId});assert.equal(playback.status,200);assert.ok(playback.body.url);assert.equal((await fetch(playback.body.url)).status,200);
 assert.equal((await endpoint('staff-api',{action:'activity',recordingId,memberId,event:'location_viewed'})).status,200);
 stage='concurrent review';
 const edit={action:'save',recordingId,memberId,version:1,text:'Synthetic approved text',published:true};
 const results=await Promise.all([endpoint('staff-api',edit),endpoint('staff-api',{...edit,memberId:session.body.members[1].id})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await publicCard()).recording.transcript,'Synthetic approved text');
 assert.equal((await endpoint('staff-api',{...edit,version:2,published:false})).status,200);assert.equal((await publicCard()).recording.transcript,null);
 const history=await endpoint('staff-api',{action:'history',tagId});assert.equal(history.status,200);assert.equal(history.body.entries.filter(e=>e.action==='staff_approve').length,1);assert.ok(history.body.entries.every(e=>e.memberName));
 stage='direct table privacy';
 const direct=await account.from('recording_transcriptions').select('recording_id').eq('recording_id',recordingId);assert.ok(direct.error||direct.data.length===0);
 console.log('PASS: real shared staff login, 8 members, anonymous/admin denial, private draft, signed synthetic audio, location audit, concurrent review conflict, publish/hide and history. No participant recording edited or AI provider called.');
}catch {failed=true;console.error(`Staff cloud verification failed at ${stage}; sensitive diagnostics suppressed.`);}
finally {
 for(const [table,column,id] of [['recording_transcriptions','recording_id',recordingId],['recording_piece_assignments','recording_id',recordingId],['recordings','id',recordingId],['upload_sessions','id',uploadId],['storage_cleanup_queue','object_path',path],['audit_log','tag_id',tagId],['tags','id',tagId]]){
  if((await privileged.from(table).delete().eq(column,id)).error)failed=true;
 }
 if((await privileged.storage.from('recordings').remove([path])).error)failed=true;
 await account.auth.signOut({scope:'local'});
 if(failed)process.exitCode=1;
}

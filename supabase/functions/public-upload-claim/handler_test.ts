import { createHandler } from './handler.ts';
import { sha256 } from '../_shared/http.ts';
const request = (categoryCode?: unknown) => new Request('https://example.invalid', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({categoryCode})});
Deno.test('claim requires a valid fixed category before touching cloud state', async () => {
 let calls=0;const handle=createHandler(()=>{calls++;throw new Error('must not touch cloud');});
 for (const value of [undefined,null,'']) {
  const response=await handle(request(value));
  if(response.status!==400 || (await response.json()).code!=='CATEGORY_REQUIRED') throw new Error('missing category accepted');
 }
 for (const value of ['E','a',1,{}]) {
  const response=await handle(request(value));
  if(response.status!==400 || (await response.json()).code!=='CATEGORY_INVALID') throw new Error('invalid category accepted');
 }
 if(calls!==0) throw new Error('invalid request accessed cloud');
});
Deno.test('claim refuses non-boolean AI consent before touching cloud', async () => {
 const handle=createHandler(()=>{throw new Error('must not access cloud');});
 for(const transcriptionConsent of [null,0,1,'true',{},[]]){
  const response=await handle(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({categoryCode:'A',transcriptionConsent})}));
  if(response.status!==400 || (await response.json()).code!=='REQUEST_INVALID')throw Error('invalid consent accepted');
 }
});

Deno.test('claim remains successful when post-claim map assignment persistence fails and sends no coordinates to SQL', async () => {
 const token='synthetic-claim-token';
 const calls: Array<{name:string;args:Record<string,unknown>}> = [];
 const client={
  from(table:string){
   if(table!=='upload_sessions')throw Error('unexpected table');
   return {select(){return {eq(){return {maybeSingle:async()=>({data:{
    object_path:'synthetic/object',mime_type:'audio/wav',size_bytes:10,expires_at:new Date(Date.now()+60000).toISOString(),
    claimed_at:null,claim_token_hash:await sha256(token),invalidated_at:null,
   },error:null})}}}}};
  },
  storage:{from(){return {info:async()=>({data:{contentType:'audio/wav',size:10},error:null})}}},
  rpc(name:string,args:Record<string,unknown>){
   calls.push({name,args});
   if(name==='claim_recording_transcription')return {maybeSingle:async()=>({data:{claim_status:'claimed',recording_id:'40000000-0000-4000-8000-000000000001',recording_created_at:'2026-10-17T01:00:00Z'},error:null})};
   if(name==='save_automatic_piece_assignment')return Promise.resolve({data:null,error:new Error('synthetic map database failure')});
   throw Error(`unexpected RPC: ${name}`);
  },
 };
 const handle=createHandler(()=>client as never);
 const response=await handle(new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json','x-upload-token':token},body:JSON.stringify({
  uploadId:'30000000-0000-4000-8000-000000000001',nickname:'',durationSeconds:1,categoryCode:'A',transcriptionConsent:false,
  location:{source:'place',placeId:'synthetic-place'},mapPoint:{lat:33.5946138544,lng:130.4063520063},
 })}));
 const result=await response.json();
 if(response.status!==200 || result.status!=='claimed')throw Error('map assignment failure changed a successful claim');
 const claim=calls.find(call=>call.name==='claim_recording_transcription');
 if(!claim || JSON.stringify(claim.args.p_location)!==JSON.stringify({source:'place',placeId:'synthetic-place'}))throw Error('transient place coordinates altered saved location');
 const assignment=calls.find(call=>call.name==='save_automatic_piece_assignment');
 if(!assignment || assignment.args.p_recording_id!=='40000000-0000-4000-8000-000000000001'
  || assignment.args.p_state!=='assigned' || assignment.args.p_piece_code!=='B4'
  || assignment.args.p_map_version!=='fukuoka-road-73-v13')throw Error('map result was not persisted as minimal metadata');
 if(JSON.stringify(assignment.args).includes('33.5946138544') || JSON.stringify(assignment.args).includes('130.4063520063'))throw Error('coordinates were sent to assignment RPC');
});

Deno.test('missing or invalid optional map coordinates become review metadata without rejecting claim', async () => {
 const token='synthetic-claim-token';
 const calls: Array<{name:string;args:Record<string,unknown>}> = [];
 const client={
  from(){return {select(){return {eq(){return {maybeSingle:async()=>({data:{object_path:'synthetic/object',mime_type:'audio/wav',size_bytes:10,
   expires_at:new Date(Date.now()+60000).toISOString(),claimed_at:null,claim_token_hash:await sha256(token),invalidated_at:null},error:null})}}}}}},
  storage:{from(){return {info:async()=>({data:{contentType:'audio/wav',size:10},error:null})}}},
  rpc(name:string,args:Record<string,unknown>){
   calls.push({name,args});
   if(name==='claim_recording_transcription')return {maybeSingle:async()=>({data:{claim_status:'claimed',recording_id:'40000000-0000-4000-8000-000000000001',recording_created_at:'2026-10-17T01:00:00Z'},error:null})};
   if(name==='save_automatic_piece_assignment')return Promise.resolve({data:null,error:null});
   throw Error(`unexpected RPC: ${name}`);
  },
 };
 const handle=createHandler(()=>client as never);
 const response=await handle(new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/json','x-upload-token':token},body:JSON.stringify({
  uploadId:'30000000-0000-4000-8000-000000000001',durationSeconds:1,categoryCode:'A',mapPoint:{lat:'invalid',lng:130.4},
 })}));
 if(response.status!==200 || (await response.json()).status!=='claimed')throw Error('optional map point blocked claim');
 const assignment=calls.find(call=>call.name==='save_automatic_piece_assignment');
 if(assignment?.args.p_state!=='needs_review' || assignment.args.p_piece_code!==null)throw Error('invalid point was not marked for review');
});

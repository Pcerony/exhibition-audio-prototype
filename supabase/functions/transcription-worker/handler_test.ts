import { createHandler } from './handler.ts';

function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
Deno.test('worker fails closed before leasing when unauthenticated or unconfigured', async () => {
 let called = false;
 const handler = createHandler(() => { called = true; throw Error('should not connect'); }, (name) => name === 'MAINTENANCE_SECRET' ? 'secret' : undefined);
 assert((await handler(new Request('https://local', {method:'POST'}))).status === 401);
 assert((await handler(new Request('https://local', {method:'POST',headers:{'x-maintenance-secret':'secret'}}))).status === 503);
 assert(!called);
});
Deno.test('worker sends multipart private bytes only to fixed endpoint and returns no text', async () => {
 const rpcCalls: Array<{name:string;args:unknown}> = [];
 const client = {
  rpc(name:string,args:unknown) { rpcCalls.push({name,args}); return Promise.resolve({data:name==='claim_transcription'?{recordingId:'id',objectPath:'private/path',mimeType:'audio/wav',sizeBytes:4,leaseToken:'lease',version:1}:true,error:null}); },
  storage:{from:()=>({download:()=>Promise.resolve({data:new Blob(['wave'],{type:'audio/wav'}),error:null})})},
 };
 const handler=createHandler(()=>client as never,()=> 'secret',async(input,init)=>{
  assert(input==='https://api.groq.com/openai/v1/audio/transcriptions');
  assert(init?.redirect==='error');
  const form=init?.body as FormData;
  assert(form.get('model')==='whisper-large-v3-turbo');assert(form.get('language')==='ja');assert(form.get('file') instanceof File);assert(!String(form).includes('private/path'));
  return Response.json({text:'Private transcript'});
 });
 const response=await handler(new Request('https://local',{method:'POST',headers:{'x-maintenance-secret':'secret'}}));
 assert(response.ok);assert(!(await response.text()).includes('Private transcript'));
 const finish=rpcCalls.find(c=>c.name==='finish_transcription')?.args as Record<string,unknown>;
 assert(finish.p_text==='Private transcript');
});
Deno.test('worker constrains original-language transcription and omits language for auto', async () => {
 for (const languageHint of ['ja','zh','en','ko','es','fr','de','it','pt','ru','vi','th','id','ar','hi','auto']) {
  let sentLanguage:FormDataEntryValue|null|undefined;
  const client={rpc:(name:string)=>Promise.resolve({data:name==='claim_transcription'?{recordingId:'id',objectPath:'private',mimeType:'audio/wav',sizeBytes:4,leaseToken:'lease',version:1,languageHint}:true,error:null}),storage:{from:()=>({download:()=>Promise.resolve({data:new Blob(['wave']),error:null})})}};
  const handler=createHandler(()=>client as never,()=> 'secret',async(input,init)=>{
   assert(input==='https://api.groq.com/openai/v1/audio/transcriptions');
   sentLanguage=(init?.body as FormData).get('language');
   return Response.json({text:'Original language'});
  });
  assert((await handler(new Request('https://local',{method:'POST',headers:{'x-maintenance-secret':'secret'}}))).ok);
  assert(sentLanguage===(languageHint==='auto'?null:languageHint));
 }
});
Deno.test('worker sanitizes provider errors and respects Retry-After without leaking response', async () => {
 let result:Record<string,unknown>={};
 const client={rpc:(name:string,args:Record<string,unknown>)=>{if(name==='finish_transcription')result=args;return Promise.resolve({data:name==='claim_transcription'?{recordingId:'id',objectPath:'secret',mimeType:'audio/wav',sizeBytes:4,leaseToken:'lease',version:1}:true,error:null});},storage:{from:()=>({download:()=>Promise.resolve({data:new Blob(['wave']),error:null})})}};
 const handler=createHandler(()=>client as never,()=> 'secret',async()=>new Response('secret provider diagnostic',{status:429,headers:{'retry-after':'120'}}));
 const response=await handler(new Request('https://local',{method:'POST',headers:{'x-maintenance-secret':'secret'}}));
 assert(response.ok);assert(result.p_error_code==='PROVIDER_RATE_LIMITED');assert(result.p_retry_seconds===120);assert(result.p_text===null);
});
Deno.test('worker rejects oversized audio before provider and bounds untrusted response text',async()=>{
 for(const [size,text,expected] of [[11*1024*1024,'unused','AUDIO_TOO_LARGE'],[4,'x'.repeat(10001),'RESULT_INVALID']] as const){
  let result:Record<string,unknown>={};let providerCalls=0;
  const client={rpc:(name:string,args:Record<string,unknown>)=>{if(name==='finish_transcription')result=args;return Promise.resolve({data:name==='claim_transcription'?{recordingId:'id',objectPath:'private',mimeType:'audio/wav',sizeBytes:size,leaseToken:'lease',version:1}:true,error:null});},storage:{from:()=>({download:()=>Promise.resolve({data:new Blob(['wave']),error:null})})}};
  const handler=createHandler(()=>client as never,()=> 'secret',async()=>{providerCalls++;return Response.json({text});});
  const response=await handler(new Request('https://local',{method:'POST',headers:{'x-maintenance-secret':'secret'}}));
  assert(response.ok);assert(result.p_error_code===expected);assert(result.p_text===null);assert(providerCalls===(expected==='AUDIO_TOO_LARGE'?0:1));
 }
});

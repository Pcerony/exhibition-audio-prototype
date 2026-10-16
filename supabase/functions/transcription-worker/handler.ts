import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json, sha256 } from '../_shared/http.ts';

const MAX_AUDIO = 10 * 1024 * 1024;
const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
type Task = {recordingId:string;objectPath:string;mimeType:string;sizeBytes:number;leaseToken:string;version:number};

export function createHandler(getClient:()=>SupabaseClient, env:(name:string)=>string|undefined = (name)=>Deno.env.get(name), providerFetch:typeof fetch = fetch) {
 return async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
  const expected=env('MAINTENANCE_SECRET');const supplied=request.headers.get('x-maintenance-secret');
  if(!expected||!supplied||await sha256(expected)!==await sha256(supplied))return json({code:'AUTH_REQUIRED'},401);
  const key=env('GROQ_API_KEY');
  if(!key)return json({code:'TRANSCRIPTION_NOT_CONFIGURED'},503);
  try {
   const client=getClient();
   const {data,error}=await client.rpc('claim_transcription');
   if(error)return json({code:'TRANSCRIPTION_UNAVAILABLE'},503);
   const task=data as Task|null;
   if(!task)return json({processed:0});
   let text:string|null=null;let code:string|null=null;let retrySeconds=0;
   const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),45000);
   try {
    if(task.sizeBytes>MAX_AUDIO)code='AUDIO_TOO_LARGE';
    else {
     // Download server-side; never hand a storage URL or object path to the provider.
     const {data:audio,error:downloadError}=await client.storage.from('recordings').download(task.objectPath,{}, {signal:controller.signal});
     if(downloadError||!audio)code='AUDIO_UNAVAILABLE';
     else if(audio.size>MAX_AUDIO)code='AUDIO_TOO_LARGE';
     else {
      const extensions:Record<string,string>={'audio/wav':'wav','audio/webm':'webm','audio/mp4':'m4a','audio/ogg':'ogg','audio/aac':'aac'};
      const form=new FormData();form.set('model','whisper-large-v3-turbo');form.set('response_format','json');
      form.set('file',new Blob([audio],{type:task.mimeType}),`recording.${extensions[task.mimeType]??'wav'}`);
      const response=await providerFetch(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form,signal:controller.signal,redirect:'error'});
      if(!response.ok){
       code=response.status===429?'PROVIDER_RATE_LIMITED':response.status>=500?'PROVIDER_UNAVAILABLE':'PROVIDER_REJECTED';
       const retry=response.headers.get('retry-after');
       if(retry){const seconds=/^\d+$/.test(retry)?Number(retry):Math.ceil((Date.parse(retry)-Date.now())/1000);if(Number.isFinite(seconds))retrySeconds=Math.min(86400,Math.max(0,seconds));}
       await response.body?.cancel();
      }else{
       // Bound response bytes before parsing; provider responses are untrusted too.
       const reader=response.body?.getReader();let raw='';let bytes=0;
       if(reader){const decoder=new TextDecoder();while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>100000){await reader.cancel();code='RESULT_INVALID';break;}raw+=decoder.decode(chunk.value,{stream:true});}raw+=decoder.decode();}
       if(!code){try{const value=JSON.parse(raw);if(typeof value.text!=='string'||Array.from(value.text).length>10000)code='RESULT_INVALID';else text=value.text;}catch{code='RESULT_INVALID';}}
      }
     }
    }
   }catch{code=controller.signal.aborted?'TRANSCRIPTION_TIMEOUT':'PROVIDER_UNAVAILABLE';}
   finally{clearTimeout(timeout);}
   const {data:accepted,error:finishError}=await client.rpc('finish_transcription',{p_recording_id:task.recordingId,p_lease_token:task.leaseToken,p_version:task.version,p_text:text,p_error_code:code,p_retry_seconds:retrySeconds});
   if(finishError)return json({code:'TRANSCRIPTION_UNAVAILABLE'},503);
   return json({processed:1,accepted:accepted===true});
  }catch{return json({code:'TRANSCRIPTION_UNAVAILABLE'},503);}
 };
}

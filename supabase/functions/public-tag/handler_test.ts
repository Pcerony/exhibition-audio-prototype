import { createHandler } from './handler.ts';
function assert(value:unknown):asserts value{if(!value)throw Error('assertion failed');}
const token='e'.repeat(48);
function fixture(status='bound',consented=true,published=true,ready=true,failText=false){
 const filters:Record<string,unknown>={};let transcriptReads=0;
 const recording={id:'recording',transcription_consent:consented,nickname:'',duration_seconds:1,created_at:'2026-10-17',location:null};
 const query={select:()=>query,eq:(field:string,value:unknown)=>{filters[field]=value;return query;},is:()=>query,maybeSingle:async()=>({data:{id:'tag',status,recordings:[recording],memory_topics:[]},error:null})};
 const transcript={select:()=>transcript,eq:(field:string,value:unknown)=>{filters[field]=value;return transcript;},maybeSingle:async()=>{transcriptReads++;return {data:published&&ready?{text:'Reviewed <plain text>'}:null,error:failText?{}:null};}};
 const client={from:(table:string)=>table==='tags'?query:transcript};
 return {handler:createHandler(()=>client as never),filters,get reads(){return transcriptReads;}};
}
Deno.test('public text exposes only consented ready published text and filters every read',async()=>{
 const f=fixture();const response=await f.handler(new Request(`https://local/?token=${token}`));
 const body=await response.json();assert(body.recording.transcript==='Reviewed <plain text>');assert(f.filters.status==='ready'&&f.filters.published===true);
 for(const [published,ready] of [[false,true],[true,false]]){
  const body=await (await fixture('bound',true,published,ready).handler(new Request(`https://local/?token=${token}`))).json();assert(body.recording.transcript===null);
 }
});
Deno.test('optional text lookup failure preserves audio metadata without exposing text',async()=>{
 const response=await fixture('bound',true,true,true,true).handler(new Request(`https://local/?token=${token}`));
 assert(response.ok);const body=await response.json();assert(body.recording.id==='recording');assert(body.recording.transcript===null);
});
Deno.test('disabled and unconsented recordings never read text; disabled returns no recording',async()=>{
 for(const [status,consented] of [['disabled',true],['bound',false]] as const){
  const f=fixture(status,consented);const body=await (await f.handler(new Request(`https://local/?token=${token}`))).json();assert(f.reads===0);if(status==='disabled')assert(body.recording===null);else assert(body.recording.transcript===null);
 }
});

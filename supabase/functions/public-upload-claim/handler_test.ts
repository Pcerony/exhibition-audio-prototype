import { createHandler } from './handler.ts';
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

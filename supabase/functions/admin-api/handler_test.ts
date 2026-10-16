import { createHandler } from './handler.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
const id = '00000000-0000-4000-8000-000000000001';
Deno.test('lease responses use UTC Z timestamps compatible with older Android Instant.parse', async () => {
  for (const action of ['leaseJob', 'nextJob']) {
    for (const expiresAt of ['2026-10-16T01:11:25.65647+00:00', '2026-10-16T10:11:25.65647+09:00', '2026-10-16T01:11:25.656Z']) {
      const data = { job: { id }, leaseToken: 'synthetic-token', expiresAt };
      const response = await fixture('operator', true, data).handler(request({ action }));
      equal(response.status, 200);
      equal(await response.json(), { ...data, expiresAt: '2026-10-16T01:11:25.656Z' });
    }
  }
});
Deno.test('invalid lease expiry fails closed and empty queues stay empty', async () => {
  for (const action of ['leaseJob', 'nextJob']) {
    for (const expiresAt of [null, undefined, '', 'invalid', 123]) {
      const response = await fixture('operator', true, { job: { id }, expiresAt }).handler(request({ action }));
      equal(response.status, 503);
      equal(await response.json(), { code: 'SERVICE_UNAVAILABLE' });
    }
    const response = await fixture('operator', true, { job: null }).handler(request({ action }));
    equal(response.status, 200);
    equal(await response.json(), { job: null });
  }
});
Deno.test('v2 management actions pass through and version conflicts are stable', async () => {
  for (const action of ['categories','createCategory','renameCategory','createCards','bulkPreview','bulkApply','leaseJob','nextJob','releaseJob']) {
    equal((await fixture().handler(request({ action }))).status, 200);
  }
  const f = fixture('operator', true, null, { code: 'P0001', message: 'VERSION_CONFLICT private detail' });
  const response = await f.handler(request({ action: 'bulkApply' }));
  equal(response.status,409); equal(await response.json(),{code:'VERSION_CONFLICT'});
});
Deno.test('v2 errors do not leak database details and category identities are UUIDs', async () => {
  for (const [code,status] of Object.entries({CATEGORY_NOT_FOUND:404,CATEGORY_NAME_EXISTS:409,VERSION_CONFLICT:409,GROUP_CONFLICT:409,LEASE_CONFLICT:409,LEASE_EXPIRED:409,CLIENT_UPGRADE_REQUIRED:426,JOB_INELIGIBLE:409})) {
    const response=await fixture('operator',true,null,{code:'P0001',message:code+' internal detail'}).handler(request({action:'nextJob'}));
    equal(response.status,status);equal(await response.json(),{code});
  }
  const f=fixture();equal((await f.handler(request({action:'createCards',categoryId:'not-a-uuid'}))).status,400);equal(f.calls,[]);
});
function fixture(role: string | null = 'operator', valid = true, rpcData: unknown = { ok: true }, rpcError: { code: string; message: string } | null = null, configured = false) {
  const calls: unknown[] = [];
  const client = {
    auth: { getUser: async (token: string) => ({ data: { user: valid && token === 'valid-jwt' ? { id } : null }, error: valid ? null : {} }) },
    from: (table: string) => ({ select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null, error: null }) }),
      in: async (_field: string, ids: string[]) => ({ data: ids.map((id) => ({ id, location: { source: 'place', placeId: 'synthetic-place' } })), error: null }),
    }) }),
    rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: rpcData, error: rpcError }; },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://example.invalid/audio' }, error: null }) }) },
  };
  return { handler: createHandler(() => client as never, () => configured), calls };
}
Deno.test('unconfigured transcription retry does not call database and get reports configuration truthfully',async()=>{
 const f=fixture();
 const response=await f.handler(request({action:'retryTranscription',recordingId:id,version:1}));
 equal(response.status,503);equal(await response.json(),{code:'TRANSCRIPTION_NOT_CONFIGURED'});equal(f.calls,[]);
 const get=await fixture('operator',true,{consented:false,transcription:null}).handler(request({action:'getTranscription',recordingId:id}));
 equal(await get.json(),{consented:false,transcription:null,configured:false});
 equal((await fixture(null).handler(request({action:'getTranscription',recordingId:id}))).status,403);
 for(const [code,status] of Object.entries({TRANSCRIPTION_NOT_FOUND:404,TRANSCRIPTION_CONSENT_REQUIRED:409,TRANSCRIPTION_RATE_LIMITED:429})){
  const response=await fixture('operator',true,null,{code:'P0001',message:code+' sensitive details'},true).handler(request({action:'retryTranscription',recordingId:id,version:1}));
  equal(response.status,status);equal(await response.json(),{code});
 }
});
Deno.test('transcription save validates plain text, publication and integer version before RPC',async()=>{
 for(const fields of [
  {text:'\n\t\r',published:true,version:1},
  {text:' \u3000\u00a0 ',published:true,version:1},
  {text:'x'.repeat(10001),published:false,version:1},
  {text:null,published:false,version:1},
  {text:'text',published:'true',version:1},
  {text:'text',published:true,version:1.5},
  {text:'text',published:true,version:0},
  {text:'text',published:true,version:'1'},
 ]){
  const f=fixture();const response=await f.handler(request({action:'saveTranscription',recordingId:id,...fields}));
  equal(response.status,400);equal(await response.json(),{code:'REQUEST_INVALID'});equal(f.calls,[]);
 }
 for(const text of ['\n\t',String.fromCodePoint(0x1f600).repeat(10000)]){
  const f=fixture();equal((await f.handler(request({action:'saveTranscription',recordingId:id,version:1,text,published:false}))).status,200);equal(f.calls.length,1);
 }
});
Deno.test('authenticated list includes recording location without exposing object paths', async () => {
  const response = await fixture('operator', true, { tags: [{ recording: { id, nickname: '' } }], total: 1 }).handler(request({ action: 'list' }));
  equal(response.status, 200);
  const body = await response.json();
  equal(body.tags[0].recording.location, { source: 'place', placeId: 'synthetic-place' });
});
function request(body: unknown, token = 'valid-jwt') {
  return new Request('https://example.invalid/admin-api', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
Deno.test('anonymous and forged JWT requests cannot invoke privileged RPC', async () => {
  const f = fixture('operator', false);
  equal((await f.handler(request({ action: 'reset', tagId: id }, 'forged'))).status, 401);
  equal(f.calls, []);
});
Deno.test('valid Auth identity without allowlist is forbidden', async () => {
  const f = fixture(null);
  equal((await f.handler(request({ action: 'list' }))).status, 403);
  equal(f.calls, []);
});
Deno.test('authenticated operator invokes RPC using verified identity, not payload identity', async () => {
  const f = fixture();
  equal((await f.handler(request({ action: 'reset', tagId: id, userId: 'forged' }))).status, 200);
  equal((f.calls[0] as { args: { p_operator: string } }).args.p_operator, id);
});
Deno.test('unknown action and malformed JSON are rejected without RPC', async () => {
  const f = fixture();
  equal((await f.handler(request({ action: 'dropDatabase' }))).status, 400);
  equal((await f.handler(new Request('https://example.invalid', { method: 'POST', headers: { Authorization: 'Bearer valid-jwt' }, body: '{' }))).status, 400);
  equal(f.calls, []);
});
Deno.test('unsupported allowlist role cannot invoke privileged RPC', async () => {
  const f = fixture('visitor');
  equal((await f.handler(request({ action: 'list' }))).status, 403);
  equal(f.calls, []);
});
Deno.test('admin playback exposes a short-lived signed URL, never internal object path', async () => {
  const f = fixture('operator', true, { objectPath: 'private/tag/upload' });
  const response = await f.handler(request({ action: 'playback', recordingId: id }));
  equal(response.status, 200);
  equal(await response.json(), { url: 'https://example.invalid/audio', expiresInSeconds: 120 });
});
Deno.test('label collisions return stable conflict code without raw database details', async () => {
  const f = fixture('operator', true, null, { code: 'P0001', message: 'TAG_LABEL_EXISTS internal detail' });
  const response = await f.handler(request({ action: 'createBatch', requestKey: id, rows: [{ label: 'A', batch: '' }] }));
  equal(response.status, 409);
  equal(await response.json(), { code: 'TAG_LABEL_EXISTS' });
});
Deno.test('V3 fixed and unassigned categories have stable errors', async () => {
  for (const code of ['CATEGORIES_FIXED','CATEGORY_UNASSIGNED']) {
    const response = await fixture('operator',true,null,{code:'P0001',message:code+' internal detail'}).handler(request({action:'bulkApply'}));
    equal(response.status,409);equal(await response.json(),{code});
  }
});
Deno.test('invalid calendar date errors are requests, not service failures', async () => {
  for (const code of ['22007','22008']) {
    const response=await fixture('operator',true,null,{code,message:'private invalid date detail'}).handler(request({action:'list',batchDate:'2026-02-30'}));
    equal(response.status,400);equal(await response.json(),{code:'REQUEST_INVALID'});
  }
});

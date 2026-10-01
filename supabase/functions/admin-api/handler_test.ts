import { createHandler } from './handler.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
const id = '00000000-0000-4000-8000-000000000001';
function fixture(role: string | null = 'operator', valid = true, rpcData: unknown = { ok: true }, rpcError: { code: string; message: string } | null = null) {
  const calls: unknown[] = [];
  const client = {
    auth: { getUser: async (token: string) => ({ data: { user: valid && token === 'valid-jwt' ? { id } : null }, error: valid ? null : {} }) },
    from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null, error: null }) }) }) }),
    rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: rpcData, error: rpcError }; },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://example.invalid/audio' }, error: null }) }) },
  };
  return { handler: createHandler(() => client as never), calls };
}
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

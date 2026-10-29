import { createHandler } from './handler.ts';
function assert(value: unknown): asserts value { if (!value) throw Error('assertion'); }
function handler(role: string | null, authenticated = true) {
  const profile = { select: () => profile, eq: () => profile, maybeSingle: async () => ({ data: role ? { role } : null, error: null }) };
  return createHandler(() => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'user' } : null }, error: null }) }, from: () => profile } as never));
}
Deno.test('audio review rejects anonymous, invalid identity, operator and missing role before data access', async () => {
  const req = (auth = true) => new Request('https://test/', { method: 'POST', headers: { ...(auth ? { authorization: 'Bearer token' } : {}), 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list' }) });
  assert((await handler('admin')(req(false))).status === 401);
  assert((await handler('admin', false)(req())).status === 401);
  for (const role of ['operator', null]) assert((await handler(role)(req())).status === 403);
});
Deno.test('audio review validates action and identifiers', async () => {
  for (const body of [{ action: 'delete' }, { action: 'save', recordingId: '../path' }]) {
    const response = await handler('admin')(new Request('https://test/', { method: 'POST', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    assert(response.status === 400);
  }
});

Deno.test('storage upload failure leaves a durable cleanup entry and never commits a primary version', async () => {
  let queued = false, committed = false;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'admin' } }, error: null }) },
    from: (table: string) => { const query = { select: () => query, eq: () => query, is: () => query,
      maybeSingle: async () => ({ data: table === 'operator_profiles' ? { role: 'admin' } : table === 'recordings' ? { id: 'recording' } : null, error: null }),
      insert: async () => { queued = true; return { error: null }; } }; return query; },
    storage: { from: () => ({ upload: async () => ({ error: { message: 'synthetic storage failure' } }) }) },
    rpc: () => { committed = true; return { error: null }; },
  };
  const bytes = new Uint8Array(32044), view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']] as const) for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  for (const [offset, value] of [[4, 32036], [16, 16], [24, 16000], [28, 32000], [40, 32000]]) view.setUint32(offset, value, true);
  for (const [offset, value] of [[20, 1], [22, 1], [32, 2], [34, 16]]) view.setUint16(offset, value, true);
  const form = new FormData(); for (const [key, value] of Object.entries({ action: 'save', recordingId: '20000000-0000-4000-8000-000000000001', revision: 0, requestKey: crypto.randomUUID(), start: 0, end: 1 })) form.set(key, String(value));
  form.set('audio', new Blob([bytes], { type: 'audio/wav' }), 'clip.wav');
  const response = await createHandler(() => client as never)(new Request('https://test/', { method: 'POST', headers: { authorization: 'Bearer token' }, body: form }));
  assert(response.status === 503 && queued && !committed);
});

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createHandler } from './handler.ts';

function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw Error(message); }
const tagId = '00000000-0000-4000-8000-000000000010';
const recordingId = '00000000-0000-4000-8000-000000000020';
function fixture() {
  return { id: tagId, public_token: 'a'.repeat(48), label: 'Fictional memory', serial_number: 'TEST-A001', status: 'bound',
    memory_topics: { code: 'A' }, recordings: { id: recordingId, duration_seconds: 12, created_at: '2026-01-01T00:00:00Z',
      location: { source: 'pin', lat: 33.59, lng: 130.4 }, object_path: 'must-not-leak', nickname: 'private-fixture' } };
}
function mock(rows: unknown[], error: unknown = null, states: unknown[] = [], versions: unknown[] = []) {
  const calls: [string, ...unknown[]][] = [];
  const query: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(resolve) };
  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'gt']) query[method] = (...args: unknown[]) => { calls.push([method, ...args]); return query; };
  const client = { from(table: string) {
    calls.push(['from', table]);
    if (table === 'tags') return query;
    const result = { select: () => result, in: () => Promise.resolve({ data: table === 'recording_audio_state' ? states : versions, error: null }) };
    return result;
  } } as unknown as SupabaseClient;
  return { calls, handler: createHandler(() => client) };
}
Deno.test('public map exposes only the explicit exhibition DTO and applies active/deleted filters', async () => {
  const { calls, handler } = mock([fixture()]);
  const response = await handler(new Request('https://example.invalid/public-map'));
  const value = await response.json();
  assert(response.status === 200 && value.items.length === 1);
  assert(Object.keys(value.items[0]).sort().join(',') === 'categoryCode,createdAt,durationSeconds,id,label,location,token');
  assert(!JSON.stringify(value).includes('must-not-leak') && !JSON.stringify(value).includes('private-fixture'));
  assert(calls.some(c => c[0] === 'eq' && c[1] === 'status' && c[2] === 'bound'));
  assert(calls.some(c => c[0] === 'is' && c[1] === 'deleted_at' && c[2] === null));
  assert(calls.some(c => c[0] === 'select' && String(c[1]).includes('recordings!inner')));
});
Deno.test('public map reports the active edited duration without exposing versions or object paths', async () => {
  const { handler } = mock([fixture()], null, [{ recording_id: recordingId, active_version_id: tagId }], [{ id: tagId, recording_id: recordingId, duration: 7 }]);
  const response = await handler(new Request('https://example.invalid/public-map'));
  const value = await response.json();
  assert(value.items[0].durationSeconds === 7);
  assert(!JSON.stringify(value).includes('active_version_id'));
});
Deno.test('public map uses bounded tag-ID keyset pagination, not recording-ID or token cursors', async () => {
  const row = fixture();
  const { calls, handler } = mock([row, { ...row, id: '00000000-0000-4000-8000-000000000011' }]);
  const response = await handler(new Request(`https://example.invalid/public-map?limit=1&cursor=${tagId}`));
  const value = await response.json();
  assert(value.items.length === 1 && value.nextCursor === tagId);
  assert(calls.some(c => c[0] === 'limit' && c[1] === 2));
  assert(calls.some(c => c[0] === 'gt' && c[1] === 'id' && c[2] === tagId));
});
Deno.test('public map rejects writes and invalid inputs without creating a privileged client', async () => {
  const handler = createHandler(() => { throw Error('Client must not be called'); });
  assert((await handler(new Request('https://example.invalid/', { method: 'POST' }))).status === 405);
  for (const query of ['limit=0', 'limit=101', 'limit=1.2', 'cursor=not-a-uuid']) {
    assert((await handler(new Request(`https://example.invalid/?${query}`))).status === 400);
  }
});
Deno.test('public map fails closed and omits an unexpectedly disabled record', async () => {
  const denied = mock([], { message: 'must-not-leak' });
  const response = await denied.handler(new Request('https://example.invalid/'));
  assert(response.status === 503 && !(await response.text()).includes('must-not-leak'));
  const disabled = mock([{ ...fixture(), status: 'disabled' }]);
  assert((await (await disabled.handler(new Request('https://example.invalid/'))).json()).items.length === 0);
});

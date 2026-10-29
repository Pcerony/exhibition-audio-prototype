import assert from 'node:assert/strict';
import { loadEnv } from 'vite';

const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
const url = env.VITE_SUPABASE_URL;
assert.equal(new URL(url).hostname, 'ngcvfpyyihhkjqtdvivx.supabase.co');
const headers = { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
async function request(name, options = {}) {
  return fetch(`${url}/functions/v1/${name}`, { ...options, headers, signal: AbortSignal.timeout(30000) });
}
const entries = [];
let cursor = null;
do {
  const response = await request(`public-map?limit=100${cursor ? `&cursor=${cursor}` : ''}`);
  assert.equal(response.status, 200);
  const page = await response.json();
  for (const item of page.items) {
    assert.deepEqual(Object.keys(item).sort(), ['categoryCode', 'createdAt', 'durationSeconds', 'id', 'label', 'location', 'token']);
    entries.push(item);
  }
  cursor = page.nextCursor;
} while (cursor);
assert(entries.length > 0);
assert.equal((await request('public-map', { method: 'POST', body: '{}' })).status, 405);
assert.equal((await request('public-map?cursor=invalid')).status, 400);
const sample = entries.find(entry => entry.location?.source === 'pin') ?? entries[0];
const tagResponse = await request(`public-tag?token=${sample.token}`);
assert.equal(tagResponse.status, 200);
const tag = await tagResponse.json();
assert.equal(tag.recording.id, sample.id);
assert.equal(tag.recording.durationSeconds, sample.durationSeconds);
const playbackResponse = await request('public-playback-url', { method: 'POST', body: JSON.stringify({ token: sample.token }) });
assert.equal(playbackResponse.status, 200);
const playback = await playbackResponse.json();
assert.equal(playback.expiresInSeconds, 120);
const media = await fetch(playback.url, { headers: { Range: 'bytes=0-43' }, signal: AbortSignal.timeout(30000) });
assert([200, 206].includes(media.status));
await media.body?.cancel();
const invalidTranslation = await request('public-translate', { method: 'POST', body: JSON.stringify({ token: sample.token, targetLanguage: 'unsupported' }) });
assert.equal(invalidTranslation.status, 400);
assert.equal((await invalidTranslation.json()).code, 'LANGUAGE_UNSUPPORTED');
if (process.argv.includes('--translate')) {
  let source = null;
  for (const entry of entries) {
    const response = await request(`public-tag?token=${entry.token}`);
    const value = await response.json();
    if (value.recording?.transcript?.trim()) { source = entry; break; }
  }
  assert(source, 'No public transcript available to verify translation');
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request('public-translate', { method: 'POST', body: JSON.stringify({ token: source.token, targetLanguage: 'en' }) });
    const value = await response.json();
    assert.equal(response.status, 200, value.code);
    assert(value.translation?.trim());
    if (attempt) assert.equal(value.cached, true);
  }
  console.log('PASS: one published transcript translated; repeated request served from cache; content not logged');
}
console.log(JSON.stringify({ catalog: entries.length, pins: entries.filter(entry => entry.location?.source === 'pin').length,
  places: entries.filter(entry => entry.location?.source === 'place').length, unlocated: entries.filter(entry => !entry.location).length,
  playback: 'authorized, private media reachable, 120 seconds', translation: 'endpoint available; validation checked without provider call' }));

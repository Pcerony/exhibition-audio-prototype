import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const ref = process.env.SUPABASE_PROJECT_REF, cli = process.env.SUPABASE_CLI;
if (!cli || !ref || !process.argv.includes('--allow-remote-test')) throw Error('Explicit cloud-test authorization required');
const keys = JSON.parse(execFileSync(cli, ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 }));
const service = keys.find(k => k.name === 'service_role')?.api_key, publicKey = keys.find(k => k.name === 'anon')?.api_key;
assert.ok(service && publicKey);
const origin = `https://${ref}.supabase.co`, client = createClient(origin, service, { auth: { persistSession: false, autoRefreshToken: false } });
const check = error => { if (error) throw Error('Synthetic fixture operation failed'); };
const users = [], tag = randomUUID(), upload = randomUUID(), recording = randomUUID(), token = randomBytes(24).toString('hex');
const originalPath = `synthetic-audio-review/${tag}/${upload}.wav`, uploadedPaths = [originalPath];
function wav(seconds = 1) { const buffer = Buffer.alloc(44 + seconds * 32000); buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40); return buffer; }
const call = async (jwt, body) => {
 const response = await fetch(origin + '/functions/v1/admin-audio', { method: 'POST', headers: { apikey: publicKey, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}), ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: body instanceof FormData ? body : JSON.stringify(body) });
 return { status: response.status, body: await response.json() };
};
const form = (revision, requestKey = randomUUID(), valid = true) => { const f = new FormData(); for (const [k, v] of Object.entries({ action: 'save', recordingId: recording, revision, requestKey, start: 0, end: 1 })) f.set(k, String(v)); f.set('audio', new Blob([valid ? wav() : Buffer.from('invalid')], { type: 'audio/wav' }), 'clip.wav'); return f; };
let passed = false;
try {
 for (const role of ['admin', 'operator']) {
  const email = `audio-release-${randomUUID()}@example.invalid`, password = randomBytes(24).toString('base64url');
  const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true }); check(error); users.push(data.user.id);
  check((await client.from('operator_profiles').insert({ user_id: data.user.id, role })).error);
  const auth = createClient(origin, publicKey, { auth: { persistSession: false, autoRefreshToken: false } }); const login = await auth.auth.signInWithPassword({ email, password }); check(login.error); if (role === 'admin') users.adminToken = login.data.session.access_token; else users.operatorToken = login.data.session.access_token;
 }
 check((await client.from('tags').insert({ id: tag, label: `SYNTHETIC-${tag}`, inventory_label: `SYNTHETIC-${tag}`, public_token: token, status: 'bound' })).error);
 check((await client.from('upload_sessions').insert({ id: upload, tag_id: tag, object_path: originalPath, claim_token_hash: 'synthetic-no-claim', mime_type: 'audio/wav', size_bytes: wav().length, expires_at: new Date().toISOString(), claimed_at: new Date().toISOString() })).error);
 check((await client.storage.from('recordings').upload(originalPath, wav(), { contentType: 'audio/wav' })).error);
 check((await client.from('recordings').insert({ id: recording, tag_id: tag, upload_session_id: upload, object_path: originalPath, nickname: '', mime_type: 'audio/wav', size_bytes: wav().length, duration_seconds: 1, transcription_consent: true })).error);
 check((await client.from('recording_transcriptions').insert({ recording_id: recording, status: 'ready', text: 'Synthetic cloud test only', published: true })).error);
 assert.equal((await call(null, { action: 'list' })).status, 401); assert.equal((await call(users.operatorToken, { action: 'list' })).status, 403);
 assert.equal((await call(users.adminToken, { action: 'list' })).status, 200);
 assert.equal((await call(users.adminToken, form(0, randomUUID(), false))).status, 400);
 const key = randomUUID(), saved = await call(users.adminToken, form(0, key)); assert.equal(saved.status, 200, saved.body.code);
 assert.equal((await call(users.adminToken, form(0, key))).status, 200);
 const staleLease = randomUUID();
 check((await client.from('recording_transcriptions').update({ status: 'processing', published: false, lease_token: staleLease, lease_expires_at: new Date(Date.now() + 60000).toISOString() }).eq('recording_id', recording)).error);
 const competing = await Promise.all([call(users.adminToken, form(1)), call(users.adminToken, form(1))]); assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]);
 const detail = await call(users.adminToken, { action: 'detail', recordingId: recording }); assert.equal(detail.status, 200); assert.equal(detail.body.versions.length, 2); assert.equal(detail.body.revision, 2);
 const stale = await client.rpc('finish_transcription', { p_recording_id: recording, p_lease_token: staleLease, p_version: 2, p_text: 'stale result', p_error_code: null, p_retry_seconds: 0 }); check(stale.error); assert.equal(stale.data, false);
 const versions = await client.from('recording_audio_versions').select('object_path').eq('recording_id', recording); check(versions.error); uploadedPaths.push(...versions.data.map(r => r.object_path));
 const transcript = await client.from('recording_transcriptions').select('published,text').eq('recording_id', recording).single(); check(transcript.error); assert.equal(transcript.data.published, false); assert.equal(transcript.data.text, 'Synthetic cloud test only');
 const playback = await fetch(origin + '/functions/v1/public-playback-url', { method: 'POST', headers: { apikey: publicKey, 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); assert.equal(playback.status, 200); const url = (await playback.json()).url; assert.ok(url.includes('/edits/')); assert.equal((await fetch(url)).status, 200);
 assert.equal((await fetch(origin + '/storage/v1/object/public/recordings/' + versions.data[0].object_path)).ok, false);
 assert.equal((await call(users.adminToken, { action: 'restore', recordingId: recording, revision: 2 })).status, 200);
 const restored = await fetch(origin + '/functions/v1/public-playback-url', { method: 'POST', headers: { apikey: publicKey, 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); assert.ok((await restored.json()).url.includes('/synthetic-audio-review/'));
 const original = await client.from('recordings').select('object_path').eq('id', recording).single(); assert.equal(original.data.object_path, originalPath);
 // Conflict uploads must remain in the durable delayed cleanup queue.
 const queue = await client.from('storage_cleanup_queue').select('object_path').like('object_path', `edits/${recording}/%`); check(queue.error); assert.equal(queue.data.length, 1); uploadedPaths.push(...queue.data.map(r => r.object_path));
 passed = true; console.log('PASS: cloud admin-only auth, malformed WAV, idempotency, concurrent save, transcript draft, private visitor playback, restore, conflict cleanup queue');
} finally {
 check((await client.from('tags').delete().eq('id', tag)).error);
 check((await client.storage.from('recordings').remove(uploadedPaths)).error);
 for (const user of users) { check((await client.from('audit_log').delete().eq('operator_id', user)).error); check((await client.auth.admin.deleteUser(user)).error); }
 if (passed) console.log('PASS: synthetic accounts, recordings and objects removed');
}

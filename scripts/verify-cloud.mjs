import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Explicit opt-in: this creates only short-lived synthetic test users/tags/audio.
const projectRef = process.argv[process.argv.indexOf('--project-ref') + 1];
if (!process.argv.includes('--allow-remote-test') || !/^[a-z]{20}$/.test(projectRef ?? '')) {
  throw new Error('Usage: node scripts/verify-cloud.mjs --project-ref <ref> --allow-remote-test');
}
const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}));
const publicKey = keys.find((item) => item.type === 'publishable')?.api_key ?? keys.find((item) => item.name === 'anon')?.api_key;
const serviceKey = keys.find((item) => item.name === 'service_role')?.api_key;
assert.ok(publicKey && serviceKey, 'CLI credentials unavailable');
const url = `https://${projectRef}.supabase.co`;
const client = (key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const privileged = client(serviceKey);
const batch = `AUTOTEST-${randomUUID()}`;
const users = []; const paths = new Set(); const requestKey = randomUUID();
let operatorJwt;
function check(error, message) { if (error) throw new Error(message); }
async function endpoint(name, body, extra = {}) {
  const response = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST', headers: { apikey: publicKey, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const admin = (action, body = {}, jwt = operatorJwt) => endpoint('admin-api', { action, ...body }, jwt ? { authorization: `Bearer ${jwt}` } : {});
function wav() {
  const buffer = new Uint8Array(3244); const view = new DataView(buffer.buffer);
  const text = (offset, value) => [...value].forEach((char, index) => { buffer[offset + index] = char.charCodeAt(0); });
  text(0, 'RIFF'); view.setUint32(4, buffer.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, buffer.length - 44, true);
  for (let i = 44; i < buffer.length; i += 2) view.setInt16(i, Math.round(Math.sin(i / 18) * 1500), true);
  return buffer;
}
const audio = wav();
async function init(tag) {
  const result = await endpoint('public-upload-init', { token: tag.token, mimeType: 'audio/wav', sizeBytes: audio.length });
  assert.equal(result.status, 201, 'Upload initialization failed');
  paths.add(result.body.path);
  return result.body;
}
async function upload(grant) {
  // Each caller has its own anonymous client; no shared session or local database.
  const { error } = await client(publicKey).storage.from('recordings').uploadToSignedUrl(grant.path, grant.storageToken, audio, { contentType: 'audio/wav' });
  check(error, 'Synthetic upload failed');
}
const claim = (grant, durationSeconds = 1, token = grant.claimToken) => endpoint('public-upload-claim', {
  uploadId: grant.uploadId, nickname: 'Synthetic fixture', durationSeconds,
}, { 'x-upload-token': token });
async function makeUser(operator) {
  const password = randomBytes(24).toString('base64url');
  const email = `fixture-${randomUUID()}@example.invalid`;
  const { data, error } = await privileged.auth.admin.createUser({ email, password, email_confirm: true });
  check(error, 'Fixture user creation failed'); users.push(data.user.id);
  if (operator) check((await privileged.from('operator_profiles').insert({ user_id: data.user.id, role: 'operator' })).error, 'Fixture allowlist failed');
  const { data: login, error: loginError } = await client(publicKey).auth.signInWithPassword({ email, password });
  check(loginError, 'Fixture login failed'); return login.session.access_token;
}

try {
  assert.equal((await admin('session', {}, undefined)).status, 401, 'Anonymous admin accepted');
  const outsiderJwt = await makeUser(false);
  assert.equal((await admin('list', {}, outsiderJwt)).status, 403, 'Non-operator admin accepted');
  operatorJwt = await makeUser(true);
  assert.equal((await admin('session')).body.role, 'operator', 'Operator membership failed');
  for (const table of ['tags', 'recordings', 'upload_sessions', 'operator_profiles', 'audit_log', 'provisioning_jobs', 'storage_cleanup_queue', 'batch_requests']) {
    const result = await client(publicKey).from(table).select('*').limit(1);
    assert.ok(result.error || !result.data?.length, `Anonymous table exposed: ${table}`);
    const outsider = client(publicKey);
    const headers = { apikey: publicKey, authorization: `Bearer ${outsiderJwt}` };
    const response = await fetch(`${url}/rest/v1/${table}?limit=1`, { headers });
    const rows = await response.json();
    assert.ok(!response.ok || (Array.isArray(rows) && !rows.length), `Non-operator table exposed: ${table}`);
    void outsider;
  }
  console.log('PASS: anonymous/non-operator authorization and table isolation');

  const rows = ['Race', 'Reset', 'Invalid', 'Rate'].map((label) => ({ label: `${batch}-${label}`, batch }));
  const created = await admin('createBatch', { rows, requestKey });
  assert.equal(created.status, 200, 'Batch creation failed');
  const tags = created.body.tags;
  assert.equal(tags.length, 4, 'Incorrect batch size');
  assert.equal(new Set(tags.map((tag) => tag.token)).size, 4, 'Public tokens duplicated');
  assert.ok(tags.every((tag) => /^[a-f0-9]{48}$/.test(tag.token)), 'Public tokens not opaque');
  const replay = await admin('createBatch', { rows, requestKey });
  assert.ok(replay.body.tags.every((tag, i) => tag.id === tags[i].id), 'Batch retry created duplicate tags');
  const conflict = await admin('createBatch', { rows: [rows[0]], requestKey });
  assert.equal(conflict.status, 409, 'Idempotency conflict accepted');
  const jobs = await admin('jobs', { batch, offset: 0, limit: 2 });
  assert.equal(jobs.body.total, 4, 'Jobs pagination total incorrect');
  assert.equal(jobs.body.jobs.length, 2, 'Jobs pagination failed');
  const job = tags[0].provisioning;
  assert.equal((await admin('provision', { jobId: job.id, version: job.version, visitorUrl: `${job.visitorUrl}-wrong`, status: 'verified' })).status, 409, 'Wrong readback accepted');
  assert.equal((await admin('provision', { jobId: job.id, version: job.version, visitorUrl: job.visitorUrl, status: 'verified' })).status, 200, 'Fixture provision report failed');
  console.log('PASS: atomic/idempotent cloud provisioning and exact URL checks (synthetic jobs only)');

  const grants = await Promise.all([init(tags[0]), init(tags[0])]);
  await Promise.all(grants.map(upload));
  const results = await Promise.all(grants.map((grant) => claim(grant)));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409], 'Concurrent bind did not select exactly one winner');
  const winner = results.findIndex((result) => result.status === 200);
  assert.equal((await claim(grants[winner])).status, 410, 'Claim token reused');
  const playback = await endpoint('public-playback-url', { token: tags[0].token });
  assert.equal(playback.status, 200, 'Independent visitor playback failed');
  const downloaded = await fetch(playback.body.url);
  assert.equal(downloaded.status, 200, 'Signed audio download failed');
  const bytes = new Uint8Array(await downloaded.arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), createHash('sha256').update(audio).digest('hex'), 'Playback bytes differ');
  const publicObject = await fetch(`${url}/storage/v1/object/public/recordings/${grants[winner].path}`);
  assert.ok(!publicObject.ok, 'Audio bucket publicly readable');
  const winnerObject = await privileged.storage.from('recordings').info(grants[winner].path);
  check(winnerObject.error, 'Repeated claim deleted winning recording');
  console.log('PASS: synthetic upload, concurrent binding, duplicate claim safety, independent playback, private bucket');

  assert.equal((await admin('setEnabled', { tagId: tags[0].id, enabled: false })).status, 200);
  assert.equal((await endpoint('public-playback-url', { token: tags[0].token })).status, 410, 'Disabled tag still plays');
  assert.equal((await admin('setEnabled', { tagId: tags[0].id, enabled: true })).status, 200);
  assert.equal((await admin('reset', { tagId: tags[0].id })).status, 200);
  assert.ok(!(await endpoint('public-playback-url', { token: tags[0].token })).body.url, 'Reset tag still signs playback');
  const stale = await init(tags[1]); await upload(stale);
  assert.equal((await admin('reset', { tagId: tags[1].id })).status, 200);
  assert.equal((await claim(stale)).status, 410, 'Pre-reset candidate bound after reset');
  const invalid = await init(tags[2]); await upload(invalid);
  assert.equal((await claim(invalid, 61)).status, 400, 'Invalid recording accepted');
  assert.ok((await admin('audit')).body.entries.length > 0, 'Audit missing');
  console.log('PASS: disable/enable, reset, pre-reset upload invalidation and failed finalize');

  const limited = await Promise.all(Array.from({ length: 9 }, () => endpoint('public-upload-init', { token: tags[3].token, mimeType: 'audio/wav', sizeBytes: audio.length })));
  limited.filter((result) => result.status === 201).forEach((result) => paths.add(result.body.path));
  assert.equal(limited.filter((result) => result.status === 201).length, 8, 'Concurrent upload rate limit violated');
  assert.equal(limited.filter((result) => result.status === 429).length, 1, 'Ninth upload not rate-limited');
  // Advance only synthetic session timestamps; never alter a real visitor upload.
  check((await privileged.from('upload_sessions').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).in('tag_id', tags.map((tag) => tag.id))).error, 'Fixture expiry update failed');
  check((await privileged.from('storage_cleanup_queue').update({ not_before: new Date(Date.now() - 1000).toISOString() }).in('object_path', [...paths])).error, 'Fixture cleanup expiry failed');
  const cleaned = await admin('maintenance');
  assert.equal(cleaned.status, 200, 'Cleanup worker failed');
  for (const path of paths) assert.ok((await privileged.storage.from('recordings').info(path)).error, 'Unbound object cleanup failed');
  console.log('PASS: atomic rate limiting and failed/expired upload cleanup');
} finally {
  let failed = false;
  const { data: fixtures, error } = await privileged.from('tags').select('id').eq('batch', batch);
  if (error) failed = true;
  if (paths.size && (await privileged.storage.from('recordings').remove([...paths])).error) failed = true;
  if ((await privileged.from('storage_cleanup_queue').delete().in('object_path', [...paths])).error) failed = true;
  if (fixtures?.length && (await privileged.from('tags').delete().in('id', fixtures.map((tag) => tag.id))).error) failed = true;
  for (const id of users) {
    if ((await privileged.from('batch_requests').delete().eq('operator_id', id)).error) failed = true;
    if ((await privileged.from('audit_log').delete().eq('operator_id', id)).error) failed = true;
    if ((await privileged.auth.admin.deleteUser(id)).error) failed = true;
  }
  if (failed) throw new Error('Fixture cleanup incomplete; inspect test batch using project dashboard');
  console.log('PASS: synthetic users, tags, metadata and audio removed');
}

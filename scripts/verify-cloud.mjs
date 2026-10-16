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
const users = []; const paths = new Set(); const requestKey = randomUUID();
const creationRequestKeys = [requestKey];
let operatorJwt;
let fixtureTagIds = [];
const categoryId = '00000000-0000-4000-8000-000000000001';
const targetId = '00000000-0000-4000-8000-000000000002';
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
const claim = (grant, durationSeconds = 1, token = grant.claimToken, location = null) => endpoint('public-upload-claim', {
  uploadId: grant.uploadId, nickname: 'Synthetic fixture', durationSeconds, location, categoryCode: 'A',
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
  for (const table of ['tags', 'recordings', 'upload_sessions', 'operator_profiles', 'audit_log', 'provisioning_jobs', 'storage_cleanup_queue', 'batch_requests', 'categories', 'label_history', 'management_requests', 'memory_topics', 'daily_topic_counters']) {
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

  const categories = await admin('categories');
  assert.deepEqual(categories.body.categories.map((category) => category.code), ['A', 'B', 'C', 'D']);
  assert.equal((await admin('createCategory', { name: 'Synthetic fixture', requestKey: randomUUID() })).body.code, 'CATEGORIES_FIXED');
  const created = await admin('createCards', { count: 4, requestKey, protocolVersion: 3 });
  assert.equal(created.status, 200, 'Batch creation failed');
  const tags = created.body.tags;
  fixtureTagIds = tags.map((tag) => tag.id);
  assert.equal(tags.length, 4, 'Incorrect batch size');
  assert.equal(new Set(tags.map((tag) => tag.token)).size, 4, 'Public tokens duplicated');
  assert.ok(tags.every((tag) => /^[a-f0-9]{48}$/.test(tag.token)), 'Public tokens not opaque');
  assert.ok(tags.every((tag) => tag.categoryId === null && tag.serialNumber === null && /^U[0-9]{6,}$/.test(tag.inventoryLabel)), 'Empty cards preclassified');
  const replay = await admin('createCards', { count: 4, requestKey, protocolVersion: 3 });
  assert.ok(replay.body.tags.every((tag, i) => tag.id === tags[i].id), 'Batch retry created duplicate tags');
  const conflict = await admin('createCards', { count: 1, requestKey, protocolVersion: 3 });
  assert.equal(conflict.status, 409, 'Idempotency conflict accepted');
  const jobs = await admin('jobs', { offset: 0, limit: 2, protocolVersion: 3 });
  assert.ok(jobs.body.total >= 4, 'Jobs pagination total incorrect');
  assert.equal(jobs.body.jobs.length, 2, 'Jobs pagination failed');
  const job = tags[0].provisioning;
  assert.equal((await admin('jobs', { protocolVersion: 2 })).status, 426, 'Old writer received jobs before physical write');
  const lease = await admin('leaseJob', { jobId: job.id, deviceId: 'synthetic-integration', protocolVersion: 3 });
  assert.equal(lease.status, 200, 'Lease failed');
  assert.match(lease.body.expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'Lease expiry incompatible with older Android');
  const report = { jobId: job.id, version: job.version, visitorUrl: job.visitorUrl, status: 'verified', protocolVersion: 3, leaseToken: lease.body.leaseToken };
  assert.equal((await admin('provision', { ...report, visitorUrl: `${job.visitorUrl}-wrong` })).status, 409, 'Wrong readback accepted');
  assert.equal((await admin('provision', report)).status, 200, 'Fixture provision report failed');
  assert.equal((await admin('releaseJob', { jobId: job.id, leaseToken: lease.body.leaseToken })).status, 200);
  const rewrite = await admin('leaseJob', { jobId: job.id, deviceId: 'synthetic-integration', protocolVersion: 3 });
  assert.equal(rewrite.status, 200, 'Verified card rewrite lease failed');
  assert.match(rewrite.body.expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'Rewrite expiry incompatible with older Android');
  const retry = await admin('leaseJob', { jobId: job.id, deviceId: 'synthetic-integration', protocolVersion: 3 });
  assert.deepEqual(retry.body, rewrite.body, 'Rewrite retry did not preserve the lease');
  assert.equal((await admin('provision', { ...report, leaseToken: rewrite.body.leaseToken })).status, 200, 'Rewrite report failed');
  assert.equal((await admin('releaseJob', { jobId: job.id, leaseToken: rewrite.body.leaseToken })).status, 200);
  assert.equal((await admin('provision', { jobId: job.id, version: job.version, visitorUrl: job.visitorUrl, status: 'verified' })).status, 426, 'Old writer was not blocked');
  console.log('PASS: atomic/idempotent cloud provisioning and exact URL checks (synthetic jobs only)');

  const preview = await admin('bulkPreview', { tagIds: [tags[3].id], operation: 'move', targetCategoryId: targetId });
  assert.equal(preview.body.code, 'CATEGORY_UNASSIGNED', 'Empty card move accepted');
  const extraRequestKey = randomUUID(); creationRequestKeys.push(extraRequestKey);
  const extra = await admin('createCards', { count: 1, requestKey: extraRequestKey, protocolVersion: 3 });
  assert.equal(extra.status, 200);
  const deleted = extra.body.tags[0]; fixtureTagIds.push(deleted.id);
  const deletion = await admin('bulkPreview', { tagIds: [deleted.id], operation: 'delete' });
  assert.equal((await admin('bulkApply', { operation: 'delete', kind: 'empty', cards: deletion.body.groups[0].cards, requestKey: randomUUID() })).status, 200);
  const gone = await fetch(`${url}/functions/v1/public-tag?token=${deleted.token}`, { headers: { apikey: publicKey } });
  assert.equal(gone.status, 404, 'Deleted card remains public');
  console.log('PASS: empty card classification prohibited and deletion invalidates the public card');

  const grants = await Promise.all([init(tags[0]), init(tags[0])]);
  await Promise.all(grants.map(upload));
  const locations = [{ source: 'pin', lat: 33.59, lng: 130.4 }, { source: 'place', placeId: 'synthetic-place-id' }];
  const results = await Promise.all(grants.map((grant, index) => claim(grant, 1, grant.claimToken, locations[index])));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409], 'Concurrent bind did not select exactly one winner');
  const winner = results.findIndex((result) => result.status === 200);
  const publicTag = await fetch(`${url}/functions/v1/public-tag?token=${tags[0].token}`, { headers: { apikey: publicKey } });
  assert.equal(publicTag.status, 200, 'Public location lookup failed');
  const publicBody = await publicTag.json();
  assert.deepEqual(publicBody.recording.location, locations[winner], 'Winning location not preserved');
  assert.equal(publicBody.categoryCode, 'A');
  assert.match(publicBody.serialNumber, /^\d{6}-A\d{3,}$/);
  const managed = await admin('list', { search: tags[0].inventoryLabel, categoryId });
  assert.deepEqual(managed.body.tags.find((tag) => tag.id === tags[0].id).recording.location, locations[winner], 'Admin location missing');
  const move = await admin('bulkPreview', { tagIds: [tags[0].id], operation: 'move', targetCategoryId: targetId });
  assert.equal((await admin('bulkApply', { operation: 'move', cards: move.body.groups[0].cards, kind: 'recorded', targetCategoryId: targetId, requestKey: randomUUID() })).status, 200, 'Bound move failed');
  const moved = (await admin('list', { search: tags[0].inventoryLabel })).body.tags.find((tag) => tag.id === tags[0].id);
  assert.equal(moved.token, tags[0].token, 'Move changed public identity');
  assert.equal(moved.provisioning.visitorUrl, tags[0].provisioning.visitorUrl, 'Move changed written URL');
  assert.equal(moved.batchDate, publicBody.batchDate, 'Move changed recording date');
  assert.match(moved.serialNumber, /^\d{6}-B\d{3,}$/);
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
  // Never invoke the global maintenance worker in a production fixture run.
  // Its deletion/retry contract is covered by isolated backend tests.
  const queued = await privileged.from('storage_cleanup_queue').select('object_path').in('object_path', [...paths]);
  check(queued.error, 'Fixture cleanup lookup failed');
  assert.ok(queued.data.length > 0, 'Failed uploads were not durably queued');
  console.log('PASS: atomic rate limiting and durable failed-upload cleanup queue');
} finally {
  let failed = false;
  // Recover fixture IDs even when a create response was lost after commit.
  if (users.length) {
    const requests = await privileged.from('management_requests').select('response').in('request_key', creationRequestKeys).in('operator_id', users);
    if (requests.error) failed = true;
    fixtureTagIds = [...new Set([...fixtureTagIds, ...(requests.data ?? []).flatMap((request) => request.response?.tags?.map((tag) => tag.id) ?? [])])];
  }
  if (fixtureTagIds.length) {
    const uploads = await privileged.from('upload_sessions').select('object_path').in('tag_id', fixtureTagIds);
    if (uploads.error) failed = true;
    for (const upload of uploads.data ?? []) paths.add(upload.object_path);
  }
  if (paths.size && (await privileged.storage.from('recordings').remove([...paths])).error) failed = true;
  if ((await privileged.from('storage_cleanup_queue').delete().in('object_path', [...paths])).error) failed = true;
  if (fixtureTagIds.length) {
    if ((await privileged.from('label_history').delete().in('tag_id', fixtureTagIds)).error) failed = true;
    if ((await privileged.from('tags').delete().in('id', fixtureTagIds)).error) failed = true;
  }
  for (const id of users) {
    if ((await privileged.from('batch_requests').delete().eq('operator_id', id)).error) failed = true;
    if ((await privileged.from('management_requests').delete().eq('operator_id', id)).error) failed = true;
    if ((await privileged.from('audit_log').delete().eq('operator_id', id)).error) failed = true;
    if ((await privileged.auth.admin.deleteUser(id)).error) failed = true;
  }
  if (failed) throw new Error('Fixture cleanup incomplete; inspect test batch using project dashboard');
  console.log('PASS: synthetic users, tags, metadata and audio removed');
}

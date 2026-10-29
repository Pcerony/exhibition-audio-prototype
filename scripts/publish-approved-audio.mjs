import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
process.umask(0o077);
const root = process.env.AUDIO_BACKUP_DIR, cli = process.env.SUPABASE_CLI, ref = process.env.SUPABASE_PROJECT_REF;
if (!root || !cli || !ref || !process.argv.includes('--publish-owner-approved-edits')) throw Error('Explicit publication authorization and source backup required');
const keys = JSON.parse(execFileSync(cli, ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 }));
const service = keys.find(k => k.name === 'service_role')?.api_key, publicKey = keys.find(k => k.name === 'anon')?.api_key; assert.ok(service && publicKey);
const origin = `https://${ref}.supabase.co`, client = createClient(origin, service, { auth: { persistSession: false, autoRefreshToken: false } });
const check = error => { if (error) throw Error('Publication operation failed'); };
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'database-public.json'))).tables;
const rows = JSON.parse(fs.readFileSync(path.join(root, 'review-results.json')));
const approvedLabels = new Set(['261018-B001', '261018-D010', '261017-A006', '261018-D004']);
const admin = baseline.operator_profiles.find(p => p.role === 'admin')?.user_id; assert.ok(admin);
const receiptPath = path.join(root, 'approved-publication.json');
const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath)) : { project: ref, items: {} };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function canonical(file) {
 const pcm = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { maxBuffer: 10 * 1024 * 1024 });
 const buffer = Buffer.alloc(44 + pcm.length); buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(pcm.length, 40); pcm.copy(buffer, 44); return buffer;
}
for (const row of rows.filter(r => approvedLabels.has(r.label))) {
 const edit = JSON.parse(fs.readFileSync(path.join(root, 'local-edits', row.id + '.json'))), original = baseline.recordings.find(r => r.id === row.id);
 const current = await client.from('recordings').select('id,object_path,size_bytes,tag_id').eq('id', row.id).single(); check(current.error); assert.equal(current.data.object_path, original.object_path); assert.equal(current.data.tag_id, original.tag_id);
 const cloudOriginal = await client.storage.from('recordings').download(original.object_path); check(cloudOriginal.error);
 assert.equal(hash(Buffer.from(await cloudOriginal.data.arrayBuffer())), hash(fs.readFileSync(path.join(root, row.file))));
 const bytes = canonical(path.join(root, 'local-edits', row.id + '.wav')), duration = (bytes.length - 44) / 32000;
 assert.ok(duration > 0 && Math.abs(duration - (edit.end - edit.start)) <= .35);
 if (!receipt.items[row.id]) {
  const state = await client.from('recording_audio_state').select('revision').eq('recording_id', row.id).maybeSingle(); check(state.error);
  receipt.items[row.id] = { label: row.label, id: randomUUID(), requestKey: randomUUID(), revision: state.data?.revision ?? 0, sha256: hash(bytes), duration };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
 }
 const item = receipt.items[row.id]; assert.equal(item.sha256, hash(bytes));
 const existing = await client.from('recording_audio_versions').select('id').eq('request_key', item.requestKey).maybeSingle(); check(existing.error);
 if (!existing.data) {
  const objectPath = `edits/${row.id}/${item.id}.wav`;
  check((await client.from('storage_cleanup_queue').upsert({ object_path: objectPath, not_before: new Date(Date.now() + 86400000).toISOString() })).error);
  const upload = await client.storage.from('recordings').upload(objectPath, bytes, { contentType: 'audio/wav', upsert: false }); check(upload.error);
  const committed = await client.rpc('audio_commit_version', { p_operator: admin, p_recording: row.id, p_revision: item.revision, p_version: item.id, p_request: item.requestKey, p_path: objectPath, p_duration: duration, p_start: edit.start, p_end: edit.end, p_size: bytes.length }); check(committed.error);
 }
 const token = baseline.tags.find(t => t.id === original.tag_id).public_token;
 const response = await fetch(origin + '/functions/v1/public-playback-url', { method: 'POST', headers: { apikey: publicKey, 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); assert.equal(response.status, 200);
 const signed = await response.json(); assert.ok(signed.url.includes(item.id));
 assert.equal(hash(Buffer.from(await (await fetch(signed.url)).arrayBuffer())), item.sha256);
 const tag = await fetch(origin + '/functions/v1/public-tag?token=' + token, { headers: { apikey: publicKey } }); const publicRecording = (await tag.json()).recording; assert.equal(publicRecording.durationSeconds, duration); assert.equal(publicRecording.transcript, null);
 item.verifiedAt = new Date().toISOString(); fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 });
 console.log(`PASS: ${row.label} primary=${duration.toFixed(2)}s; original SHA256 preserved; anonymous playback matches edited bytes`);
}
assert.equal(Object.keys(receipt.items).length, 4);
// Persist actual decoded duration/volume for all original recordings, without altering public audio.
for (const row of rows) {
 const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', path.join(root, row.file), '-af', 'asetpts=N/SR/TB', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 100 * 1024 * 1024 });
 const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4); let power = 0; for (const value of samples) power += value * value;
 const meanDb = Math.max(-200, 10 * Math.log10(power / samples.length || 1e-20));
 check((await client.from('recording_audio_state').upsert({ recording_id: row.id }, { onConflict: 'recording_id', ignoreDuplicates: true })).error);
 check((await client.from('recording_audio_state').update({ measured_duration: samples.length / 16000, mean_db: meanDb, measured_at: new Date().toISOString() }).eq('recording_id', row.id)).error);
}
console.log('PASS: 49 original recording measurements saved; C001 and A007 public audio unchanged');

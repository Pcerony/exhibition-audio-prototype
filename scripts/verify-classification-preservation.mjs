import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const cli = process.env.SUPABASE_CLI;
const snapshotFile = process.argv[2];
if (!cli || !snapshotFile?.includes('output/private-backups/')) throw new Error('Protected metadata snapshot and CLI required');
const { project, snapshot: before } = JSON.parse(readFileSync(snapshotFile, 'utf8'));
if (!/^[a-z]{20}$/.test(project)) throw new Error('Project invalid');
const sql = `select jsonb_build_object(
 'tags',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.tags t),
 'recordings',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.recordings r),
 'jobs',(select coalesce(jsonb_agg(to_jsonb(j)),'[]') from public.provisioning_jobs j)
) as snapshot;`;
let result;
try { result = JSON.parse(execFileSync(cli, ['db', 'query', '--linked', '--project-ref', project, sql, '-o', 'json', '--yes'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000, maxBuffer: 10 * 1024 * 1024 })); }
catch { throw new Error('Protected preservation query failed; data not logged'); }
const after = result.rows?.[0]?.snapshot;
assert.ok(after, 'Snapshot missing');
for (const tag of before.tags) {
  const current = after.tags.find(value => value.id === tag.id);
  assert.ok(current, 'Original card missing');
  assert.equal(current.public_token, tag.public_token, 'Original token changed');
  assert.equal(current.status, tag.status, 'Original status changed');
  if (before.recordings.some(recording => recording.tag_id === tag.id)) assert.equal(current.label, tag.label, 'Legacy bound label changed');
}
for (const recording of before.recordings) assert.deepEqual(after.recordings.find(value => value.id === recording.id), recording, 'Original recording metadata changed');
for (const job of before.provisioningJobs) {
  const current = after.jobs.find(value => value.id === job.id);
  assert.ok(current, 'Original writing job missing');
  assert.equal(current.visitor_url, job.visitor_url, 'Original NFC URL changed');
  assert.equal(current.tag_id, job.tag_id, 'Original writing identity changed');
}
console.log(`PASS: original ${before.tags.length} cards, ${before.recordings.length} recordings and NFC URLs preserved; current totals ${after.tags.length}/${after.recordings.length}`);

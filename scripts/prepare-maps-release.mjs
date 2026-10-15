import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const cli = process.env.SUPABASE_CLI;
const project = process.argv[process.argv.indexOf('--project-ref') + 1];
if (!cli || !process.argv.includes('--allow-remote-backup') || !/^[a-z]{20}$/.test(project ?? '')) {
  throw new Error('Set SUPABASE_CLI and pass --project-ref <ref> --allow-remote-backup');
}
const directory = resolve('output/private-backups', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(directory, { recursive: true, mode: 0o700 });
const sql = `select jsonb_build_object(
 'tags',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.tags t),
 'recordings',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.recordings r),
 'uploads',(select coalesce(jsonb_agg(to_jsonb(u)),'[]') from public.upload_sessions u),
 'claimDefinition',pg_get_functiondef('public.claim_recording(uuid,text,text,integer,bigint,text)'::regprocedure),
 'recordingColumns',(select jsonb_agg(to_jsonb(c)) from information_schema.columns c where c.table_schema='public' and c.table_name='recordings')
) as snapshot;`;
const result = JSON.parse(execFileSync(cli, ['db', 'query', '--linked', '--project-ref', project, sql, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const snapshot = result.rows?.[0]?.snapshot;
assert.ok(snapshot && Array.isArray(snapshot.tags) && Array.isArray(snapshot.recordings), 'Backup response invalid');
const file = resolve(directory, 'metadata.json');
writeFileSync(file, JSON.stringify({ project, createdAt: new Date().toISOString(), snapshot }), { mode: 0o600 });
assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).snapshot, snapshot);
const migration = readFileSync('supabase/migrations/202610150002_visitor_location.sql', 'utf8');
const rehearsal = resolve(directory, 'rehearsal.sql');
writeFileSync(rehearsal, `begin;\n${migration}\nrollback;\n`, { mode: 0o600 });
execFileSync(cli, ['db', 'query', '--linked', '--project-ref', project, '--file', rehearsal, '--output', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
console.log(`PASS: protected metadata snapshot verified; remote migration rehearsal rolled back. Cards=${snapshot.tags.length}, recordings=${snapshot.recordings.length}`);
console.log(`Backup directory: ${directory}`);

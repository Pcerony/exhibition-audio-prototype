import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const cli = process.env.SUPABASE_CLI;
const project = process.argv[process.argv.indexOf('--project-ref') + 1];
const migrationIndex = process.argv.indexOf('--migration');
const migrationName = migrationIndex < 0 ? '202610150002_visitor_location.sql' : process.argv[migrationIndex + 1];
assert.ok(['202610150002_visitor_location.sql', '202610150001_categories_and_leases.sql', '202610160001_post_recording_classification.sql', '202610170001_transcription.sql', '202610170002_on_demand_writing.sql'].includes(migrationName), 'Unsupported release migration');
if (!cli || !process.argv.includes('--allow-remote-backup') || !/^[a-z]{20}$/.test(project ?? '')) {
  throw new Error('Set SUPABASE_CLI and pass --project-ref <ref> --allow-remote-backup');
}
const directory = resolve('output/private-backups', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(directory, { recursive: true, mode: 0o700 });
function query(args) {
  try { return execFileSync(cli, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000, maxBuffer: 10 * 1024 * 1024 }); }
  catch { throw new Error('Protected release query failed or timed out; no database output is logged.'); }
}
const sql = `select jsonb_build_object(
 'tags',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.tags t),
 'recordings',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.recordings r),
 'uploads',(select coalesce(jsonb_agg(to_jsonb(u)),'[]') from public.upload_sessions u),
 'provisioningJobs',(select coalesce(jsonb_agg(to_jsonb(j)),'[]') from public.provisioning_jobs j),
 'batchRequests',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from public.batch_requests b),
 'categories',(select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.categories c),
 'labelHistory',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from public.label_history h),
 'managementRequests',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.management_requests m),
 'functions',(select jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'),
 'claimDefinition',pg_get_functiondef('public.claim_recording(uuid,text,text,integer,bigint,text)'::regprocedure),
 'recordingColumns',(select jsonb_agg(to_jsonb(c)) from information_schema.columns c where c.table_schema='public' and c.table_name='recordings')
) as snapshot;`;
const result = JSON.parse(query(['db', 'query', '--linked', '--project-ref', project, sql, '--output', 'json', '--yes']));
const snapshot = result.rows?.[0]?.snapshot;
assert.ok(snapshot && Array.isArray(snapshot.tags) && Array.isArray(snapshot.recordings), 'Backup response invalid');
const file = resolve(directory, 'metadata.json');
writeFileSync(file, JSON.stringify({ project, migrationName, createdAt: new Date().toISOString(), snapshot }), { mode: 0o600 });
assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).snapshot, snapshot);
const migration = readFileSync(`supabase/migrations/${migrationName}`, 'utf8');
const rehearsal = resolve(directory, 'rehearsal.sql');
const before = `create temp table release_tags_before as select id,public_token,label,status from public.tags;
create temp table release_recordings_before as select to_jsonb(r) data from public.recordings r;
create temp table release_jobs_before as select id,tag_id,visitor_url from public.provisioning_jobs;`;
const protectedData = `do $$ begin
if exists(select 1 from release_tags_before b left join public.tags t using(id) where t.id is null or t.public_token is distinct from b.public_token or t.status is distinct from b.status or (b.status='bound' and t.label is distinct from b.label)) then raise exception 'RELEASE_TAG_IDENTITY_CHANGED';end if;
if (select count(*) from release_recordings_before)<>(select count(*) from public.recordings) or exists(select 1 from release_recordings_before b left join public.recordings r on r.id=(b.data->>'id')::uuid where r.id is null or not to_jsonb(r) @> b.data) then raise exception 'RELEASE_RECORDING_CHANGED';end if;
if exists(select 1 from release_jobs_before b left join public.provisioning_jobs j using(id) where j.id is null or j.tag_id is distinct from b.tag_id or j.visitor_url is distinct from b.visitor_url) then raise exception 'RELEASE_NFC_URL_CHANGED';end if;
end $$;`;
writeFileSync(rehearsal, `begin;\nset local lock_timeout='5s';\nset local statement_timeout='30s';\n${before}\n${migration}\n${protectedData}\nrollback;\n`, { mode: 0o600 });
query(['db', 'query', '--linked', '--project-ref', project, '--file', rehearsal, '--output', 'json', '--yes']);
console.log(`PASS: protected metadata snapshot verified; remote migration rehearsal rolled back. Cards=${snapshot.tags.length}, recordings=${snapshot.recordings.length}`);
console.log(`Backup directory: ${directory}`);

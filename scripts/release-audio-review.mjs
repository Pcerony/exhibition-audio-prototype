import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
process.umask(0o077);
const cli = process.env.SUPABASE_CLI;
const project = process.env.SUPABASE_PROJECT_REF;
const directory = process.env.AUDIO_RELEASE_BACKUP;
const apply = process.argv.includes('--apply'), rehearse = process.argv.includes('--rehearse');
if (!cli || !/^[a-z]{20}$/.test(project ?? '') || !directory || (!apply && !rehearse)) throw Error('CLI, project, backup directory and explicit release mode required');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const sql = readFileSync(new URL('../supabase/migrations/202610290001_audio_versions.sql', import.meta.url), 'utf8');
const file = resolve(directory, apply ? 'apply.sql' : 'rehearsal.sql');
const preserve = `create temp table audio_before_recordings as select to_jsonb(r) data from public.recordings r;
create temp table audio_before_tags as select id,public_token,label,status from public.tags;
create temp table audio_before_transcripts as select to_jsonb(t) data from public.recording_transcriptions t;`;
const assert = `do $$ begin
if (select count(*) from audio_before_recordings)<>(select count(*) from public.recordings) or exists(select 1 from audio_before_recordings b left join public.recordings r on r.id=(b.data->>'id')::uuid where r.id is null or to_jsonb(r)<>b.data) then raise exception 'ORIGINAL_RECORDING_CHANGED';end if;
if exists(select 1 from audio_before_tags b left join public.tags t using(id) where t.id is null or t.public_token<>b.public_token or t.label<>b.label or t.status<>b.status) then raise exception 'TAG_CHANGED';end if;
if exists(select 1 from audio_before_transcripts b left join public.recording_transcriptions t on t.recording_id=(b.data->>'recording_id')::uuid where t.recording_id is null or to_jsonb(t)<>b.data) then raise exception 'TRANSCRIPT_CHANGED';end if;
end $$;`;
const history = `insert into supabase_migrations.schema_migrations(version,name,statements) values('202610290001','audio_versions',array[$migration$${sql}$migration$]);`;
writeFileSync(file, `begin;set local lock_timeout='5s';set local statement_timeout='60s';${preserve}\n${sql}\n${assert}\n${apply ? history + '\ncommit;' : 'rollback;'}\nselect 'verified' as result;`, { mode: 0o600 });
try {
  const result = JSON.parse(execFileSync(cli, ['db', 'query', '--linked', '--project-ref', project, '--file', file, '--output', 'json', '--yes'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, maxBuffer: 5 * 1024 * 1024 }));
  writeFileSync(resolve(directory, apply ? 'apply-result.json' : 'rehearsal-result.json'), JSON.stringify(result), { mode: 0o600 });
  console.log(apply ? 'PASS: migration applied atomically; original recordings, tags and transcripts unchanged' : 'PASS: remote migration rehearsed and rolled back; original data unchanged');
} catch { throw Error('Release SQL failed; inspect protected server diagnostics before retrying'); }

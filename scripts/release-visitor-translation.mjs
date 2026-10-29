import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

process.umask(0o077);
const cli = process.env.SUPABASE_CLI;
const project = process.env.SUPABASE_PROJECT_REF;
const directory = process.env.VISITOR_RELEASE_BACKUP;
const apply = process.argv.includes('--apply');
if (!cli || project !== 'ngcvfpyyihhkjqtdvivx' || !directory || (!apply && !process.argv.includes('--rehearse'))) throw Error('Explicit project, backup directory and mode required');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const migration = readFileSync(new URL('../supabase/migrations/202610290003_public_transcript_translation.sql', import.meta.url), 'utf8');
function query(sql) {
  try {
    return JSON.parse(execFileSync(cli, ['db', 'query', '--linked', '--project-ref', project, sql, '--output', 'json', '--yes'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, maxBuffer: 20 * 1024 * 1024,
    }));
  } catch { throw Error('Protected release query failed; no database content logged'); }
}
if (!apply) {
  const snapshot = query("select jsonb_build_object('tags',(select jsonb_agg(to_jsonb(t)) from public.tags t),'recordings',(select jsonb_agg(to_jsonb(r)) from public.recordings r),'transcriptions',(select jsonb_agg(to_jsonb(t)) from public.recording_transcriptions t)) as snapshot");
  writeFileSync(resolve(directory, 'metadata.json'), JSON.stringify(snapshot), { mode: 0o600 });
}
const protectedTables = ['tags', 'recordings', 'recording_transcriptions', 'recording_audio_state', 'recording_audio_versions'];
const before = protectedTables.map((table, i) => `create temp table preserve_${i} as select to_jsonb(t) data from public.${table} t;`).join('\n');
const assertions = protectedTables.map((table, i) => `if exists((select data from preserve_${i} except select to_jsonb(t) from public.${table} t) union all (select to_jsonb(t) from public.${table} t except select data from preserve_${i})) then raise exception 'PROTECTED_TABLE_CHANGED_${i}'; end if;`).join('\n');
const history = `insert into supabase_migrations.schema_migrations(version,name,statements) values('202610290003','public_transcript_translation',array[$migration$${migration}$migration$]);`;
const sql = `begin; set local lock_timeout='5s'; set local statement_timeout='60s';\n${before}\n${migration}\ndo $$ begin ${assertions} end $$;\n${apply ? history + '\ncommit;' : 'rollback;'}\nselect 'verified' as result;`;
writeFileSync(resolve(directory, apply ? 'apply.sql' : 'rehearsal.sql'), sql, { mode: 0o600 });
const result = query(sql);
writeFileSync(resolve(directory, apply ? 'apply-result.json' : 'rehearsal-result.json'), JSON.stringify(result), { mode: 0o600 });
console.log(apply ? 'PASS: translation schema applied; existing visitor/audio data unchanged' : 'PASS: metadata backed up; migration rolled back; existing visitor/audio data unchanged');

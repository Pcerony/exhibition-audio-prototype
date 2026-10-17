import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

const ref=process.argv[process.argv.indexOf('--project-ref')+1];
if(!process.argv.includes('--allow-remote-rehearsal')||!/^[a-z]{20}$/.test(ref??'')) throw Error('Pass --project-ref and --allow-remote-rehearsal after encrypted backup/restore verification');
const tables=['tags','recordings','provisioning_jobs','recording_transcriptions','audit_log','management_requests'];
const fingerprints=tables.map(t=>`md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.${t} r),'[]')) as ${t}`).join(',');
const migration=readFileSync('supabase/migrations/202610180001_qr_card_attachments.sql','utf8');
const directory=resolve('output/private-backups/qr-attachment-preflight');mkdirSync(directory,{recursive:true,mode:0o700});
const path=resolve(directory,'rehearsal.sql');
writeFileSync(path,`begin isolation level repeatable read;
set local lock_timeout='5s';set local statement_timeout='30s';
create temp table protected_before as select ${fingerprints};
${migration}
create temp table protected_after as select ${fingerprints};
do $$ begin
 if (select to_jsonb(b) from protected_before b) is distinct from (select to_jsonb(a) from protected_after a) then raise exception 'EXISTING_DATA_CHANGED';end if;
 if has_function_privilege('authenticated','public.admin_action(uuid,jsonb)','execute') or has_function_privilege('service_role','public.admin_action_before_qr_attachment(uuid,jsonb)','execute') then raise exception 'RPC_AUTHORIZATION_CHANGED';end if;
 if has_table_privilege('anon','public.qr_card_attachments','select') or has_table_privilege('authenticated','public.qr_attachment_leases','select') then raise exception 'PRIVATE_TABLE_EXPOSED';end if;
end $$;
rollback;`,{mode:0o600});
try {
 execFileSync('npx',['--','supabase','db','query','--linked','--project-ref',ref,'--file',path,'-o','json','--yes'],{stdio:['ignore','pipe','pipe'],timeout:90000,maxBuffer:10*1024*1024});
 console.log('PASS: production transaction rehearsal rolled back; protected metadata fingerprints and RPC/table authorization unchanged.');
} catch {console.error('Migration rehearsal failed; private database diagnostics suppressed.');process.exitCode=1;}

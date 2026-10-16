import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ref=process.argv[process.argv.indexOf('--project-ref')+1];
if(!process.argv.includes('--apply')||!/^[a-z]{20}$/.test(ref??''))throw Error('Usage: node scripts/configure-transcription.mjs --project-ref <ref> --apply');
const binary=process.env.SUPABASE_CLI_BIN;
const cli=(args,input)=>execFileSync(binary??'npx',binary?args:['--','supabase',...args],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:90000});
const query=(sql)=>JSON.parse(cli(['db','query','--linked','--project-ref',ref,'--file','/dev/stdin','--output','json','--yes'],sql));
let stage='Edge secret names';
try{
 // The CLI returns secret names/digests, not values. Do not retrieve or print credentials.
 const secrets=JSON.parse(cli(['secrets','list','--project-ref',ref,'-o','json']));
 if(!secrets.some(secret=>secret.name==='GROQ_API_KEY')){
  stage='pause transcription cron';
  query("do $$ begin if exists(select 1 from pg_extension where extname='pg_cron') then perform cron.unschedule(jobid) from cron.job where jobname='recording-transcription';end if;end $$;");
  console.log('NOT CONFIGURED: GROQ_API_KEY missing; transcription cron remains stopped. No provider called.');
 }else{
  if(!secrets.some(secret=>secret.name==='MAINTENANCE_SECRET'))throw Error('MAINTENANCE_SECRET_MISSING');
  stage='Vault-backed transcription schedule';
  query(readFileSync('supabase/transcription-cron.sql','utf8'));
  console.log('PASS: one-minute transcription cron configured with existing Vault credentials. No provider verification performed.');
 }
}catch{
 console.error(`Transcription configuration failed at ${stage}; no secrets printed or rotated.`);process.exitCode=1;
}

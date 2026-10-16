-- Optional owner-run setup. No credentials or rotations; reuse existing maintenance Vault entries.
do $$ begin
 if (select count(*) from vault.decrypted_secrets where name='exhibition_maintenance_secret')<>1
 or (select count(*) from vault.decrypted_secrets where name='exhibition_project_url')<>1
 or (select count(*) from vault.decrypted_secrets where name='exhibition_public_key')<>1
 then raise exception 'MAINTENANCE_VAULT_NOT_CONFIGURED';end if;
end $$;
select cron.schedule('recording-transcription','* * * * *',$job$
 select net.http_post(
  url := (select rtrim(decrypted_secret,'/') from vault.decrypted_secrets where name='exhibition_project_url')||'/functions/v1/transcription-worker',
  headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='exhibition_public_key'),
  'x-maintenance-secret',(select decrypted_secret from vault.decrypted_secrets where name='exhibition_maintenance_secret')),
  body := '{}'::jsonb,timeout_milliseconds := 60000);
$job$);

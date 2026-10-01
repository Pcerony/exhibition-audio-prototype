-- Optional operator-run setup, NOT an automatically applied migration.
-- First enable pg_cron + pg_net and configure Edge MAINTENANCE_SECRET.
-- Store matching values in Vault as exhibition_maintenance_secret,
-- exhibition_project_url and exhibition_public_key.
-- exhibition_project_url is the Supabase project HTTPS origin, not the visitor website.
-- Never place the secret itself in this file or CLI logs.
do $$
begin
  if (select count(*) from vault.decrypted_secrets where name='exhibition_maintenance_secret')<>1
    or (select count(*) from vault.decrypted_secrets where name='exhibition_project_url')<>1
    or (select count(*) from vault.decrypted_secrets where name='exhibition_public_key')<>1
    then raise exception 'Configure unique maintenance_secret and project_url Vault entries first'; end if;
end;
$$;
select cron.schedule('recording-storage-maintenance','*/15 * * * *', $job$
  select net.http_post(
    url := (select rtrim(decrypted_secret,'/') from vault.decrypted_secrets where name='exhibition_project_url') || '/functions/v1/maintenance',
    headers := jsonb_build_object('Content-Type','application/json','apikey',
      (select decrypted_secret from vault.decrypted_secrets where name='exhibition_public_key'),'x-maintenance-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='exhibition_maintenance_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
$job$);

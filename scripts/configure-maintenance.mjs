import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ref = process.argv[process.argv.indexOf('--project-ref') + 1];
if (!process.argv.includes('--apply') || !/^[a-z]{20}$/.test(ref ?? '')) {
  throw new Error('Usage: node scripts/configure-maintenance.mjs --project-ref <ref> --apply');
}
const binary = process.env.SUPABASE_CLI_BIN;
const cli = (args, input) => execFileSync(binary ?? 'npx', binary ? args : ['--', 'supabase', ...args], {
  input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});
const query = (sql) => JSON.parse(cli(['db', 'query', '--linked', '--project-ref', ref, '--file', '/dev/stdin'], sql));
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
let stage = 'public configuration';

try {
  const keys = JSON.parse(cli(['projects', 'api-keys', '--project-ref', ref, '-o', 'json']));
  const publicKey = keys.find((key) => key.type === 'publishable')?.api_key;
  if (!publicKey) throw new Error('PUBLIC_CONFIG_MISSING');
  const secret = randomBytes(32).toString('hex');
  // Secrets travel through pipes, never process arguments, files, stdout or source.
  stage = 'Edge secret';
  cli(['secrets', 'set', '--project-ref', ref, '--env-file', '/dev/stdin'], `MAINTENANCE_SECRET=${secret}\n`);
  stage = 'extensions';
  query('create extension if not exists pg_cron with schema pg_catalog; create extension if not exists pg_net with schema extensions;');
  const values = {
    exhibition_maintenance_secret: secret,
    exhibition_project_url: `https://${ref}.supabase.co`,
    exhibition_public_key: publicKey,
  };
  for (const [name, value] of Object.entries(values)) {
    stage = `Vault entry ${name}`;
    query(`do $$ declare existing uuid; begin
      select id into existing from vault.secrets where name=${literal(name)};
      if existing is null then perform vault.create_secret(${literal(value)},${literal(name)});
      else perform vault.update_secret(existing,${literal(value)}); end if;
    end $$;`);
  }
  stage = 'cron schedule';
  query(readFileSync('supabase/maintenance-cron.sql', 'utf8'));
  stage = 'worker verification';
  const worker = `https://${ref}.supabase.co/functions/v1/maintenance`;
  const denied = await fetch(worker, { method: 'POST', headers: { apikey: publicKey }, body: '{}' });
  if (denied.status !== 401) throw new Error('WORKER_AUTH_FAILED');
  const verified = await fetch(worker, { method: 'POST', headers: {
    apikey: publicKey, 'content-type': 'application/json', 'x-maintenance-secret': secret,
  }, body: '{}' });
  if (!verified.ok) throw new Error('WORKER_UNAVAILABLE');
  console.log('PASS: Vault-backed 15-minute cleanup scheduled; protected worker verified');
} catch {
  // CLI diagnostic objects may contain SQL input; never print them here.
  console.error(`Maintenance configuration failed at ${stage}. Inspect Supabase configuration; no secret printed.`);
  process.exitCode = 1;
}

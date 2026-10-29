import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const run = promisify(execFile);

function installedCli() {
  const cache = path.join(os.homedir(), '.npm/_npx');
  if (fs.existsSync(cache)) for (const directory of fs.readdirSync(cache)) {
    const binary = path.join(cache, directory, 'node_modules', '@supabase', `cli-${process.platform}-${process.arch}`, 'bin', process.platform === 'win32' ? 'supabase.exe' : 'supabase');
    if (fs.existsSync(binary)) return binary;
  }
  return null;
}

// Server-side only. No credential is written to disk, browser code, or logs.
export async function soundMapCloudClient() {
  const env = loadEnv('development', process.cwd(), '');
  const url = env.VITE_SUPABASE_URL;
  if (!url || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) throw Error('CLOUD_PROJECT_CONFIGURATION_REQUIRED');
  const ref = new URL(url).hostname.split('.')[0];
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    try {
      const cli = installedCli();
      const args = ['projects', 'api-keys', '--project-ref', ref, '--output', 'json', '--yes'];
      const pending = run(cli ?? 'npx', cli ? args : ['--yes', 'supabase', ...args], { maxBuffer: 1024 * 1024, timeout: 60000, killSignal: 'SIGKILL' });
      pending.child.stdin?.end();
      const { stdout } = await pending;
      const result = JSON.parse(stdout);
      const keys = Array.isArray(result) ? result : result.api_keys;
      key = keys?.find(item => item.name === 'service_role')?.api_key;
    } catch { throw Error('LOCAL_SUPABASE_CREDENTIAL_UNAVAILABLE'); }
  }
  if (!key) throw Error('LOCAL_SUPABASE_CREDENTIAL_UNAVAILABLE');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

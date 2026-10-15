import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const project = 'ngcvfpyyihhkjqtdvivx';
const file = 'output/playwright/cloud-browser-fixture.json';
if (!process.argv.includes('--allow-remote-test')) throw new Error('Explicit --allow-remote-test required');
const keys = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', project, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const key = keys.find((value) => value.name === 'service_role')?.api_key;
if (!key) throw new Error('Server credential unavailable');
const client = createClient(`https://${project}.supabase.co`, key, { auth: { persistSession: false, autoRefreshToken: false } });
function check(error) { if (error) throw new Error('Synthetic fixture operation failed'); }
if (process.argv.includes('create')) {
  const label = `BROWSER-FIXTURE-${randomUUID()}`;
  const { data, error } = await client.from('tags').insert({ label, batch: 'Synthetic browser verification' }).select('id,public_token').single();
  check(error);
  mkdirSync('output/playwright', { recursive: true });
  writeFileSync(file, JSON.stringify({ id: data.id, label, url: `https://voice.heisei.space/#/t/${data.public_token}` }), { mode: 0o600 });
  console.log(`Created synthetic fixture manifest: ${file}`);
} else if (process.argv.includes('cleanup')) {
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  if (!fixture.label.startsWith('BROWSER-FIXTURE-')) throw new Error('Not a synthetic fixture');
  const { data: tag, error: tagError } = await client.from('tags').select('id,label').eq('id', fixture.id).maybeSingle();
  check(tagError);
  if (tag && tag.label !== fixture.label) throw new Error('Fixture identity changed');
  const { data: uploads, error } = await client.from('upload_sessions').select('object_path').eq('tag_id', fixture.id);
  check(error);
  const paths = (uploads ?? []).map((value) => value.object_path);
  if (paths.length) {
    check((await client.storage.from('recordings').remove(paths)).error);
    check((await client.from('storage_cleanup_queue').delete().in('object_path', paths)).error);
  }
  check((await client.from('tags').delete().eq('id', fixture.id).eq('label', fixture.label)).error);
  console.log('PASS: synthetic browser tag and uploaded objects removed');
} else throw new Error('Use create or cleanup');

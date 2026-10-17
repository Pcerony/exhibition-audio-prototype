import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runtime = process.env.EMBEDDED_PG_RUNTIME;
if (!runtime) throw new Error('Set EMBEDDED_PG_RUNTIME to a temporary prefix containing embedded-postgres and pg');
const require = createRequire(join(runtime, 'package.json'));
const EmbeddedPostgres = require('embedded-postgres').default;
const { Pool } = require('pg');
const password = randomUUID();
const port = Number(process.env.TEST_POSTGRES_PORT ?? 55445);
const server = new EmbeddedPostgres({
  databaseDir: join(tmpdir(), `qr-fallback-${randomUUID()}`),
  user: 'postgres', password, port, persistent: false,
  postgresFlags: ['-h', '127.0.0.1'], onLog() {}, onError() {},
});
let pool;
try {
  await server.initialise();
  await server.start();
  pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', max: 16 });
  await pool.query(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for (const file of (await readdir('supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    await pool.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }

  const operator = randomUUID();
  const otherOperator = randomUUID();
  const staffUser = randomUUID();
  const requestKey = randomUUID();
  await pool.query('insert into auth.users(id) values ($1),($2),($3)', [operator, otherOperator, staffUser]);
  await pool.query("insert into public.operator_profiles(user_id,role) values ($1,'operator'),($2,'operator'),($3,'staff')", [operator, otherOperator, staffUser]);

  const admin = async (body, userId = operator) => (await pool.query(
    'select public.admin_action($1::uuid,$2::jsonb) as result', [userId, body],
  )).rows[0].result;
  const staff = async (body, userId = staffUser) => (await pool.query(
    'select public.staff_action($1::uuid,$2::jsonb) as result', [userId, body],
  )).rows[0].result;
  const body = { action: 'createQrEntry', requestKey };
  const parallel = await Promise.all(Array.from({ length: 16 }, () => admin(body)));
  assert.ok(parallel.every((result) => result.id === parallel[0].id && result.visitorUrl === parallel[0].visitorUrl));
  const crossApi = await Promise.all(Array.from({ length: 16 }, (_, index) => index % 2 ? admin(body) : staff(body, operator)));
  assert.ok(crossApi.every((result) => result.id === parallel[0].id && result.visitorUrl === parallel[0].visitorUrl));
  assert.equal(Number((await pool.query('select count(*) from public.tags')).rows[0].count), 1);
  assert.equal(Number((await pool.query('select count(*) from public.audit_log where action = $1', ['qr_issue'])).rows[0].count), 1);
  assert.equal(Number((await pool.query('select count(*) from public.provisioning_jobs where tag_id = $1', [parallel[0].id])).rows[0].count), 0);

  const staffBody = { action: 'createQrEntry', requestKey: randomUUID() };
  const staffIssued = await staff(staffBody);
  const staffReplay = await staff(staffBody);
  assert.equal(staffReplay.id, staffIssued.id);
  assert.equal(staffIssued.entryChannel, 'qr');
  assert.equal(Number((await pool.query('select count(*) from public.audit_log where action = $1 and tag_id=$2', ['qr_issue', staffIssued.id])).rows[0].count), 1);
  assert.equal(Number((await pool.query('select count(*) from public.provisioning_jobs where tag_id = $1', [staffIssued.id])).rows[0].count), 0);
  await assert.rejects(admin({ action: 'createQrEntry', requestKey: randomUUID() }, staffUser), /OPERATOR_REQUIRED/);

  await assert.rejects(admin(body, otherOperator), /REQUEST_KEY_CONFLICT/);
  await assert.rejects(admin({ ...body, extra: true }), /REQUEST_KEY_CONFLICT/);

  const separate = await Promise.all(Array.from({ length: 8 }, () => admin({
    action: 'createQrEntry', requestKey: randomUUID(),
  })));
  assert.equal(new Set(separate.map((result) => result.id)).size, separate.length);

  const physical = await admin({
    action: 'prepareWrite', deviceId: 'qr-fallback-test', requestKey: randomUUID(), protocolVersion: 3,
  });
  assert.notEqual(physical.job.tagId, parallel[0].id);
  assert.notEqual(physical.job.tagId, staffIssued.id);
  const physicalTag = await pool.query('select entry_channel from public.tags where id = $1', [physical.job.tagId]);
  assert.equal(physicalTag.rows[0].entry_channel, 'nfc');
  console.log('PASS: independent PostgreSQL sessions serialize QR issuance across admin/staff APIs and keep QR identities out of NFC provisioning');
} finally {
  await pool?.end();
  await server.stop();
}

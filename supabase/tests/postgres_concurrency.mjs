import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Opt-in, isolated PostgreSQL process. Never accepts a remote database URL.
const runtime = process.env.EMBEDDED_PG_RUNTIME;
if (!runtime) throw new Error('Set EMBEDDED_PG_RUNTIME to a temporary npm prefix containing embedded-postgres and pg');
const require = createRequire(join(runtime, 'package.json'));
const EmbeddedPostgres = require('embedded-postgres').default;
const { Pool } = require('pg');
const port = Number(process.env.TEST_POSTGRES_PORT ?? 55439);
const password = randomUUID();
const server = new EmbeddedPostgres({ databaseDir: join(tmpdir(), `exhibition-pg-${randomUUID()}`), user: 'postgres', password, port, persistent: false, postgresFlags: ['-h', '127.0.0.1'], onLog() {}, onError() {} });
let pool;
try {
  await server.initialise();
  await server.start();
  pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', max: 12 });
  await pool.query(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for (const file of ['202609290001_cloud_recording_core.sql', '202610010001_operator_management.sql', '202610010002_stable_job_order.sql', '202610150001_categories_and_leases.sql', '202610150002_visitor_location.sql']) {
    await pool.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
  await pool.query(await readFile('supabase/tests/operator_v2.sql', 'utf8'));
  await pool.query(await readFile('supabase/tests/visitor_location.sql', 'utf8'));
  const operator = randomUUID();
  await pool.query('insert into auth.users values($1)', [operator]);
  await pool.query("insert into public.operator_profiles values($1,'admin',now())", [operator]);
  const admin = async (body, client = pool) => (await client.query('select public.admin_action($1,$2) result', [operator, body])).rows[0].result;
  const category = (await admin({ action: 'createCategory', name: 'Synthetic concurrency', requestKey: randomUUID() })).category;
  const results = await Promise.all(Array.from({ length: 8 }, () => admin({ action: 'createCards', categoryId: category.id, count: 2, requestKey: randomUUID() })));
  assert.equal(new Set(results.flatMap((r) => r.tags.map((t) => t.label))).size, 16);
  const retryBody = { action: 'createCards', categoryId: category.id, count: 1, requestKey: randomUUID() };
  const retries = await Promise.all(Array.from({ length: 8 }, () => admin(retryBody)));
  assert.ok(retries.every((r) => r.tags[0].id === retries[0].tags[0].id));
  console.log('PASS: independent PostgreSQL sessions allocate unique numbers and replay one creation');

  const single = (await admin({ action: 'createCategory', name: 'Synthetic lease', requestKey: randomUUID() })).category;
  const card = (await admin({ action: 'createCards', categoryId: single.id, count: 1, requestKey: randomUUID() })).tags[0];
  const leases = await Promise.all(['device-a', 'device-b'].map((deviceId) => admin({ action: 'nextJob', categoryId: single.id, deviceId, protocolVersion: 2 })));
  assert.equal(leases.filter((r) => r.job).length, 1);
  console.log('PASS: two independent writers cannot lease the same card');

  const grant = async () => {
    const id = randomUUID();
    await pool.query("select public.initialize_upload($1,$2,encode(extensions.digest('test','sha256'),'hex'),'audio/wav',10)", [card.token, id]);
    return id;
  };
  const uploads = await Promise.all([grant(), grant()]);
  const claims = await Promise.all(uploads.map((id, index) => pool.query("select * from public.claim_recording_with_location($1,'test','fictional',1,10,'audio/wav',$2)", [id, { source: 'pin', lat: 33 + index, lng: 130 }])));
  assert.deepEqual(claims.map((r) => r.rows[0].claim_status).sort(), ['already-bound', 'claimed']);
  const winnerIndex = claims.findIndex((r) => r.rows[0].claim_status === 'claimed');
  const storedLocation = (await pool.query('select location from public.recordings where tag_id=$1', [card.id])).rows[0].location;
  assert.deepEqual(storedLocation, { source: 'pin', lat: 33 + winnerIndex, lng: 130 });
  console.log('PASS: independent concurrent claims bind exactly one recording and preserve only the winning location');

  const current = (await admin({ action: 'list', categoryId: single.id })).tags[0];
  const deleting = await pool.connect();
  const enabling = await pool.connect();
  try {
    await deleting.query('begin');
    await admin({ action: 'bulkApply', operation: 'delete', kind: 'recorded', cards: [{ id: current.id, version: current.version }], requestKey: randomUUID() }, deleting);
    const pending = admin({ action: 'setEnabled', tagId: current.id, enabled: true }, enabling).then(() => 'accepted', (error) => error.message);
    await deleting.query('commit');
    assert.match(await pending, /TAG_NOT_FOUND/);
    await assert.rejects(pool.query("select public.initialize_upload($1,$2,'hash','audio/wav',10)", [card.token, randomUUID()]), /TAG_UNAVAILABLE/);
  } finally { deleting.release(); enabling.release(); }
  console.log('PASS: deletion cannot be undone by concurrent enable or visitor upload');
} finally {
  await pool?.end();
  await server.stop();
}

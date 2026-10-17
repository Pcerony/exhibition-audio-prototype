import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

Deno.test('QR entries replay the same identity and never enter the NFC writer pool', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema auth;create schema storage;create schema extensions;
      create table auth.users(id uuid primary key);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create function extensions.gen_random_bytes(n integer) returns bytea language sql as
        'select decode(left(string_agg(md5(random()::text),''''),n*2),''hex'') from generate_series(1,(n+15)/16)';
      create function extensions.digest(v bytea,algorithm text) returns bytea language sql immutable as
        'select decode(md5(v)||md5(v),''hex'')';
      create function extensions.digest(v text,algorithm text) returns bytea language sql immutable as
        'select extensions.digest(convert_to(v,''UTF8''),algorithm)';`);
    for (const file of [...Deno.readDirSync('supabase/migrations')].map((entry) => entry.name).sort()) {
      await db.exec((await Deno.readTextFile(`supabase/migrations/${file}`))
        .replace('create extension if not exists pgcrypto with schema extensions;', ''));
    }

    const operator = '10000000-0000-4000-8000-000000000001';
    const otherOperator = '10000000-0000-4000-8000-000000000002';
    const unlistedOperator = '10000000-0000-4000-8000-000000000003';
    const staff = '10000000-0000-4000-8000-000000000004';
    const requestKey = '20000000-0000-4000-8000-000000000001';
    await db.query('insert into auth.users(id) values ($1),($2),($3),($4)', [operator, otherOperator, unlistedOperator, staff]);
    await db.query("insert into public.operator_profiles(user_id,role) values ($1,'operator'),($2,'operator'),($3,'staff')", [operator, otherOperator, staff]);

    async function createQr(userId: string, body: Record<string, unknown>, api = 'admin_action') {
      const result = await db.query<{ result: Record<string, unknown> }>(
        `select public.${api}($1::uuid,$2::jsonb) as result`,
        [userId, JSON.stringify(body)],
      );
      return result.rows[0].result;
    }

    const body = { action: 'createQrEntry', requestKey };
    const created = await createQr(operator, body);
    if (created.entryChannel !== 'qr' || typeof created.visitorUrl !== 'string') {
      throw new Error(`unexpected QR entry response: ${JSON.stringify(created)}`);
    }
    const tagId = String(created.id);
    const replay = await createQr(operator, body);
    if (JSON.stringify(replay) !== JSON.stringify(created)) throw new Error('request replay changed the QR identity');
    const replayFromStaffApi = await createQr(operator, body, 'staff_action');
    if (JSON.stringify(replayFromStaffApi) !== JSON.stringify(created)) throw new Error('staff API replay changed the operator QR identity');

    const staffKey = '20000000-0000-4000-8000-000000000004';
    const staffBody = { action: 'createQrEntry', requestKey: staffKey };
    const staffCreated = await createQr(staff, staffBody, 'staff_action');
    if (staffCreated.entryChannel !== 'qr' || typeof staffCreated.visitorUrl !== 'string') {
      throw new Error(`staff QR entry response was invalid: ${JSON.stringify(staffCreated)}`);
    }
    const staffReplay = await createQr(staff, staffBody, 'staff_action');
    if (JSON.stringify(staffReplay) !== JSON.stringify(staffCreated)) throw new Error('staff request replay changed the QR identity');

    const concurrentKey = '20000000-0000-4000-8000-000000000002';
    const concurrentBody = { action: 'createQrEntry', requestKey: concurrentKey };
    const concurrent = await Promise.all([createQr(operator, concurrentBody), createQr(operator, concurrentBody)]);
    if (String(concurrent[0].id) !== String(concurrent[1].id)) throw new Error('concurrent replay created different identities');

    const dto = await db.query<{ dto: Record<string, unknown> }>('select public.tag_dto(t) as dto from public.tags t where t.id=$1', [tagId]);
    if (dto.rows[0].dto.entryChannel !== 'qr' || dto.rows[0].dto.provisioning !== null) {
      throw new Error('management DTO did not identify the QR-only state');
    }

    const rows = await db.query<{ count: number }>('select count(*)::int as count from public.tags where id=$1', [tagId]);
    if (rows.rows[0].count !== 1) throw new Error('QR request created more than one tag');
    const jobs = await db.query<{ count: number }>('select count(*)::int as count from public.provisioning_jobs where tag_id=$1', [tagId]);
    if (jobs.rows[0].count !== 0) throw new Error('QR-only identity entered the provisioning pool');
    const audit = await db.query<{ count: number }>(
      "select count(*)::int as count from public.audit_log where tag_id=$1 and action='qr_issue'",
      [tagId],
    );
    if (audit.rows[0].count !== 1) throw new Error('QR issuance did not create exactly one audit event');

    let bodyConflict = '';
    try {
      await createQr(operator, { ...body, extra: true });
    } catch (error) {
      bodyConflict = String(error);
    }
    if (!bodyConflict.includes('REQUEST_KEY_CONFLICT')) throw new Error(`expected changed request body conflict, received ${bodyConflict}`);

    let conflict = '';
    try {
      await createQr(otherOperator, body);
    } catch (error) {
      conflict = String(error);
    }
    if (!conflict.includes('REQUEST_KEY_CONFLICT')) throw new Error(`expected request key conflict, received ${conflict}`);

    let denied = '';
    try {
      await createQr(unlistedOperator, { action: 'createQrEntry', requestKey: '20000000-0000-4000-8000-000000000003' });
    } catch (error) {
      denied = String(error);
    }
    if (!denied.includes('OPERATOR_REQUIRED')) throw new Error(`expected operator authorization failure, received ${denied}`);
    let adminDenied = '';
    try {
      await createQr(staff, { action: 'createQrEntry', requestKey: '20000000-0000-4000-8000-000000000005' });
    } catch (error) {
      adminDenied = String(error);
    }
    if (!adminDenied.includes('OPERATOR_REQUIRED')) throw new Error(`expected admin API to reject staff, received ${adminDenied}`);
    let staffDenied = '';
    try {
      await createQr(unlistedOperator, { action: 'createQrEntry', requestKey: '20000000-0000-4000-8000-000000000006' }, 'staff_action');
    } catch (error) {
      staffDenied = String(error);
    }
    if (!staffDenied.includes('STAFF_REQUIRED')) throw new Error(`expected staff API authorization failure, received ${staffDenied}`);

    const privileges = await db.query<{ wrapper: boolean; anonymous: boolean; helper: boolean }>(
      "select has_function_privilege('service_role','public.staff_action(uuid,jsonb)','EXECUTE') wrapper, " +
      "has_function_privilege('authenticated','public.staff_action(uuid,jsonb)','EXECUTE') anonymous, " +
      "has_function_privilege('service_role','public.issue_qr_entry_internal(uuid,jsonb)','EXECUTE') helper",
    );
    if (!privileges.rows[0].wrapper || privileges.rows[0].anonymous || privileges.rows[0].helper) {
      throw new Error('staff QR wrapper or internal helper execution grants are unsafe');
    }

    const prepared = await createQr(operator, {
      action: 'prepareWrite',
      deviceId: 'writer-test',
      requestKey: '30000000-0000-4000-8000-000000000001',
      protocolVersion: 3,
    });
    const job = prepared.job as { tagId?: string } | undefined;
    if (!job?.tagId || job.tagId === tagId) throw new Error('generic writer allocation selected a QR-only identity');
    const physicalTag = await db.query<{ entry_channel: string }>('select entry_channel from public.tags where id=$1', [job.tagId]);
    if (physicalTag.rows[0]?.entry_channel !== 'nfc') throw new Error('new physical inventory did not retain the NFC entry channel');
  } finally {
    await db.close();
  }
});

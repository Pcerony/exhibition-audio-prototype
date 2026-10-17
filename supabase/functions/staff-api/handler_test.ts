import { createHandler } from './handler.ts';
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}
const id = '10000000-0000-4000-8000-000000000011';
function fixture(
  role: string | null = 'staff',
  valid = true,
  data: unknown = { ok: true },
  error: unknown = null,
  configured = true,
) {
  const calls: unknown[] = [];
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: valid ? { id } : null },
        error: valid ? null : {},
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: role ? { role } : null,
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data, error };
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string, seconds: number) => {
          calls.push({ path, seconds });
          return {
            data: { signedUrl: 'https://example.invalid/signed' },
            error: null,
          };
        },
      }),
    },
  };
  return { handler: createHandler(() => client as never, () => configured), calls };
}
function request(body: unknown, token = 'test-jwt') {
  return new Request('https://example.invalid/staff-api', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
Deno.test('staff retry validates language and version, requires provider, and forwards verified fields only', async () => {
 const body={action:'retryTranscription',recordingId:id,memberId:'wang-heisei',version:2,languageHint:'zh'};
 const f=fixture();equal((await f.handler(request({...body,memberName:'forged',text:'secret'}))).status,200);
 equal(f.calls,[{name:'staff_action',args:{p_operator:id,p_body:body}}]);
 for(const change of [{languageHint:'zh-TW'},{languageHint:null},{languageHint:undefined},{version:1.5},{version:0},{memberId:''},{recordingId:'bad'}]) {
  const invalid=fixture();equal((await invalid.handler(request({...body,...change}))).status,400);equal(invalid.calls,[]);
 }
 const missing=fixture('staff',true,null,null,false);
 const unavailable=await missing.handler(request(body));equal(unavailable.status,503);equal(await unavailable.json(),{code:'TRANSCRIPTION_NOT_CONFIGURED'});equal(missing.calls,[]);
 for(const [code,status] of [['TRANSCRIPTION_RATE_LIMITED',429],['TRANSCRIPTION_IN_PROGRESS',409]] as const){
  const response=await fixture('staff',true,null,{message:code+' secret'}).handler(request(body));equal(response.status,status);equal(await response.json(),{code});
 }
});
Deno.test(
  'staff API denies anonymous, forged and non-member identities',
  async () => {
    equal(
      (
        await fixture().handler(
          new Request('https://example.invalid', { method: 'POST' }),
        )
      ).status,
      401,
    );
    for (const f of [
      fixture('staff', false),
      fixture(null),
      fixture('visitor'),
    ]) {
      const r = await f.handler(request({ action: 'list' }));
      if (![401, 403].includes(r.status)) throw Error('not rejected');
      equal(f.calls, []);
    }
  },
);
Deno.test(
  'staff API never delegates privileged actions and rejects invalid mutation inputs',
  async () => {
    for (const body of [
      { action: 'reset' },
      { action: 'createCards' },
      { action: 'provision' },
      { action: 'setPieceAssignment' },
      {
        action: 'save',
        recordingId: id,
        memberId: 'member',
        version: 0,
        text: 'text',
        published: true,
      },
      {
        action: 'save',
        recordingId: id,
        memberId: 'member',
        version: 1,
        text: ' \u3000\u00a0 ',
        published: true,
      },
      {
        action: 'save',
        recordingId: id,
        memberId: 'member',
        version: 1,
        text: 'x'.repeat(10001),
        published: false,
      },
      { action: 'list', limit: 500 },
      { action: 'list', reviewState: 'other' },
      { action: 'list', categoryCode: 'Z' },
      { action: 'history', tagId: 'invalid' },
      {
        action: 'activity',
        recordingId: id,
        memberId: 'member',
        event: 'reset',
      },
    ]) {
      const f = fixture();
      equal((await f.handler(request(body))).status, 400);
      equal(f.calls, []);
    }
  },
);
Deno.test(
  'staff RPC uses verified account and playback only returns a short signed URL',
  async () => {
    const f = fixture('staff', true, { objectPath: 'private/object' });
    const r = await f.handler(
      request({
        action: 'playback',
        recordingId: id,
        memberId: 'member',
        userId: 'forged',
        memberName: 'forged',
      }),
    );
    equal(await r.json(), {
      url: 'https://example.invalid/signed',
      expiresInSeconds: 120,
    });
    equal(f.calls, [
      {
        name: 'staff_action',
        args: {
          p_operator: id,
          p_body: { action: 'playback', recordingId: id, memberId: 'member' },
        },
      },
      { path: 'private/object', seconds: 120 },
    ]);
  },
);
Deno.test('staff list forwards an allowed memory category filter', async () => {
  const f = fixture('staff', true, { cards: [], total: 0 });
  const response = await f.handler(
    request({ action: 'list', categoryCode: 'C', offset: 30, limit: 30 }),
  );
  equal(response.status, 200);
  equal(f.calls, [
    {
      name: 'staff_action',
      args: {
        p_operator: id,
        p_body: { action: 'list', categoryCode: 'C', offset: 30, limit: 30 },
      },
    },
  ]);
});
Deno.test(
  'staff API sanitizes errors, handles conflicts and permits existing admin sign-in',
  async () => {
    const f = fixture('staff', true, null, {
      code: 'P0001',
      message: 'VERSION_CONFLICT database private text',
    });
    const r = await f.handler(
      request({
        action: 'save',
        recordingId: id,
        memberId: 'member',
        version: 1,
        text: 'review',
        published: true,
      }),
    );
    equal(r.status, 409);
    equal(await r.json(), { code: 'VERSION_CONFLICT' });
    for (const role of ['admin', 'operator', 'staff'])
      equal(
        (await fixture(role).handler(request({ action: 'session' }))).status,
        200,
      );
  },
);

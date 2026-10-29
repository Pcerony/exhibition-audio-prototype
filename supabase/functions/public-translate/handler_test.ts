import { createHandler } from './handler.ts';

function assert(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function fixture(options: {
  tagStatus?: string;
  tagFound?: boolean;
  transcriptionConsent?: boolean;
  transcriptPublished?: boolean;
  transcriptReady?: boolean;
  currentTranscriptVisible?: boolean;
  cachedTranslation?: string;
  providerStatus?: number;
  providerConfigured?: boolean;
  providerFinishReason?: string;
  providerDelay?: boolean;
  leaseLostBeforeCommit?: boolean;
} = {}) {
  const cache = new Map<string, string>();
  if (options.cachedTranslation) cache.set('recording-1:4:en', options.cachedTranslation);
  const writes: Record<string, unknown>[] = [];
  const providerRequests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  let providerCalls = 0;
  let activeLease = '';
  let transcriptReads = 0;
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query: Record<string, (...args: never[]) => unknown> = {};
      query.select = (() => query) as never;
      query.eq = ((field: string, value: unknown) => { filters[field] = value; return query; }) as never;
      query.is = ((field: string, value: unknown) => { filters[field] = value; return query; }) as never;
      query.maybeSingle = (async () => {
        if (table === 'tags') {
          if (options.tagFound === false) return { data: null, error: null };
          return { data: { id: 'tag-1', status: options.tagStatus ?? 'bound', recordings: [{ id: 'recording-1', transcription_consent: options.transcriptionConsent !== false }] }, error: null };
        }
        if (table === 'recording_transcriptions') {
          transcriptReads++;
          const visible = options.transcriptPublished !== false && options.transcriptReady !== false
            && (transcriptReads === 1 || options.currentTranscriptVisible !== false)
            && filters.status === 'ready' && filters.published === true;
          return { data: visible ? { text: '福岡の思い出', version: 4 } : null, error: null };
        }
        if (table === 'recording_translations') {
          const key = `${filters.recording_id}:${filters.source_version}:${filters.target_language}`;
          const translation = cache.get(key);
          return { data: translation ? { translated_text: translation } : null, error: null };
        }
        throw new Error(`unexpected table ${table}`);
      }) as never;
      query.upsert = (async (row: Record<string, unknown>) => {
        writes.push(row);
        const key = `${row.recording_id}:${row.source_version}:${row.target_language}`;
        cache.set(key, String(row.translated_text));
        return { error: null };
      }) as never;
      return query;
    },
    async rpc(name: string, args: Record<string, string | number>) {
      if (name === 'acquire_recording_translation_lease') {
        if (activeLease) return { data: false, error: null };
        activeLease = String(args.p_lease_token);
        return { data: true, error: null };
      }
      if (name === 'complete_recording_translation') {
        if (options.leaseLostBeforeCommit) activeLease = 'reclaimed-by-another-request';
        if (activeLease !== args.p_lease_token) return { data: false, error: null };
        const row = {
          recording_id: args.p_recording_id,
          source_version: args.p_source_version,
          target_language: args.p_target_language,
          translated_text: args.p_translated_text,
        };
        writes.push(row);
        cache.set(`${row.recording_id}:${row.source_version}:${row.target_language}`, String(row.translated_text));
        activeLease = '';
        return { data: true, error: null };
      }
      if (name === 'release_recording_translation_lease') {
        if (activeLease === args.p_lease_token) activeLease = '';
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const getClient = () => client as never;
  const env = (name: string) => name === 'GROQ_API_KEY' && options.providerConfigured !== false ? 'server-only-test-key' : undefined;
  const providerFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    providerCalls++;
    providerRequests.push({ input, init });
    if (options.providerDelay) await new Promise((resolve) => setTimeout(resolve, 20));
    if (options.providerStatus && options.providerStatus !== 200) {
      return new Response('provider details must not escape', { status: options.providerStatus });
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: options.providerFinishReason ?? 'stop', message: { content: 'A memory of Fukuoka' } }] }));
  };
  const handler = createHandler(getClient, env, providerFetch);
  const secondHandler = createHandler(getClient, env, providerFetch);
  return { handler, secondHandler, cache, writes, providerRequests, get providerCalls() { return providerCalls; } };
}

function request(body: unknown, method = 'POST') {
  return new Request('https://local/functions/v1/public-translate', {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
}

Deno.test('public translation rejects unsupported target languages before touching data', async () => {
    const f = fixture();
    const response = await f.handler(request({ token: 'a'.repeat(48), targetLanguage: 'xx' }));
    assertEquals(response.status, 400);
    assertEquals((await response.json()).code, 'LANGUAGE_UNSUPPORTED');
    assertEquals(f.providerCalls, 0);
});

Deno.test('public translation requires an active tag with published ready text', async () => {
    const disabled = fixture({ tagStatus: 'disabled' });
    const disabledResponse = await disabled.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(disabledResponse.status, 410);
    assertEquals((await disabledResponse.json()).code, 'TAG_UNAVAILABLE');

    const hidden = fixture({ transcriptPublished: false });
    const hiddenResponse = await hidden.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(hiddenResponse.status, 409);
    assertEquals((await hiddenResponse.json()).code, 'TRANSLATION_NOT_AVAILABLE');
    assertEquals(hidden.providerCalls, 0);
});

Deno.test('public translation rejects unknown, unbound, and unconsented sources', async () => {
    const unknown = fixture({ tagFound: false });
    const unknownResponse = await unknown.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(unknownResponse.status, 404);
    assertEquals((await unknownResponse.json()).code, 'TAG_NOT_FOUND');

    const unbound = fixture({ tagStatus: 'unbound' });
    const unboundResponse = await unbound.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(unboundResponse.status, 404);
    assertEquals((await unboundResponse.json()).code, 'RECORDING_NOT_FOUND');

    const unconsented = fixture({ transcriptionConsent: false });
    const unconsentedResponse = await unconsented.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(unconsentedResponse.status, 409);
    assertEquals((await unconsentedResponse.json()).code, 'TRANSLATION_NOT_AVAILABLE');
    assertEquals(unconsented.providerCalls, 0);
});

Deno.test('public translation serves versioned cache without calling the provider', async () => {
    const f = fixture({ cachedTranslation: 'A cached Fukuoka memory' });
    const response = await f.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { translation: 'A cached Fukuoka memory', targetLanguage: 'en', cached: true });
    assertEquals(f.providerCalls, 0);
});

Deno.test('public translation translates only on request and caches by source version and language', async () => {
    const f = fixture();
    const response = await f.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(response.status, 200);
    assertEquals(await response.json(), { translation: 'A memory of Fukuoka', targetLanguage: 'en', cached: false });
    assertEquals(f.providerCalls, 1);
    assertEquals(f.writes, [{ recording_id: 'recording-1', source_version: 4, target_language: 'en', translated_text: 'A memory of Fukuoka' }]);
    const providerRequest = f.providerRequests[0];
    assertEquals(providerRequest.input, 'https://api.groq.com/openai/v1/chat/completions');
    assertEquals(new Headers(providerRequest.init?.headers).get('authorization'), 'Bearer server-only-test-key');
    const providerBody = JSON.parse(String(providerRequest.init?.body));
    assertEquals(providerBody.model, 'openai/gpt-oss-20b');
    assertEquals(providerBody.messages[1].content, '福岡の思い出');
    assert(providerBody.messages[0].content.includes('English'));
    const cached = await f.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(await cached.json(), { translation: 'A memory of Fukuoka', targetLanguage: 'en', cached: true });
    assertEquals(f.providerCalls, 1);
});

Deno.test('public translation hides provider failures and does not cache them', async () => {
    const f = fixture({ providerStatus: 429 });
    const response = await f.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(response.status, 503);
    assertEquals(await response.json(), { code: 'TRANSLATION_UNAVAILABLE' });
    assertEquals(f.writes, []);
});

Deno.test('public translation does not cache truncated provider output', async () => {
    const f = fixture({ providerFinishReason: 'length' });
    const response = await f.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(response.status, 503);
    assertEquals(await response.json(), { code: 'TRANSLATION_UNAVAILABLE' });
    assertEquals(f.writes, []);
});

Deno.test('simultaneous misses across handler instances share one provider request', async () => {
    const f = fixture({ providerDelay: true });
    const [first, second] = await Promise.all([
      f.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' })),
      f.secondHandler(request({ token: 'a'.repeat(48), targetLanguage: 'en' })),
    ]);
    const results = await Promise.all([first.json(), second.json()]);
    assertEquals(results.map((result) => result.translation), ['A memory of Fukuoka', 'A memory of Fukuoka']);
    assertEquals(results.map((result) => result.cached).sort(), [false, true]);
    assertEquals(f.providerCalls, 1);
});

Deno.test('a stale lease owner cannot cache a translation after its lease is reclaimed', async () => {
    const f = fixture({ leaseLostBeforeCommit: true });
    const response = await f.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(response.status, 503);
    assertEquals(await response.json(), { code: 'TRANSLATION_UNAVAILABLE' });
    assertEquals(f.writes, []);
});

Deno.test('public translation does not cache a result if the source is hidden during generation', async () => {
    const f = fixture({ currentTranscriptVisible: false });
    const response = await f.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(response.status, 409);
    assertEquals((await response.json()).code, 'TRANSLATION_NOT_AVAILABLE');
    assertEquals(f.writes, []);
});

Deno.test('public translation reports missing server configuration without exposing provider data', async () => {
    const f = fixture({ providerConfigured: false });
    const response = await f.handler(request({ token: 'a'.repeat(48), targetLanguage: 'en' }));
    assertEquals(response.status, 503);
    assertEquals(await response.json(), { code: 'TRANSLATION_NOT_CONFIGURED' });
    assertEquals(f.providerCalls, 0);
});

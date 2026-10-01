import { runMaintenance } from './maintenance.ts';

Deno.test('failed storage deletions remain in durable queue and successful ones are acknowledged', async () => {
  const acknowledged: string[] = [];
  const client = {
    rpc: async () => ({ data: [{ object_path: 'good' }, { object_path: 'retry' }], error: null }),
    storage: { from: () => ({ remove: async (paths: string[]) => ({ error: paths[0] === 'retry' ? new Error('offline') : null }) }) },
    from: () => ({
      delete: () => ({ eq: async (_key: string, path: string) => { acknowledged.push(path); return { error: null }; } }),
      select: async () => ({ count: 1, error: null }),
    }),
  };
  const result = await runMaintenance(client as never);
  if (JSON.stringify(result) !== JSON.stringify({ removed: 1, pending: 1 }) || acknowledged.join() !== 'good') throw new Error('cleanup did not preserve failed candidate');
});

Deno.test('database failure never starts object deletion', async () => {
  let deleted = false;
  const client = {
    rpc: async () => ({ data: null, error: new Error('offline') }),
    storage: { from: () => ({ remove: async () => { deleted = true; return { error: null }; } }) },
  };
  try { await runMaintenance(client as never); throw new Error('accepted database failure'); }
  catch (error) { if (!(error instanceof Error) || error.message !== 'MAINTENANCE_UNAVAILABLE') throw error; }
  if (deleted) throw new Error('deleted without proven safe candidates');
});

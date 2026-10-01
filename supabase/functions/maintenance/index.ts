import { adminClient } from '../_shared/client.ts';
import { json, sha256 } from '../_shared/http.ts';
import { runMaintenance } from '../_shared/maintenance.ts';

// Configure a high-entropy MAINTENANCE_SECRET in Edge secrets and cron's Vault.
// Cron sends POST with x-maintenance-secret; never expose it to client bundles.
Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const expected = Deno.env.get('MAINTENANCE_SECRET');
  const supplied = request.headers.get('x-maintenance-secret');
  if (!expected || !supplied || await sha256(expected) !== await sha256(supplied)) return json({ code: 'AUTH_REQUIRED' }, 401);
  try { return json(await runMaintenance(adminClient())); }
  catch { return json({ code: 'MAINTENANCE_UNAVAILABLE' }, 503); }
});

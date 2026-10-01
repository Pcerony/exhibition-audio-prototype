import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('admin migration protects privileged RPC and atomically invalidates reset sessions', () => {
  const sql = readFileSync('supabase/migrations/202610010001_operator_management.sql', 'utf8');
  assert.match(sql, /revoke all on function public\.admin_action/);
  assert.match(sql, /operator_profiles/);
  assert.match(sql, /invalidated_at/);
  assert.match(sql, /storage_cleanup_queue/);
  assert.match(sql, /for update/);
});
test('claim endpoint never deletes a candidate object based on a stale lookup', () => {
  const source = readFileSync('supabase/functions/public-upload-claim/index.ts', 'utf8');
  assert.doesNotMatch(source, /\.remove\(/);
  assert.doesNotMatch(source, /removeUnclaimedObject/);
});

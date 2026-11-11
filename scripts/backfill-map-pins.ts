import { execFileSync } from 'node:child_process';
import { parseMemoryLocation } from '../src/domain/location.ts';
import { mapPinRecommendation } from '../src/domain/mapPinRecommendation.ts';

const cli = ['--yes', 'supabase@latest', 'db', 'query', '--remote'];
function query(statement: string) {
  return JSON.parse(execFileSync('npx', [...cli, '--read-only', '-o', 'json', statement], { encoding: 'utf8' })).rows;
}
const counts: Record<string, number> = { assigned: 0, needs_review: 0, outside_map: 0, invalid: 0 };
const calls: string[] = [];
let after = '00000000-0000-0000-0000-000000000000';
for (;;) {
  const rows = query(`select id,location from public.recordings where id > '${after}' and location->>'source'='pin' order by id limit 200`);
  if (!rows.length) break;
  for (const row of rows) {
    if (!/^[a-f0-9-]{36}$/.test(row.id)) throw new Error('Unexpected ID');
    after = row.id;
    let point;
    try { point = parseMemoryLocation(row.location); } catch { counts.invalid++; continue; }
    if (point?.source !== 'pin') throw new Error('Unexpected location type');
    const result = mapPinRecommendation(point);
    counts[result.state]++;
    calls.push(`perform public.save_recording_pin_recommendation('${row.id}', '${result.state}', ${result.pieceCode ? `'${result.pieceCode}'` : 'null'}, ${result.x ?? 'null'}, ${result.y ?? 'null'});`);
  }
}
if (process.argv.includes('--apply') && calls.length) {
  execFileSync('npx', [...cli, '--yes', '--file', '/dev/stdin'], {
    input: `do $backfill$ begin\n${calls.join('\n')}\nend $backfill$;`, stdio: ['pipe', 'pipe', 'pipe'],
  });
}
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'preview', ...counts }));

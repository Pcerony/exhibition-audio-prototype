import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const { url, size, sha256 } = JSON.parse(await readFile('dist/updates/android.json', 'utf8'));
if (!/^https:\/\/github\.com\/Pcerony\/exhibition-audio-prototype\/releases\/download\/[\w.-]+\/[\w.-]+\.apk$/.test(url)
  || !/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(size) || size < 1 || size > 50_000_000) {
  throw new Error('Invalid Android release manifest');
}
let source = url;
let apk;
for (let hop = 0; hop < 5; hop++) {
  const response = await fetch(source, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) throw new Error('Missing release asset location');
    const next = new URL(location, source);
    if (next.protocol !== 'https:' || next.port || next.username || next.password
      || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(next.hostname)) {
      throw new Error('Unexpected release asset host');
    }
    source = next.href;
    continue;
  }
  if (response.status !== 200) throw new Error(`Android release returned HTTP ${response.status}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > size) throw new Error('Android release size mismatch');
    chunks.push(chunk);
  }
  apk = Buffer.concat(chunks);
  break;
}
if (!apk || apk.length !== size || createHash('sha256').update(apk).digest('hex') !== sha256) {
  throw new Error('Android release does not match update manifest');
}
await mkdir('dist/updates/apk', { recursive: true });
await writeFile(`dist/updates/apk/${sha256}.apk`, apk);
console.log('Verified Android release mirrored into Pages artifact.');

import { createServer } from 'vite';
import { soundMapCloudClient } from './sound-map-cloud-client.mjs';
import { createHandler } from '../supabase/functions/public-map/handler.ts';

const client = await soundMapCloudClient();
const handler = createHandler(() => client);
process.env.VITE_SOUND_MAP_LOCAL_API = '/__local/public-map';
const server = await createServer({
  server: { host: '127.0.0.1', port: 4180, strictPort: false },
  plugins: [{
    name: 'localhost-read-only-sound-map',
    configureServer(vite) {
      vite.middlewares.use('/__local/public-map', async (req, res) => {
        const host = req.headers.host ?? '';
        const origin = req.headers.origin;
        if (!/^127\.0\.0\.1:\d+$/.test(host) || (origin && origin !== `http://${host}`)) {
          res.writeHead(403); res.end(); return;
        }
        const response = await handler(new Request(`http://${host}/?${(req.url ?? '').split('?')[1] ?? ''}`, { method: req.method }));
        res.writeHead(response.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(await response.text());
      });
    },
  }],
});
await server.listen();
server.printUrls();
console.log('Sound map: local read-only catalog; recording/playback use the existing cloud APIs. No deployment performed.');

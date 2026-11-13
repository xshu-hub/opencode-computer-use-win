import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/settings.js', ['settings.js', 'text/javascript; charset=utf-8']],
]);
export async function createSettingsServer({ store, onChange, getStatus, onLocale, assetRoot = new URL('../dist/', import.meta.url) }) {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const respond = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== `127.0.0.1:${server.address().port}`) return respond(403, { error: 'Invalid host' });
      const origin = `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== origin) return respond(403, { error: 'Invalid origin' });
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      const pathname = new URL(req.url, origin).pathname;
      if (assets.has(pathname) && req.method === 'GET') {
        const [file, mime] = assets.get(pathname);
        const body = await readFile(fileURLToPath(new URL(file, assetRoot)));
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); return res.end(body);
      }
      const auth = req.headers.authorization ?? '';
      const supplied = Buffer.from(auth.startsWith('Bearer ') ? auth.slice(7) : '');
      if (supplied.length !== token.length || !timingSafeEqual(Buffer.from(token), supplied)) return respond(401, { error: 'Open settings from the Computer Use command' });
      if (pathname === '/api/settings' && req.method === 'GET') return respond(200, { ...await store.snapshot(), status: getStatus() });
      if (pathname === '/api/status' && req.method === 'GET') return respond(200, getStatus());
      if (pathname === '/api/locale' && req.method === 'POST' && onLocale) {
        if (!req.headers['content-type']?.startsWith('application/json')) return respond(415, { error: 'JSON required' });
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 128) return respond(413, { error: 'Request too large' }); }
        const { locale } = JSON.parse(body); if (!['zh','en'].includes(locale)) throw Error('Unsupported language');
        await onLocale(locale); return respond(200, { locale });
      }
      if (pathname === '/api/settings' && req.method === 'PATCH') {
        if (!req.headers['content-type']?.startsWith('application/json')) return respond(415, { error: 'JSON required' });
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 32768) return respond(413, { error: 'Request too large' }); }
        const input = JSON.parse(body);
        const snapshot = await store.patch(input.patch, input.revision);
        await onChange(snapshot);
        return respond(200, { ...snapshot, status: getStatus() });
      }
      respond(404, { error: 'Not found' });
    } catch (error) { respond(error.status ?? (error.code === 'ENOENT' ? 503 : 400), { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); server.unref();
  return { url: `http://127.0.0.1:${server.address().port}/#${token}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

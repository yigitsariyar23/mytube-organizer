import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/tests/dashboard') {
      const html = (await fs.readFile(path.join(root, 'dashboard/dashboard.html'), 'utf8'))
        .replace('<head>', '<head><base href="/dashboard/">')
        .replace('<script type="module" src="dashboard.js"></script>', '<script type="module" src="/tests/browser-fixture.js"></script>');
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Content-Security-Policy': "script-src 'self'; object-src 'self'" }); response.end(html); return;
    }
    if (!/^\/(dashboard\/|shared\/|icons\/|tests\/browser-(fixture|smoke)\.js$|background\.js$|version\.json$)/.test(url.pathname)) throw new Error('Not a fixture asset');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || url.pathname.includes('/.')) throw new Error('Invalid path');
    const data = await fs.readFile(file);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(data);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(8767, '127.0.0.1', () => console.log('Synthetic dashboard: http://127.0.0.1:8767/tests/dashboard'));

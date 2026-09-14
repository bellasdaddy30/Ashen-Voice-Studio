import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, '.codespace-test', 'dist');
const port = 8091;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store, max-age=0',
    'X-Ashen-Test-Server': 'STATIC-CHATTERBOX-8091'
  });
  res.end(body);
}

function diagnostic(res) {
  const exists = fs.existsSync(dist);
  const files = exists ? fs.readdirSync(dist).join(', ') : '(dist directory does not exist)';
  send(res, 200, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ashen 8091 Diagnostic</title><style>body{margin:0;background:#111;color:#fff;font:16px system-ui;padding:24px}.box{max-width:760px;margin:auto;border:2px solid #8b5;padding:20px;border-radius:16px}code,pre{background:#000;padding:8px;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere}.ok{color:#9f9}.bad{color:#faa}</style></head><body><div class="box"><h1>ASHEN 8091 SERVER IS ALIVE</h1><p class="${exists ? 'ok' : 'bad'}">Static build directory: ${exists ? 'FOUND' : 'MISSING'}</p><p>This page is generated directly by the Codespace server. Kokoro is not involved.</p><pre>root: ${root}\ndist: ${dist}\nfiles: ${files}</pre><p>If the build exists, reload <code>/</code>. If it is missing, the Codespace setup/build failed before the voice test could start.</p></div></body></html>`);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/__ashen_health') return diagnostic(res);

    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const target = path.normalize(path.join(dist, rel));

    if (!target.startsWith(dist)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');

    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      if (rel === '/index.html') return diagnostic(res);
      return send(res, 404, `Not found: ${rel}`, 'text/plain; charset=utf-8');
    }

    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store, max-age=0',
      'X-Ashen-Test-Server': 'STATIC-CHATTERBOX-8091'
    });
    fs.createReadStream(target).pipe(res);
  } catch (e) {
    send(res, 500, `<pre>${String(e?.stack || e)}</pre>`);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Ashen static Chatterbox server listening on 0.0.0.0:${port}`);
  console.log(`dist exists: ${fs.existsSync(dist)}`);
});

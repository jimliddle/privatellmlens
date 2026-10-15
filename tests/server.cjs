const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.pdf': 'application/pdf', '.wasm': 'application/wasm' };
http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname === '/native') {
    let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    html = html.replace('<head>', '<head><script src="/tests/browser/native-bootstrap.js"></script>');
    html = html.replace('https://cdn.jsdelivr.net/npm/coi-serviceworker@0.1.7/coi-serviceworker.min.js', '/tests/browser/empty.js');
    html = html.replace('https://cdn.jsdelivr.net/npm/dompurify@3.4.17/dist/purify.min.js', '/node_modules/dompurify/dist/purify.min.js');
    html = html.replace('https://cdn.jsdelivr.net/npm/marked@18.1.1/lib/marked.umd.js', '/node_modules/marked/lib/marked.umd.js');
    html = html.replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', '/node_modules/jszip/dist/jszip.min.js');
    html = html.replace('https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/', 'http://127.0.0.1:18767/node_modules/pdfjs-dist/');
    html = html.replace('indexedDB.open("PrivateLLMLensEnhanced", 6)', 'indexedDB.open("PrivateLLMLensTest-' + require('node:crypto').randomUUID() + '", 6)');
    html = html.replace(/<\/body>\s*<\/html>\s*$/, '<script src="/tests/browser/native-checks.js"></script></body></html>');
    response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); return;
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(response);
}).listen(18767, '127.0.0.1');

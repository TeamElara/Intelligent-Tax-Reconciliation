// Tiny static server for local testing: node tools/serve.js [port]
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), port = +process.argv[2] || 8765;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.json':'application/json', '.css':'text/css', '.csv':'text/csv' };
http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'content-type':types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(port, () => console.log('http://localhost:' + port));

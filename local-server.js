'use strict';
// $hellgame server. Zero dependencies: http + SSE + JSON file persistence.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Game } = require('./lib/game');

const PORT = Number(process.env.PORT) || 3666;
const CONTENT = process.env.CONTENT || path.join(__dirname, 'content', 'game.json');
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'data', 'state.json');
const PUBLIC = path.join(__dirname, 'public');
let HOST_KEY = process.env.HOST_KEY;
if (!HOST_KEY) {
  HOST_KEY = crypto.randomBytes(6).toString('hex');
  console.log(`[hellgame] HOST_KEY not set. Generated one for this run: ${HOST_KEY}`);
}
const COOKIE_VAL = crypto.createHmac('sha256', HOST_KEY).update('hellgame-host').digest('hex');

const content = JSON.parse(fs.readFileSync(CONTENT, 'utf8'));
const game = new Game(content);
try { game.restore(fs.readFileSync(STATE_FILE, 'utf8')); console.log('[hellgame] restored saved state'); } catch (_) { /* fresh */ }

// ---------- persistence ----------
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE + '.tmp', game.serialize());
      fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    } catch (e) { console.error('save failed', e.message); }
  }, 400);
}

// ---------- SSE ----------
const clients = new Set(); // { res, role, token }
let pushTimer = null;
function pushAll() {
  scheduleSave();
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; for (const c of clients) sendState(c); }, 20);
}
function viewFor(c) {
  if (c.role === 'host') return game.boardView(true);
  if (c.role === 'player') return game.playerView(c.token);
  return game.boardView(false);
}
function sendState(c) {
  try { c.res.write(`event: state\ndata: ${JSON.stringify(viewFor(c))}\n\n`); } catch (_) { clients.delete(c); }
}
game.onChange(pushAll);
setInterval(() => game.tick(), 250);
setInterval(() => { for (const c of clients) { try { c.res.write(': ping\n\n'); } catch (_) { clients.delete(c); } } }, 15000);

// ---------- helpers ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.mp3': 'audio/mpeg' };
const PAGES = { '/': 'play.html', '/play': 'play.html', '/host': 'host.html', '/board': 'board.html' };

function secHeaders(extra = {}) {
  return Object.assign({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  }, extra);
}
function json(res, code, obj, extra) {
  res.writeHead(code, secHeaders(Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extra)));
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (d) => { n += d.length; if (n > 4096) { reject(new Error('too big')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function cookie(req, name) {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : '';
}
function safeEq(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
const isHost = (req) => safeEq(cookie(req, 'hg_host'), COOKIE_VAL);

// simple per-key rate limiter: `limit` events per `windowMs`
const buckets = new Map();
function limited(key, limit, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { t: now, n: 0 };
  if (now - b.t > windowMs) { b.t = now; b.n = 0; }
  b.n += 1; buckets.set(key, b);
  return b.n > limit;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 120000) buckets.delete(k); }, 60000);
const ipOf = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// ---------- routes ----------
async function api(req, res, url) {
  const ip = ipOf(req);
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const role = url.searchParams.get('role');
    const token = url.searchParams.get('token') || '';
    if (role === 'host' && !isHost(req)) return json(res, 401, { error: 'auth' });
    if (role === 'player' && !game.s.players[token]) return json(res, 404, { error: 'unknown player' });
    if (!['host', 'player', 'board'].includes(role)) return json(res, 400, { error: 'role' });
    if (clients.size > 400) return json(res, 503, { error: 'busy' });
    res.writeHead(200, secHeaders({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }));
    res.write('retry: 1000\n\n');
    const c = { res, role, token };
    clients.add(c);
    sendState(c);
    req.on('close', () => clients.delete(c));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const role = url.searchParams.get('role');
    if (!['host', 'player', 'board'].includes(role)) return json(res, 400, { error: 'role' });
    if (role === 'host' && !isHost(req)) return json(res, 401, { error: 'auth' });
    return json(res, 200, { view: viewFor({ role, token: url.searchParams.get('token') || '' }) });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  if (!/^application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'json only' });
  let body;
  try { body = await readBody(req); } catch (_) { return json(res, 400, { error: 'bad body' }); }

  if (url.pathname === '/api/host/login') {
    if (limited('login:' + ip, 8, 60000)) return json(res, 429, { error: 'slow down, mortal' });
    if (!safeEq(body.key || '', HOST_KEY)) return json(res, 401, { error: 'wrong key' });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return json(res, 200, { ok: true }, { 'Set-Cookie': `hg_host=${COOKIE_VAL}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure}` });
  }
  if (url.pathname.startsWith('/api/host/')) {
    if (!isHost(req)) return json(res, 401, { error: 'auth' });
    return json(res, 200, game.host(url.pathname.slice('/api/host/'.length), body));
  }
  if (url.pathname === '/api/join') {
    if (limited('join:' + ip, 30, 60000)) return json(res, 429, { error: 'slow down' });
    return json(res, 200, game.join(body));
  }
  const token = String(body.token || '');
  if (limited('tok:' + token, 25, 1000)) return json(res, 429, { error: 'too fast' });
  switch (url.pathname) {
    case '/api/buzz': return json(res, 200, game.buzz(token));
    case '/api/solve': return json(res, 200, game.solve(token, body.answer));
    case '/api/final/wager': return json(res, 200, game.playerFinalWager(token, body.amount));
    case '/api/final/answer': return json(res, 200, game.finalAnswer(token, body.text));
    default: return json(res, 404, { error: 'nope' });
  }
}

function serveStatic(req, res, url) {
  let rel = PAGES[url.pathname] || decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, secHeaders({ 'Content-Type': 'text/plain' })); return res.end('404: this page has been eaten.'); }
    res.writeHead(200, secHeaders({ 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }));
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (_) { res.writeHead(400); return res.end(); }
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch((e) => { console.error(e); json(res, 500, { error: 'server' }); });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, url);
});
server.keepAliveTimeout = 65000;
server.listen(PORT, () => console.log(`[hellgame] listening on :${PORT}  host panel: /host  board: /board`));
module.exports = { server, game };

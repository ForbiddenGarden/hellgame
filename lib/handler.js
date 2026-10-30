'use strict';
// Serverless request handler (Vercel). Same API as server.js, but stateless:
// every request loads the game from the store, applies the action, and writes it
// back with compare-and-set. Clients poll /api/state instead of holding an SSE stream.
const crypto = require('crypto');
const { Game } = require('./game');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeEq = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

function makeHandler({ store, content, hostKey }) {
  const cookieVal = hostKey ? crypto.createHmac('sha256', hostKey).update('hellgame-host').digest('hex') : null;
  const buckets = new Map(); // best effort only: each serverless instance has its own
  const limited = (key, limit, windowMs) => {
    const now = Date.now();
    const b = buckets.get(key) || { t: now, n: 0 };
    if (now - b.t > windowMs) { b.t = now; b.n = 0; }
    b.n += 1; buckets.set(key, b);
    if (buckets.size > 5000) buckets.clear();
    return b.n > limit;
  };

  async function load() {
    const { json, rev } = await store.read();
    const game = new Game(content);
    if (json) game.restore(json);
    game.tick();
    return { game, json, rev };
  }

  // Run fn(game) against fresh state and persist; retry the whole action if someone else wrote first.
  async function mutate(fn) {
    for (let i = 0; i < 15; i++) {
      const { game, json, rev } = await load();
      const result = fn(game);
      const out = game.serialize();
      if (out === json || (await store.cas(rev, out))) return result;
      await sleep(5 + Math.random() * 25);
    }
    throw new Error('state contention');
  }

  async function view(role, token) {
    const { game, json, rev } = await load();
    const out = game.serialize();
    if (out !== json) { try { await store.cas(rev, out); } catch (_) { /* someone else ticked it */ } }
    if (role === 'host') return game.boardView(true);
    if (role === 'player') return game.playerView(token);
    return game.boardView(false);
  }

  return async function handler(req, res) {
    const send = (code, obj, extra) => { res.statusCode = code; for (const [k, v] of Object.entries(Object.assign({}, HEADERS, extra))) res.setHeader(k, v); res.end(JSON.stringify(obj)); };
    try {
      const url = new URL(req.url, 'http://x');
      let p = (req.query && req.query.p) || url.searchParams.get('p');
      if (p == null) p = url.pathname.replace(/^\/api\/?/, '');
      p = String(p).replace(/^\/+|\/+$/g, '');
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'local';
      const cookies = req.headers.cookie || '';
      const m = cookies.split(/;\s*/).find((c) => c.startsWith('hg_host='));
      const isHost = !!cookieVal && !!m && safeEq(m.slice(8), cookieVal);

      if (req.method === 'GET' && p === 'state') {
        const role = url.searchParams.get('role');
        if (!['host', 'player', 'board'].includes(role)) return send(400, { error: 'role' });
        if (role === 'host' && !isHost) return send(401, { error: 'auth' });
        return send(200, { view: await view(role, url.searchParams.get('token') || '') });
      }
      if (req.method !== 'POST') return send(p === 'events' ? 404 : 405, { error: 'method' });
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(415, { error: 'json only' });
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { return send(400, { error: 'bad body' }); } }
      body = body && typeof body === 'object' ? body : {};
      if (JSON.stringify(body).length > 4096) return send(413, { error: 'too big' });

      if (p === 'host/login') {
        if (!hostKey) return send(503, { error: 'HOST_KEY is not configured on the server' });
        if (limited('login:' + ip, 8, 60000)) return send(429, { error: 'slow down, mortal' });
        if (!safeEq(body.key || '', hostKey)) return send(401, { error: 'wrong key' });
        return send(200, { ok: true }, { 'Set-Cookie': `hg_host=${cookieVal}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400; Secure` });
      }
      if (p.startsWith('host/')) {
        if (!isHost) return send(401, { error: 'auth' });
        return send(200, await mutate((g) => g.host(p.slice(5), body)));
      }
      if (p === 'join') {
        if (limited('join:' + ip, 30, 60000)) return send(429, { error: 'slow down' });
        return send(200, await mutate((g) => g.join(body)));
      }
      const token = String(body.token || '');
      switch (p) {
        case 'buzz': return send(200, await mutate((g) => g.buzz(token)));
        case 'solve': return send(200, await mutate((g) => g.solve(token, body.answer)));
        case 'final/wager': return send(200, await mutate((g) => g.playerFinalWager(token, body.amount)));
        case 'final/answer': return send(200, await mutate((g) => g.finalAnswer(token, body.text)));
        default: return send(404, { error: 'nope' });
      }
    } catch (e) {
      console.error('[hellgame]', e);
      return send(500, { error: 'server' });
    }
  };
}

module.exports = { makeHandler };

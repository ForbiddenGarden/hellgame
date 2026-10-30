'use strict';
// Where the serverless deployment keeps the game. One JSON blob plus a revision
// counter, updated with compare-and-set so concurrent buzzes serialize cleanly.
//   redisStore: Upstash/Vercel KV over REST (no dependencies)
//   tcpRedisStore: any redis:// or rediss:// URL (Redis Cloud etc.), minimal RESP client over net/tls (no dependencies)
//   memoryStore: for local testing of the serverless handler

const KEY = 'hg:state', REV = 'hg:rev';
// Only writes if the revision is still what the caller read.
const CAS = `local r = tonumber(redis.call('GET', KEYS[2]) or '0')
if r == tonumber(ARGV[1]) then
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('SET', KEYS[2], tostring(r + 1))
  return 1
end
return 0`;

function redisStore(url, token) {
  const call = async (cmd) => {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || `redis ${r.status}`);
    return j.result;
  };
  return {
    async read() {
      const [json, rev] = await call(['MGET', KEY, REV]);
      return { json: json || null, rev: Number(rev || 0) };
    },
    async cas(rev, json) { return (await call(['EVAL', CAS, '2', KEY, REV, String(rev), json])) === 1; },
  };
}

// ---- minimal RESP client: one short-lived connection per call ----
function encode(args) {
  return `*${args.length}\r\n` + args.map((a) => { const b = Buffer.from(String(a)); return `$${b.length}\r\n${b.toString('latin1')}\r\n`; }).join('');
}
// Parses one RESP value from buf at offset; returns [value, nextOffset] or null if incomplete.
function parse(buf, o) {
  if (o >= buf.length) return null;
  const nl = buf.indexOf('\r\n', o, 'latin1');
  if (nl < 0) return null;
  const t = String.fromCharCode(buf[o]), line = buf.toString('latin1', o + 1, nl);
  if (t === '+') return [line, nl + 2];
  if (t === '-') return [new Error(line), nl + 2];
  if (t === ':') return [Number(line), nl + 2];
  if (t === '$') {
    const n = Number(line);
    if (n < 0) return [null, nl + 2];
    if (buf.length < nl + 2 + n + 2) return null;
    return [buf.toString('utf8', nl + 2, nl + 2 + n), nl + 2 + n + 2];
  }
  if (t === '*') {
    const n = Number(line); if (n < 0) return [null, nl + 2];
    const out = []; let p = nl + 2;
    for (let i = 0; i < n; i++) { const r = parse(buf, p); if (!r) return null; out.push(r[0]); p = r[1]; }
    return [out, p];
  }
  throw new Error('bad RESP type ' + t);
}

function tcpRedisStore(redisUrl) {
  const u = new URL(redisUrl);
  const tls = u.protocol === 'rediss:';
  const port = Number(u.port) || 6379;
  const pass = decodeURIComponent(u.password || ''), user = decodeURIComponent(u.username || '');
  const preamble = pass ? [user && user !== 'default' ? ['AUTH', user, pass] : ['AUTH', pass]] : [];
  const run = (cmds) => new Promise((resolve, reject) => {
    const all = preamble.concat(cmds);
    const sock = (tls ? require('tls').connect({ host: u.hostname, port, servername: u.hostname }) : require('net').connect({ host: u.hostname, port }));
    let buf = Buffer.alloc(0), results = [], off = 0, done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(new Error('redis timeout')), 4000);
    sock.on(tls ? 'secureConnect' : 'connect', () => sock.write(Buffer.from(all.map(encode).join(''), 'latin1')));
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        let r;
        while (results.length < all.length && (r = parse(buf, off))) { results.push(r[0]); off = r[1]; }
      } catch (e) { return finish(e); }
      if (results.length === all.length) {
        const bad = results.find((x) => x instanceof Error);
        finish(bad || null, results.slice(preamble.length));
      }
    });
    sock.on('error', (e) => finish(e));
  });
  return {
    async read() {
      const [res] = await run([['MGET', KEY, REV]]);
      return { json: res[0] || null, rev: Number(res[1] || 0) };
    },
    async cas(rev, json) {
      const [res] = await run([['EVAL', CAS, '2', KEY, REV, String(rev), json]]);
      return res === 1;
    },
  };
}

function memoryStore() {
  let json = null, rev = 0;
  return {
    async read() { return { json, rev }; },
    async cas(expect, next) { if (expect !== rev) return false; json = next; rev += 1; return true; },
  };
}

let shared = null;
function defaultStore() {
  if (shared) return shared;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const tcp = process.env.REDIS_URL;
  if (url && token) shared = redisStore(url, token);
  else if (tcp) shared = tcpRedisStore(tcp);
  else if (process.env.VERCEL) {
    // never silently fall back to per-instance memory in production: state would diverge between instances
    const fail = async () => { throw new Error('no Redis configured (set REDIS_URL or KV_REST_API_URL/KV_REST_API_TOKEN)'); };
    shared = { read: fail, cas: fail };
  } else { console.warn('[hellgame] no Redis env vars; using per-instance memory (dev only!)'); shared = memoryStore(); }
  return shared;
}

module.exports = { redisStore, tcpRedisStore, memoryStore, defaultStore };

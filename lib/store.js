'use strict';
// Where the serverless deployment keeps the game. One JSON blob plus a revision
// counter, updated with compare-and-set so concurrent buzzes serialize cleanly.
//   redisStore: Upstash/Vercel KV over REST (no dependencies)
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
  if (url && token) shared = redisStore(url, token);
  else { console.warn('[hellgame] no Redis env vars; using per-instance memory (dev only!)'); shared = memoryStore(); }
  return shared;
}

module.exports = { redisStore, memoryStore, defaultStore };

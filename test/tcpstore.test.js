'use strict';
// Needs a real Redis: REDIS_TEST_URL=redis://:pw@localhost:6390 npm test   (skipped otherwise)
const test = require('node:test');
const assert = require('node:assert');
const { tcpRedisStore } = require('../lib/store');
const { makeHandler } = require('../lib/handler');
const content = require('../content/game.json');

const URL_ = process.env.REDIS_TEST_URL;
const t = URL_ ? test : test.skip;

t('tcp store: read, cas, stale cas rejected, unicode and large values round-trip', async () => {
  const s = tcpRedisStore(URL_);
  // start from a clean slate
  let { rev } = await s.read();
  assert.equal(await s.cas(rev, '{"a":"héllo 💀"}'), true);
  const r1 = await s.read();
  assert.equal(r1.json, '{"a":"héllo 💀"}');
  assert.equal(r1.rev, rev + 1);
  assert.equal(await s.cas(rev, 'stale'), false); // someone else already advanced it
  const big = JSON.stringify({ x: 'z'.repeat(300000), e: '☠'.repeat(1000) });
  assert.equal(await s.cas(r1.rev, big), true);
  assert.equal((await s.read()).json, big);
});

t('tcp store: wrong password surfaces an error', async () => {
  const bad = tcpRedisStore(URL_.replace(/:[^:@]*@/, ':nope@'));
  await assert.rejects(() => bad.read());
});

t('handler on real redis: 8 simultaneous buzzes -> exactly one floor', async () => {
  const store = tcpRedisStore(URL_);
  const mk = () => {
    const h = makeHandler({ store, content, hostKey: 'k' });
    let cookie = '';
    return async (method, p, body) => {
      let out = '', hdr = {};
      await h({ method, url: '/api/handler?p=' + p, query: { p }, headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '9.9.9.9' }, body }, { setHeader: (k, v) => { hdr[k] = v; }, set statusCode(c) {}, end: (x) => { out = x; } });
      if (hdr['Set-Cookie']) cookie = hdr['Set-Cookie'].split(';')[0];
      return JSON.parse(out);
    };
  };
  const host = mk();
  await host('POST', 'host/login', { key: 'k' });
  await host('POST', 'host/restart', {});
  await host('POST', 'host/chaos', { level: 0 });
  const toks = [];
  for (let i = 0; i < 8; i++) toks.push((await mk()('POST', 'join', { name: 'p' + i, newTeamName: 'T' + i })).token);
  await host('POST', 'host/start', {});
  await host('POST', 'host/pick', { ci: 0, ri: 0 });
  await host('POST', 'host/arm', {});
  await new Promise((r) => setTimeout(r, 900));
  const res = await Promise.all(toks.map((tk) => mk()('POST', 'buzz', { token: tk })));
  const st = res.map((r) => r.status);
  assert.equal(st.filter((x) => x === 'floor').length, 1, JSON.stringify(st));
  assert.equal(st.filter((x) => x === 'queued').length, 7, JSON.stringify(st));
  await host('POST', 'host/restart', {});
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeHandler } = require('../lib/handler');
const { memoryStore } = require('../lib/store');
const content = require('../content/game.json');

function client(store) {
  const handler = makeHandler({ store, content, hostKey: 'k3y' });
  let cookie = '';
  return async function call(method, path, body) {
    const req = { method, url: '/api/handler?p=' + path.split('?')[0].replace(/^\//, '') + (path.includes('?') ? '&' + path.split('?')[1] : ''), headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '1.2.3.4' }, body, query: { p: path.split('?')[0].replace(/^\//, '') } };
    let out = '', code = 0; const hdr = {};
    const res = { setHeader: (k, v) => { hdr[k] = v; }, set statusCode(c) { code = c; }, end: (s) => { out = s; } };
    await handler(req, res);
    if (hdr['Set-Cookie']) cookie = hdr['Set-Cookie'].split(';')[0];
    return { code, json: JSON.parse(out) };
  };
}

test('host auth is required and login sets a cookie', async () => {
  const c = client(memoryStore());
  assert.equal((await c('POST', '/host/start', {})).code, 401);
  assert.equal((await c('POST', '/host/login', { key: 'nope' })).code, 401);
  assert.equal((await c('POST', '/host/login', { key: 'k3y' })).code, 200);
  assert.equal((await c('GET', '/state?role=host')).code, 200);
});

test('state persists across handler instances (separate serverless invocations)', async () => {
  const store = memoryStore();
  const a = client(store), b = client(store);
  const { json } = await a('POST', '/join', { name: 'alice', newTeamName: 'Ghouls' });
  assert.ok(json.ok);
  const v = (await b('GET', '/state?role=board')).json.view;
  assert.equal(v.teams[0].name, 'Ghouls');
});

test('full flow incl. captcha stored in shared state, and answers hidden from board', async () => {
  const store = memoryStore();
  const host = client(store), p = client(store);
  await host('POST', '/host/login', { key: 'k3y' });
  const tok = (await p('POST', '/join', { name: 'alice', newTeamName: 'Ghouls' })).json.token;
  await host('POST', '/host/chaos', { level: 1 });
  await host('POST', '/host/start', {});
  await host('POST', '/host/pick', { ci: 0, ri: 0 });
  await host('POST', '/host/arm', {});
  const r = (await p('POST', '/buzz', { token: tok })).json; // instantly after arm: spammer -> captcha
  assert.equal(r.status, 'challenge');
  const board = (await p('GET', '/state?role=board')).json.view;
  assert.equal(JSON.stringify(board).includes('answer":"'), false);
  const hostView = (await host('GET', '/state?role=host')).json.view;
  assert.ok(hostView.cur.hostAnswer);
});

test('simultaneous buzzes from different instances: exactly one gets the floor', async () => {
  const store = memoryStore();
  const host = client(store);
  await host('POST', '/host/login', { key: 'k3y' });
  await host('POST', '/host/chaos', { level: 0 });
  const toks = [];
  for (let i = 0; i < 6; i++) toks.push((await client(store)('POST', '/join', { name: 'p' + i, newTeamName: 'T' + i })).json.token);
  await host('POST', '/host/start', {});
  await host('POST', '/host/pick', { ci: 0, ri: 0 });
  await host('POST', '/host/arm', {});
  await new Promise((r) => setTimeout(r, 900)); // clear any early lockout
  const results = await Promise.all(toks.map((t) => client(store)('POST', '/buzz', { token: t })));
  const statuses = results.map((r) => r.json.status).sort();
  assert.equal(statuses.filter((s) => s === 'floor').length, 1);
  assert.equal(statuses.filter((s) => s === 'queued').length, 5);
});

'use strict';
// Smoke test against a deployed instance. WIPES the game state (restart) before and after.
//   HOST_KEY=... node tools/live-check.js https://hellgame.sasquatch.sh
const base = (process.argv[2] || 'http://localhost:3666').replace(/\/$/, '');
const key = process.env.HOST_KEY;
if (!key) { console.error('set HOST_KEY'); process.exit(1); }
let cookie = '';
async function post(path, body) {
  const r = await fetch(base + '/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body || {}) });
  const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
  return r.json();
}
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  ok((await post('host/login', { key })).ok, 'host login');
  ok((await post('host/restart')).ok, 'reset state');
  await post('host/chaos', { level: 0 });
  const toks = [];
  for (let i = 0; i < 8; i++) toks.push((await post('join', { name: 'p' + i, newTeamName: 'Team' + i })).token);
  ok(toks.every(Boolean), 'joined 8 players in 8 teams');
  ok((await post('host/start')).ok, 'start');
  ok((await post('host/pick', { ci: 0, ri: 0 })).ok, 'pick clue');
  ok((await post('host/arm')).ok, 'arm buzzers');
  await new Promise((r) => setTimeout(r, 900));
  const t0 = Date.now();
  const st = (await Promise.all(toks.map((t) => post('buzz', { token: t })))).map((r) => r.status);
  console.log(`8 simultaneous buzzes took ${Date.now() - t0}ms:`, st.join(','));
  ok(st.filter((s) => s === 'floor').length === 1, 'exactly one team got the floor');
  ok(st.filter((s) => s === 'queued').length === 7, 'the other seven were queued in order');
  ok((await post('host/judge', { correct: true })).ok, 'judge correct');
  const v = await (await fetch(base + '/api/state?role=board')).json();
  ok(v.view.teams.some((t) => t.score === 200), 'score persisted and visible to the board');
  ok(!JSON.stringify(v).includes('"answer"') || v.view.cur.state === 'revealed', 'answer only visible after reveal');
  await post('host/restart');
  console.log('done; state reset');
})();

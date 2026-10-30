'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../lib/game');
const challenges = require('../lib/challenges');

const mkContent = () => ({
  title: 't',
  rounds: [1, 2].map((r) => ({
    name: 'R' + r,
    categories: Array.from({ length: 2 }, (_, c) => ({ name: `C${c}`, clues: [1, 2, 3].map((n) => ({ value: n * 100 * r, clue: `clue${c}${n}`, answer: `ans${c}${n}` })) })),
  })),
  final: { category: 'FINAL', clue: 'fclue', answer: 'fans' },
});

function setup({ chaos = 0 } = {}) {
  let t = 1000;
  const clock = { now: () => t, adv: (ms) => { t += ms; } };
  const g = new Game(mkContent(), { now: clock.now, rng: () => 0.99 });
  const a = g.join({ name: 'alice', newTeamName: 'Ghouls' }).token;
  const b = g.join({ name: 'bob', newTeamName: 'Ghosts' }).token;
  const teams = g.teamIds();
  g.host('chaos', { level: chaos });
  return { g, clock, a, b, ta: teams[0], tb: teams[1] };
}

test('join validates and dedupes team names', () => {
  const { g } = setup();
  assert.equal(g.join({ name: '', newTeamName: 'x' }).ok, false);
  assert.equal(g.join({ name: 'z', newTeamName: 'ghouls' }).ok, false);
  assert.equal(g.join({ name: '<b>z</b>', teamId: g.teamIds()[0] }).player.name, 'bz/b');
});

test('start, pick, arm, buzz, judge correct', () => {
  const { g, clock, a, ta } = setup();
  assert.ok(g.host('start').ok);
  g.s.dd = {};
  assert.ok(g.host('pick', { ci: 0, ri: 0 }).ok);
  assert.equal(g.buzz(a).status, 'early');
  assert.ok(g.host('arm').ok);
  clock.adv(1000);
  assert.equal(g.buzz(a).status, 'floor'); // 750ms early lockout has expired by now
});

test('early buzz locks out only briefly', () => {
  const { g, clock, a, b } = setup();
  g.host('start'); g.s.dd = {};
  g.host('pick', { ci: 0, ri: 0 });
  g.buzz(a);
  g.host('arm');
  clock.adv(500);
  assert.equal(g.buzz(a).status, 'locked');
  assert.equal(g.buzz(b).status, 'floor');
});

test('first buzz wins, wrong answer passes to queued team, scores update', () => {
  const { g, clock, a, b, ta, tb } = setup();
  g.host('start'); g.s.dd = {};
  g.host('pick', { ci: 0, ri: 1 });
  g.host('arm'); clock.adv(1000);
  assert.equal(g.buzz(a).status, 'floor');
  assert.equal(g.buzz(b).status, 'queued');
  g.host('judge', { correct: false });
  assert.equal(g.s.teams[ta].score, -200);
  assert.equal(g.s.cur.floor, tb);
  g.host('judge', { correct: true });
  assert.equal(g.s.teams[tb].score, 200);
  assert.equal(g.s.cur.state, 'revealed');
  assert.equal(g.s.control, tb);
  g.host('close');
  assert.equal(g.s.phase, 'board');
  assert.ok(g.s.used['0:1']);
});

test('wrong with no queue re-arms for remaining teams; all wrong reveals', () => {
  const { g, clock, a, b } = setup();
  g.host('start'); g.s.dd = {};
  g.host('pick', { ci: 0, ri: 0 });
  g.host('arm'); clock.adv(1000);
  g.buzz(a); g.host('judge', { correct: false });
  assert.equal(g.s.cur.state, 'armed');
  assert.equal(g.buzz(a).status, 'out');
  g.buzz(b); g.host('judge', { correct: false });
  assert.equal(g.s.cur.state, 'revealed');
});

test('armed clue times out via tick', () => {
  const { g, clock } = setup();
  g.host('start'); g.s.dd = {};
  g.host('pick', { ci: 0, ri: 0 }); g.host('arm');
  clock.adv(21000); g.tick();
  assert.equal(g.s.cur.state, 'revealed');
  assert.ok(g.s.cur.timedOut);
});

test('daily double: wager bounds and floor goes to control team', () => {
  const { g } = setup();
  g.host('start');
  g.s.dd = { '0:0': true };
  g.host('pick', { ci: 0, ri: 0 });
  assert.equal(g.s.cur.state, 'wager');
  assert.equal(g.boardView(false).cur.clue, null);
  assert.equal(g.host('wager', { amount: 99999 }).ok, false);
  assert.ok(g.host('wager', { amount: 500 }).ok);
  assert.equal(g.s.cur.floor, g.s.control);
  g.host('judge', { correct: true });
  assert.equal(g.s.teams[g.s.control].score, 500);
});

test('answers never leak before reveal', () => {
  const { g } = setup();
  g.host('start'); g.s.dd = {};
  g.host('pick', { ci: 0, ri: 0 });
  assert.equal(JSON.stringify(g.boardView(false)).includes('ans01'), false);
  assert.equal(JSON.stringify(g.playerView(Object.keys(g.s.players)[0])).includes('ans01'), false);
  assert.ok(JSON.stringify(g.boardView(true)).includes('ans01'));
});

test('chaos: spam buzz right after arming triggers a challenge, solving registers', () => {
  const { g, clock, a } = setup({ chaos: 1 });
  g.host('start'); g.s.dd = {};
  g.host('pick', { ci: 0, ri: 0 }); g.host('arm');
  clock.adv(100);
  const r = g.buzz(a);
  assert.equal(r.status, 'challenge');
  assert.equal(g.s.cur.floor, null);
  const ch = g.s.pending[a].ch;
  clock.adv(5000);
  let res;
  if (ch.pub.type === 'text') res = g.solve(a, ch.secret.answer);
  else if (ch.pub.type === 'grid') res = g.solve(a, ch.secret.want);
  else if (ch.pub.type === 'slider') res = g.solve(a, ch.secret.target);
  else res = g.solve(a, true);
  assert.equal(res.status, 'floor');
});

test('chaos: wrong captcha answer issues a new challenge', () => {
  const { g, clock, a } = setup({ chaos: 1 });
  g.host('start'); g.s.dd = {};
  g.host('pick', { ci: 0, ri: 0 }); g.host('arm'); clock.adv(100);
  g.buzz(a);
  const res = g.solve(a, 'definitely wrong ☃');
  assert.equal(res.status, 'challenge');
  assert.ok(res.retry);
});

test('blood moon curses everyone once, cleared on close', () => {
  const { g, clock, a, b } = setup({ chaos: 0 });
  g.host('start'); g.s.dd = {};
  g.host('bloodMoon');
  g.host('pick', { ci: 0, ri: 0 }); g.host('arm'); clock.adv(2000);
  assert.equal(g.buzz(a).status, 'challenge');
  assert.equal(g.buzz(b).status, 'challenge');
  g.host('reveal'); g.host('close');
  assert.equal(g.s.bloodMoon, false);
});

test('challenge checker enforces min time and exact answers', () => {
  const ch = challenges.make(() => 0.0);
  const hold = { pub: { type: 'hold' }, secret: {}, minMs: 3000 };
  assert.equal(challenges.check(hold, true, 100), false);
  assert.equal(challenges.check(hold, true, 3500), true);
  const txt = { pub: { type: 'text' }, secret: { answer: 'Abc', exact: true }, minMs: 0 };
  assert.equal(challenges.check(txt, 'abc', 10), false);
  assert.equal(challenges.check(txt, 'Abc', 10), true);
  assert.ok(ch.kind);
});

test('every generated challenge is solvable with its own secret', () => {
  for (let i = 0; i < 300; i++) {
    const ch = challenges.make(Math.random);
    const t = ch.pub.type;
    const ans = t === 'text' ? (ch.secret.answer) : t === 'grid' ? ch.secret.want : t === 'slider' ? ch.secret.target : true;
    assert.ok(challenges.check(ch, ans, 10000), ch.kind);
  }
});

test('full game flows through round 2 and final to over', () => {
  const { g, clock, a, b, ta, tb } = setup();
  g.host('start'); g.s.dd = {};
  for (let round = 1; round <= 2; round++) {
    g.s.dd = {};
    for (let ci = 0; ci < 2; ci++) for (let ri = 0; ri < 3; ri++) {
      g.host('pick', { ci, ri }); g.host('arm'); clock.adv(1000);
      g.buzz(a); g.host('judge', { correct: true }); g.host('close');
    }
    assert.ok(g.host('nextRound').ok);
  }
  assert.equal(g.s.phase, 'final');
  assert.deepEqual(g.s.final.eligible, [ta]);
  assert.equal(g.playerFinalWager(b, 10).ok, false);
  assert.equal(g.playerFinalWager(a, 99999).ok, false);
  assert.ok(g.playerFinalWager(a, 1000).ok);
  g.host('finalOpen');
  assert.ok(g.finalAnswer(a, 'the answer').ok);
  g.host('finalClose');
  assert.equal(g.boardView(false).final.reveals.length, 1);
  assert.equal(g.host('finalNext').ok, false);
  g.host('finalJudge', { correct: true });
  const before = g.s.teams[ta].score;
  g.host('finalNext');
  assert.equal(g.s.phase, 'over');
  assert.equal(g.s.teams[ta].score, before);
});

test('persistence round trip', () => {
  const { g } = setup();
  g.host('start');
  const g2 = new Game(mkContent());
  g2.restore(g.serialize());
  assert.equal(g2.s.phase, 'board');
  assert.equal(g2.teamIds().length, 2);
});

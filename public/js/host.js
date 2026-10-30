'use strict';
const { h, money } = HG;
const app = document.getElementById('app');
let view = null, connected = false, lastSig = '';

const act = (action, body) => HG.api('/api/host/' + action, body || {}).then((r) => { if (!r.ok) flash(r.error || 'failed'); return r; });
let flashEl = null;
function flash(msg) {
  if (!flashEl) { flashEl = h('div', { style: 'position:fixed;right:16px;bottom:16px;background:#200a12;border:1px solid var(--blood);padding:8px 14px;z-index:99' }); document.body.append(flashEl); }
  flashEl.textContent = msg; flashEl.style.display = 'block';
  clearTimeout(flash.t); flash.t = setTimeout(() => { flashEl.style.display = 'none'; }, 2500);
}

// ---------- login ----------
function login(err) {
  const key = h('input', { class: 'field', type: 'password', placeholder: 'host key', autocomplete: 'off' });
  const e = h('div', { class: 'err' }, err || '');
  const go = async () => {
    const r = await HG.api('/api/host/login', { key: key.value });
    if (r.ok) start(); else e.textContent = r.error || 'nope';
  };
  key.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(); });
  app.replaceChildren(h('div', { class: 'login' }, h('h1', {}, h('b', {}, '$'), h('span', {}, 'hellgame')), h('div', { class: 'muted' }, 'host panel. prove you are the necromancer.'), key, h('button', { class: 'btn go', onclick: go }, 'ENTER'), e));
  key.focus();
}

// ---------- panel ----------
const teamOf = (id) => view.teams.find((t) => t.id === id);

function topBar() {
  const v = view;
  const chaos = [0, 1, 2, 3].map((n) => h('button', { class: 'btn' + (v.chaos === n ? ' on' : ''), onclick: () => act('chaos', { level: n }), title: ['off', 'spammers only', 'spammers + 12% random', 'spammers + 35% random'][n] }, n));
  const secs = h('input', { class: 'field', type: 'number', value: String(Math.round(v.armMs / 1000)), style: 'width:64px;padding:.3em', 'data-keep': 'secs' });
  secs.addEventListener('change', () => act('armSeconds', { seconds: secs.value }));
  return h('div', { class: 'bar' },
    h('span', { class: 'conn' + (connected ? ' ok' : '') }),
    h('div', { class: 'brand' }, h('b', {}, '$'), h('span', {}, 'hellgame'), h('span', { class: 'muted', style: 'font-size:12px;margin-left:8px' }, 'host')),
    h('div', { class: 'seg' }, h('label', {}, 'phase'), h('span', {}, v.phase + (v.round ? ` · R${v.round}` : ''))),
    h('div', { class: 'seg' }, h('label', {}, 'chaos'), chaos),
    h('div', { class: 'seg' }, h('label', {}, 'buzz secs'), secs),
    h('div', { class: 'seg' }, h('button', { class: 'btn' + (v.bloodMoon ? ' on-red' : ''), onclick: () => act('bloodMoon'), title: 'Next clue: EVERY player must beat a troll captcha before their buzz counts' }, '☾ blood moon')),
    h('div', { class: 'seg' }, h('a', { href: '/board', target: '_blank', rel: 'noopener' }, 'open board ↗')),
    h('div', { class: 'seg', style: 'margin-left:auto' }, h('span', { class: 'muted' }, `${v.players} players`)),
  );
}

function lobbyPanel() {
  const v = view;
  return [
    h('div', { class: 'meta' }, 'lobby'),
    h('div', {}, 'Share the board on the projector. Players scan the QR code and join a team.'),
    v.teams.length ? h('div', {}, v.teams.map((t) => h('div', { class: 'team', style: `border-left-color:${t.color}` }, h('div', { class: 'nm' }, `${t.emoji} ${t.name}`), h('div', { class: 'mem' }, v.roster.filter((p) => p.teamId === t.id).map((p) => p.name).join(', ') || 'no members')))) : h('div', { class: 'muted' }, 'No teams yet.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn go', disabled: !v.teams.length, onclick: () => act('start') }, 'OPEN THE GATES (start)')),
  ];
}

function boardPanel() {
  const v = view;
  const g = h('div', { class: 'mgrid' });
  v.cats.forEach((c) => g.append(h('div', { class: 'c' }, c.name)));
  for (let ri = 0; ri < 5; ri++) v.cats.forEach((c, ci) => {
    const cl = c.clues[ri];
    g.append(h('button', { class: cl.used ? 'used' : '', onclick: () => act('pick', { ci, ri }) }, money(cl.value), v.dd && v.dd[`${ci}:${ri}`] && !cl.used ? h('span', { class: 'dd' }, 'DD') : null));
  });
  const allUsed = v.cats.every((c) => c.clues.every((x) => x.used));
  const ctl = teamOf(v.control);
  return [
    h('div', { class: 'meta' }, `${v.roundName}  ·  control: ${ctl ? ctl.emoji + ' ' + ctl.name : 'nobody'}`),
    g,
    h('div', { class: 'actions' }, h('button', { class: 'btn' + (allUsed ? ' go' : ''), onclick: () => (allUsed || confirm('Board not finished. Move on anyway?')) && act('nextRound') }, v.round < v.rounds ? 'NEXT ROUND →' : 'FINAL ROUND →')),
  ];
}

function cluePanel() {
  const v = view, c = v.cur;
  const out = [h('div', { class: 'meta' }, `${c.category} · ${c.dd ? 'SUDO (daily double)' : money(c.value)}`)];
  if (c.state === 'wager') {
    const t = teamOf(v.control);
    const inp = h('input', { class: 'field', type: 'number', placeholder: 'wager', style: 'width:140px', 'data-keep': 'wager' });
    out.push(h('div', { class: 'status hot' }, `DAILY DOUBLE for ${t ? t.emoji + ' ' + t.name : '?'} (${t ? money(t.score) : ''}). Take their wager, then enter it.`),
      h('div', { class: 'row' }, inp, h('button', { class: 'btn go', onclick: () => act('wager', { amount: inp.value }) }, 'SHOW CLUE')));
    out.push(h('div', { class: 'ansbox' }, h('small', {}, 'host only: clue + answer'), c.hostAnswer));
    return out;
  }
  out.push(h('div', { class: 'cluebox' }, c.clue), h('div', { class: 'ansbox' }, h('small', {}, `host only: answer${c.hostNote ? ' · ' + c.hostNote : ''}`), c.hostAnswer));
  const A = [];
  const btn = (cls, label, key, fn) => h('button', { class: 'btn ' + cls, onclick: fn }, label, key ? h('kbd', {}, key) : null);
  if (c.state === 'reading') {
    out.push(h('div', { class: 'status' }, 'Read the clue aloud, then arm.'));
    A.push(btn('go', 'ARM BUZZERS', 'space', () => act('arm')), btn('warn', 'reveal', 'R', () => act('reveal')));
  } else if (c.state === 'armed') {
    out.push(h('div', { class: 'status hot', id: 'armtimer' }, 'BUZZERS LIVE'));
    A.push(btn('warn', 'nobody / reveal', 'R', () => act('reveal')));
  } else if (c.state === 'answering') {
    const t = teamOf(c.floor);
    out.push(h('div', { class: 'status hot' }, `${t ? t.emoji + ' ' + t.name : '?'}${c.floorPlayer ? ' · ' + c.floorPlayer : ''} has the floor` + (c.queueDetail.length ? `   queue: ${c.queueDetail.map((q) => (teamOf(q.teamId) || {}).name + ' (' + q.who + ')').join(' → ')}` : '')));
    A.push(btn('go', 'CORRECT', 'Y', () => act('judge', { correct: true })), btn('bad', 'WRONG', 'N', () => act('judge', { correct: false })), btn('warn', 'reveal', 'R', () => act('reveal')));
  } else if (c.state === 'revealed') {
    out.push(h('div', { class: 'status' }, c.timedOut ? 'Time ran out.' : 'Answer shown on the board.'));
    A.push(btn('go', 'BACK TO BOARD', 'enter', () => act('close')));
  }
  out.push(h('div', { class: 'actions' }, A));
  return out;
}

function finalPanel() {
  const v = view, f = v.final;
  const out = [h('div', { class: 'meta' }, `FINAL · ${f.category} · ${f.state}`), h('div', { class: 'cluebox' }, f.clue || '(clue hidden until wagers close)'), h('div', { class: 'ansbox' }, h('small', {}, 'host only: answer'), f.hostAnswer)];
  const cards = f.eligible.map((tid) => {
    const t = teamOf(tid);
    const wager = h('input', { class: 'field', type: 'number', placeholder: 'wager', style: 'width:100px;padding:.3em', value: f.wagers[tid] != null ? String(f.wagers[tid]) : '', 'data-keep': 'fw' + tid });
    return h('div', { class: 'team', style: `border-left-color:${t.color}` }, h('div', { class: 'hd' }, h('span', { class: 'nm' }, `${t.emoji} ${t.name}`), h('span', {}, money(t.score))),
      h('div', { class: 'mem' }, `wager: ${f.wagers[tid] != null ? money(f.wagers[tid]) : '—'}`),
      f.state === 'wager' ? h('div', { class: 'ops' }, wager, h('button', { class: 'btn', onclick: () => act('finalSetWager', { teamId: tid, amount: wager.value }) }, 'set')) : null,
      h('div', { class: 'mem' }, `answer: ${f.answers[tid] != null ? '“' + f.answers[tid] + '”' : '—'}`));
  });
  out.push(h('div', { class: 'final-grid' }, cards.length ? cards : h('div', { class: 'muted' }, 'No team has points to wager.')));
  const A = [];
  if (f.state === 'wager') A.push(h('button', { class: 'btn go', onclick: () => act('finalOpen') }, `SHOW CLUE + START 45s (${f.wagered.length}/${f.eligible.length} wagers)`));
  if (f.state === 'answer') A.push(h('button', { class: 'btn warn', onclick: () => act('finalClose') }, `STOP · reveal answers (${f.answered.length}/${f.eligible.length} in)`));
  if (f.state === 'judge') {
    const tid = f.order[f.idx], t = teamOf(tid), judged = tid in f.judged;
    out.push(h('div', { class: 'status hot' }, `Judging ${t.emoji} ${t.name}: “${f.answers[tid] || '(silence)'}”, wager ${money(f.wagers[tid] || 0)}`));
    A.push(h('button', { class: 'btn go', disabled: judged, onclick: () => act('finalJudge', { correct: true }) }, 'CORRECT'), h('button', { class: 'btn bad', disabled: judged, onclick: () => act('finalJudge', { correct: false }) }, 'WRONG'), h('button', { class: 'btn', disabled: !judged, onclick: () => act('finalNext') }, f.idx + 1 < f.order.length ? 'NEXT TEAM →' : 'FINISH →'));
  }
  out.push(h('div', { class: 'actions' }, A));
  return out;
}

function overPanel() {
  const ranked = view.teams.slice().sort((a, b) => b.score - a.score);
  return [h('div', { class: 'meta' }, 'game over'), h('div', { style: 'font-size:22px;line-height:1.8' }, ranked.map((t, i) => h('div', { style: `color:${t.color}` }, `${i + 1}. ${t.emoji} ${t.name} ${money(t.score)}`))),
    h('div', { class: 'actions' }, h('button', { class: 'btn bad', onclick: () => confirm('Wipe everything (teams, players, scores)?') && act('restart') }, 'RESET EVERYTHING'))];
}

function teamsPanel() {
  const v = view;
  return h('div', { class: 'panel' }, h('h3', {}, 'teams'), v.teams.length ? v.teams.map((t) => {
    const mem = v.roster.filter((p) => p.teamId === t.id);
    const floor = v.cur && v.cur.floor === t.id;
    return h('div', { class: 'team' + (floor ? ' floor' : ''), style: `border-left-color:${t.color}` },
      h('div', { class: 'hd' }, h('span', { class: 'nm' }, `${t.emoji} ${t.name}${v.control === t.id ? ' ▶' : ''}`), h('span', { class: 'sc' + (t.score < 0 ? ' neg' : '') }, money(t.score))),
      h('div', { class: 'ops' },
        [-200, -100, 100, 200].map((d) => h('button', { class: 'btn', onclick: () => act('score', { teamId: t.id, delta: d }) }, (d > 0 ? '+' : '') + d)),
        h('button', { class: 'btn', onclick: () => act('setControl', { teamId: t.id }), title: 'give board control' }, '▶'),
        h('button', { class: 'btn' + (t.cursed ? ' on' : ''), onclick: () => act('curse', { teamId: t.id }), title: "curse: this team's next buzz needs a troll captcha" }, '☠'),
        h('button', { class: 'btn', onclick: () => { const n = prompt('Rename team', t.name); if (n) act('renameTeam', { teamId: t.id, name: n }); } }, 'ren'),
        h('button', { class: 'btn', onclick: () => confirm(`Remove ${t.name} and its players?`) && act('removeTeam', { teamId: t.id }) }, '✕')),
      h('div', { class: 'mem' }, mem.length ? mem.map((p) => h('span', { style: 'margin-right:8px' }, p.name, h('a', { href: '#', title: 'kick', style: 'color:var(--blood);margin-left:2px;text-decoration:none', onclick: (e) => { e.preventDefault(); act('kick', { token: p.token }); } }, '×'))) : 'no players'));
  }) : h('div', { class: 'muted' }, 'none yet'));
}

function render() {
  const v = view;
  let main;
  if (v.phase === 'lobby') main = lobbyPanel();
  else if (v.phase === 'board') main = boardPanel();
  else if (v.phase === 'clue') main = cluePanel();
  else if (v.phase === 'final') main = finalPanel();
  else main = overPanel();
  const keep = {};
  document.querySelectorAll('[data-keep]').forEach((el) => { keep[el.dataset.keep] = { v: el.value, f: document.activeElement === el }; });
  app.replaceChildren(
    topBar(),
    h('div', { class: 'main' }, main),
    h('div', { class: 'side' }, teamsPanel()),
    h('div', { class: 'logbox', id: 'log' }, (v.log || []).slice().reverse().map((l) => h('div', {}, h('b', {}, new Date(l.t).toLocaleTimeString()), l.msg))),
  );
  document.querySelectorAll('[data-keep]').forEach((el) => { const k = keep[el.dataset.keep]; if (k) { if (k.v) el.value = k.v; if (k.f) el.focus(); } });
}

document.addEventListener('keydown', (e) => {
  if (!view || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (view.phase === 'clue') {
    const s = view.cur.state;
    if (k === ' ' && s === 'reading') act('arm');
    else if (k === 'y' && s === 'answering') act('judge', { correct: true });
    else if (k === 'n' && s === 'answering') act('judge', { correct: false });
    else if (k === 'r' && ['reading', 'armed', 'answering'].includes(s)) act('reveal');
    else if (k === 'enter' && s === 'revealed') act('close');
    else return;
    e.preventDefault();
  }
});

setInterval(() => {
  const el = document.getElementById('armtimer');
  if (el && view && view.cur && view.cur.state === 'armed') el.textContent = `BUZZERS LIVE · ${Math.max(0, Math.ceil((view.cur.deadline - HG.now()) / 1000))}s`;
}, 250);

function start() {
  HG.connect('host', null, (v) => {
    view = v;
    const sig = JSON.stringify(Object.assign({}, v, { now: 0 }));
    if (sig === lastSig) return;
    lastSig = sig;
    render();
  }, (ok) => { if (connected !== ok) { connected = ok; const d = document.querySelector('.conn'); if (d) d.className = 'conn' + (ok ? ' ok' : ''); } });
}

(async function boot() {
  // a cheap auth probe: login endpoint is separate, so just try the stream
  const r = await fetch('/api/state?role=host').then((x) => x.status === 200).catch(() => false);
  if (r) start(); else login();
})();

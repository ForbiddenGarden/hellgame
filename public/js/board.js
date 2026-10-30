'use strict';
const { h, money } = HG;
const $ = (id) => document.getElementById(id);
let prev = null, lastKey = '', lastCurseN = 0, view = null;

// ---------- sound gate ----------
$('sound').addEventListener('click', () => { HGAudio.init(); $('sound').classList.add('hidden'); if (view) syncAudio(view, null); });

// ---------- QR ----------
function qrImg(url) {
  const q = qrcode(0, 'M'); q.addData(url); q.make();
  return h('img', { src: q.createDataURL(6, 2), alt: 'QR code to join' });
}

// ---------- render ----------
function render(v) {
  const key = v.phase + ':' + (v.cur ? v.cur.key || `${v.cur.ci}.${v.cur.ri}:${v.cur.state}` : '') + ':' + (v.final ? v.final.state + (v.final.idx ?? '') : '') + ':' + v.round;
  const enter = key !== lastKey;
  lastKey = key;
  document.body.classList.toggle('moon', !!v.bloodMoon);
  renderTop(v);
  const stage = $('stage');
  stage.replaceChildren(screenFor(v, enter));
  renderScores(v);
}

function renderTop(v) {
  $('top').replaceChildren(
    h('span', { class: 'brand' }, '$', h('b', {}, 'hell'), 'game', v.bloodMoon ? '  ☾ BLOOD MOON ☽' : ''),
    h('span', {}, v.phase === 'lobby' ? 'lobby' : v.phase === 'final' || v.phase === 'over' ? 'final round' : (v.roundName || '')),
    h('span', {}, `${v.players} souls online`),
  );
}

function screenFor(v, enter) {
  const cls = (c) => 'screen ' + c + (enter ? ' enter' : '');
  if (v.phase === 'lobby') return lobby(v, cls('lobby'));
  if (v.phase === 'board') return boardGrid(v, cls('boardscr'));
  if (v.phase === 'clue') return clueScreen(v, cls(''));
  if (v.phase === 'final') return finalScreen(v, cls('final'));
  return overScreen(v, cls('over'));
}

function lobby(v, cls) {
  const url = location.origin + '/';
  return h('section', { class: cls },
    h('div', { class: 'logo' }, h('span', { class: 'd' }, '$'), h('span', { class: 't glitch', 'data-text': 'hellgame' }, 'hellgame')),
    h('div', { class: 'sub' }, 'hacker jeopardy · halloween edition · sasquatch.sh'),
    h('div', { class: 'joinrow' }, qrImg(url), h('div', { class: 'joinurl' }, 'Scan to join, or visit', h('div', { class: 'u' }, url.replace(/^https?:\/\//, '')), h('div', { class: 'muted', style: 'font-size:1.6vw' }, 'pick a team · you are the buzzer'))),
    h('div', { class: 'roster' }, v.teams.map((t) => h('div', { class: 'pill', style: `border-color:${t.color}` }, `${t.emoji} ${t.name}`))),
    h('div', { class: 'waiting' }, v.teams.length ? 'Waiting for the host to open the gates' : 'No teams yet. Be brave.', h('span', { class: 'cursor' })),
  );
}

function boardGrid(v, cls) {
  const g = h('div', { class: 'grid' });
  v.cats.forEach((c) => g.append(h('div', { class: 'cat' }, c.name)));
  for (let ri = 0; ri < 5; ri++) {
    v.cats.forEach((c) => {
      const cl = c.clues[ri];
      g.append(h('div', { class: 'tile' + (cl && cl.used ? ' used' : '') }, cl ? h('span', {}, money(cl.value)) : ''));
    });
  }
  return h('section', { class: cls }, h('div', { class: 'round-title' }, v.roundName), g);
}

function teamOf(v, id) { return v.teams.find((t) => t.id === id); }

function clueScreen(v, cls) {
  const c = v.cur;
  if (c.state === 'wager') {
    const t = teamOf(v, v.control);
    return h('section', { class: cls + ' dd' },
      h('div', { class: 'big' }, 'SUDO!'),
      h('div', { class: 'big2' }, 'DAILY DOUBLE'),
      h('div', { class: 'big2', style: 'color:var(--bone)' }, t ? `${t.emoji} ${t.name}: name your wager` : 'name your wager'),
      h('div', { class: 'muted', style: 'font-size:1.6vw' }, `${c.category}`),
    );
  }
  const text = h('div', { class: 'text' + (c.clue.length > 110 ? ' long' : '') }, c.clue);
  const parts = [h('div', { class: 'meta' }, c.category, '  ·  ', h('b', {}, c.dd ? `SUDO ${money(c.wager)}` : money(c.value))), text];
  if (c.state === 'reading') parts.push(h('div', { class: 'status locked' }, '🔒 buzzers locked'));
  if (c.state === 'armed') parts.push(h('div', { class: 'status armed' }, 'BUZZ IN!'), h('div', { class: 'timer' }, h('i', { id: 'timerbar', style: 'width:100%' })));
  if (c.state === 'answering') {
    const t = teamOf(v, c.floor);
    parts.push(h('div', { class: 'status', style: t ? `color:${t.color}` : '' }, t ? `${t.emoji} ${t.name}${c.floorPlayer ? ' · ' + c.floorPlayer : ''} — answer!` : ''));
    if (c.queue.length) parts.push(h('div', { class: 'queue' }, 'next up: ' + c.queue.map((id) => (teamOf(v, id) || {}).name).join(' → ')));
  }
  if (c.state === 'revealed') {
    if (c.timedOut) parts.push(h('div', { class: 'status', style: 'color:var(--blood)' }, "TIME'S UP. the void claims it."));
    parts.push(h('div', { class: 'answer' }, h('small', {}, 'correct response'), c.answer));
  }
  return h('section', { class: cls + ' clue' }, parts);
}

function finalScreen(v, cls) {
  const f = v.final;
  if (f.state === 'wager') {
    return h('section', { class: cls },
      h('div', { class: 'tag' }, 'final round · kernel panic'),
      h('div', { class: 'cat-big' }, f.category),
      h('div', { class: 'sub' }, `place your wagers… ${f.wagered.length}/${f.eligible.length} locked in`),
      f.eligible.length === 0 ? h('div', { class: 'muted' }, 'nobody qualifies. everyone is already dead.') : null,
    );
  }
  if (f.state === 'answer') {
    return h('section', { class: cls },
      h('div', { class: 'cat-big', style: 'font-size:3vw' }, f.category),
      h('div', { class: 'text', style: 'font-size:3.3vw;max-width:88vw;line-height:1.3' }, f.clue),
      h('div', { class: 'timer' }, h('i', { id: 'timerbar', style: 'width:100%' })),
      h('div', { class: 'queue' }, `answers locked in: ${f.answered.length}/${f.eligible.length}`),
    );
  }
  const cards = (f.reveals || []).map((r) => {
    const t = teamOf(v, r.teamId) || { name: '?', emoji: '', color: '#fff' };
    const judged = r.correct !== undefined;
    return h('div', { class: 'rcard' + (judged ? (r.correct ? ' ok' : ' no') : '') },
      h('div', { class: 't', style: `color:${t.color}` }, `${t.emoji} ${t.name}`),
      h('div', { class: 'a' }, r.answer ? `“${r.answer}”` : '(silence)'),
      h('div', { class: 'w' }, judged ? `${r.correct ? 'CORRECT' : 'WRONG'} · wager ${money(r.wager)}` : 'wager hidden…'),
    );
  });
  return h('section', { class: cls },
    h('div', { class: 'tag' }, f.category),
    h('div', { class: 'sub' }, 'the reckoning'),
    h('div', { class: 'reveals' }, cards),
    f.correct ? h('div', { class: 'answer' }, h('small', {}, 'correct response'), f.correct) : null,
  );
}

function overScreen(v, cls) {
  const ranked = v.teams.slice().sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const tie = ranked[1] && ranked[1].score === top.score;
  return h('section', { class: cls },
    h('div', { class: 'tag' }, 'game over'),
    h('div', { class: 'winner' }, top ? `${top.emoji} ${tie ? 'IT\'S A TIE' : top.name}` : 'nobody'),
    h('div', { class: 'sub' }, tie ? 'the dead cannot decide' : 'rises from the crypt'),
    h('div', { class: 'rank' }, ranked.map((t, i) => h('div', { style: `color:${t.color}` }, `${i + 1}. ${t.emoji} ${t.name}  ${money(t.score)}`))),
  );
}

function renderScores(v) {
  const el = $('scores');
  if (v.phase === 'lobby' || v.phase === 'over') { el.replaceChildren(); return; }
  const c = v.cur;
  const flash = c && c.flash;
  el.replaceChildren(...v.teams.map((t) => {
    const cl = ['team'];
    if (v.control === t.id && v.phase !== 'final') cl.push('ctl');
    let who = '';
    if (c) {
      if (c.floor === t.id) { cl.push('floor'); who = c.floorPlayer || ''; }
      else if (c.queue.includes(t.id)) cl.push('queued');
      if (c.excluded.includes(t.id)) cl.push('out');
      if (c.state === 'revealed' && flash && flash.type === 'correct' && flash.teamId === t.id) cl.push('good');
    }
    return h('div', { class: cl.join(' '), style: `border-left:.45vw solid ${t.color}` },
      h('div', { class: 'n', style: `color:${t.color}` }, `${t.emoji} ${t.name}`),
      h('div', { class: 's' + (t.score < 0 ? ' neg' : '') }, money(t.score)),
      h('div', { class: 'who' }, who ? `🔔 ${who}` : ''),
    );
  }));
}

// ---------- sound + toast reactions ----------
function syncAudio(v, p) {
  if (!HGAudio.ready()) return;
  const c = v.cur, pc = p && p.cur;
  const sum = (x) => x.teams.reduce((a, t) => a + t.score, 0);
  if (!p) { HGAudio.drone(v.phase === 'final' && v.final && v.final.state !== 'judge'); return; }
  if (c && (!pc || pc.key !== c.key) && !pc) { c.dd ? HGAudio.dd() : HGAudio.select(); }
  if (c && pc && pc.state !== c.state) {
    if (c.state === 'armed') HGAudio.arm();
    if (c.state === 'answering' && pc.state === 'armed') HGAudio.buzz();
    if (c.state === 'answering' && pc.state === 'wager') HGAudio.arm();
    if (c.state === 'revealed') {
      if (c.timedOut) HGAudio.timeout();
      else if (c.flash && c.flash.type === 'correct') HGAudio.correct();
      else HGAudio.reveal();
    }
  }
  if (c && pc && c.state === pc.state && c.state === 'answering' && sum(v) < sum(p)) HGAudio.wrong();
  if (c && pc && c.state === 'armed' && pc.state === 'answering') HGAudio.wrong(); // wrong -> re-armed
  if (v.phase === 'final' || v.phase === 'over') {
    HGAudio.drone(v.phase === 'final' && v.final.state !== 'judge');
    if (v.phase === 'over' && p.phase !== 'over') { HGAudio.fanfare(); bats(); }
    if (v.final && p.final && v.final.state === 'answer' && p.final.state !== 'answer') HGAudio.arm();
    if (v.final && p.final && v.final.state === 'judge' && v.final.reveals.length !== p.final.reveals.length) HGAudio.reveal();
    if (v.final && p.final && v.final.state === 'judge') {
      const oldJ = p.final.reveals.filter((r) => r.correct !== undefined).length, newJ = v.final.reveals.filter((r) => r.correct !== undefined).length;
      if (newJ > oldJ) (v.final.reveals.find((r, i) => i === newJ - 1) || {}).correct ? HGAudio.correct() : HGAudio.wrong();
    }
  } else HGAudio.drone(false);
  if (v.lastCurse && v.lastCurse.n !== lastCurseN) { lastCurseN = v.lastCurse.n; HGAudio.curse(); showToast(v.lastCurse); }
  if (v.bloodMoon && !p.bloodMoon) HGAudio.thunder();
}

function showToast(cu) {
  const t = $('toast');
  t.replaceChildren(h('b', {}, '☠ CURSED ☠'), h('div', {}, `${cu.emoji} ${cu.name} was caught spamming`));
  t.classList.remove('hidden');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => t.classList.add('hidden'), 3500);
}

function bats() {
  for (let i = 0; i < 24; i++) {
    const b = h('div', { class: 'bat', style: `left:${Math.random() * 100}vw;animation-duration:${4 + Math.random() * 5}s;animation-delay:${Math.random() * 3}s` }, ['🦇', '🎃', '👻', '💀'][i % 4]);
    document.body.append(b);
  }
}

// ---------- timer bar ----------
(function loop() {
  const bar = $('timerbar');
  if (bar && view) {
    const dl = view.phase === 'final' ? view.final.deadline : view.cur && view.cur.deadline;
    const total = view.phase === 'final' ? 45000 : view.armMs;
    if (dl) bar.style.width = Math.max(0, Math.min(100, ((dl - HG.now()) / total) * 100)) + '%';
  }
  requestAnimationFrame(loop);
})();

HG.connect('board', null, (v) => {
  const p = prev;
  view = v;
  render(v);
  syncAudio(v, p);
  prev = v;
}, null);

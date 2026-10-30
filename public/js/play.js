'use strict';
const { h, money } = HG;
const app = document.getElementById('app');
const overlay = document.getElementById('challenge');
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } }, del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } } };
let token = store.get('hg_token');
let view = null, ui = null, noteUntil = 0, noteText = '', lastBuzzAt = 0;

const brand = () => h('div', { class: 'brand' }, h('b', {}, '$'), h('span', {}, 'hellgame'));

// ---------- join ----------
function showJoin(teams, err) {
  const sel = { teamId: null };
  const name = h('input', { class: 'field', placeholder: 'your handle', maxlength: '20', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: store.get('hg_name') || '' });
  const newTeam = h('input', { class: 'field', placeholder: 'or start a new team…', maxlength: '24', autocomplete: 'off', spellcheck: 'false' });
  const errEl = h('div', { class: 'err' }, err || '');
  const row = h('div', { class: 'teamrow' });
  const paint = () => {
    row.replaceChildren(...teams.map((t) => h('button', { class: 'btn' + (sel.teamId === t.id ? ' sel' : ''), onclick: () => { sel.teamId = t.id; newTeam.value = ''; paint(); } }, `${t.emoji} ${t.name}`)));
  };
  paint();
  newTeam.addEventListener('input', () => { if (newTeam.value) { sel.teamId = null; paint(); } });
  const go = async () => {
    errEl.textContent = '';
    const r = await HG.api('/api/join', { name: name.value, teamId: sel.teamId, newTeamName: newTeam.value });
    if (!r.ok) { errEl.textContent = r.error; return; }
    store.set('hg_token', r.token); store.set('hg_name', name.value);
    token = r.token;
    boardConn && boardConn.close();
    startPlayer();
  };
  app.replaceChildren(brand(),
    h('div', { class: 'card' }, h('h2', {}, '1. who are you'), name),
    h('div', { class: 'card' }, h('h2', {}, '2. pick your coven'), teams.length ? row : h('div', { class: 'muted' }, 'No teams yet. Start one!'), newTeam),
    errEl,
    h('button', { class: 'btn go', style: 'font-size:20px;padding:16px', onclick: go }, 'ENTER THE CRYPT →'),
    h('div', { class: 'note' }, 'You are the buzzer. Look at the big screen for the clue.'),
  );
}

let boardConn = null;
function joinScreen(err) {
  // watch the public stream just to keep the team list fresh while picking
  let shown = false;
  boardConn = HG.connect('board', null, (v) => {
    if (document.activeElement && ['INPUT'].includes(document.activeElement.tagName) && shown) return;
    shown = true;
    showJoin(v.teams, err);
  }, null);
}

// ---------- buzzer ----------
function buildPlayer() {
  ui = {
    team: h('div', { class: 'me' }), score: h('div', { class: 'score' }),
    cat: h('div', { class: 'cat' }), val: h('div', { class: 'val' }),
    buzz: h('button', { id: 'buzz' }, 'LOCKED'), note: h('div', { class: 'note' }), moon: h('div', { class: 'moon hidden' }, '☾ BLOOD MOON ☽'),
    extra: h('div', { class: 'stage', style: 'flex:0' }),
  };
  ui.buzz.addEventListener('pointerdown', (e) => { e.preventDefault(); doBuzz(); });
  ui.buzz.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); doBuzz(); } });
  app.replaceChildren(brand(),
    h('div', { class: 'card top' }, ui.team, ui.score),
    ui.moon,
    h('div', { class: 'info' }, ui.cat, ui.val),
    h('div', { class: 'stage' }, ui.buzz, ui.note),
    ui.extra,
  );
}

const LABEL = { locked: 'LOCKED', early: 'WAIT…', armed: 'BUZZ!', lockout: 'LOCKED OUT', floor: "YOU'RE UP!", queued: 'IN QUEUE', out: 'OUT' };
const HINT = { locked: 'waiting for the host', early: 'host is reading. no jumping the gun.', armed: 'GO GO GO', lockout: 'you jumped early. the void is judging.', floor: 'answer out loud!', queued: 'you are next if they miss', out: 'your team missed this one' };

function say(t, ms = 2200) { noteText = t; noteUntil = Date.now() + ms; ui.note.textContent = t; }

function paint(v) {
  const me = v.me;
  ui.team.replaceChildren(`${me.emoji} ${me.team}`, h('small', {}, me.name));
  ui.score.textContent = money(me.score);
  ui.score.className = 'score' + (me.score < 0 ? ' neg' : '');
  document.body.classList.toggle('moonbg', !!v.bloodMoon);
  ui.moon.classList.toggle('hidden', !v.bloodMoon);
  if (v.clue) { ui.cat.textContent = v.clue.category; ui.val.textContent = v.clue.dd ? 'SUDO' : money(v.clue.value); }
  else { ui.cat.textContent = v.phase === 'lobby' ? 'lobby' : v.phase === 'over' ? 'game over' : v.phase === 'final' ? 'final round' : 'on the board'; ui.val.textContent = ''; }
  const b = v.phase === 'clue' ? v.buzz : 'locked';
  ui.buzz.className = b;
  ui.buzz.textContent = v.phase === 'clue' ? LABEL[b] : (v.phase === 'board' ? 'WATCH THE BOARD' : v.phase === 'lobby' ? 'SOON…' : 'LOCKED');
  ui.buzz.style.display = v.phase === 'final' ? 'none' : '';
  if (Date.now() > noteUntil) ui.note.textContent = v.phase === 'clue' ? HINT[b] : '';
  paintFinal(v);
  if (v.phase === 'over') {
    const ranked = v.teams.slice().sort((a, c) => c.score - a.score);
    ui.note.textContent = `Final: #${ranked.findIndex((t) => t.id === me.teamId) + 1} of ${ranked.length}`;
  }
}

function paintFinal(v) {
  const f = v.final, fm = v.finalMe;
  if (v.phase !== 'final' || !f) { ui.extra.replaceChildren(); ui.extra.dataset.k = ''; return; }
  const k = f.state + (fm && fm.eligible ? 'e' : 'x');
  if (ui.extra.dataset.k === k) return; // don't clobber typing
  ui.extra.dataset.k = k;
  if (!fm.eligible) { ui.extra.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'final round'), 'Your team has no points to wager. Spectate the carnage.')); return; }
  if (f.state === 'wager') {
    const inp = h('input', { class: 'field', type: 'number', inputmode: 'numeric', min: '0', max: String(fm.max), placeholder: `0 – ${fm.max}`, value: fm.wager != null ? String(fm.wager) : '' });
    const msg = h('div', { class: 'err' });
    ui.extra.replaceChildren(h('div', { class: 'card' }, h('h2', {}, `final: ${f.category}`), h('div', {}, 'Wager some of your points (anyone on your team can set it).'), h('div', { class: 'row' }, inp, h('button', { class: 'btn go', onclick: async () => { const r = await HG.api('/api/final/wager', { token, amount: inp.value }); msg.textContent = r.ok ? 'Locked in.' : r.error; msg.style.color = r.ok ? 'var(--green)' : ''; } }, 'LOCK')), msg));
  } else if (f.state === 'answer') {
    const inp = h('input', { class: 'field', maxlength: '120', placeholder: 'your answer', autocomplete: 'off', value: fm.answer || '' });
    const msg = h('div', { class: 'err' });
    ui.extra.replaceChildren(h('div', { class: 'card' }, h('h2', {}, `final: ${f.category}`), h('div', {}, 'Read the big screen. Type your answer. Last submit counts.'), h('div', { class: 'row' }, inp, h('button', { class: 'btn go', onclick: async () => { const r = await HG.api('/api/final/answer', { token, text: inp.value }); msg.textContent = r.ok ? 'Answer sealed.' : r.error; msg.style.color = r.ok ? 'var(--green)' : ''; } }, 'SEAL')), msg));
  } else ui.extra.replaceChildren(h('div', { class: 'card' }, 'Eyes on the board. The reckoning begins.'));
}

async function doBuzz() {
  if (!token) return; // no client-side phase check: polling can lag, the server decides
  const t = Date.now();
  if (t - lastBuzzAt < 60) return;
  lastBuzzAt = t;
  if (navigator.vibrate) navigator.vibrate(25);
  applyResult(await HG.api('/api/buzz', { token }));
}

function applyResult(r) {
  if (!r.ok) { say(r.error || 'nope'); return; }
  switch (r.status) {
    case 'challenge': showChallenge(r.challenge, !!r.retry); break;
    case 'floor': hideChallenge(); say("YOU'RE UP! answer out loud!", 4000); if (navigator.vibrate) navigator.vibrate([80, 40, 80]); break;
    case 'queued': hideChallenge(); say('Queued. You are next if they miss.'); break;
    case 'early': shake(); say('TOO EARLY. the void noticed.'); break;
    case 'locked': hideChallenge(); shake(); say(`Locked out ${(r.ms / 1000).toFixed(1)}s more`, 1200); break;
    case 'out': hideChallenge(); say('Your team already missed this one.'); break;
    case 'closed': hideChallenge(); say('Too late. It is over.'); break;
    default: break;
  }
}
function shake() { ui.buzz.classList.add('shake'); setTimeout(() => ui.buzz.classList.remove('shake'), 400); if (navigator.vibrate) navigator.vibrate([40, 30, 40]); }

// ---------- troll captchas ----------
function hideChallenge() { overlay.classList.add('hidden'); overlay.replaceChildren(); }
async function submitChallenge(answer) {
  applyResult(await HG.api('/api/solve', { token, answer }));
}
function showChallenge(ch, retry) {
  const parts = [h('div', { class: 'title' }, retry ? '☠ WRONG. TRY AGAIN ☠' : '☠ PROVE YOU ARE HUMAN ☠'), h('div', { class: 'prompt' }, ch.prompt)];
  const submitBtn = (fn) => h('button', { class: 'btn go', style: 'font-size:20px;padding:14px 30px', onclick: fn }, 'VERIFY');
  if (ch.type === 'text') {
    if (ch.show) parts.push(h('div', { class: 'show' }, ch.show));
    const inp = h('input', { class: 'field', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: ch.input === 'number' ? 'numeric' : 'text' });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitChallenge(inp.value); });
    parts.push(inp, submitBtn(() => submitChallenge(inp.value)));
    setTimeout(() => inp.focus(), 50);
  } else if (ch.type === 'grid') {
    const on = new Set();
    const g = h('div', { class: 'cgrid' }, ch.cells.map((c, i) => h('button', { onclick: (e) => { on.has(i) ? on.delete(i) : on.add(i); e.currentTarget.classList.toggle('on'); } }, c)));
    parts.push(g, submitBtn(() => submitChallenge([...on])));
  } else if (ch.type === 'slider') {
    const out = h('div', { class: 'glow-pumpkin', style: 'font-size:34px;font-weight:900' }, '0');
    const r = h('input', { type: 'range', min: String(ch.min), max: String(ch.max), step: '1', value: '0' });
    r.addEventListener('input', () => { out.textContent = r.value; });
    parts.push(out, r, submitBtn(() => submitChallenge(Number(r.value))));
  } else if (ch.type === 'hold') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 178 178'); svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'circle'));
    const c = svg.firstChild; c.setAttribute('cx', '89'); c.setAttribute('cy', '89'); c.setAttribute('r', '83');
    const sig = h('div', { class: 'sigil' }, svg, '🕯️');
    let t0 = 0, raf = 0, done = false;
    const step = () => { const p = Math.min(1, (performance.now() - t0) / ch.ms); c.style.strokeDashoffset = String(520 * (1 - p)); if (p >= 1 && !done) { done = true; submitChallenge(true); } else if (!done) raf = requestAnimationFrame(step); };
    const end = () => { cancelAnimationFrame(raf); if (!done) c.style.strokeDashoffset = '520'; };
    sig.addEventListener('pointerdown', (e) => { e.preventDefault(); t0 = performance.now(); raf = requestAnimationFrame(step); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => sig.addEventListener(ev, end));
    sig.addEventListener('contextmenu', (e) => e.preventDefault());
    parts.push(sig, h('div', { class: 'muted' }, 'keep holding. do not let go.'));
  } else if (ch.type === 'mash') {
    let n = 0;
    const cnt = h('div', { class: 'glow-pumpkin', style: 'font-size:30px;font-weight:900' }, `0 / ${ch.n}`);
    const zone = h('div', { class: 'mashzone' });
    const btn = h('button', { class: 'mashbtn', style: 'left:calc(50% - 55px);top:95px' }, '👁️');
    const hop = () => { const zw = zone.clientWidth - 110, zh = zone.clientHeight - 110; btn.style.left = Math.random() * zw + 'px'; btn.style.top = Math.random() * zh + 'px'; };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); n += 1; cnt.textContent = `${n} / ${ch.n}`; if (n >= ch.n) submitChallenge(true); else hop(); });
    zone.append(btn);
    parts.push(cnt, zone);
  } else if (ch.type === 'verify') {
    const holder = h('div', {}, h('div', { class: 'spin' }));
    parts.push(holder);
    let dodges = 0;
    setTimeout(() => {
      const box = h('div', { class: 'box' });
      const cap = h('div', { class: 'hcap', style: 'cursor:pointer' }, box, "I'm not a robot");
      const tryClick = (e) => {
        e.preventDefault();
        if (dodges < 2) { dodges += 1; cap.style.transform = `translate(${dodges % 2 ? 40 : -40}px, ${dodges * 30}px) rotate(${dodges % 2 ? 6 : -6}deg)`; cap.firstChild.style.borderColor = 'var(--blood)'; return; }
        box.textContent = '✓'; box.style.color = 'var(--green)';
        setTimeout(() => submitChallenge('ok'), 350);
      };
      cap.addEventListener('pointerdown', tryClick);
      holder.replaceChildren(cap);
    }, 4200);
  }
  overlay.replaceChildren(...parts);
  overlay.classList.remove('hidden');
  if (navigator.vibrate) navigator.vibrate([200, 60, 200]);
}

// ---------- boot ----------
function startPlayer() {
  buildPlayer();
  HG.connect('player', token, (v) => {
    view = v;
    if (!v.me) { store.del('hg_token'); location.reload(); return; }
    paint(v);
  }, null);
}

(async function boot() {
  if (token) {
    const r = await HG.api('/api/join', { token });
    if (r.ok) return startPlayer();
    store.del('hg_token'); token = null;
  }
  joinScreen();
})();

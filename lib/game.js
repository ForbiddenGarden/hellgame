'use strict';
const crypto = require('crypto');
const challenges = require('./challenges');

const EMOJI = ['💀', '🎃', '🕷️', '🦇', '👻', '🧛', '🧟', '🐺'];
const COLORS = ['#ff3b30', '#ff9500', '#bf5af2', '#32d74b', '#0a84ff', '#ffd60a', '#ff2d92', '#64d2ff'];
const MAX_TEAMS = 8;
const MAX_PLAYERS_PER_TEAM = 8;
const MAX_PLAYERS = 80;
const EARLY_LOCKOUT_MS = 750;
const SPAM_WINDOW_MS = 300;
const CURSE_CHANCE = [0, 0, 0.12, 0.35];
const DEFAULT_ARM_MS = 20000;
const FINAL_ANSWER_MS = 45000;

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n);
const id = (n = 4) => crypto.randomBytes(n).toString('hex');

class Game {
  constructor(content, opts = {}) {
    this.content = content;
    this.now = opts.now || Date.now;
    this.rng = opts.rng || Math.random;
    this.listeners = new Set();
    this.reset(true);
  }

  // ---------- plumbing ----------
  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(); }
  log(msg) {
    this.s.log.push({ t: this.now(), msg });
    if (this.s.log.length > 200) this.s.log.shift();
  }
  reset(silent) {
    this.s = {
      phase: 'lobby', round: 0, teams: {}, players: {}, control: null,
      used: {}, dd: {}, cur: null, chaos: 1, bloodMoon: false, armMs: DEFAULT_ARM_MS,
      final: null, log: [],
      pending: {}, // token -> { ch, key, issuedAt } (kept in saved state so any server instance can verify captchas)
    };
    this.log('The void awakens.');
    if (!silent) this.emit();
  }
  serialize() { return JSON.stringify(this.s); }
  restore(json) {
    const s = JSON.parse(json);
    if (s && s.teams && s.players) { s.pending = s.pending || {}; this.s = s; }
  }

  roundData() { return this.content.rounds[this.s.round - 1]; }
  clueAt(ci, ri) {
    const r = this.roundData();
    return r && r.categories[ci] && r.categories[ci].clues[ri];
  }
  teamIds() { return Object.keys(this.s.teams); }
  ok(extra) { this.emit(); return Object.assign({ ok: true }, extra); }
  err(error) { return { ok: false, error }; }

  // ---------- lobby / players ----------
  join({ name, teamId, newTeamName, token }) {
    const s = this.s;
    if (token && s.players[token]) return this.ok({ token, player: s.players[token] });
    name = clean(name, 20);
    if (!name) return this.err('Pick a handle.');
    if (Object.keys(s.players).length >= MAX_PLAYERS) return this.err('The crypt is full.');
    let team;
    if (teamId) {
      team = s.teams[teamId];
      if (!team) return this.err('That coven does not exist.');
    } else {
      newTeamName = clean(newTeamName, 24);
      if (!newTeamName) return this.err('Name your team.');
      if (this.teamIds().length >= MAX_TEAMS) return this.err('Too many teams. Join one.');
      if (Object.values(s.teams).some((t) => t.name.toLowerCase() === newTeamName.toLowerCase())) return this.err('Team name taken.');
      const n = this.teamIds().length;
      const used = new Set(Object.values(s.teams).map((t) => t.emoji));
      const emoji = EMOJI.find((e) => !used.has(e)) || EMOJI[n % EMOJI.length];
      team = { id: id(3), name: newTeamName, emoji, color: COLORS[EMOJI.indexOf(emoji) % COLORS.length], score: 0, lockUntil: 0, curse: false };
      s.teams[team.id] = team;
      this.log(`Team ${team.emoji} ${team.name} rises.`);
    }
    if (Object.values(s.players).filter((p) => p.teamId === team.id).length >= MAX_PLAYERS_PER_TEAM) return this.err('That team is full.');
    const tok = id(12);
    s.players[tok] = { token: tok, pid: id(3), name, teamId: team.id };
    this.log(`${name} joined ${team.name}.`);
    return this.ok({ token: tok, player: s.players[tok] });
  }

  // ---------- host actions ----------
  host(action, p = {}) {
    const fn = this['h_' + action];
    if (!fn) return this.err('Unknown action');
    return fn.call(this, p);
  }

  h_start() {
    const s = this.s;
    if (s.phase !== 'lobby') return this.err('Already started.');
    if (this.teamIds().length < 1) return this.err('Need at least one team.');
    s.round = 1;
    this.setupRound();
    s.phase = 'board';
    s.control = this.teamIds()[Math.floor(this.rng() * this.teamIds().length)];
    this.log('Round 1: the board opens.');
    return this.ok();
  }

  setupRound() {
    const s = this.s;
    s.used = {}; s.dd = {}; s.cur = null;
    const r = this.roundData();
    const want = s.round === 1 ? 1 : 2;
    const cats = r.categories.map((_, i) => i);
    // explicit dd flags in content win
    r.categories.forEach((c, ci) => c.clues.forEach((cl, ri) => { if (cl.dd) s.dd[`${ci}:${ri}`] = true; }));
    while (Object.keys(s.dd).length < want) {
      const ci = cats.splice(Math.floor(this.rng() * cats.length), 1)[0];
      if (ci === undefined) break;
      const ri = 1 + Math.floor(this.rng() * (r.categories[ci].clues.length - 1));
      s.dd[`${ci}:${ri}`] = true;
    }
  }

  h_pick({ ci, ri }) {
    const s = this.s;
    if (s.phase !== 'board') return this.err('Not on the board.');
    const clue = this.clueAt(ci, ri);
    if (!clue) return this.err('No such clue.');
    const key = `${ci}:${ri}`;
    if (s.used[key]) return this.err('Already used.');
    s.cur = {
      ci, ri, key, value: clue.value, dd: !!s.dd[key], state: s.dd[key] ? 'wager' : 'reading',
      queue: [], excluded: [], early: {}, cursed: {}, floor: null, floorPlayer: null,
      armedAt: 0, deadline: 0, wager: 0, timedOut: false, flash: null,
    };
    s.phase = 'clue';
    this.log(`${this.roundData().categories[ci].name} for ${clue.value}${s.dd[key] ? ' (SUDO!)' : ''}.`);
    return this.ok();
  }

  h_wager({ amount }) {
    const c = this.s.cur;
    if (!c || c.state !== 'wager') return this.err('No wager pending.');
    const team = this.s.teams[this.s.control];
    if (!team) return this.err('No team in control.');
    const max = Math.max(team.score, this.s.round === 1 ? 1000 : 2000);
    amount = Math.round(Number(amount));
    if (!Number.isFinite(amount) || amount < 5 || amount > max) return this.err(`Wager 5–${max}.`);
    c.wager = amount;
    c.state = 'answering';
    c.floor = team.id;
    c.floorPlayer = null;
    this.log(`${team.name} wagers ${amount}.`);
    return this.ok();
  }

  h_arm() {
    const c = this.s.cur;
    if (!c || c.state !== 'reading') return this.err('Nothing to arm.');
    this.armNow();
    return this.ok();
  }

  armNow() {
    const s = this.s, c = s.cur, t = this.now();
    c.state = 'armed';
    c.armedAt = t;
    c.deadline = t + s.armMs;
    for (const [tid, n] of Object.entries(c.early)) {
      if (n > 0 && s.teams[tid]) s.teams[tid].lockUntil = t + EARLY_LOCKOUT_MS;
    }
  }

  h_judge({ correct }) {
    const s = this.s, c = s.cur;
    if (!c || c.state !== 'answering') return this.err('Nobody has the floor.');
    const team = s.teams[c.floor];
    const val = c.dd ? c.wager : c.value;
    if (correct) {
      team.score += val;
      s.control = team.id;
      c.flash = { type: 'correct', teamId: team.id };
      this.log(`${team.name} +${val}.`);
      c.state = 'revealed';
    } else {
      team.score -= val;
      c.excluded.push(team.id);
      c.flash = { type: 'wrong', teamId: team.id };
      this.log(`${team.name} -${val}.`);
      c.floor = null; c.floorPlayer = null;
      if (c.dd) { c.state = 'revealed'; return this.ok(); }
      let next = c.queue.shift();
      while (next && c.excluded.includes(next.teamId)) next = c.queue.shift();
      if (next) {
        c.floor = next.teamId; c.floorPlayer = next.pid; c.state = 'answering';
      } else if (c.excluded.length >= this.teamIds().length) {
        c.state = 'revealed';
      } else {
        c.state = 'armed'; c.armedAt = this.now(); c.deadline = this.now() + s.armMs;
      }
    }
    return this.ok();
  }

  h_reveal() {
    const c = this.s.cur;
    if (!c || c.state === 'revealed' || c.state === 'wager') return this.err('Cannot reveal now.');
    c.state = 'revealed';
    c.floor = null;
    return this.ok();
  }

  h_close() {
    const s = this.s, c = s.cur;
    if (!c || c.state !== 'revealed') return this.err('Reveal the answer first.');
    s.used[c.key] = true;
    s.cur = null; s.phase = 'board'; s.bloodMoon = false; s.pending = {};
    return this.ok();
  }

  h_nextRound() {
    const s = this.s;
    if (s.phase !== 'board') return this.err('Finish the clue first.');
    if (s.round < this.content.rounds.length) {
      s.round += 1; this.setupRound();
      this.log(`Round ${s.round}: the board deepens.`);
      return this.ok();
    }
    return this.h_final();
  }

  h_final() {
    const s = this.s;
    if (s.phase !== 'board') return this.err('Finish the clue first.');
    s.phase = 'final'; s.cur = null;
    const elig = this.teamIds().filter((t) => s.teams[t].score > 0);
    s.final = { state: 'wager', eligible: elig, wagers: {}, answers: {}, deadline: 0, judged: {}, order: [], idx: -1 };
    this.log('FINAL ROUND: kernel panic.');
    return this.ok();
  }

  h_finalSetWager({ teamId, amount }) { return this.finalWager(teamId, amount); }

  h_finalOpen() {
    const f = this.s.final;
    if (!f || f.state !== 'wager') return this.err('Not at wager stage.');
    f.state = 'answer';
    f.deadline = this.now() + FINAL_ANSWER_MS;
    return this.ok();
  }

  h_finalClose() {
    const f = this.s.final;
    if (!f || f.state !== 'answer') return this.err('Not answering.');
    this.beginFinalJudging();
    return this.ok();
  }

  beginFinalJudging() {
    const s = this.s, f = s.final;
    f.state = 'judge';
    f.order = f.eligible.slice().sort((a, b) => s.teams[a].score - s.teams[b].score);
    f.idx = f.order.length ? 0 : -1;
    if (!f.order.length) { f.state = 'done'; s.phase = 'over'; }
  }

  h_finalJudge({ correct }) {
    const s = this.s, f = s.final;
    if (!f || f.state !== 'judge' || f.idx < 0) return this.err('Not judging.');
    const tid = f.order[f.idx];
    const w = f.wagers[tid] || 0;
    s.teams[tid].score += correct ? w : -w;
    f.judged[tid] = !!correct;
    this.log(`${s.teams[tid].name} ${correct ? '+' : '-'}${w}.`);
    return this.ok();
  }

  h_finalNext() {
    const s = this.s, f = s.final;
    if (!f || f.state !== 'judge') return this.err('Not judging.');
    const tid = f.order[f.idx];
    if (!(tid in f.judged)) return this.err('Judge this team first.');
    if (f.idx + 1 < f.order.length) f.idx += 1;
    else { f.state = 'done'; s.phase = 'over'; this.log('GAME OVER. The dead have spoken.'); }
    return this.ok();
  }

  h_score({ teamId, delta }) {
    const t = this.s.teams[teamId];
    if (!t) return this.err('No such team.');
    delta = Math.round(Number(delta));
    if (!Number.isFinite(delta) || Math.abs(delta) > 100000) return this.err('Bad delta.');
    t.score += delta;
    this.log(`Host adjusted ${t.name} by ${delta}.`);
    return this.ok();
  }

  h_setControl({ teamId }) {
    if (!this.s.teams[teamId]) return this.err('No such team.');
    this.s.control = teamId;
    return this.ok();
  }

  h_renameTeam({ teamId, name }) {
    const t = this.s.teams[teamId];
    name = clean(name, 24);
    if (!t || !name) return this.err('Bad rename.');
    t.name = name;
    return this.ok();
  }

  h_kick({ token }) {
    if (!this.s.players[token]) return this.err('No such player.');
    delete this.s.players[token];
    delete this.s.pending[token];
    return this.ok();
  }

  h_removeTeam({ teamId }) {
    const s = this.s;
    if (!s.teams[teamId]) return this.err('No such team.');
    for (const [tok, p] of Object.entries(s.players)) if (p.teamId === teamId) delete s.players[tok];
    delete s.teams[teamId];
    if (s.control === teamId) s.control = null;
    return this.ok();
  }

  h_chaos({ level }) {
    level = Math.max(0, Math.min(3, Math.round(Number(level))));
    this.s.chaos = level;
    this.log(`Chaos level ${level}.`);
    return this.ok();
  }

  h_armSeconds({ seconds }) {
    seconds = Math.max(3, Math.min(120, Math.round(Number(seconds))));
    this.s.armMs = seconds * 1000;
    return this.ok();
  }

  h_bloodMoon() {
    this.s.bloodMoon = !this.s.bloodMoon;
    this.log(this.s.bloodMoon ? 'BLOOD MOON rises: everyone gets a captcha.' : 'Blood moon sets.');
    return this.ok();
  }

  h_curse({ teamId }) {
    const t = this.s.teams[teamId];
    if (!t) return this.err('No such team.');
    t.curse = !t.curse;
    this.log(`${t.name} ${t.curse ? 'is cursed' : 'is uncursed'}.`);
    return this.ok();
  }

  h_restart() { this.reset(); return { ok: true }; }

  // Fresh board, same teams and players: scores to zero, back to the lobby. Settings (chaos, timers, captchas) stay.
  h_resetGame() {
    const s = this.s;
    for (const t of Object.values(s.teams)) { t.score = 0; t.lockUntil = 0; t.curse = false; }
    Object.assign(s, { phase: 'lobby', round: 0, control: null, used: {}, dd: {}, cur: null, final: null, bloodMoon: false, pending: {}, lastCurse: null });
    this.log('Game reset. Teams kept, scores zeroed.');
    return this.ok();
  }

  enabledCaptchas() {
    const on = this.s.captchas || {};
    return challenges.NAMES.filter((n) => (n in on ? on[n] : challenges.DEFAULT_ON.includes(n)));
  }

  h_captcha({ kind, on }) {
    if (!challenges.NAMES.includes(kind)) return this.err('Unknown captcha.');
    const next = Object.assign({}, this.s.captchas || {}, { [kind]: !!on });
    if (!challenges.NAMES.some((n) => (n in next ? next[n] : challenges.DEFAULT_ON.includes(n)))) return this.err('Keep at least one captcha on.');
    this.s.captchas = next;
    this.log(`Captcha ${kind} ${on ? 'on' : 'off'}.`);
    return this.ok();
  }

  // ---------- player actions ----------
  buzz(token) {
    const s = this.s, p = s.players[token];
    if (!p) return this.err('Unknown player.');
    const team = s.teams[p.teamId];
    const c = s.cur, t = this.now();
    if (!c || c.state === 'reading') {
      if (c) c.early[team.id] = (c.early[team.id] || 0) + 1;
      return this.ok({ status: 'early' });
    }
    if (c.state === 'armed') {
      if (c.excluded.includes(team.id)) return this.ok({ status: 'out' });
      if (t < team.lockUntil) return this.ok({ status: 'locked', ms: team.lockUntil - t });
      if (this.shouldCurse(p, team, c, t)) {
        const ch = challenges.make(this.rng, null, this.enabledCaptchas());
        this.s.pending[token] = { ch, key: c.key, issuedAt: t };
        c.cursed[token] = true;
        team.curse = false;
        this.log(`${p.name} is cursed (${ch.kind}).`);
        s.curseN = (s.curseN || 0) + 1;
        s.lastCurse = { n: s.curseN, name: p.name, team: team.name, emoji: team.emoji, t };
        this.emit();
        return { ok: true, status: 'challenge', challenge: ch.pub };
      }
      return this.register(p, team, c, t);
    }
    if (c.state === 'answering') return this.register(p, team, c, t);
    return this.ok({ status: 'closed' });
  }

  shouldCurse(p, team, c, t) {
    const s = this.s;
    if (s.chaos === 0 && !s.bloodMoon && !team.curse) return false;
    if (team.curse || (s.bloodMoon && !c.cursed[p.token])) return true;
    if (c.cursed[p.token]) return false;
    if (s.chaos >= 1 && (c.early[team.id] || 0) >= 3) return true;
    if (s.chaos >= 1 && t - c.armedAt < SPAM_WINDOW_MS) return true;
    return this.rng() < CURSE_CHANCE[s.chaos];
  }

  solve(token, answer) {
    const s = this.s, p = s.players[token], pend = s.pending[token];
    if (!p || !pend) return this.err('No challenge pending.');
    const c = s.cur, t = this.now();
    if (!c || c.key !== pend.key || (c.state !== 'armed' && c.state !== 'answering')) {
      delete this.s.pending[token];
      return this.ok({ status: 'closed' });
    }
    if (!challenges.check(pend.ch, answer, t - pend.issuedAt)) {
      const ch = challenges.make(this.rng, pend.ch.kind, this.enabledCaptchas());
      this.s.pending[token] = { ch, key: pend.key, issuedAt: t };
      return { ok: true, status: 'challenge', retry: true, challenge: ch.pub };
    }
    delete this.s.pending[token];
    const team = s.teams[p.teamId];
    if (c.excluded.includes(team.id)) return this.ok({ status: 'out' });
    if (c.state === 'armed' && t < team.lockUntil) return this.ok({ status: 'locked', ms: team.lockUntil - t });
    return this.register(p, team, c, t);
  }

  register(p, team, c, t) {
    if (c.excluded.includes(team.id)) return this.ok({ status: 'out' });
    if (c.state === 'armed') {
      c.state = 'answering';
      c.floor = team.id;
      c.floorPlayer = p.pid;
      c.flash = { type: 'buzz', teamId: team.id };
      this.log(`${p.name} (${team.name}) buzzes in.`);
      return this.ok({ status: 'floor' });
    }
    if (c.state === 'answering') {
      if (c.floor === team.id || c.queue.some((q) => q.teamId === team.id)) return this.ok({ status: 'queued' });
      c.queue.push({ teamId: team.id, pid: p.pid, t });
      return this.ok({ status: 'queued' });
    }
    return this.ok({ status: 'closed' });
  }

  finalWager(teamId, amount) {
    const s = this.s, f = s.final;
    if (!f || f.state !== 'wager') return this.err('Wagering is closed.');
    const team = s.teams[teamId];
    if (!team || !f.eligible.includes(teamId)) return this.err('That team is not playing the final.');
    amount = Math.round(Number(amount));
    if (!Number.isFinite(amount) || amount < 0 || amount > team.score) return this.err(`Wager 0–${team.score}.`);
    f.wagers[teamId] = amount;
    return this.ok();
  }

  playerFinalWager(token, amount) {
    const p = this.s.players[token];
    if (!p) return this.err('Unknown player.');
    return this.finalWager(p.teamId, amount);
  }

  finalAnswer(token, text) {
    const s = this.s, f = s.final, p = s.players[token];
    if (!p) return this.err('Unknown player.');
    if (!f || f.state !== 'answer') return this.err('Answers are closed.');
    if (!f.eligible.includes(p.teamId)) return this.err('Your team is out of the final.');
    f.answers[p.teamId] = clean(text, 120);
    return this.ok();
  }

  // ---------- time ----------
  tick() {
    const s = this.s, c = s.cur, t = this.now();
    let changed = false;
    if (c && c.state === 'armed' && t >= c.deadline) {
      c.state = 'revealed'; c.timedOut = true; c.floor = null; changed = true;
      this.log('Time. Nobody got it.');
    }
    if (s.final && s.final.state === 'answer' && t >= s.final.deadline) {
      this.beginFinalJudging(); changed = true;
    }
    if (changed) this.emit();
  }

  // ---------- views ----------
  teamsView() {
    return Object.values(this.s.teams).map((t) => ({ id: t.id, name: t.name, emoji: t.emoji, color: t.color, score: t.score, cursed: !!t.curse }));
  }

  boardView(isHost) {
    const s = this.s, r = s.round ? this.roundData() : null;
    const v = {
      phase: s.phase, round: s.round, rounds: this.content.rounds.length, title: this.content.title,
      teams: this.teamsView(), control: s.control, chaos: s.chaos, bloodMoon: s.bloodMoon,
      now: this.now(), armMs: s.armMs, players: Object.keys(s.players).length, lastCurse: s.lastCurse || null,
    };
    if (r) {
      v.roundName = r.name;
      v.cats = r.categories.map((c, ci) => ({ name: c.name, clues: c.clues.map((cl, ri) => ({ value: cl.value, used: !!s.used[`${ci}:${ri}`] })) }));
    }
    const c = s.cur;
    if (c) {
      const cl = this.clueAt(c.ci, c.ri);
      const showText = c.state !== 'wager';
      v.cur = {
        ci: c.ci, ri: c.ri, category: r.categories[c.ci].name, value: c.value, dd: c.dd, state: c.state,
        clue: showText ? cl.clue : null, answer: c.state === 'revealed' ? cl.answer : undefined,
        floor: c.floor, queue: c.queue.map((q) => q.teamId), excluded: c.excluded,
        armedAt: c.armedAt, deadline: c.deadline, wager: c.wager, timedOut: c.timedOut, flash: c.flash,
        floorPlayer: c.floorPlayer ? this.playerName(c.floorPlayer) : null,
      };
    }
    const f = s.final;
    if (f) {
      const fc = this.content.final;
      v.final = {
        state: f.state, category: fc.category, eligible: f.eligible, deadline: f.deadline,
        wagered: Object.keys(f.wagers), answered: Object.keys(f.answers),
        clue: f.state === 'wager' ? null : fc.clue,
      };
      if (f.state === 'judge' || f.state === 'done') {
        const upto = f.state === 'done' ? f.order.length : f.idx + 1;
        v.final.order = f.order;
        v.final.idx = f.idx;
        v.final.reveals = f.order.slice(0, upto).map((tid) => ({
          teamId: tid, answer: f.answers[tid] || '', wager: tid in f.judged ? f.wagers[tid] || 0 : null,
          correct: f.judged[tid],
        }));
        if (f.state === 'done') v.final.correct = fc.answer;
      }
    }
    if (isHost) {
      if (c) v.cur.hostAnswer = this.clueAt(c.ci, c.ri).answer;
      if (c) v.cur.hostNote = this.clueAt(c.ci, c.ri).note || '';
      if (c) v.cur.queueDetail = c.queue.map((q) => ({ teamId: q.teamId, who: this.playerName(q.pid) }));
      if (f) {
        v.final.hostAnswer = this.content.final.answer;
        v.final.wagers = f.wagers; v.final.answers = f.answers; v.final.judged = f.judged;
      }
      v.dd = s.dd;
      const en = this.enabledCaptchas();
      v.captchas = challenges.NAMES.map((n) => ({ kind: n, on: en.includes(n), optIn: challenges.OPT_IN.includes(n) }));
      v.roster = Object.values(s.players).map((p) => ({ token: p.token, name: p.name, teamId: p.teamId }));
      v.log = s.log.slice(-40);
    }
    return v;
  }

  playerName(pid) {
    const p = Object.values(this.s.players).find((x) => x.pid === pid);
    return p ? p.name : '';
  }

  playerView(token) {
    const s = this.s, p = s.players[token];
    const b = this.boardView(false);
    const out = { phase: b.phase, round: b.round, teams: b.teams, now: b.now, title: b.title, final: b.final && { state: b.final.state, eligible: b.final.eligible, deadline: b.final.deadline, category: b.final.category } };
    if (!p) { out.me = null; return out; }
    const team = s.teams[p.teamId];
    out.me = { name: p.name, teamId: team.id, team: team.name, emoji: team.emoji, color: team.color, score: team.score };
    const c = s.cur;
    let buzz = 'locked';
    if (c) {
      out.clue = { category: b.cur.category, value: c.value, dd: c.dd, state: c.state, deadline: c.deadline };
      const t = this.now();
      if (c.excluded.includes(team.id)) buzz = 'out';
      else if (c.state === 'armed') buzz = t < team.lockUntil ? 'lockout' : 'armed';
      else if (c.state === 'answering') {
        if (c.floor === team.id) buzz = 'floor';
        else if (c.queue.some((q) => q.teamId === team.id)) buzz = 'queued';
        else buzz = 'armed'; // can still queue
      } else if (c.state === 'reading') buzz = 'early';
      if (c.state === 'wager' || c.state === 'revealed') buzz = 'locked';
      out.lockUntil = team.lockUntil;
    }
    out.buzz = buzz;
    if (s.bloodMoon) out.bloodMoon = true;
    if (s.final) {
      const f = s.final;
      out.finalMe = {
        eligible: f.eligible.includes(team.id), max: Math.max(0, team.score),
        wager: f.wagers[team.id], answer: f.answers[team.id],
      };
    }
    return out;
  }
}

module.exports = { Game, clean };

'use strict';
// Troll captchas. Each challenge has a `pub` half (sent to the player's phone)
// and a `secret` half (kept on the server). Anything checkable is checked on
// the server so a hacker-meetup crowd can't skip it from devtools.

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

const ROT13 = (s) => s.replace(/[a-z]/gi, (c) => {
  const b = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b);
});

const CURSED_PHRASES = [
  'I AM NOT A ROBOT AND I FEAR THE VOID',
  'sudo rm -rf / --no-preserve-root',
  'THE CALL IS COMING FROM INSIDE THE HOUSE',
  'there is no cloud only someone elses haunted computer',
  'all your base are belong to the dead',
  'DO NOT DELETE SYSTEM32 AT MIDNIGHT',
  'chmod 666 /dev/soul',
  'I HAVE SEEN THE KERNEL PANIC AND IT SAW ME',
];

const ROT_WORDS = ['ghost', 'vampire', 'zombie', 'exploit', 'shell', 'phantom', 'coffin', 'daemon'];

const SCRAMBLE_WORDS = ['firewall', 'payload', 'backdoor', 'rootkit', 'zombie', 'ransomware', 'phishing', 'daemon', 'exploit', 'keylogger'];
const B64_WORDS = ['ghost', 'sudo', 'root', 'cursed', 'banshee', 'werewolf', 'shadow', 'coffin'];
const REVERSE_WORDS = ['necromancer', 'poltergeist', 'graveyard', 'nightmare', 'hellgame', 'sasquatch', 'cryptography'];
const LEET_WORDS = ['hack the planet', 'trick or treat', 'zero day', 'happy halloween', 'sasquatch', 'it is alive'];
const LEET = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' };

const GRID_THEMES = [
  { want: '👻', label: 'GHOSTS', pool: ['🎃', '💀', '🕷️', '🦇', '🧛', '🕸️'] },
  { want: '🎃', label: 'PUMPKINS', pool: ['👻', '💀', '🕷️', '🦇', '🧟', '🕸️'] },
  { want: '💀', label: 'SKULLS', pool: ['🎃', '👻', '🕷️', '🦇', '🧛', '🕸️'] },
  { want: '🦇', label: 'BATS', pool: ['🎃', '👻', '🕷️', '💀', '🧛', '🕸️'] },
];

const generators = {
  arith(rng) {
    const a = int(rng, 6, 19), b = int(rng, 3, 9), c = int(rng, 2, 30);
    const op = pick(rng, ['+', '-']);
    const val = op === '+' ? a * b + c : a * b - c;
    return { pub: { type: 'text', prompt: `Prove you are human: ${a} × ${b} ${op} ${c} = ?`, input: 'number' }, secret: { answer: String(val) } };
  },
  hex(rng) {
    const a = int(rng, 1, 15), b = int(rng, 1, 15);
    return { pub: { type: 'text', prompt: `0x${a.toString(16).toUpperCase()} + 0x${b.toString(16).toUpperCase()} = ? (decimal)`, input: 'number' }, secret: { answer: String(a + b) } };
  },
  binary(rng) {
    const v = int(rng, 5, 63);
    return { pub: { type: 'text', prompt: `What is 0b${v.toString(2)} in decimal?`, input: 'number' }, secret: { answer: String(v) } };
  },
  ascii(rng) {
    const ch = pick(rng, 'ABCDEFGHJKMNPRSTWXYZ'.split(''));
    return { pub: { type: 'text', prompt: `ASCII ${ch.charCodeAt(0)} is which letter?`, input: 'text' }, secret: { answer: ch.toLowerCase() } };
  },
  rot13(rng) {
    const w = pick(rng, ROT_WORDS);
    return { pub: { type: 'text', prompt: `Decode this ROT13 whisper: ${ROT13(w)}`, input: 'text' }, secret: { answer: w } };
  },
  phrase(rng) {
    const p = pick(rng, CURSED_PHRASES);
    return { pub: { type: 'text', prompt: 'Type the incantation EXACTLY (case counts):', show: p, input: 'text' }, secret: { answer: p, exact: true } };
  },
  grid(rng) {
    const theme = pick(rng, GRID_THEMES);
    const cells = [];
    const want = [];
    for (let i = 0; i < 9; i++) {
      const hit = rng() < 0.4;
      cells.push(hit ? theme.want : pick(rng, theme.pool));
      if (hit) want.push(i);
    }
    if (!want.length) { cells[4] = theme.want; want.push(4); }
    return { pub: { type: 'grid', prompt: `Select all squares containing ${theme.label}`, cells }, secret: { want } };
  },
  slider(rng) {
    const target = pick(rng, [13, 66, 69, 313, 404, 666, 1337]);
    return { pub: { type: 'slider', prompt: `Set the slider to EXACTLY ${target}`, min: 0, max: 1400, target }, secret: { target } };
  },
  hold(rng) {
    const ms = int(rng, 2500, 4000);
    return { pub: { type: 'hold', prompt: 'Hold the sigil to prove you have a pulse', ms }, secret: {}, minMs: ms };
  },
  mash(rng) {
    const n = int(rng, 13, 20);
    return { pub: { type: 'mash', prompt: `Mash it ${n} times. It fights back.`, n }, secret: {}, minMs: n * 90 };
  },
  verify(rng) {
    return { pub: { type: 'verify', prompt: 'Verifying you are human…' }, secret: {}, minMs: 4000 };
  },
  // ---- opt-in captchas (host turns these on) ----
  reverse(rng) {
    const w = pick(rng, REVERSE_WORDS);
    return { pub: { type: 'text', prompt: `Type "${w}" BACKWARDS`, input: 'text' }, secret: { answer: w.split('').reverse().join('') } };
  },
  leet(rng) {
    const w = pick(rng, LEET_WORDS);
    return { pub: { type: 'text', prompt: 'Translate from l33t back to English:', show: w.replace(/[aeiost]/g, (c) => LEET[c]), input: 'text' }, secret: { answer: w } };
  },
  base64(rng) {
    const w = pick(rng, B64_WORDS);
    return { pub: { type: 'text', prompt: 'Decode this base64 (you have a terminal, probably):', show: Buffer.from(w).toString('base64'), input: 'text' }, secret: { answer: w } };
  },
  unscramble(rng) {
    const w = pick(rng, SCRAMBLE_WORDS);
    let a;
    do { a = w.split(''); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } } while (a.join('') === w && rng() < 0.99);
    return { pub: { type: 'text', prompt: 'Unscramble this hacker word:', show: a.join('').toUpperCase(), input: 'text' }, secret: { answer: w } };
  },
  count(rng) {
    const want = pick(rng, ['🦇', '👻', '🎃', '💀']);
    const n = int(rng, 4, 11);
    const others = ['🕷️', '🕸️', '🧛', '🧟'];
    const cells = [];
    for (let i = 0; i < n; i++) cells.push(want);
    for (let i = 0; i < int(rng, 6, 10); i++) cells.push(pick(rng, others));
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    return { pub: { type: 'text', prompt: `How many ${want} are there?`, show: cells.join(' '), input: 'number' }, secret: { answer: String(n) } };
  },
  queue(rng) {
    const n = int(rng, 40, 400);
    return { pub: { type: 'verify', prompt: `High traffic. You are #${n} in line for human verification…` }, secret: {}, minMs: 7000 };
  },
};

const NAMES = Object.keys(generators);
// New ones are off until the host enables them.
const OPT_IN = ['reverse', 'leet', 'base64', 'unscramble', 'count', 'queue'];
const DEFAULT_ON = NAMES.filter((n) => !OPT_IN.includes(n));

function make(rng = Math.random, avoid = null, enabled = null) {
  let pool = (enabled && enabled.length ? enabled : DEFAULT_ON).filter((n) => generators[n]);
  if (!pool.length) pool = DEFAULT_ON;
  const name = pick(rng, pool.length > 1 ? pool.filter((n) => n !== avoid) : pool);
  const g = generators[name](rng);
  return { kind: name, pub: g.pub, secret: g.secret, minMs: g.minMs || 0 };
}

// Returns true if `answer` solves challenge `ch` after `elapsedMs`.
function check(ch, answer, elapsedMs) {
  if (elapsedMs < ch.minMs) return false;
  const t = ch.pub.type;
  if (t === 'text') {
    const got = String(answer == null ? '' : answer).trim();
    return ch.secret.exact ? got === ch.secret.answer : got.toLowerCase() === ch.secret.answer;
  }
  if (t === 'grid') {
    if (!Array.isArray(answer)) return false;
    const got = [...new Set(answer.map(Number))].sort((a, b) => a - b);
    const want = ch.secret.want;
    return got.length === want.length && got.every((v, i) => v === want[i]);
  }
  if (t === 'slider') return Number(answer) === ch.secret.target;
  // hold / mash / verify: proof-of-work is client side, the server enforces minimum time
  return answer === true || answer === 'ok';
}

module.exports = { make, check, NAMES, OPT_IN, DEFAULT_ON };

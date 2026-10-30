'use strict';
// Shared client helpers: JSON API, SSE with auto-reconnect, tiny DOM + audio utilities.
const HG = {
  offset: 0, // serverNow - clientNow
  async api(path, body) {
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const j = await r.json();
      if (HG.kick) HG.kick(); // polling mode: refresh right after an action
      return j;
    } catch (e) { return { ok: false, error: 'Network error' }; }
  },
  // role: 'board' | 'player' | 'host'. onState(view), onStatus(bool connected).
  // Prefers a live SSE stream; if that is unavailable (serverless hosting) it falls back to polling /api/state.
  // Returns { close() }.
  connect(role, token, onState, onStatus) {
    let es = null, timer = null, closed = false, polling = false, got = false, last = null;
    const qs = `role=${role}${token ? '&token=' + encodeURIComponent(token) : ''}`;
    const deliver = (v) => {
      if (v.now) HG.offset = v.now - Date.now();
      last = v;
      onStatus && onStatus(true);
      onState(v);
    };
    const poll = async () => {
      clearTimeout(timer);
      if (closed) return;
      try {
        const r = await fetch('/api/state?' + qs, { cache: 'no-store' });
        if (r.ok) deliver((await r.json()).view); else onStatus && onStatus(false);
      } catch (_) { onStatus && onStatus(false); }
      // poll fast while a clue is live (buzz fairness), slowly otherwise
      const live = last && (last.phase === 'clue' || (last.clue && last.clue.state));
      timer = setTimeout(poll, live ? 500 : role === 'player' ? 1500 : 1000);
    };
    const startPolling = () => {
      if (polling || closed) return;
      polling = true;
      if (es) { es.close(); es = null; }
      HG.kick = () => { clearTimeout(timer); timer = setTimeout(poll, 40); };
      poll();
    };
    es = new EventSource(`/api/events?${qs}`);
    es.addEventListener('state', (e) => { got = true; deliver(JSON.parse(e.data)); });
    es.onerror = () => {
      onStatus && onStatus(false);
      if (!got) startPolling(); // never got a stream: this host cannot do SSE
      else if (es && es.readyState === 2) setTimeout(() => { if (!closed) startPolling(); }, 2000);
    };
    return { close() { closed = true; clearTimeout(timer); if (es) es.close(); } };
  },
  now() { return Date.now() + HG.offset; },
  h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  },
  money(n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US'); },
};

// Synthesized spooky sound effects. No audio files, works offline.
const HGAudio = (() => {
  let ctx = null, master = null, droneNodes = null;
  const ok = () => ctx && ctx.state !== 'closed';
  function init() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  function tone({ f = 440, f2, t = 0.2, type = 'sine', v = 0.3, at = 0, attack = 0.005 }) {
    if (!ok()) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + t);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + t + 0.05);
  }
  function noise({ t = 0.3, v = 0.3, at = 0, lp = 2000 }) {
    if (!ok()) return;
    const n = Math.floor(ctx.sampleRate * t), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
    const g = ctx.createGain(); g.gain.value = v;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(ctx.currentTime + at);
  }
  return {
    init,
    ready: () => ok() && ctx.state === 'running',
    buzz() { tone({ f: 880, f2: 220, t: 0.25, type: 'sawtooth', v: 0.35 }); tone({ f: 1320, t: 0.12, type: 'square', v: 0.15 }); },
    arm() { tone({ f: 330, t: 0.12, type: 'square', v: 0.18 }); tone({ f: 660, t: 0.18, type: 'square', v: 0.18, at: 0.1 }); },
    correct() { [523, 659, 784, 1047].forEach((f, i) => tone({ f, t: 0.35, type: 'triangle', v: 0.25, at: i * 0.09 })); },
    wrong() { tone({ f: 140, f2: 55, t: 0.7, type: 'sawtooth', v: 0.4 }); noise({ t: 0.5, v: 0.2, lp: 700 }); },
    select() { tone({ f: 200, f2: 90, t: 0.18, type: 'square', v: 0.2 }); noise({ t: 0.12, v: 0.08, lp: 4000 }); },
    reveal() { tone({ f: 392, t: 0.5, type: 'triangle', v: 0.2 }); tone({ f: 466, t: 0.6, type: 'triangle', v: 0.2, at: 0.12 }); },
    thunder() { noise({ t: 1.6, v: 0.7, lp: 400 }); tone({ f: 60, f2: 28, t: 1.4, type: 'sine', v: 0.5 }); },
    dd() { this.thunder(); [90, 85, 80, 70].forEach((f, i) => tone({ f, f2: f / 2, t: 0.6, type: 'sawtooth', v: 0.3, at: i * 0.25 })); },
    timeout() { tone({ f: 200, f2: 100, t: 0.5, type: 'square', v: 0.3 }); tone({ f: 150, f2: 70, t: 0.7, type: 'square', v: 0.3, at: 0.3 }); },
    tick() { tone({ f: 1500, t: 0.03, type: 'square', v: 0.07 }); },
    curse() { tone({ f: 70, f2: 700, t: 0.35, type: 'sawtooth', v: 0.25 }); noise({ t: 0.3, v: 0.2, lp: 3000 }); },
    fanfare() { [392, 494, 587, 784, 988, 1175].forEach((f, i) => tone({ f, t: 0.5, type: 'triangle', v: 0.25, at: i * 0.12 })); this.thunder(); },
    drone(on) {
      if (!ok()) return;
      if (on && !droneNodes) {
        const g = ctx.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 2);
        const os = [55, 82.7, 110.4].map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const lf = ctx.createOscillator(); lf.frequency.value = 0.15 + Math.random() * 0.2; const lg = ctx.createGain(); lg.gain.value = 3; lf.connect(lg); lg.connect(o.frequency); lf.start(); o.connect(g); o.start(); return [o, lf]; });
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260; g.connect(f); f.connect(master);
        droneNodes = { g, os, f };
      } else if (!on && droneNodes) {
        const d = droneNodes; droneNodes = null;
        d.g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1);
        setTimeout(() => d.os.forEach(([o, l]) => { o.stop(); l.stop(); }), 1200);
      }
    },
  };
})();

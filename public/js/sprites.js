'use strict';
// Pixel-art sprites for the board. Each sprite is a list of frames; each frame is rows of
// palette letters ('.' = transparent). Frames are drawn side by side onto a canvas, and the
// canvas becomes a data: URL, so there are no image files to load or cache.
(function () {
  const PAL = {
    w: '#e9e6d6', s: '#9fb0b8', k: '#04070a', o: '#ff7a1a', O: '#b8480a', g: '#3dff6e', G: '#1f9a43',
    b: '#8b5cd6', B: '#5a3a96', r: '#e5173f', p: '#7a3fd0', P: '#4b2490', y: '#ffd23f', t: '#6e8c7d', T: '#3d5a4d',
    c: '#c9c2d8', m: '#2b2b3d', M: '#55557a', q: '#ff8fb1', n: '#7a4a26', N: '#3f2813',
  };

  const ART = {
    ghost: [[
      '....wwwwww....',
      '..wwwwwwwwww..',
      '.wwwwwwwwwwww.',
      '.wwkkwwwwkkww.',
      'wwwkkwwwwkkwww',
      'wwwkkwwwwkkwww',
      'wwwwwwkkwwwwww',
      'wwwwwkkkkwwwww',
      'wwwwwwkkwwwwww',
      'wwwwwwwwwwwwww',
      'wwwwwwwwwwwwww',
      'wwwwwwwwwwwwww',
      'wwwwwwwwwwwwww',
      'ww.wwww.wwww.w',
      'w...ww...ww...',
    ]],
    pumpkin: [[
      '.....gggg.....',
      '......gg......',
      '..ooooggoooo..',
      '.oooooooooooo.',
      'ooookkoookkooo',
      'ooookkoookkooo',
      'oooooookoooooo',
      'ookkookkookkoo',
      'oookkkkkkkkkoo',
      'ooookkkkkkkooo',
      '.OooooooooooO.',
      '..OOOOOOOOOO..',
    ]],
    bat: [[
      'b.............b',
      'bb....b.b....bb',
      'bbb..bbbbb..bbb',
      'bbbbbbrbrbbbbbb',
      '.bbbbbbbbbbbbb.',
      '..bb.bbbbb.bb..',
      '...b..b.b..b...',
    ], [
      '......b.b......',
      '.....bbbbb.....',
      '..bbbbrbrbbbb..',
      'bbbbbbbbbbbbbbb',
      'bbb.bbbbbbb.bbb',
      'bb....b.b....bb',
      'b.............b',
    ]],
    skull: [[
      '..wwwwwwww..',
      '.wwwwwwwwww.',
      'wwwwwwwwwwww',
      'wwkkkwwkkkww',
      'wwkkkwwkkkww',
      'wwkkkwwkkkww',
      'wwwwwkkwwwww',
      '.wwwwkkwwww.',
      '..wwwwwwww..',
      '..wkwkwkwkw.',
      '..wkwkwkwkw.',
    ]],
    spider: [[
      '...c.....c...',
      '..c.ccccc.c..',
      '.c.ccccccc.c.',
      'c..ccrcrcc..c',
      '...ccccccc...',
      '.c.ccccccc.c.',
      'c...ccccc...c',
      '.....c.c.....',
    ]],
    hat: [[
      '.......pp....',
      '......pppp...',
      '.....pppp....',
      '.....pppp....',
      '....pppppp...',
      '....pppppp...',
      '...yyyyyyyy..',
      '...pppppppp..',
      '..pppppppppp.',
      'pppppppppppppp',
      '.PPPPPPPPPPPP.',
    ]],
    cat: [[
      '.MM.......MM.',
      '.MmM.....MmM.',
      '.MmmMMMMMmmM.',
      'MmmmmmmmmmmmM',
      'MmyymmmmmyymM',
      'MmykmmmmmykmM',
      'MmmmmmqmmmmmM',
      '.MmmmmMmmmmM.',
      '..MmmmmmmmM.M',
      '.MmmmMmMmmmM.M',
      '.MmmmmmmmmmM.M',
      '.MmmmmmmmmmMMM',
      '.MMMMMMMMMMM..',
    ]],
    coffin: [[
      '...NNNN...',
      '..NnnnnN..',
      '.NnnnnnnN.',
      'NnnnccnnnN',
      'NnnnccnnnN',
      'NnnccccnnN',
      'NnnnccnnnN',
      'NnnnccnnnN',
      'NnnnccnnnN',
      'NnnnnnnnnN',
      '.NnnnnnnN.',
      '.NnnnnnnN.',
      '..NnnnnN..',
      '..NnnnnN..',
      '...NNNN...',
    ]],
    tomb: [[
      '...tttttt...',
      '..tttttttt..',
      '.tttttttttt.',
      '.ttTTTTTTtt.',
      '.ttTttTTTtt.',
      '.ttTtTTTTtt.',
      '.ttTTttTTtt.',
      '.ttTtTtTTtt.',
      '.tttttttttt.',
      '.tttttttttt.',
      '.tttttttttt.',
      'gGgGgGgGgGgG',
    ]],
  };

  const cache = {};
  // returns { url, w, h, frames }
  function sheet(name) {
    if (cache[name]) return cache[name];
    const frames = ART[name];
    const w = Math.max(...frames[0].map((r) => r.length)), hh = frames[0].length;
    const cv = document.createElement('canvas');
    cv.width = w * frames.length; cv.height = hh;
    const cx = cv.getContext('2d');
    frames.forEach((rows, f) => rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = PAL[row[x]];
        if (!col) continue;
        cx.fillStyle = col;
        cx.fillRect(f * w + x, y, 1, 1);
      }
    }));
    return (cache[name] = { url: cv.toDataURL('image/png'), w, h: hh, frames: frames.length });
  }

  // scale = vw per art pixel
  function sprite(name, scale, cls) {
    const s = sheet(name);
    const el = document.createElement('div');
    el.className = 'spr ' + (cls || '');
    el.style.width = s.w * scale + 'vw';
    el.style.height = s.h * scale + 'vw';
    el.style.backgroundImage = `url(${s.url})`;
    el.style.backgroundSize = `${s.w * s.frames * scale}vw ${s.h * scale}vw`;
    if (s.frames > 1) { el.style.setProperty('--sheet', `-${s.w * s.frames * scale}vw`); el.classList.add('flap'); }
    return el;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  const fx = () => document.getElementById('fx');
  const add = (el, ttl) => { fx().append(el); if (ttl) setTimeout(() => el.remove(), ttl); return el; };

  // ---------- persistent scenery, per phase ----------
  let sceneEl = null;
  function scene(phase) {
    if (sceneEl) sceneEl.remove();
    sceneEl = document.createElement('div');
    sceneEl.className = 'scene';
    fx().append(sceneEl);
    const hang = (x, len, scale) => {
      const wrap = document.createElement('div');
      wrap.className = 'hang';
      wrap.style.left = x + 'vw';
      wrap.style.animationDuration = rnd(3.5, 6) + 's';
      const th = document.createElement('i');
      th.style.height = len + 'vw';
      wrap.append(th, sprite('spider', scale));
      sceneEl.append(wrap);
    };
    if (phase === 'lobby') {
      // graveyard along the bottom
      ['tomb', 'pumpkin', 'cat', 'hat', 'coffin', 'tomb'].forEach((n, i) => {
        const e = sprite(n, 0.34);
        e.classList.add('ground');
        e.style.left = (i * 16.5 + rnd(1, 4)) + 'vw';
        sceneEl.append(e);
      });
      [[6, 14], [86, 8]].forEach(([x, y], i) => {
        const g = sprite('ghost', 0.4, 'drift');
        g.style.left = x + 'vw'; g.style.top = (18 + y * 2 + i * 6) + 'vh';
        g.style.animationDuration = rnd(7, 11) + 's, ' + rnd(14, 22) + 's';
        g.style.animationDelay = (-rnd(0, 8)) + 's';
        sceneEl.append(g);
      });
      hang(3, 9, 0.28); hang(92, 14, 0.3);
    } else if (phase === 'over') {
      for (let i = 0; i < 3; i++) {
        const g = sprite(['ghost', 'cat', 'coffin'][i], 0.5, 'drift');
        g.style.left = (12 + i * 34) + 'vw'; g.style.top = (62 + (i % 3) * 8) + 'vh';
        g.style.animationDelay = (-i) + 's';
        sceneEl.append(g);
      }
    } else {
      hang(97, 5, 0.22);
    }
  }

  // ---------- one-shots ----------
  function flyBat(opts = {}) {
    const b = sprite('bat', opts.scale || rnd(0.28, 0.42), 'fly');
    const ltr = Math.random() < 0.5;
    b.style.top = (opts.top != null ? opts.top : rnd(8, 78)) + 'vh';
    const dur = opts.dur || rnd(5, 8), delay = opts.delay || 0;
    // two animations: the flight path (linear, once) and the wing flap (steps, forever)
    b.style.animation = `${ltr ? 'fxFlyR' : 'fxFlyL'} ${dur}s linear ${delay}s both, fxFlap .35s steps(1) infinite`;
    add(b, (dur + delay) * 1000 + 500);
  }

  function burst(kind) {
    if (!fx()) return;
    if (kind === 'good') {
      // pumpkins and ghosts hop up from the floor
      for (let i = 0; i < 5; i++) {
        const e = sprite(i % 3 === 0 ? 'ghost' : 'pumpkin', rnd(0.3, 0.5), 'rise');
        e.style.left = rnd(3, 92) + 'vw';
        e.style.animationDelay = rnd(0, 0.6) + 's';
        add(e, 3200);
      }
    } else if (kind === 'bad') {
      for (let i = 0; i < 4; i++) {
        const e = sprite('skull', rnd(0.3, 0.45), 'drop');
        e.style.left = rnd(4, 92) + 'vw';
        e.style.animationDelay = rnd(0, 0.7) + 's';
        add(e, 3000);
      }
    } else if (kind === 'curse') {
      const e = sprite('skull', 1.2, 'stamp');
      e.style.left = '44vw'; e.style.top = '30vh';
      add(e, 1800);
    } else if (kind === 'moon') {
      for (let i = 0; i < 8; i++) flyBat({ delay: rnd(0, 3), dur: rnd(3, 6) });
    } else if (kind === 'dd') {
      const e = sprite('ghost', 1.4, 'zoom');
      e.style.left = '42vw'; e.style.top = '30vh';
      add(e, 2600);
    } else if (kind === 'over') {
      const list = ['bat', 'ghost', 'pumpkin', 'skull', 'hat', 'cat', 'coffin'];
      for (let i = 0; i < 14; i++) {
        const e = sprite(list[i % list.length], rnd(0.3, 0.5), 'fall');
        e.style.left = rnd(1, 95) + 'vw';
        e.style.animationDuration = rnd(4, 9) + 's';
        e.style.animationDelay = rnd(0, 4) + 's';
        add(e, 14000);
      }
    }
  }

  // an occasional bat flies by, unless the buzzers are live and people should be reading
  let quiet = false;
  (function ambient() {
    setTimeout(() => { if (fx() && !quiet) flyBat(); ambient(); }, rnd(9000, 16000));
  })();

  window.HGFX = { sprite, scene, burst, flyBat, setQuiet: (q) => { quiet = q; }, skullUrl: () => sheet('skull').url };
})();

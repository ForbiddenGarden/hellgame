# $hellgame

Hacker Jeopardy for the SSH (Snohomish Sasquatch Hackers) Halloween meetup, Oct 31 2026.
Sibling project: `../lcl_sec_grp` (sasquatch.sh).

- `server.js`: zero-dep Node http + SSE; JSON persistence to `data/state.json`
- `lib/game.js`: whole game state machine (host actions are `h_*`); `lib/challenges.js`: troll captchas
- `public/`: `play.html` (`/`), `board.html`, `host.html`; shared `js/common.js` (API, SSE, WebAudio)
- `content/game.json`: clues. Answers must never be sent to board/player views before reveal (tested)
- Run `npm test` after touching `lib/`. Palette matches the SSH site, plus blood red / pumpkin.
- CSP forbids inline scripts: keep JS in files.
- Two runtimes share `lib/game.js`: `server.js` (in-memory + SSE, fallback) and `api/handler.js` -> `lib/handler.js`
  (Vercel, Redis via `lib/store.js`, client polling). Pending captchas live in saved state so any instance can verify them.
- `tools/vercel-local.js` emulates the Vercel path locally. Repo: github.com/ForbiddenGarden/hellgame (private)

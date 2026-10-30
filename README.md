# $hellgame

Hacker Jeopardy with a Halloween curse, built for the Snohomish Sasquatch Hackers
Halloween meetup (Oct 31, 1–3 PM, Monroe Public Library).

One host runs the game. The big screen shows the board. Everyone else joins on a phone,
picks a team, and becomes a buzzer. Spam the button and the game will make you prove you
are human with a troll captcha.

No dependencies, just Node 18+.

```bash
HOST_KEY=choose-something npm start     # http://localhost:3666
npm test
```

| URL | Who | What |
|-----|-----|------|
| `/` | players | join a team, then buzz. Final-round wager and answer forms live here too |
| `/board` | projector | board, clues, scores, sound (click once to enable audio) |
| `/host` | you | sign in with `HOST_KEY`; pick clues, arm buzzers, judge, adjust scores |

## Running a game

1. Open `/board` on the projector and `/host` on your laptop. Players scan the QR code.
2. **Start**, then pick a clue. Read it aloud, press **Space** to arm buzzers.
3. First buzz gets the floor. **Y** correct, **N** wrong (next queued team gets it, or the
   buzzers re-arm), **R** reveal, **Enter** back to the board.
4. Daily Doubles ("SUDO") are placed randomly each round. The team in control wagers.
5. After round 2 the **Final Round**: phones submit wagers, then answers (45s), then you
   judge each team lowest-score-first.
6. The server saves state to `data/state.json`, so a crash or restart resumes the game.

Buzzer rules: buzzing before arming locks that team out for 0.75s. Wrong answers lose the
clue value. The host can adjust any score by hand.

## Chaos (the troll captchas)

Host bar, **chaos** 0-3. A buzz gets intercepted by a challenge (math, hex, ROT13, a grid of
ghosts, an exact slider, hold-the-sigil, mash-a-dodging-button, a fake "verifying you are
human" checkbox that runs away). The buzz only counts once it is solved, so a pranked
player loses the race.

- 1: only spammers (buzz within 0.3s of arming, or 3+ early presses)
- 2: spammers + 12% of buzzes   - 3: spammers + 35%
- **☾ blood moon**: next clue, every player must clear a captcha
- **☠** on a team: that team's next buzz is cursed

Challenges are issued and verified on the server. Clue answers never leave the server until
revealed (a security group will read the network tab).

## Content

`content/game.json`: 2 rounds × 6 categories × 5 clues plus a final. Edit freely.
Values are 200-1000 (round 1) and 400-2000 (round 2). Add `"dd": true` to pin a Daily
Double, otherwise they are random. `note` is shown to the host only.

`tools/pick.py` searches the [jwolle1 Jeopardy dataset](https://github.com/jwolle1/jeopardy_clue_dataset)
and [skullspace/hacker-jeopardy](https://github.com/skullspace/hacker-jeopardy) for more
ideas. Neither repo has a license file, so the shipped clues are written fresh (inspired by
the Skullspace categories) rather than copied. Fact-check anything you import.

## Deploy

Two ways to run it, same game and UI.

### A. Vercel (always-on, serverless)

`api/handler.js` + `lib/handler.js` are a stateless port. Each request loads the game from
Redis, applies the action, and writes it back with compare-and-set (so simultaneous buzzes
serialize). Clients poll `/api/state` (500ms during a live clue, 1-1.5s otherwise) instead of
holding an SSE stream. Static files come from `public/`, routes are in `vercel.json`.

1. Import the GitHub repo in Vercel (framework: Other; no build command).
2. Storage tab: add a Redis from the Marketplace. Either Upstash (REST: `KV_REST_API_URL` and
   `KV_REST_API_TOKEN`) or a plain `REDIS_URL` (redis:// or rediss://) both work. With neither, production errors out on purpose.
3. Settings, Environment Variables: set `HOST_KEY` to a strong secret.
4. Domains: add `hellgame.sasquatch.sh`; at GoDaddy add `CNAME hellgame -> cname.vercel-dns.com`.
5. Open `/host`, sign in, and run a dry run. **Reset everything** (bottom of the host panel after
   a game) wipes state.

Test the serverless path locally without Vercel: `HOST_KEY=x node tools/vercel-local.js`
(port 3777, in-memory store).

Tradeoff: polling means a phone can learn "buzzers are live" up to 0.5s after the board does.
Everyone has the same disadvantage, but SSE (option B) is fairer. If a hall full of
fast-twitch hackers gets competitive, use B.

### B. Your laptop (the original, fallback)

The Node server keeps state in memory and streams over SSE. Run `HOST_KEY=... npm start`, then
expose it with `cloudflared tunnel --url http://localhost:3666` (random trycloudflare URL, no
account) or any VPS using the `Dockerfile`. Open the board from the public URL so the QR code
points there.

Always set a strong `HOST_KEY` and serve over HTTPS. Expect this crowd to poke at it.

# Agent Idol

A desktop browser game about running a fleet of AI coding agents where **you
are the bottleneck**. One 30-minute timed run, score-attack, pixel sprites.
One number at the end.

The agents write the code. You are the only thing standing between them and
shipping, and there is only one of you.

---

## Cookbook

### Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

That is the whole setup. If anything feels wrong, run `npm run smoke` first —
it checks the environment, compiles the sim, runs the tests and sanity-checks
the balance in one go, and it tells you what to fix rather than just failing.

### Play it

You land on a start screen: `START RUN`, `HIGH SCORES`, `STUDIO KEY`. The clock
does not begin until you press start, so reading your key costs you nothing.

The run is 30 minutes and the clock never stops. There are **two gestures**:

| Gesture | On what | What happens |
|---|---|---|
| **Click** | anything **red** | a stuck agent retries |
| **Drag** | anything **amber** into a dashed box | assign work |

That is the entire input. Concretely, to get a run going:

1. **Drag a project card** from `PROJECTS AVAILABLE` into any empty pod.
2. **Drag an idle agent** from `DOING NOTHING` onto that pod's desks. It starts
   working immediately. Pile on as many as you like — there's no seat limit —
   but every extra body on the same pod lowers everyone there's one-shot
   chance, on top of burning that many more tokens. Swarming still works;
   it just isn't free. Watch `HALLUCINATION` on the pod card climb from
   `LOW` toward `EXTREME` as you crowd it — that's your early warning for how
   much clicking a pod is about to demand.
3. When an agent gets stuck it turns red and asks something idiotic. **Click
   it.** It retries from zero, so the time it already spent is gone.
4. **Hire more agents** with `+STARTER` / `+SENIOR` / `+ELITE` next to
   `DOING NOTHING`. Hiring is free — the cost of a bigger fleet shows up on
   the floor, not at the door. Higher tiers one-shot more reliably and clear
   more work per run, at a steeper token burn.
5. Payouts **tick down every second** you take. The reasoning dial (`LOW`/
   `MEDIUM`/`HIGH`) trades tokens for speed.
6. Tokens are your fuel — a plain, uncapped number that only ever goes down.
   At zero, everyone stops dead while the payout keeps falling. `BUY MORE`
   tops the reserve up by a flat lot of tokens for cash; there's no picker,
   it's always the same lot.

`Esc` or the topbar button pauses. Blurring the window auto-pauses; an `Esc`
pause does not un-pause itself when you click back in.

### The five colours

Five colours, five meanings, nothing else is coloured.

| | |
|---|---|
| **Red** | click it |
| **Amber** | drag it |
| **Green** | money |
| **Blue** | tokens |
| **Grey** | ignore — if the screen is grey, put the kettle on |

The clock is deliberately never red. Red means "click me", and you cannot
click the clock.

### Saves, studio keys and high scores

There are no accounts. On first visit the game generates a **studio key** — four
words, e.g. `COMMIT-KERNEL-SANDBOX-PIVOT` — and saves to `localStorage`. You are never
asked for anything; the key only matters when you want the same studio on a
different machine, where you type it into `STUDIO KEY` on the start screen.

Keys are generated, never chosen, because a chosen password is the failure mode:
somebody types `agent` on day one and lands in a stranger's studio. Four words
from a 256-word list is 2^32 ≈ 4.3 billion, and the server rate-limits lookups.
You *may* set a custom key, but it has to clear 12 characters.

The key never leaves the browser. The client sends `SHA-256(key)` as a token in
the `x-studio-token` header — never in a URL, which is the part of a request
that gets logged — and the server stores under `SHA-256(token)`. A dump of the
datastore yields neither the key nor a usable token.

**What this is not.** A studio key is a bearer token: whoever holds it holds the
studio, and a lost key is unrecoverable — no email, no reset. That is the right
trade for a save holding a reputation number and a list of best runs, and the
wrong one for anything else.

**The high scores board is client-authoritative.** The browser sends a number
and the server believes it, so anyone with devtools can post any score. One row
per studio, best-score-wins, a sanity ceiling and rate limiting are in place;
none of that makes it trustworthy. The sim is seeded and deterministic
specifically so a replay log could be re-simulated server-side later. Until that
exists, treat the board as social, not competitive.

Per tech stack §7, **a run in progress is never saved.** Only reputation,
unlocks, best runs and your name persist. The clock is the point.

### Host it

The server is plain Node with no framework — it serves the Vite build and a
four-route API.

```bash
npm run serve      # build, then serve on :3000
```

On Railway: point it at the repo and it will run `npm run build` then
`npm start`. Add a **Postgres** service and Railway injects `DATABASE_URL`,
which is all the server needs to switch off the file store.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | listen port |
| `DATABASE_URL` | — | use Postgres. **Set this on Railway.** |
| `SAVE_DATA_DIR` | `.data` | file store path, used when there is no `DATABASE_URL` |
| `STATIC_DIR` | `dist` | where the built game lives |
| `RATE_LIMIT_PER_MIN` | `60` | API requests per IP per minute |

Without `DATABASE_URL` the server writes JSON files. A Railway container's
filesystem is **ephemeral unless a volume is mounted**, so that combination
loses every studio on redeploy — the server warns loudly at boot if it detects
it. Use Postgres, or mount a volume and set `SAVE_DATA_DIR` to it.

```
GET  /api/save     x-studio-token: <hex>    the save, or 404 if new
PUT  /api/save     x-studio-token: <hex>    store it
PUT  /api/score    x-studio-token: <hex>    submit a run (best score wins)
GET  /api/scores?limit=25                   the board; flags your row if you send a token
GET  /api/health                            which store is active
```

### Commands

```bash
npm run dev        # Vite dev server; proxies /api to :3000 if it is running
npm start          # serve dist/ + the save API on :3000
npm run serve      # build, then the above
npm run build      # production build to dist/
npm run preview    # serve the production build
npm test           # sim invariants — 23 assertions, must stay green
npm run smoke      # environment + build + sim sanity. Run this first.
npm run balance    # headless balance report over thousands of runs
npm run dashboard  # rebuild tools/agent-idol-balance-harness.html
npm run typecheck  # tsc --noEmit
```

### Poke at it

A run is seeded and fully deterministic, so bugs reproduce.

```
http://localhost:5173/?seed=anything      # same seed, same run, every time
```

In the console, `window.AI` exposes the live run for debugging (marked
`TODO(dev-only)`):

```js
AI.state.cash            // read anything on the run
AI.state.agents          // who's working, who's stuck
AI.paused                // loop state
AI.tick(AI.state, 1)     // advance one sim-second by hand
AI.assignAgent(AI.state, AI.state.agents[0].id, 0)   // drive it like a player
```

Every mutation goes through an action in `src/sim/tick.ts` — `retryAgent`,
`assignAgent`, `acceptProject`, `setReasoning`, `buyTokens`, `hireAgent`.
Nothing else is allowed to write to the run.

### Tune it

`npm run balance` prints how thousands of runs actually play out. Open
`tools/agent-idol-balance-harness.html` to move sliders against it. **Every
tunable number lives in `src/sim/config.ts` and nowhere else** — if you find a
magic number in tick, render or fx, that's a bug.

Nothing in `config.ts` is signed off yet. The current values put every lever in
live territory; they are a starting point for playtesting, not a balance.

---

## How it fits together

**The one rule: the simulation never touches the DOM.**

```
src/sim/       pure state + rules. No DOM, no anime.js, no window.
src/render/    reads sim state, writes to DOM. Never mutates state.
src/input/     the two gestures. Mutates only via sim/tick.ts actions.
src/fx/        anime.js only. Discrete events, never continuous state.  (empty)
src/save/      studio keys, the save blob, localStorage + the save API
src/ui/        start screen, high scores, studio panel. Shop and run
               summary still to come.
src/harness/   headless balance testing
server/        Node http: serves dist/ and the save + leaderboard API
main.ts        the loop, pause, and all the wiring
```

`src/save/` never imports from `src/sim/`, and `src/sim/` never imports from
`src/save/`. The sim stays pure and deterministic; main.ts is the only place
the two meet.

If pausing the game must freeze it, the sim owns it — the payout countdown,
token drain, run progress and the run clock are all sim. Sprite walks, bubble
bobs and slice pops are fx. Two independent clocks driving the same value is
the bug class this rule exists to prevent.

A few things worth knowing before you change rendering code:

- **The renderer owns the DOM.** `render()` runs every frame and reparents each
  agent's pooled node to match sim state. Input never detaches or reparents a
  node — a drag only applies a `transform` in place and clears it on release.
- **Transforms only.** Continuous bars use `transform: scaleX()` with
  `transform-origin: left`. Nothing animates `width`, `left` or `top`.
- **Sprites are pre-rendered once at boot** into twelve PNG data URLs and used
  as `<img>`. Do not run the pixel-plot loop per frame the way the mockup does.
- **Stage scale lives in `src/render/stage.ts` as `stageScale()`.** Input
  imports it. A second copy of that formula makes drags track at the wrong
  speed.

## Where the build is

Steps 1–4 and 6 are done and the game is playable end to end: the sim core and
balance harness, the floor bound to live state, the fixed-timestep loop, and
the two gestures.

Not started: the rest of **step 5** (per-agent upgrades), **7** the anime.js
juice pass, **8** the run summary, **9** audio and the tutorial ramp.

Hiring is wired: `+STARTER` / `+SENIOR` / `+ELITE` call `hireAgent` directly,
free of charge (see `docs/decisions.md`). `BUY MORE` is done — it calls
`buyTokens` directly, no picker: tokens are bought in one flat lot
(`cfg.tokens.lotSize`), as many times as cash allows (see `docs/decisions.md`).

## Open questions

These need playtesting, not argument. They are real and currently unresolved:

1. **Is 30 minutes right?** First time this is answerable is now.
2. **The attention cap doesn't bind yet.** `npm run smoke` warns about it: peak
   demand is ~1.7 clicks/sec against a 2.5/sec player, so the floor never
   actually outruns your hands. "You are the bottleneck" is not true at the
   current numbers.
3. **One strategy dominates.** "Swarm the bleeder" scores ~2.2× the runner-up.
4. **Run length affects click frequency but not throughput.** Every class
   delivers `runWork` work in `runWork/speed` seconds, so the *rate* is
   identical for all three; only slice size and click cadence differ. The
   handover claims run length does both. Not fixed in code — it matters because
   it's the mechanism "cheap agents survive late" is supposed to rest on.
5. **`abandonProject` has no gesture.** The action exists in `tick.ts` because
   the harness needed it. Adding one would be a third gesture, which the design
   forbids — so it stays unwired until the floor demonstrably feels stuck
   without it.
6. **Does the class ladder still hold now that hiring is free?** Elite is no
   longer more expensive to *acquire*, only to *run* and to crowd a pod with.
   See `docs/decisions.md` for the full note — not fixed in code, needs
   playtesting against `tools/agent-idol-balance-harness.html`.

## The bar

The game has to be intuitive enough to need no tutorial. Push back on additions
that need explaining. An invisible rule the player has to be taught is a design
failure, not a feature.

`CLAUDE.md` has the full house rules. `docs/agentidolhandoverv2.pdf` is the
design state of record and wins any conflict, except where `docs/decisions.md`
has since amended it — that file is newer and wins over the PDF where the two
disagree. `docs/archive/` holds the planning documents the finished steps
were built from.

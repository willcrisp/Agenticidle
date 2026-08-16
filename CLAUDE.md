# Agent Idol

A browser game (desktop only) about running a fleet of AI coding agents where
**you are the bottleneck**. A 30-minute timed score-attack idle/clicker with
pixel-sprite art. One number at the end.

## Read before proposing anything

- `docs/agentidolhandoverv2.pdf` — full design state. **This document wins.**
- `docs/decisions.md` — amendments made after the handover, where it reverses
  or fills a gap in the PDF above. The PDF is static and can't be edited in
  place; where the two disagree, **the decisions log wins — it's newer.**
  Check it before assuming the PDF's `[DECIDED]` list is still current.
- `docs/agentidoltechstack.pdf` — architecture, build order, what not to use.
- `docs/agent-idol-v9.html` — visual reference of record. Promote this shell,
  don't rebuild it. Note it predates the run clock, so it has no timer.
- `docs/agent-idol-pitch.html` — one-pager. Also predates the clock, and its
  third beat still says debt is how you lose. That is now wrong.

The handover marks every call `[DECIDED]`, `[PROPOSED]` or `[OPEN]`. Respect the
markers. DECIDED items are not up for discussion; PROPOSED items are the best
current answer, not a commitment; OPEN items need playtesting, not argument.

There is a `§12 Explicitly rejected` list. Do not re-propose anything on it.
If you think something on it deserves another look, say so once, in one
sentence, and move on. (One entry on it — a crowding penalty on swarms — has
since been overturned; see `docs/decisions.md`. The rest still stands.)

## Architecture — the one rule

**Simulation and rendering are separate, and the simulation never touches the
DOM.**

    src/sim/       pure state + rules. No DOM, no anime.js, no window.
    src/render/    reads sim state, writes to DOM
    src/fx/        anime.js only. Discrete events, never continuous state.
    src/save/      studio keys, save blob, localStorage + save API client
    src/ui/        start screen, high scores, studio panel; shop and run summary
    src/harness/   headless balance testing
    server/        Node http: serves dist/ and the save + leaderboard API
    main.ts        loop, input, wiring

`src/save/` must never import from `src/sim/`, and `src/sim/` must never import
from `src/save/`. Persistence is not simulation. main.ts is the only place the
two meet, and it is where a finished run gets recorded.

If pausing the game must freeze it, the sim owns it. The payout countdown,
credit drain, agent run progress and the run clock are all sim. Slice pops,
sprite walks, bubble bobs, repossession staggers and screen transitions are fx.

Two independent clocks driving the same value is the bug class this rule exists
to prevent.

## Numbers

**Every tunable number lives in `src/sim/config.ts` and nowhere else.** No magic
numbers in tick, render or fx. If you need a new constant, add it to Config with
a comment explaining what it does, so it appears in the tuning dashboard.

The save layer is the one exception, and it has its own file: `src/save/config.ts`.
Key length, name limits and retry policy are not game tunables — they do not
change how a run plays and must not appear in the balance dashboard.

Nothing currently in `config.ts` is signed off. The values put every lever in
live territory; they are a starting point for playtesting.

## Stack

TypeScript strict, Vite, no framework. DOM + CSS, not canvas. anime.js v4 with
named imports. Vitest. Native Web Audio.

Do not add: React/Vue/Svelte, Phaser/PixiJS, Redux/Zustand/signals, Tailwind,
the HTML5 drag-and-drop API, `setInterval` for game logic, or Google Fonts CDN.
Each has a stated reason in the tech stack doc.

## Rendering rules

- Transforms only. `transform: scaleX()` with `transform-origin: left`, never
  animating `width`/`left`/`top`. Layout thrash is the enemy.
- One DOM node per agent, reused. Agents move between pods by reparenting.
  State changes are class swaps: `.is-running`, `.is-blocked`, `.is-idle`, `.is-ok`.
- Sprites pre-rendered once at boot into offscreen canvases, exported to data
  URLs, used as `<img>` with `image-rendering: pixelated`. Twelve images total.
  Do not run the pixel-plot loop per sprite per frame as the mockup does.
- One `#stage` at exactly 1280×720, `transform: scale(n)` where n is
  `min(vw/1280, vh/720)` — fit to viewport, aspect preserved, never stretched.
  **This replaces the original integer-only rule.** Integer-only needs a
  2560×1440 *viewport* to reach scale 2, which browser chrome puts out of reach
  even on a 1440p monitor, so every real display floored to 1 and the game
  rendered as a small island in a sea of black. The scale lives in
  `src/render/stage.ts` as `stageScale()` and input must use it — a second copy
  of the formula makes drags track at the wrong speed.
- Sprite CSS sizes are still whole multiples of 16 (64px = 4×, 48px = 3×). At
  a 1.5× stage scale that lands on 96px = 6×, so 1080p is pixel-perfect; other
  window sizes trade some evenness for filling the screen.
- Self-host Silkscreen, JetBrains Mono and Inter as woff2.

## Interface constraints

- **Five colours, five meanings.** Red = click it. Amber = drag it. Green =
  money. Blue = credits. Grey = ignore. Nothing else is coloured.
- **The clock cannot be red.** Red means click it. Endgame urgency comes from
  motion and contrast: timer bob, floor darkening, panel edges tightening.
- **Two gestures only.** Click anything red. Drag anything amber into a dashed
  drop target.
- **No derived numbers.** No burn rate, runway, margin %, net per minute or
  decay labels. The player feels the rate instead of reading it. The run clock
  is the one permitted exception.
- Respect `prefers-reduced-motion`, but keep the *informational* layer: the
  payout counter still updates and the credit bar still drains. Cut only the
  decorative layer.

## The quality bar

The design constraint is that the game must be intuitive enough to need no
tutorial. **Push back on additions that need explaining.** An invisible rule the
player has to be taught is a design failure, not a feature.

## Commands

    npm install
    npm test          # sim invariants — must stay green
    npm run smoke     # full environment + sanity check, run this first
    npm run balance   # headless balance report over thousands of runs
    npm run dashboard # rebuild tools/agent-idol-balance-harness.html
    npm run dev       # Vite dev server (once the client exists)

## Persistence

Tech stack §7 is decided and load-bearing: **only reputation, unlocks, best runs
and the player's name persist. A run in progress is never saved — the clock is
the point.** Do not add mid-run save/resume without an explicit decision to
overturn that; a resumable timed score-attack makes the one number meaningless.

Identity is a generated four-word **studio key**, held in localStorage and
mirrored to the server under a double hash. It is a bearer token, not an
account — see the header comment in `src/save/key.ts` for the full rationale,
and `README.md` for the deployment side.

The high scores board is client-authoritative and therefore spoofable. This is
recorded, not hidden. Fixing it means re-simulating a replay log server-side,
which the seeded deterministic sim already makes possible.

## Where the build is

Steps 1–4 and 6 are done, plus saves, the start screen and the leaderboard.
The game is playable end to end:

- **1, 6** — sim core, seeded and deterministic, plus the headless balance
  harness. 23 passing assertions.
- **2** — the floor. `src/render/` builds the shell once and binds it to live
  `RunState` every frame.
- **3** — the loop. Fixed 30Hz sim step, decoupled render, pause.
- **4** — the two gestures. Click to retry, drag to assign/accept.

- **saves** — `src/save/` and `server/`. Studio keys, localStorage, the save API
  and the leaderboard. 27 passing assertions on top of the sim's 23.
- **start screen** — `src/ui/start.ts`. Gates the run clock; carries the menu,
  the studio key and the high scores.

Steps 5 and 7–9 are still open: the shop, the anime.js pass, audio, the run
summary and the tutorial ramp. Two hooks are waiting for them:

- `reputation` is in the save and always 0. Final cash converts to reputation
  (handover §8) but the rate is open question #2, so nothing invents one.
- `roster` is in the save and unused. The run still starts from
  `cfg.startingRoster`, and `RunState` is built once at boot rather than at
  START, so wiring a saved roster into a run is part of the shop work.

See `README.md` for how to run and play it, and `docs/archive/` for the
planning documents those completed steps were built from.

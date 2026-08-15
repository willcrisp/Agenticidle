# Agent Idol

A browser game (desktop only) about running a fleet of AI coding agents where
**you are the bottleneck**. A 30-minute timed score-attack idle/clicker with
pixel-sprite art. One number at the end.

## Read before proposing anything

- `docs/agentidolhandoverv2.pdf` — full design state. **This document wins.**
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
sentence, and move on.

## Architecture — the one rule

**Simulation and rendering are separate, and the simulation never touches the
DOM.**

    src/sim/       pure state + rules. No DOM, no anime.js, no window.
    src/render/    reads sim state, writes to DOM
    src/fx/        anime.js only. Discrete events, never continuous state.
    src/ui/        shop, run summary, reputation, title
    src/harness/   headless balance testing
    main.ts        loop, input, wiring

If pausing the game must freeze it, the sim owns it. The payout countdown,
credit drain, agent run progress and the run clock are all sim. Slice pops,
sprite walks, bubble bobs, repossession staggers and screen transitions are fx.

Two independent clocks driving the same value is the bug class this rule exists
to prevent.

## Numbers

**Every tunable number lives in `src/sim/config.ts` and nowhere else.** No magic
numbers in tick, render or fx. If you need a new constant, add it to Config with
a comment explaining what it does, so it appears in the tuning dashboard.

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
  `Math.floor(min(vw/1280, vh/720))`. Integer only, or the pixel grid smears.
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

## Where the build is

Steps 1 and 6 of the build order are done: the sim core exists, is seeded and
deterministic, and has a headless balance harness with 23 passing assertions.

Steps 2–5 and 7–9 are not started. See `KICKOFF.md`.

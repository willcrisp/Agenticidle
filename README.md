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

The run is 30 minutes and the clock never stops. There are **two gestures**:

| Gesture | On what | What happens |
|---|---|---|
| **Click** | anything **red** | a stuck agent retries |
| **Drag** | anything **amber** into a dashed box | assign work |

That is the entire input. Concretely, to get a run going:

1. **Drag a project card** from `PROJECTS AVAILABLE` into any empty pod.
2. **Drag an idle agent** from `DOING NOTHING` onto that pod's desks. It starts
   working immediately. Pile on as many as you like — there are no seats.
3. When an agent gets stuck it turns red and asks something idiotic. **Click
   it.** It retries from zero, so the time it already spent is gone.
4. Payouts **tick down every second** you take. The dial (`SLOW`/`NORMAL`/
   `FAST`) trades credits for speed.
5. Credits are your fuel. At zero, everyone stops dead while the payout keeps
   falling. `BUY MORE` is a placeholder until the shop lands.

`Esc` or the topbar button pauses. Blurring the window auto-pauses; an `Esc`
pause does not un-pause itself when you click back in.

### The five colours

Five colours, five meanings, nothing else is coloured.

| | |
|---|---|
| **Red** | click it |
| **Amber** | drag it |
| **Green** | money |
| **Blue** | credits |
| **Grey** | ignore — if the screen is grey, put the kettle on |

The clock is deliberately never red. Red means "click me", and you cannot
click the clock.

### Commands

```bash
npm run dev        # Vite dev server
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
`assignAgent`, `acceptProject`, `setDial`, `buyCreditBlock`. Nothing else is
allowed to write to the run.

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
src/ui/        shop, run summary, reputation, title.                    (empty)
src/harness/   headless balance testing
main.ts        the loop, pause, and all the wiring
```

If pausing the game must freeze it, the sim owns it — the payout countdown,
credit drain, run progress and the run clock are all sim. Sprite walks, bubble
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

Not started: **step 5** the shop and economy, **7** the anime.js juice pass,
**8** the run summary, **9** audio and the tutorial ramp.

Step 5 is the natural next one — `buyCreditBlock` and `hireAgent` already exist
in the sim, and `BUY MORE` is currently a stub wired to the cheapest block.

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

## The bar

The game has to be intuitive enough to need no tutorial. Push back on additions
that need explaining. An invisible rule the player has to be taught is a design
failure, not a feature.

`CLAUDE.md` has the full house rules. `docs/agentidolhandoverv2.pdf` is the
design state of record and wins any conflict; `docs/archive/` holds the
planning documents the finished steps were built from.

# Agent Idol — Orchestration & Delegation Pack

**Role split.** Opus plans, reads the docs, owns design calls and reviews output.
Sonnet-5 (low reasoning) writes code against closed, pre-specified work packages.
Everything a subagent needs is in its own WP section — a subagent should never
need to read the PDFs or make a design judgement.

Covers build-order **steps 2, 3 and 4** plus a prerequisite step 0 that the
KICKOFF brief assumes but the repo doesn't have yet.

---

## Part A — What I found reading the repo

### A1. The toolchain doesn't exist yet

`CLAUDE.md` documents `npm run dev` (Vite). `package.json` has no Vite, no
anime.js, no `index.html`, no `dev` script, no CSS. Everything present is
Node-side: sim, harness, smoke, dashboard builder.

**This is a hard blocker on step 2** and it is not in the KICKOFF brief. It
becomes WP-0. A low-reasoning subagent handed "port the v9 markup" against this
repo will improvise a build setup, and improvised setups are where the pixel-grid
and font rules get quietly broken.

### A2. Fonts

CLAUDE.md forbids the Google Fonts CDN and requires self-hosted woff2. The
sandbox can reach the npm registry but not `fonts.gstatic.com`, so the fonts come
from npm: `@fontsource/silkscreen`, `@fontsource/jetbrains-mono`,
`@fontsource/inter`. Vite bundles the woff2 files locally, which satisfies the
rule. Set `font-display: block` per the tech stack doc.

### A3. The sim has three states; the interface has four

`AgentState = "idle" | "running" | "blocked"`. The mockup and the handover both
show **four** visual states — running, one-shot success (sage), blocked, idle.

Success is not a sim state and must not become one. It's a transient event. The
tech stack doc's twelve sprites (3 classes × 4 states) are all pre-rendered at
boot, but **only three are used until step 7**.

Detecting success without touching the sim, by diffing across frames:

- agent was `running`, `progress` dropped and state is still `running` → success
- agent was `running`, state is now `blocked` → failure

The renderer keeps its own `prev` memo per agent id. This is specified in WP-3 so
nobody has to invent it, and it is what step 7's `+15%` pop will hang off.

### A4. Step 7 will need a sim change, and that's a later conversation

Rendering diffs fine. Animation doesn't — a slice landing, a delivery, a
repossession are *events*, and diffing at 30Hz will drop or double them under a
stall. Step 7 will want an event queue drained each frame off `RunState`.

That's a sim modification, which CLAUDE.md forbids without asking. Not needed for
steps 2–4. **Flagging it now so it's a design conversation at step 7, not an
emergency.** No subagent should touch it.

### A5. v9 mockup vs. handover conflicts

KICKOFF item 3 asks which parts of the mockup contradict the handover. All of
these are already resolved in the WPs below — the handover wins every time:

| Mockup does | Rule it breaks | Resolution |
|---|---|---|
| `width: n%` on runbars, credit bar, segments | transforms only | `transform: scaleX()`, `transform-origin: left` |
| One `<canvas>` per sprite, redrawn per state | pre-render once | 12 data-URL `<img>` at boot |
| `Math.min(1, w/1280)` fractional scale | integer scaling only | `Math.max(1, Math.floor(min(vw/1280, vh/720)))` |
| Google Fonts CDN `<link>` | no CDN fonts | `@fontsource/*` via npm |
| `setInterval` driving payout tick | no setInterval for game logic | sim owns payout; render reads it |
| No run clock | run is scored against the clock | added to topbar in WP-3 |
| `CREDITS: LOW` word label | arguably a derived readout | **flagged, see B2** |

### A6. Scale factor is a live problem at 1280×720

`Math.floor` integer-only scaling means a 1440p or 1080p browser window gets
scale **1** — the stage renders at exactly 1280×720 inside a much larger viewport,
letterboxed with a lot of black. Scale 2 needs 2560×1440 of *viewport*, which
almost nobody has.

The rule is correct and stays. But it means the practical experience is a fixed
1280×720 panel centred in the window. Worth knowing before you see it and think
it's a bug. If it reads badly, the fix is a smaller stage (960×540 scales to 2 on
a 1080p screen), not fractional scaling — that's a design call for you, and I've
left it alone.

---

## Part B — Design calls I am NOT making for you

Three things block a clean step-4 build. I've picked a default for each so work
isn't stalled, but each needs your yes/no.

### B1. Accepting a project from the board is a gesture nobody scoped

KICKOFF step 4 lists click-to-retry and drag-to-assign. But nothing in steps 2–4
gets a project onto the floor, so with only those two the game can't start.

The handover already covers this: *"Agents drag onto projects; projects drag into
empty pod slots. Same gesture."* The v9 mockup's fourth pod says
`EMPTY / DRAG A PROJECT HERE`. So it's the same amber-drag gesture, not a third
one.

**Default taken:** drag-to-accept is in scope for WP-5, calling
`acceptProject(state, boardIndex, pod)`.

### B2. `BUY MORE` and the `CREDITS: LOW` label

The shop is step 5. But if credits can only drain, every run in steps 3–4 stalls
after a few minutes and you can't feel the loop.

Two sub-issues:

- **The button.** A clickable blue control is technically a third affordance
  under "click anything red, drag anything amber". The mockup has it, so the
  design already lives with it — but it's worth naming out loud.
- **The word "LOW".** That's a derived readout of the credit bar. The
  no-derived-numbers rule says the bar carries the meaning by itself.

**Defaults taken:** `BUY MORE` is wired as a temporary stub to
`buyCreditBlock(state, 0)` on `pointerdown`, marked `TODO(step-5)` in the source.
The `LOW` label is **dropped** — the label reads `CREDITS` only, and the bar
carries the rest.

### B3. `src/input/` is a deviation from the documented tree

CLAUDE.md's tree puts input in `main.ts`. Step 4's drag logic is a few hundred
lines and doesn't belong in the loop file.

**Default taken:** a `src/input/gestures.ts` module that `main.ts` imports and
wires. `main.ts` stays the single wiring point, which I read as the actual intent
of the rule. Say the word and it collapses back into `main.ts`.

### B4. The two watch-items from KICKOFF are still open and untouched

- **`abandonProject`** exists in `tick.ts` but has no design gesture. No WP wires
  it. Revisit after you've played step 4 — if the floor feels stuck without it,
  it's a third gesture and needs a real decision.
- **Run length affects click frequency but not throughput.** Confirmed by reading
  `tick.ts`: `a.progress += dt * dial.speed` and resolve at `runWork`, so a run
  delivers `runWork` work in `runWork/speed` seconds — the *rate* is identical for
  every class. Only the slice size and click cadence differ. The handover claims
  run length does both. **Not fixed in code, as instructed. Flagged.** It matters
  because it's the mechanism the "cheap agents survive late" balance rests on.

---

## Part C — Target module layout

```
index.html                  NEW  (WP-0)
src/
  style.css                 NEW  (WP-0)   design tokens + all floor CSS
  sim/                      FROZEN — do not modify
  render/
    sprites.ts              NEW  (WP-1)   12 pre-rendered data URLs
    stage.ts                NEW  (WP-1)   integer scale + resize
    shell.ts                NEW  (WP-2)   builds static DOM once, returns Refs
    topbar.ts               NEW  (WP-3)   money, credit bar, run clock
    pod.ts                  NEW  (WP-3)   one pod
    agent.ts                NEW  (WP-3)   agent node pool + reparenting
    floor.ts                NEW  (WP-3)   render(state, refs) entry point
  input/
    gestures.ts             NEW  (WP-5)
  main.ts                   NEW  (WP-4)   owns RunState, loop, pause, wiring
```

`src/fx/` and `src/ui/` stay empty until steps 7 and 5. `src/harness/` and
`src/web/` are untouched throughout.

### The one rule, restated for subagents

Nothing under `src/render/` or `src/input/` may import from `src/sim/` except as
**types** and the **action functions** in `tick.ts`. No renderer writes to
`RunState` except through those actions. No sim file gains a DOM reference.

---

## Part D — Work packages

Six packages, three gates. Each WP is a separate subagent invocation. Run them in
order; don't parallelise WP-2/3 (same files).

| WP | Build step | Gate after |
|---|---|---|
| WP-0 Toolchain | prerequisite | — |
| WP-1 Sprites + stage | step 2 | — |
| WP-2 Static shell | step 2 | — |
| WP-3 Render binding | step 2 | **GATE — commit, playtest the static floor** |
| WP-4 The loop | step 3 | **GATE — commit, feel the clock** |
| WP-5 The two gestures | step 4 | **GATE — commit, this is the playable** |

Every WP ends with the same three commands, all of which must pass:

```
npm run smoke
npm test
npm run typecheck
```

---

### WP-0 — Toolchain and shell

**Goal.** Make `npm run dev` serve an empty, correctly-scaled 1280×720 stage.
No game content.

**Create / modify**
- `package.json` — add `vite` (^6), `animejs` (^4), `@fontsource/silkscreen`,
  `@fontsource/jetbrains-mono`, `@fontsource/inter`. Add scripts:
  `"dev": "vite"`, `"build": "vite build"`, `"preview": "vite preview"`.
  **Do not touch** the existing `smoke`, `test`, `balance`, `dashboard`,
  `typecheck` scripts.
- `vite.config.ts` — root at repo root, `build.outDir: "dist"`.
- `index.html` at repo root — `<div id="stage"></div>`, module script importing
  `/src/main.ts`.
- `src/main.ts` — placeholder that imports the CSS and logs. Real content in WP-4.
- `src/style.css` — the design tokens and reset, nothing else yet.
- `tsconfig.json` — leave `include` covering `src`; do not weaken `strict`.

**Design tokens — copy exactly, these are signed off**

```css
:root{
  --bg:#0D0F11; --floor:#131619; --pod:#191D21; --pod-2:#1E2227;
  --line:#282D33; --line-soft:#20242A;
  --fg:#C6CBD1; --fg-2:#878E96; --dim:#5A616A; --faint:#383E45;
  --run:#5F807A;   /* muted sea  — agent running */
  --ok:#78906C;    /* sage       — success, money */
  --fail:#A5605A;  /* dusty clay — blocked, click it */
  --idle:#AC9463;  /* brass      — idle, drag it */
  --tok:#6B8598;   /* slate      — credits */
  --px:"Silkscreen","JetBrains Mono",monospace;
  --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
  --sans:"Inter",system-ui,sans-serif;
}
```

Import fonts from `@fontsource/*` in `src/style.css`. **Never** a Google Fonts
`<link>`. Set `font-display: block`.

**Constraints**
- No React/Vue/Svelte, no Tailwind, no state library. Plain TS + CSS.
- `body` background `var(--bg)`, no scrollbars, stage centred.

**Acceptance criteria**
1. `npm install` succeeds.
2. `npm run dev` serves a page with a centred 1280×720 dark stage, letterboxed.
3. Fonts load from local bundle — no network request to any `fonts.g*` domain.
4. `npm run smoke`, `npm test`, `npm run typecheck` all pass.
5. `git diff` touches no file under `src/sim/`, `src/harness/`, `scripts/`.

**Out of scope.** Any game content, any sim import, any sprite work.

---

### WP-1 — Sprites and stage scaling

**Goal.** Two small, self-contained modules.

**Create**
- `src/render/sprites.ts`
- `src/render/stage.ts`

**`sprites.ts` spec**

Port the three 16×16 pixel grids and the palette verbatim from
`docs/agent-idol-v9.html` (the `STARTER`, `SENIOR`, `ELITE` const arrays, `PAL`,
and the `draw()` function's plotting logic). Do not redesign the sprites.

```ts
export type SpriteClass = "starter" | "senior" | "elite";
export type SpriteState = "running" | "ok" | "blocked" | "idle";

/** Called once at boot. Renders 12 offscreen canvases → data URLs. */
export function buildSprites(): Record<string, string>;
// key format: `${cls}:${state}`, e.g. "senior:blocked"

/** Convenience: an <img> for a given class+state, ready to reparent. */
export function spriteImg(cls: SpriteClass, state: SpriteState): HTMLImageElement;
```

- Render each at **16×16 natural size**. Scaling is CSS
  (`image-rendering: pixelated`), never canvas.
- State accent colours: `running` `#5F807A`, `ok` `#78906C`,
  `blocked` `#A5605A`, `idle` `#AC9463`. In the grid, `9` is the accent pixel.
- The mockup's translucent visor-glow overlay (`globalAlpha` fill) is kept.
- **Exactly 12 canvases, created once.** No canvas work after boot. No
  per-frame drawing. This is the single most important constraint in this WP.

**`stage.ts` spec**

```ts
/** Attaches resize handling. Returns a teardown fn. */
export function mountStage(stageEl: HTMLElement): () => void;
```

- Scale is `Math.max(1, Math.floor(Math.min(vw / 1280, vh / 720)))`.
  **Integer only** — a fractional scale smears the pixel grid.
- Apply `transform: scale(n)` with `transform-origin: center` (or top-left plus
  a centring translate — your call, but centred in the viewport).
- Listen on `resize`; debounce with `requestAnimationFrame`, not a timer.
- Stage element is exactly `1280px × 720px` in CSS, letterboxed against `--bg`.

**Acceptance criteria**
1. `buildSprites()` returns exactly 12 entries, all valid `data:image/png` URLs.
2. Resizing the window never produces a non-integer scale value.
3. No `setInterval` anywhere.
4. smoke / test / typecheck pass.

**Out of scope.** Any sim import. Any pod, agent or topbar markup.

---

### WP-2 — The static shell

**Goal.** Build the entire 1280×720 floor markup once, with **all fake data
stripped**, and return typed handles to every element the renderer will need.
Nothing binds to sim state in this WP.

**Create**
- `src/render/shell.ts`
- extend `src/style.css` with all floor CSS

**Source of truth.** `docs/agent-idol-v9.html`. Port the markup and CSS inside
`<div class="game">` only. **Ignore** everything outside it — the concept-sheet
header, the `.legend` block, the `.notes` section, and the whole `<script>`.
Those are presentation furniture for the mockup, not the game.

**Structure to build**

```
#game (1280×720, flex column)
  .topbar        money · credits(label + bar) · BUY MORE · spacer · run clock · pause
  .pods          4 × .pod, always present
    .pod-h       .pod-r1 (name, .pod-diff pips ×5, .pod-pay) · .segs · .dial (3 × b)
    .desks       0..n .station (.bub, img.sprite, .desk, .plate, .runbar)
                 + .empty > .empty-slot  "DROP HERE"
  .tray
    .tray-half   "DOING NOTHING"      → .tray-row of .bcard
    .tray-half   "PROJECTS AVAILABLE" → .tray-row of .pcard
```

**Required changes from the mockup**

1. **Run clock** — new element in the topbar, right side, before the pause
   button. `<div class="clock" id="clock">30:00</div>`. `var(--mono)`, ~22px,
   colour `var(--fg)`. **It can never be red or use `--fail`.** Placement is
   yours to design; it is a raw monospace `MM:SS` and nothing else.
2. **Sprites** — `<img class="sprite">` from WP-1, **not** `<canvas>`.
3. **Credits label** — reads `CREDITS` only. Delete the `LOW` value span.
4. **Everything animated is a transform.** `.runbar i`, `.cred-bar i` and each
   `.segs i` get `width: 100%; transform: scaleX(0); transform-origin: left`.
   No `width` animation anywhere.
5. **`BUY MORE`** — keep, add `id="buy"`, wired in WP-5.
6. **Pause** — keep, add `id="pause"`, wired in WP-4.

**Strip all of this fake data:** hardcoded `$18,430`, project names, agent names,
`data-from`/`data-rate` attributes, inline `style="width:n%"`, the seven-agent
swarm, the `.tick` class, `.hot`/`.great`/`.low` state classes. Build four
**empty** pods and empty tray rows. The renderer fills them.

**Export**

```ts
export interface Refs {
  game: HTMLElement;
  money: HTMLElement;
  creditFill: HTMLElement;      // the scaleX target
  creditLabel: HTMLElement;
  buyBtn: HTMLElement;
  clock: HTMLElement;
  pauseBtn: HTMLElement;
  pods: PodRefs[];              // length 4, fixed
  trayIdle: HTMLElement;        // container for idle agent cards
  trayBoard: HTMLElement;       // container for project cards
}

export interface PodRefs {
  root: HTMLElement;
  name: HTMLElement;
  pips: HTMLElement[];          // length 5
  payout: HTMLElement;
  segs: HTMLElement;            // slice container
  dials: HTMLElement[];         // length 3, order [slow, normal, fast]
  desks: HTMLElement;           // agent stations reparent into here
  emptySlot: HTMLElement;       // the dashed DROP HERE target
}

export function buildShell(root: HTMLElement): Refs;
```

**Acceptance criteria**
1. `buildShell()` produces a floor visually matching the mockup with all data
   blank/zeroed.
2. `Refs.pods.length === 4` regardless of state.
3. Grep the file: no `width:` in any animated rule; no `<canvas>`; no
   `setInterval`; no import from `src/sim/`.
4. smoke / test / typecheck pass.

**Out of scope.** Sim binding, event listeners, animation, the ESC overlay.

---

### WP-3 — Bind the shell to live sim state  ·  completes step 2

**Goal.** `render(state, refs)` makes the floor an accurate picture of a
`RunState`. Pure read. Called every frame.

**Create**
- `src/render/floor.ts` — the `render()` entry point and the `prev` memo
- `src/render/topbar.ts`
- `src/render/pod.ts`
- `src/render/agent.ts`

**The sim API you read from** (types only — never mutate):

```ts
import type { RunState, Agent, Project } from "../sim/state";
// state.t, state.cash, state.credits, state.finished
// state.agents: Agent[]   { id, name, cls, state:"idle"|"running"|"blocked", pod, progress }
// state.pods: (Project|null)[]   length 4
// state.board: Project[]
// state.cfg  — for runSeconds, classes[cls].runWork, podCount
import { effectiveOneShot } from "../sim/state";   // if needed, read-only
```

**Public shape**

```ts
export function render(state: RunState, refs: Refs, alpha: number): void;
```

`alpha` is the interpolation factor from the loop. **Ignore it in this WP** —
accept the parameter, don't use it. 30Hz is smooth enough for bars, and
interpolation is a step-7 concern. Do not invent an interpolation scheme.

**Topbar**
- Money: `$` + `Math.round(state.cash).toLocaleString()`. Only write
  `textContent` when the rounded value **changed** — writing every frame thrashes
  layout. Negative cash is still not red; use `var(--fg-2)`.
- Credit bar: `scaleX(credits / startingCredits)`, clamped 0..1. Never `width`.
- Run clock: `state.cfg.runSeconds - state.t`, floored, formatted `MM:SS`, zero
  padded. Clamp at `00:00`. **Never apply a red or `--fail` class to it.**

**Pods** — for each index `0..3`:
- `state.pods[i] === null` → add `.is-open` to the pod root, show the
  `EMPTY / DRAG A PROJECT HERE` state, hide the header contents.
- Otherwise: name, `Math.round(p.payout)` formatted as money, difficulty pips
  (`.on` class on the first `p.difficulty` of the 5), dial (`.on` on the element
  matching `p.dial`).
- **Segments:** `p.slices` is an array of work-seconds. Each slice is a static
  element sized `(slice / p.work) * 100%`, appended **once** when it appears.
  Diff on length: if `refs.segs.children.length < p.slices.length`, append the
  missing ones. Never rebuild the list — that's the animation hook for step 7.

**Agents** — a node pool, this is the important part:
- `Map<agentId, HTMLElement>`. Create a `.station` node on first sight, **reuse
  it forever**, remove only when the agent leaves `state.agents` (repossession).
- Each frame, ensure the node's parent is correct:
  - `a.pod !== null` → `refs.pods[a.pod].desks`
  - `a.state === "idle"` → `refs.trayIdle`
  - Reparent with `appendChild` only when the parent actually differs. An
    unconditional `appendChild` every frame destroys focus and kills animation.
- State classes on the node — swap, never rebuild:
  `.is-running` / `.is-blocked` / `.is-idle`
- Sprite `img.src` from WP-1's map, updated only when the visual state changes.
- Run progress bar: `scaleX(a.progress / cfg.classes[a.cls].runWork)`, clamped.
- Blocked agents show `.bub` with a placeholder question; hide it otherwise.
- Swarm: if a pod holds more than 4 agents, add `.swarm` to `.desks` (the CSS
  from the mockup shrinks the sprites).

**Success/failure detection — implement exactly this**

Keep a `prev` memo in `floor.ts`: `Map<agentId, {progress:number, state:string}>`.
Each frame, after rendering:

- `prev.state === "running" && cur.state === "running" && cur.progress < prev.progress`
  → a run just succeeded
- `prev.state === "running" && cur.state === "blocked"` → a run just failed

Expose these as a returned event list. **Do nothing with them in this WP** —
step 7 consumes them. This exists so nobody adds a success state to the sim.

**Tray** — board cards: name, `$payout`, difficulty pips, `SIZE JOB` from
`p.size` uppercased. Diff by project `id`; don't rebuild the row every frame.

**Constraints**
- `render()` must not mutate `state`. Not one field.
- No `anime` import. No animation. No listeners.
- No magic numbers: anything tunable comes from `state.cfg`.

**Acceptance criteria**
1. With a freshly `createRun()` state and no ticking, the floor shows starting
   cash, full credits, `30:00`, three board cards, three idle agents in the tray,
   four empty pods.
2. Manually stepping `tick()` in the console moves payouts, the credit bar and
   run bars correctly.
3. Calling `render()` 1000× consecutively creates no additional DOM nodes.
4. `render()` never calls `appendChild` on an agent already in the right parent.
5. smoke / test / typecheck pass.

**GATE.** Commit. Stop. Report: what looks wrong on the static floor, and which
mockup details you couldn't reproduce.

---

### WP-4 — The loop  ·  step 3

**Goal.** `main.ts` owns the run and drives it at a fixed 30Hz.

**Rewrite** `src/main.ts`.

**The loop — implement exactly as the tech stack doc specifies**

```ts
const STEP = 1000 / 30;
let acc = 0, last = performance.now();

function frame(now: number) {
  let delta = now - last;
  last = now;
  delta = Math.min(delta, 250);        // clamp — no catch-up burst after a stall
  acc += delta;
  while (acc >= STEP) { tick(state, STEP / 1000); acc -= STEP; }
  render(state, refs, acc / STEP);
  raf = requestAnimationFrame(frame);
}
```

**`tick()` takes seconds, not milliseconds.** Pass `STEP / 1000`. Getting this
wrong makes the run 1000× too fast and is the single easiest bug to ship here.

**Pause**
- Listen on `visibilitychange` and `blur`. On hide/blur: `cancelAnimationFrame`,
  set `paused = true`.
- On resume: **`last = performance.now()` before restarting**, or accumulated
  wall-time leaks in and resolves a dozen runs in one frame.
- ESC toggles pause manually and shows a simple centred overlay
  (`PAUSED · ESC TO RESUME`). Use the existing tokens; no new colours.
- The pause button in the topbar does the same thing.
- While paused: the loop stops entirely. The sim is frozen. The run clock does
  not advance — it is wall-clock independent.

**Also**
- `const state = createRun(DEFAULT_CONFIG, seed)` where seed comes from
  `?seed=` in the URL, defaulting to a fixed string so runs are reproducible.
- Expose `(window as any).AI = { state, tick }` for console debugging. Mark
  `TODO(dev-only)`.
- When `state.finished` flips true, stop the loop and log the score. **No run
  summary screen** — that's step 8.

**Acceptance criteria**
1. A 30-minute run takes 30 real minutes. Verify: after 10 seconds of wall time,
   `state.t` is within 0.5s of 10.
2. Backgrounding the tab for 60s then returning advances `state.t` by ~0, not 60.
3. ESC pauses and resumes cleanly; the clock freezes and resumes at the same value.
4. Throttling the CPU hard in devtools never resolves a burst of runs at once.
5. smoke / test / typecheck pass.

**Out of scope.** All input except pause. No gestures.

**GATE.** Commit. Stop. Report whether 30 minutes feels right — this is the
first moment that question can be answered, and it's open question #1.

---

### WP-5 — The two gestures  ·  step 4

**Goal.** The floor becomes playable.

**Create** `src/input/gestures.ts`. Wire it from `main.ts`.

**Every mutation goes through a `tick.ts` action. No exceptions:**

```ts
import { retryAgent, assignAgent, acceptProject, setDial, buyCreditBlock }
  from "../sim/tick";
```

**Gesture 1 — click to retry**
- `pointerdown`, **not** `click`. This is worth ~50–80ms of perceived latency
  and the late run is nothing but clicking.
- Delegate from `refs.game`, don't attach per agent — nodes are pooled and
  reparented.
- Target: any `.station.is-blocked`. Resolve to `agentId` from a `data-agent-id`
  attribute. Call `retryAgent(state, id)`.
- Keyboard parity: blocked stations are tab-focusable with a visible focus ring;
  Enter retries. Cheap, and it makes the endgame less punishing.

**Gesture 2 — drag amber into a dashed box**

Two sources, same gesture, same visual language:
- an **idle agent** (tray or pod) → drop on a pod's `.desks` → `assignAgent`
- a **board project card** → drop on an open pod → `acceptProject`

Implementation:
- Evaluate anime.js v4 `createDraggable()` first. If the pickup ghost and release
  spring fit, use it. If it fights the reparenting node pool, hand-roll with
  Pointer Events and `setPointerCapture`.
- **Never** the HTML5 drag-and-drop API. Unreliable drag images, bad cursor
  control. This is a hard rule.
- Valid drop targets highlight by **brightening the existing dash**, not by
  adding a colour. Five colours, five meanings — a hover state is not a sixth.
- A drop outside a valid target returns the element to origin. No penalty.
- Report which approach you used and why.

**Also wire**
- Dial buttons: `pointerdown` on a `.dial b` → `setDial(state, podIndex, dial)`.
  If `state.slowLocked`, the action already forces slow — just re-render, don't
  special-case it in input.
- `BUY MORE`: `pointerdown` → `buyCreditBlock(state, 0)`. Mark
  `// TODO(step-5): replace with the real block-picker shop`.

**Do not implement**
- `abandonProject`. It exists in `tick.ts` but has no approved gesture. If step 4
  makes the floor feel stuck without it, **say so and stop** — it's a third
  gesture and a design decision.
- `benchAgent` as a gesture. Dragging an assigned agent to the tray is tempting
  and is not scoped.
- `hireAgent`. That's the shop, step 5.

**Acceptance criteria**
1. A blocked agent retries on `pointerdown` with no perceptible delay.
2. An idle agent can be dragged from the tray to a pod and starts running.
3. A board card can be dragged into an empty pod; the board refills.
4. Dropping on an invalid target is a no-op and the element returns home.
5. No HTML5 DnD API anywhere in the codebase.
6. `prefers-reduced-motion` kills drag springs but keeps every drop functional.
7. smoke / test / typecheck pass.

**GATE.** Commit. This is the playable. Stop and report:
- whether the click load ramps the way the design intends
- whether 30 minutes is right
- whether anything made you reach for a third gesture

---

## Part E — The standing prompt for every subagent

Prepend this to each WP brief:

> You are implementing one scoped work package on Agent Idol. Read `CLAUDE.md`
> first. Your work package below is complete — do not read the PDFs, do not
> expand scope, and do not make design decisions.
>
> **Hard rules:**
> - Do not modify anything under `src/sim/`, `src/harness/` or `scripts/`. If a
>   test fails in a way that seems to require a sim change, **stop and report**.
> - The simulation never touches the DOM. The renderer never mutates state except
>   through the action functions exported by `src/sim/tick.ts`.
> - Every tunable number lives in `src/sim/config.ts`. No magic numbers in
>   render, input or CSS-driven logic.
> - Transforms only. Never animate `width`, `left` or `top`.
> - No `setInterval` for anything.
> - No React/Vue/Svelte, no Phaser/PixiJS, no Redux/Zustand/signals, no Tailwind,
>   no HTML5 drag-and-drop API, no Google Fonts CDN.
> - Five colours, five meanings: red = click it, amber = drag it, green = money,
>   blue = credits, grey = ignore. Nothing else gets a colour. **The run clock can
>   never be red.**
> - No derived numbers on screen — no burn rate, runway, margin %, net/min or
>   decay labels. The run clock is the only permitted number of that kind.
> - Respect `prefers-reduced-motion`: cut decoration, keep the informational
>   layer (the payout still counts, the credit bar still drains).
>
> When you finish, run `npm run smoke && npm test && npm run typecheck`. All
> three must pass. Then report: what you built, which acceptance criteria you
> verified and how, anything you had to guess, and anything you think is wrong
> with the spec. Do not start the next work package.

---

## Part F — What I'd watch for when reviewing each return

- **WP-0:** a fractional scale sneaking into the CSS; a Google Fonts link
  surviving the port.
- **WP-1:** per-frame canvas drawing surviving from the mockup. Grep for
  `getContext` outside `buildSprites`.
- **WP-2:** `width:` on an animated element. Grep for `style.width`.
- **WP-3:** unconditional `appendChild` per frame; `textContent` written every
  frame; a `success` state added to the sim; interpolation invented.
- **WP-4:** `tick(state, STEP)` instead of `STEP / 1000`; `last` not reset on
  resume.
- **WP-5:** HTML5 DnD; a new hover colour; `abandonProject` silently wired in.

# Kickoff brief

Paste the block below into Claude Code as your first message. Everything after
it in this file is context for you, not for the agent.

---

## The prompt

> Read `CLAUDE.md` first, then `docs/agentidoltechstack.pdf` §10 (build order)
> and `docs/agentidolhandoverv2.pdf` in full. Then run `npm run smoke` and
> confirm it passes before you write anything.
>
> The sim core (`src/sim/`) is complete, deterministic and covered by 23 tests.
> **Do not modify it** unless a test forces you to — and if one does, tell me
> before changing the rules rather than after.
>
> Your job is build order steps 2, 3 and 4 — a playable thing I can feel:
>
> **Step 2 — Static floor.** Port the markup from `docs/agent-idol-v9.html`
> into `src/render/`. Strip every piece of fake data and bind it to live sim
> state. Four pods, the credit bar, model dials, difficulty pips, the idle tray,
> the project list. Add the run clock to the topbar — the mockup predates it, so
> its placement is yours to design, but it is a raw monospace number and it
> cannot be red. No animation yet.
>
> **Step 3 — The loop.** Fixed timestep at 30Hz with a decoupled render, the
> delta clamp, and pause on `visibilitychange`/`blur` plus an ESC menu. Reset
> `last` to `now` on resume so no accumulated delta leaks in.
>
> **Step 4 — The two gestures.** Click-to-retry on blocked agents using
> `pointerdown`, not `click`. Drag-to-assign for idle agents; evaluate
> `createDraggable()` from anime.js v4 first and hand-roll with Pointer Events
> only if it doesn't fit. Never the HTML5 drag-and-drop API.
>
> Work one step at a time. After each, stop and tell me what you'd want to feel
> before continuing. Commit at each step boundary.
>
> Three things I want you to watch for and raise rather than quietly solve:
>
> 1. The sim has no `abandonProject` gesture in the design docs, but the action
>    exists in `tick.ts` because the harness needed it. If step 4 makes it feel
>    necessary, say so — it would be a third gesture, which the design forbids.
> 2. Agent run length currently only affects click frequency, not throughput.
>    The handover claims it does both. Don't fix this in code; flag it.
> 3. If any part of the v9 mockup contradicts the handover, the handover wins,
>    and tell me which part.
>
> Do not build the shop, run summary, reputation screen, audio or the tutorial
> ramp. Those are steps 5–9 and are explicitly out of scope for now.

---

## Why this shape

Steps 1–4 are a playable thing you can feel. If 30 minutes turns out to be the
wrong clock, you'll know by step 4 and nothing after it is wasted. That's the
whole reason the build order is ordered this way — don't let an agent get ahead
of it, however capable it seems.

The three watch-for items are open questions the simulation surfaced. They need
a designer's call, not an agent's fix. An agent that silently resolves them has
made a design decision on your behalf.

## After step 4

Step 5 is the economy, step 6 the balance harness — but step 6 already exists,
so the sequence collapses to: wire the economy into the floor, then open
`tools/agent-idol-balance-harness.html`, move sliders, and tune against what the
prototype actually felt like.

Step 7 is the anime.js pass. Do it all at once so the juice can be judged as a
whole rather than accumulating unevenly.

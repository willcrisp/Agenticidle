# Screenshots

The client as it stands after steps 1–4 and 6 — no shop, no anime.js pass, no
audio, no run summary. Captured headless at a 1280×720 viewport, so the stage
is at scale 1 and every PNG is exactly the stage. Seed `shot-3`.

Regenerate with `npm run dev` in one shell and `node scripts/screenshots.mjs`
in another.

| | |
|---|---|
| [`01-empty-floor.png`](01-empty-floor.png) | t=0. Four empty pods, three idle agents in `DOING NOTHING`, three cards on the board. The whole screen is grey except the two amber trays and the blue credit bar — nothing is asking for anything yet. |
| [`02-drag-project.png`](02-drag-project.png) | Gesture two, mid-flight: a project card dragged out of the board and held over pod 0. |
| [`03-drag-agent.png`](03-drag-agent.png) | Gesture two again, agent variant: AXEL held over pod 0's desks. The other two live pods show their dashed `DROP HERE` slot. |
| [`04-agents-running.png`](04-agents-running.png) | Three pods staffed and running. Note the pod payouts are already below what the board offered — `$2,819` → `$2,791` — and the credit bar has started to drain. |
| [`05-blocked-agent.png`](05-blocked-agent.png) | Gesture one: VEX has blocked and is asking `REBASE?` in red. That run's progress is gone the moment you click it, and it keeps burning credits until you do. |
| [`06-mid-run.png`](06-mid-run.png) | Eight minutes in with nobody clicking, which is the whole thesis: all three agents blocked, `$2,819` decayed to `$338`, half the credits burnt, zero delivered. |
| [`07-paused.png`](07-paused.png) | `Esc`. The overlay dims the floor without hiding it. |

Two things visible here that are known-missing rather than done: the payout
decay in 04 and 06 is real sim state, but the run has no shop to spend cash in,
so `BUY MORE` is still the placeholder single-block button.

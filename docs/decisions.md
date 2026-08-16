# Decisions log

`docs/agentidolhandoverv2.pdf` is a static file and wins any conflict per
`CLAUDE.md` — but it can't be amended in place. This log records decisions
made *after* it that reverse or add to something the handover called
`[DECIDED]`, `[PROPOSED]`, or explicitly rejected. Where the two disagree,
**this file wins** — it's the newer instruction. Treat entries here the same
way CLAUDE.md says to treat the handover's own markers: not up for
re-litigation, just implemented.

---

## 2026-08-16 — Reasoning buys accuracy not speed; debt is gone; a deadline countdown; class labels; number moves

A batch of directly-requested changes. Grouped here because several touch the
same files and the same playtest goal — make the board busier and the reasoning
dial an actual choice — but each stands on its own.

**New decision `[DECIDED]` — REASONING NOW LOWERS ERROR RATE, NOT RUN TIME.**
This reverses the reasoning dial's whole semantics. It *was* speed + burn:
`cfg.reasoning[r]` held `{ speed, burn }`, `speed` multiplied work-seconds
accrued, so HIGH finished runs faster and LOW slower. It *is now* accuracy +
burn: the shape is `{ oneShotBonus, burn }`, and `oneShotBonus` is added to an
agent's effective one-shot chance — positive = fewer hallucinations/errors,
negative = more. **Every agent of a class now takes the same time on a run
regardless of reasoning**; work accrues at a flat `a.progress += dtSeconds` in
`tick.ts`, no speed factor. The burn multiplier is untouched — thinking harder
still costs proportionally more tokens. `effectiveOneShot` gained a
`reasoning: Reasoning` parameter that applies the bonus, clamped to a 0.98
ceiling (no dial buys a guaranteed run) and still floored at
`cfg.difficulty.floor`. Starting values, nobody signed off: LOW
`{ oneShotBonus: -0.12, burn: 0.5 }`, MEDIUM `{ 0, 1.0 }`, HIGH
`{ 0.10, 2.4 }`. Why the reversal: a speed dial made HIGH strictly better at
everything except cost, so the "choice" was just how much token budget you had;
tying it to error rate instead makes it a real trade against the hallucination
readout the pod card already shows — LOW is cheap but breaks more, HIGH is dear
but steadier.

**New decision `[DECIDED]` — ALL DEBT MECHANICS REMOVED.** The entire `debt`
block is gone from config (`interestPerSecond`, `lowLockAt`, `repoAt`,
`repoIntervalSeconds`), and with it the whole ladder in `tick.ts`: no interest
accrual on negative cash, no forced-LOW reasoning lock, no repossession
(`repossess()` deleted), and `lowLocked` / `lastRepoAt` are off `RunState`.
Telemetry `debtSeconds` and `agentsRepossessed` are removed, along with the
dashboard's REPOSSESSED tile and its "DEBT NEVER BITES" warning. **Negative cash
is now allowed but harmless** — it only limits what you can afford to buy; it
never runs away on its own or takes anything from you. This aligns the code with
the handover reversal CLAUDE.md already flags (the pitch's "debt is how you
lose" third beat is dead): there is no game over but the clock, and cash is a
spending limit, not a punishment engine. The `debtRate` harness stat survives as
"fraction of runs that ended in the red" — a descriptive readout, not a mechanic.

**New decision `[DECIDED]` — DEADLINE COUNTDOWN, an explicit exception to §9.**
`src/sim/state.ts` now exports a pure `secondsToNextDeadline(p, now)` returning
`p.nextPenaltyAt - now` (Infinity while the card is unaccepted — the render side
treats non-finite as "no timer yet"), and config gains
`decay.deadlineWarnSeconds` (starting 8), a render-only urgency threshold the
sim never reads. This puts a real derived number — seconds to the next renegotiation
cliff — on the card, which handover §9 ("no burn rate, runway, margin %, decay
labels") otherwise forbids. It's a **user-requested, explicitly permitted
exception**, and a narrow one: it's consistent with the stepped-decay decision
below, which made the deadline a concrete cliff to race rather than an ambient
slope. A countdown to a cliff the player can see coming is the one number that
earns its place; everything else on §9's list stays banned. Render owns the
display; the sim only exposes the accessor and the threshold.

**New decision `[DECIDED]` — class display names + chevrons (additive).**
`AgentClassConfig` gains `label: string` and `chevrons: number` (intelligence
rank, army-badge style — more chevrons = smarter). starter → "Haikuu", 1;
senior → "Sonneteer", 2; elite → "Opulent", 3. The `ClassName` keys
("starter"/"senior"/"elite") are unchanged and stay the stable API — these are
player-facing dressing only, read by render as `cfg.classes[key].label` /
`.chevrons`. Nobody's signed off the names either.

**Numbers moved** (still nobody's signed off, per `config.ts`'s preamble):
`boardSlots` 3 → 6 (a busier board — more to accept, more to juggle); token
`lotSize` 1,000,000 → 100,000 and `lotPrice` 9,000 → 500 (tokens were too
expensive per the request; `startingTokens`, `priceDropPerDelivery` and
`priceFloorMult` held). Re-tune from here in
`tools/agent-idol-balance-harness.html` same as any other lever.

## 2026-08-16 — Credits are renamed tokens, and the shop is now one flat lot

**Supersedes:** every "credits" reference in the handover and in CLAUDE.md's
own "five colours" list — the resource agents burn is now called **tokens**
everywhere, in code and on screen. This is a rename plus two mechanical
simplifications to the same resource, not a new mechanic:

**New decision `[DECIDED]`:**

1. **The reserve has no ceiling.** It never had one in the sim — `s.credits`
   (now `s.tokens`) was always an unbounded number the burn loop subtracted
   from — but the topbar rendered it as a `.cred-bar` filled against
   `startingCredits`, which visually implied a cap that didn't exist. The bar
   is gone; the topbar now shows `TOKENS` as a plain number, styled like
   `MONEY`, that only ever ticks down between purchases. `src/render/topbar.ts`
   and `.tokens`/`.tokens-v` in `src/style.css` replace `.cred-bar` entirely.
2. **BUY MORE buys one flat lot, not a tiered pick.** The old
   `cfg.credits.blocks` array (four sizes, better rate at the top) is gone.
   `cfg.tokens.lotSize` / `cfg.tokens.lotPrice` replace it: BUY MORE always
   adds the same `lotSize` tokens for `lotPrice` cash (still discounted by
   `tokenPriceMult` as deliveries bank), as many times as cash allows. This
   was already most of the way there — `buyCreditBlock(state, 0)` on
   `pointerdown` was marked `TODO(step-5): replace with the real
   block-picker shop` — the decision here is that the flat lot **is** the
   real shop, not a placeholder for one. A graduated picker needs explaining
   ("why is the top tier a better rate?"); CLAUDE.md's quality bar pushes
   back on exactly that kind of invisible rule.

**Numbers moved with the rename** (still nobody's signed off, per
`config.ts`'s own preamble): `startingTokens` 900 → 100,000,
`burnPerAgentSecond` 3.0 → 300, one lot = 1,000,000 tokens for $9,000. All
three moved by the same ~100× so the felt pacing — how many seconds of
runway a purchase buys a running agent — didn't change, only the numbers
did: a big, six-figure reserve draining by three figures a second reads like
what it's meant to be, an LLM token budget, instead of a poker-chip count.
Re-tune from here in `tools/agent-idol-balance-harness.html` same as any
other lever.

## 2026-08-16 — No idle tray; ADD/REMOVE per project, capped at 15 a pod

**Supersedes:**
- The idle tray (`DOING NOTHING`) and drag-to-assign for agents, both
  introduced this session (see the hiring and free-hiring entries below).
  Not a handover position — this is this session undoing its own earlier
  work in favor of something simpler once it was actually played.
- Partially reverses "No seats" — see below.

**New decision `[DECIDED]`:** each project card carries its own `ADD` /
`REMOVE` pair, with a class dropdown on `ADD`. `ADD` hires a fresh agent of
the picked class and puts it straight to work on that pod, in one click —
no idle roster to drag from. `REMOVE` lets go of the most recently added
agent on that pod, outright, not benched — hiring and firing are both free,
so there's nothing to bank by benching instead. There's no longer any
gesture that drags an agent; the two floor gestures are now click-to-retry
and drag-a-board-card-into-a-pod. The idle tray is gone, and so is the
`.empty-slot` drop target that lived inside a pod's desks — there's nothing
left to drop there.

Knock-on effect worth recording: since there's no idle tray to hold agents
between jobs, an agent that isn't actively wanted somewhere no longer has
anywhere to *be*. Delivering a project or abandoning it now removes every
agent that was on it outright, the same as REMOVE does, rather than idling
them. A run's starting roster (`cfg.startingRoster`) still spawns idle at
boot for backward compatibility with the sim's own tests and the balance
harness, which still exercise the older hire-then-assign two-step primitives
(`hireAgent` + `assignAgent`, both still real, still used by
`tools/agent-idol-balance-harness.html`'s strategies) — but those starting
agents are never shown or reachable from the floor now, since nothing
routes an idle agent to a visible parent anymore. That's 3 of `maxRoster`'s
24 slots permanently inert for the length of a run. Small, understood,
not fixed here — flagging it rather than leaving it silently discovered
later. Fixing it properly means starting a run with zero agents instead,
which touches roughly a dozen existing sim tests that assume the starting
roster exists; not worth doing in the same pass as this UI change.

**New decision `[DECIDED]`, partially reversing "No seats":** a pod caps out
at `maxAgentsPerPod` (15) agents — `ADD` just stops working past it, greyed
out same as any other unavailable control. This is a legibility cap, not an
economic one: `crowding.penaltyPerExtraAgent` already makes swarming that
hard nearly always a bad idea well before 15, so the cap is rarely the
thing actually stopping a player — the shrink-as-you-add art in
`src/render/agent.ts` (four tiers, sprite sizes 64/48/32/16px, the pixel-art
whole-multiple rule holding at every one) was sized to comfortably handle
exactly this many on screen at once without wrapping into rows a pod has no
height for. Worth a second look if a future balance pass makes swarming
past 15 desirable rather than just survivable, but not re-proposed here.

## 2026-08-16 — Payout decay becomes a missed-deadline renegotiation, not a continuous drain

**Supersedes** the handover's continuous per-second payout decay (`decay.perSecond`
in the earlier `config.ts`, driving `tick.ts`'s decay block every frame) and the
pro-rata-on-decayed-value mechanic built on top of it. The pro-rata rule itself
(finalise() pays completion % of the project's CURRENT payout, not its original
offer) is **not** touched — it still reads whatever `p.payout` is at the buzzer,
which is now a stepped value instead of a continuously falling one.

**New decision `[DECIDED]`:** a project's payout holds perfectly flat while it's
inside its deadline interval. Missing the interval means the client
renegotiates: payout steps down once by a fraction of the ORIGINAL offer, and
the interval restarts for the next miss — so a badly-neglected project loses
value in discrete cliffs, not a smooth slope, and never drops below
`decay.floor` regardless of how many misses land. Both axes are tuned in
`src/sim/config.ts`'s `decay` block and computed per-project at spawn:

- `deadlineIntervalSeconds` scales with the job's own `work` — bigger jobs are
  slower by nature, so they get a longer window per miss (`decay.baseIntervalSeconds`
  + `decay.intervalPerWork * work`).
- `penaltyFraction` scales with the job's `difficulty` — harder jobs punish a
  miss harder (`decay.basePenaltyFraction` + `decay.penaltyPerDifficultyPip *
  (difficulty - 1)`).

These are deliberately two independent axes rather than one "big jobs punish
harder" curve: a project can be small-and-brutal or large-and-forgiving
depending on how difficulty landed on it, which is closer to what a real
missed-deadline renegotiation feels like than a single dial would be.

**Why the reversal:** requested directly — a continuous per-second bleed reads
as ambient decay a player can't act against moment-to-moment; a deadline that
holds flat until it's missed, then visibly steps, is legible the same way the
clock and the credit bar already are, and gives "you are the bottleneck" a
concrete cliff to race rather than a slope to slowly lose to. Still no new
derived-number label on the card (handover §9) — the player sees the same raw
dollar payout they always did, just moving in steps instead of a slide.

**Not yet touched:** nothing in `src/render/` or `src/fx/` changed — the pod
card already just displays whatever `p.payout` currently is, so the stepped
value renders correctly with zero UI work. Whether a step deserves its own
visual beat (a flash, a shake) when it lands is fx-layer work for step 7 and
still open.

## 2026-08-16 — The crowding penalty gets a readout: hallucination rate

**Adds to** the crowding-penalty decision below — this is the UI surface
for it, not a separate mechanic.

**New decision `[DECIDED]`:** every occupied pod shows a HALLUCINATION
reading — LOW / MEDIUM / HIGH / VERY HIGH / EXTREME — next to REASONING.
It's the mean fail rate across every agent currently on that pod (the same
population `effectiveOneShot`'s crowding penalty counts — running or
blocked, blocked hasn't left), bucketed by `hallucination.tierThresholds`
in `src/sim/config.ts`. Reads "—" until at least one agent is on the pod;
averaging zero agents isn't a rate. `src/sim/state.ts` exports
`podFailRate` and `hallucinationTierIndex` as the pure computation; nothing
about it lives in `src/render/`.

Does not conflict with handover §9's "No derived numbers" rule (no burn
rate, runway, margin %, decay labels as raw figures): this is a band, not a
percentage, the same shape as the difficulty pips and the reasoning dial
already on the same card. The player is meant to feel "more agents here
means more clicking soon," the same way they already feel decay and
difficulty — this just gives that specific feeling a name and a place to
watch it climb.

## 2026-08-16 — Swarming carries a one-shot penalty

**Supersedes:**
- §5 "No seats" `[DECIDED]` — "Do not add a crowding penalty (diminishing
  returns, merge conflicts, etc.) — it's tempting and thematic, but it's an
  invisible rule that would need explaining, and the economics already
  handle it."
- §12 "Explicitly rejected" — "A crowding penalty on swarms" — "Invisible
  rule; opportunity cost already handles it."

**New decision `[DECIDED]`:** each agent stacked on a pod beyond the first
lowers the effective one-shot chance of *every* agent on that pod, on top of
the existing difficulty penalty. Tunable as `crowding.penaltyPerExtraAgent`
in `src/sim/config.ts`; a blocked agent still counts toward its pod's
occupancy, since it hasn't left. There is still no seat *limit* — you can
put as many bodies on a project as you want — but now it costs you in
quality as well as credits.

Why the reversal, for whoever reads this next: the handover's original
argument (opportunity cost is enough of a brake) held when swarming was the
only lever. It stops holding once hiring is free (see below) — coverage and
concurrency are no longer scarce, so a brake that only taxes credits and
idle pods stops being a real brake. This is not "the invisible rule turned
out to be needed after all" in the abstract; it's downstream of the second
decision in this log.

**Not superseded:** `discardOverflow` (a separate, still-optional
throughput-side crowding cost) and the underlying claim that opportunity
cost matters — it still does, crowding just isn't invisible anymore because
the pod visibly gets worse at its job as it fills, the same way it visibly
crowds.

## 2026-08-16 — Hiring is free

The handover never specifies a hire cost — §5's Classes section and §7
Upgrades describe the three tiers and a promotion system but say nothing
about what recruiting one costs. The cash price on `hireAgent` was an
implementation detail from an earlier build pass, not a handover position,
so this isn't a reversal so much as filling in a gap the handover left open,
in a specific direction:

**New decision `[DECIDED]`:** hiring an agent, of any class, costs nothing.
Agents are free to spawn — the cost of a bigger fleet is paid on the floor,
not at the door: every agent burns its own credits once it's put to work,
and stacking more of them on one project drives that project's crowding
penalty (above). The roster cap (`maxRoster`) is the only remaining gate on
hiring itself.

**Known open tension this creates, not yet resolved:** with acquisition
free, an elite agent is no longer strictly more expensive than a starter to
*get* — only to *run* (higher `burnMult`) and it still only occupies one pod
at a time. §5's "why cheap agents survive late run" argument rested partly
on cost-to-acquire; it now rests entirely on coverage (bodies per pod) and
burn rate. Whether that's still enough to keep cheap agents relevant is an
open balance question, not a code question — chase it in
`tools/agent-idol-balance-harness.html`.

# Decisions log

`docs/agentidolhandoverv2.pdf` is a static file and wins any conflict per
`CLAUDE.md` — but it can't be amended in place. This log records decisions
made *after* it that reverse or add to something the handover called
`[DECIDED]`, `[PROPOSED]`, or explicitly rejected. Where the two disagree,
**this file wins** — it's the newer instruction. Treat entries here the same
way CLAUDE.md says to treat the handover's own markers: not up for
re-litigation, just implemented.

---

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

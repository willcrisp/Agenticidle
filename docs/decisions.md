# Decisions log

`docs/agentidolhandoverv2.pdf` is a static file and wins any conflict per
`CLAUDE.md` — but it can't be amended in place. This log records decisions
made *after* it that reverse or add to something the handover called
`[DECIDED]`, `[PROPOSED]`, or explicitly rejected. Where the two disagree,
**this file wins** — it's the newer instruction. Treat entries here the same
way CLAUDE.md says to treat the handover's own markers: not up for
re-litigation, just implemented.

---

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

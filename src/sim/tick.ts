import { ClassName, Reasoning } from "./config";
import {
  RunState,
  effectiveOneShot,
  spawnProject,
  tokenPriceMult,
  makeAgent,
} from "./state";

// ---------------------------------------------------------------------------
// Actions — the only ways the player can touch the run.
// ---------------------------------------------------------------------------

/** Take a card from the board into an empty pod. Decay starts now. */
export function acceptProject(s: RunState, boardIndex: number, pod: number): boolean {
  if (s.pods[pod] !== null) return false;
  const p = s.board[boardIndex];
  if (!p) return false;
  s.board.splice(boardIndex, 1);
  p.acceptedAt = s.t;
  p.nextPenaltyAt = s.t + p.deadlineIntervalSeconds;
  s.pods[pod] = p;
  if (s.boardRefillAt <= s.t) s.boardRefillAt = s.t + s.cfg.boardRefillSeconds;
  return true;
}

/**
 * Drag an idle agent onto a pod. No seat limit — they just crowd in, and
 * each extra body on the same pod lowers everyone there's one-shot chance
 * (see `effectiveOneShot`'s crowding penalty).
 */
export function assignAgent(s: RunState, agentId: number, pod: number): boolean {
  const a = s.agents.find((x) => x.id === agentId);
  if (!a || a.state !== "idle" || !s.pods[pod]) return false;
  a.pod = pod;
  a.state = "running";
  a.progress = 0;
  s.telemetry.runsAttempted++;
  return true;
}

/** Pull an agent off the floor. Idle agents burn nothing. */
export function benchAgent(s: RunState, agentId: number): boolean {
  const a = s.agents.find((x) => x.id === agentId);
  if (!a || a.state === "idle") return false;
  if (a.state === "blocked") {
    const i = s.blockedQueue.indexOf(a.id);
    if (i >= 0) s.blockedQueue.splice(i, 1);
  }
  a.state = "idle";
  a.pod = null;
  a.progress = 0;
  return true;
}

/** The click. Restarts a blocked agent's run from zero — lost time is lost. */
export function retryAgent(s: RunState, agentId: number): boolean {
  const a = s.agents.find((x) => x.id === agentId);
  if (!a || a.state !== "blocked") return false;
  a.state = "running";
  a.progress = 0;
  const i = s.blockedQueue.indexOf(a.id);
  if (i >= 0) s.blockedQueue.splice(i, 1);
  s.telemetry.runsAttempted++;
  return true;
}

export function setReasoning(s: RunState, pod: number, reasoning: Reasoning): boolean {
  const p = s.pods[pod];
  if (!p) return false;
  p.reasoning = s.lowLocked ? "low" : reasoning;
  return true;
}

export function buyCreditBlock(s: RunState, blockIndex: number): boolean {
  const block = s.cfg.credits.blocks[blockIndex];
  if (!block) return false;
  const price = Math.round(block.price * tokenPriceMult(s));
  s.cash -= price;
  s.credits += block.tokens;
  s.creditsBought += block.tokens;
  s.telemetry.moneySpentOnCredits += price;
  return true;
}

/**
 * Hiring is free. Agents are free to spawn — the cost of a bigger fleet is
 * paid on the floor, not at the register: every agent burns its own credits
 * once it's running, and stacking more of them on one project drives that
 * project's crowding penalty (see `effectiveOneShot`). The only gate here is
 * the roster cap.
 */
export function hireAgent(s: RunState, cls: ClassName): boolean {
  if (s.agents.length >= s.cfg.maxRoster) return false;
  s.agents.push(makeAgent(cls, s.rng));
  s.telemetry.peakRoster = Math.max(s.telemetry.peakRoster, s.agents.length);
  return true;
}

/** Drop a contract to free the pod. Banks nothing. */
export function abandonProject(s: RunState, pod: number): boolean {
  if (!s.pods[pod]) return false;
  for (const a of s.agents) if (a.pod === pod) benchAgent(s, a.id);
  s.pods[pod] = null;
  return true;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function tick(s: RunState, dtSeconds: number): void {
  if (s.finished) return;

  const cfg = s.cfg;
  s.t += dtSeconds;

  // --- credit limit / repossession -----------------------------------------
  const wasLocked = s.lowLocked;
  s.lowLocked = s.cash < cfg.debt.lowLockAt;
  if (s.lowLocked && !wasLocked) {
    for (const p of s.pods) if (p) p.reasoning = "low";
  }
  if (s.cash < 0) {
    s.cash += s.cash * cfg.debt.interestPerSecond * dtSeconds;
    s.telemetry.debtSeconds += dtSeconds;
  }
  if (s.cash < cfg.debt.repoAt && s.t - s.lastRepoAt >= cfg.debt.repoIntervalSeconds) {
    repossess(s);
    s.lastRepoAt = s.t;
  }

  // --- credit burn ----------------------------------------------------------
  let burn = 0;
  for (const a of s.agents) {
    if (a.pod === null) continue;
    const p = s.pods[a.pod];
    if (!p) continue;
    const counts =
      a.state === "running" || (a.state === "blocked" && cfg.credits.blockedAgentsBurn);
    if (!counts) continue;
    burn +=
      cfg.credits.burnPerAgentSecond *
      cfg.classes[a.cls].burnMult *
      cfg.reasoning[p.reasoning].burn;
  }
  const wanted = burn * dtSeconds;
  const stalled = s.credits <= 0 && wanted > 0;
  if (stalled) {
    s.telemetry.stalledSeconds += dtSeconds;
  } else {
    s.credits = Math.max(0, s.credits - wanted);
  }

  // --- renegotiation (missed-deadline decay) ---------------------------------
  // Payout holds perfectly flat while a project is inside its deadline
  // interval; missing it makes the client renegotiate: payout steps down once
  // by penaltyFraction of the ORIGINAL offer, and the interval restarts for
  // the next miss. `while`, not `if`, so a tick that spans more than one
  // missed interval (a long dt) still applies every step it owes rather than
  // silently swallowing them.
  for (const p of s.pods) {
    if (!p) continue;
    while (p.nextPenaltyAt <= s.t) {
      p.payout = Math.max(
        p.originalPayout * cfg.decay.floor,
        p.payout - p.originalPayout * p.penaltyFraction
      );
      p.nextPenaltyAt += p.deadlineIntervalSeconds;
    }
  }

  // --- agent runs -----------------------------------------------------------
  // Pod occupancy, counted once per tick: how many agents (running or
  // blocked — anyone still parked there) are stacked on each pod right now.
  // Feeds the crowding penalty below. Idle agents don't occupy a pod.
  const podOccupancy = new Array<number>(s.pods.length).fill(0);
  for (const a of s.agents) {
    if (a.pod !== null) podOccupancy[a.pod] = (podOccupancy[a.pod] ?? 0) + 1;
  }

  for (const a of s.agents) {
    if (a.state === "blocked") {
      a.blockedTime += dtSeconds;
      s.telemetry.agentBlockedSeconds += dtSeconds;
      continue;
    }
    if (a.state !== "running" || a.pod === null) continue;
    const p = s.pods[a.pod];
    if (!p) {
      // Pod emptied under them — go idle.
      a.state = "idle";
      a.pod = null;
      continue;
    }
    if (stalled) continue; // zero credits: frozen, while the payout keeps falling

    a.progress += dtSeconds * cfg.reasoning[p.reasoning].speed;
    const runWork = cfg.classes[a.cls].runWork;
    if (a.progress < runWork) continue;

    // Run resolves.
    a.progress = 0;
    const chance = effectiveOneShot(cfg, a.cls, p.difficulty, podOccupancy[a.pod] ?? 1);
    if (s.rng.chance(chance)) {
      let delivered = runWork;
      const remaining = p.work - p.workDone;
      if (delivered > remaining) {
        if (cfg.discardOverflow) {
          s.telemetry.overflowWasted += delivered - remaining;
          delivered = remaining;
        }
      }
      p.workDone += delivered;
      p.slices.push(runWork);
      s.telemetry.runsAttempted++; // the auto-started next run
      if (p.workDone >= p.work) deliver(s, a.pod);
    } else {
      a.state = "blocked";
      a.blockedSince = s.t;
      s.blockedQueue.push(a.id);
      s.telemetry.runsFailed++;
      const bucket = Math.min(
        s.telemetry.clicksDemanded.length - 1,
        Math.floor(s.t / s.telemetry.bucketSeconds)
      );
      s.telemetry.clicksDemanded[bucket]++;
    }
  }

  // --- board refill ---------------------------------------------------------
  if (s.board.length < cfg.boardSlots && s.t >= s.boardRefillAt) {
    s.board.push(spawnProject(s));
    if (s.board.length < cfg.boardSlots) s.boardRefillAt = s.t + cfg.boardRefillSeconds;
  }

  // --- buzzer ---------------------------------------------------------------
  if (s.t >= cfg.runSeconds) finalise(s);
}

function deliver(s: RunState, pod: number): void {
  const p = s.pods[pod];
  if (!p) return;
  s.cash += p.payout;
  s.deliveries++;
  s.pods[pod] = null;
  // Delivering frees every agent on it at once.
  for (const a of s.agents) {
    if (a.pod === pod) {
      if (a.state === "blocked") {
        const i = s.blockedQueue.indexOf(a.id);
        if (i >= 0) s.blockedQueue.splice(i, 1);
      }
      a.state = "idle";
      a.pod = null;
      a.progress = 0;
    }
  }
}

function repossess(s: RunState): void {
  // Cheapest first — the fleet degrades from the bottom.
  const order: ClassName[] = ["starter", "senior", "elite"];
  for (const cls of order) {
    const idx = s.agents.findIndex((a) => a.cls === cls);
    if (idx >= 0) {
      const a = s.agents[idx];
      const qi = s.blockedQueue.indexOf(a.id);
      if (qi >= 0) s.blockedQueue.splice(qi, 1);
      s.agents.splice(idx, 1);
      s.telemetry.agentsRepossessed++;
      return;
    }
  }
}

/**
 * At the buzzer: delivered work has already banked. Everything still in
 * progress pays its completion percentage of its CURRENT, decayed value.
 * Leftover credits are worth nothing.
 */
export function finalise(s: RunState): void {
  if (s.finished) return;
  for (let i = 0; i < s.pods.length; i++) {
    const p = s.pods[i];
    if (!p) continue;
    const pct = Math.min(1, p.workDone / p.work);
    s.cash += p.payout * pct;
  }
  s.score = Math.round(s.cash);
  s.finished = true;
}

import { ClassName, Dial } from "./config";
import {
  RunState,
  effectiveOneShot,
  spawnProject,
  blockPrice,
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
  s.pods[pod] = p;
  if (s.boardRefillAt <= s.t) s.boardRefillAt = s.t + s.cfg.boardRefillSeconds;
  return true;
}

/** Drag an idle agent onto a pod. No seat limit — they just crowd in. */
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

export function setDial(s: RunState, pod: number, dial: Dial): boolean {
  const p = s.pods[pod];
  if (!p) return false;
  p.dial = s.slowLocked ? "slow" : dial;
  return true;
}

export function buyCreditBlock(s: RunState, blockIndex: number): boolean {
  const block = s.cfg.credits.blocks[blockIndex];
  if (!block) return false;
  const price = blockPrice(s, blockIndex);
  s.cash -= price;
  s.credits += block.tokens;
  s.creditsBought += block.tokens;
  s.telemetry.moneySpentOnCredits += price;
  return true;
}

/** Can this class be hired at all yet — i.e. has its licence been bought? */
export function classUnlocked(s: RunState, cls: ClassName): boolean {
  return s.unlockedClasses.includes(cls);
}

/**
 * Buy the licence for a model class. This is the "invest in a better model"
 * lever: one-off, run-scoped, and it buys nothing but the right to hire.
 * Unlike a credit block it will not put you in the red — a licence you cannot
 * afford is simply not sold.
 */
export function buyModelLicence(s: RunState, cls: ClassName): boolean {
  if (classUnlocked(s, cls)) return false;
  const price = s.cfg.classes[cls].licenceCost;
  if (s.cash < price) return false;
  s.cash -= price;
  s.telemetry.moneySpentOnModels += price;
  s.unlockedClasses.push(cls);
  return true;
}

export function hireAgent(s: RunState, cls: ClassName): boolean {
  if (s.agents.length >= s.cfg.maxRoster) return false;
  if (!classUnlocked(s, cls)) return false;
  const cost = s.cfg.classes[cls].cost;
  if (s.cash < cost) return false;
  s.cash -= cost;
  s.telemetry.moneySpentOnAgents += cost;
  s.agents.push(makeAgent(cls, s.rng, s.t));
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
  const wasLocked = s.slowLocked;
  s.slowLocked = s.cash < cfg.debt.slowLockAt;
  if (s.slowLocked && !wasLocked) {
    for (const p of s.pods) if (p) p.dial = "slow";
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
    burn += cfg.credits.burnPerAgentSecond * cfg.classes[a.cls].burnMult * cfg.dials[p.dial].burn;
  }
  const wanted = burn * dtSeconds;
  const stalled = s.credits <= 0 && wanted > 0;
  if (stalled) {
    s.telemetry.stalledSeconds += dtSeconds;
  } else {
    s.credits = Math.max(0, s.credits - wanted);
  }

  // --- decay ----------------------------------------------------------------
  for (const p of s.pods) {
    if (!p) continue;
    const damp = 1 - cfg.decay.sizeDamping * (p.work / cfg.sizes.huge.work);
    const lost = p.originalPayout * cfg.decay.perSecond * damp * dtSeconds;
    p.payout = Math.max(p.originalPayout * cfg.decay.floor, p.payout - lost);
  }

  // --- agent runs -----------------------------------------------------------
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

    a.progress += dtSeconds * cfg.dials[p.dial].speed;
    const runWork = cfg.classes[a.cls].runWork;
    if (a.progress < runWork) continue;

    // Run resolves.
    a.progress = 0;
    const chance = effectiveOneShot(cfg, a.cls, p.difficulty);
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
      a.runsGreen++;
      a.workDelivered += delivered;
      s.telemetry.runsAttempted++; // the auto-started next run
      if (p.workDone >= p.work) deliver(s, a.pod);
    } else {
      a.state = "blocked";
      a.blockedSince = s.t;
      a.runsRed++;
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

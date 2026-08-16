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
 * Puts an idle agent to work on a pod. The floor no longer has a gesture
 * that calls this directly on its own — `addAgentToPod` below hires and
 * assigns in one step — but it's still the sim primitive underneath, and
 * the balance harness's strategies use it that way. No seat limit below
 * `maxAgentsPerPod`: agents just crowd in, and each extra body on the same
 * pod lowers everyone there's one-shot chance (see `effectiveOneShot`'s
 * crowding penalty).
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

/**
 * Pull an agent off the floor and back to idle. Idle agents burn nothing.
 * Kept for the harness and for API completeness; the interactive floor has
 * no idle tray to bench an agent into anymore, so `removeAgentFromPod`
 * below is what the UI actually calls.
 */
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
  p.reasoning = reasoning;
  return true;
}

/**
 * BUY MORE. Always the same lot — `cfg.tokens.lotSize` tokens for
 * `cfg.tokens.lotPrice` cash, discounted by `tokenPriceMult`. No picker, no
 * tiers: the reserve just goes up by a flat amount, as many times as cash
 * allows.
 */
export function buyTokens(s: RunState): boolean {
  const { tokens } = s.cfg;
  const price = Math.round(tokens.lotPrice * tokenPriceMult(s));
  s.cash -= price;
  s.tokens += tokens.lotSize;
  s.tokensBought += tokens.lotSize;
  s.telemetry.moneySpentOnTokens += price;
  return true;
}

/**
 * Hiring is free. Agents are free to spawn — the cost of a bigger fleet is
 * paid on the floor, not at the register: every agent burns its own tokens
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

/**
 * The ADD control on a project card: hires a fresh agent of the requested
 * class and puts it straight to work on this pod, in one step. There's no
 * idle roster to drag from anymore — hiring and assigning are the same
 * click. Gated by this pod's own occupancy cap (`maxAgentsPerPod`, so the
 * desks stay legible) as well as the fleet-wide `maxRoster` that `hireAgent`
 * already enforces.
 */
export function addAgentToPod(s: RunState, pod: number, cls: ClassName): boolean {
  if (!s.pods[pod]) return false;
  const occupancy = s.agents.filter((a) => a.pod === pod).length;
  if (occupancy >= s.cfg.maxAgentsPerPod) return false;
  if (!hireAgent(s, cls)) return false;
  const hired = s.agents[s.agents.length - 1]!;
  assignAgent(s, hired.id, pod);
  return true;
}

/**
 * The REMOVE control: lets go of the most recently added agent on this pod
 * — outright, not benched. Firing is free, same as hiring is, and there's
 * no idle tray left to bench them into.
 */
export function removeAgentFromPod(s: RunState, pod: number): boolean {
  for (let i = s.agents.length - 1; i >= 0; i--) {
    const a = s.agents[i];
    if (a.pod !== pod) continue;
    if (a.state === "blocked") {
      const qi = s.blockedQueue.indexOf(a.id);
      if (qi >= 0) s.blockedQueue.splice(qi, 1);
    }
    s.agents.splice(i, 1);
    return true;
  }
  return false;
}

/**
 * Fire one specific agent by id, wherever it's sitting. Powers the per-agent
 * hover-X on the floor — selective removal, versus REMOVE's blunt
 * most-recently-added-first. Firing is free, same as hiring.
 */
export function removeAgent(s: RunState, agentId: number): boolean {
  const i = s.agents.findIndex((a) => a.id === agentId);
  if (i < 0) return false;
  const a = s.agents[i];
  if (a.state === "blocked") {
    const qi = s.blockedQueue.indexOf(a.id);
    if (qi >= 0) s.blockedQueue.splice(qi, 1);
  }
  s.agents.splice(i, 1);
  return true;
}

/** Every agent on a pod, removed outright. Shared by delivery and abandon. */
function clearPod(s: RunState, pod: number): void {
  for (let i = s.agents.length - 1; i >= 0; i--) {
    const a = s.agents[i];
    if (a.pod !== pod) continue;
    if (a.state === "blocked") {
      const qi = s.blockedQueue.indexOf(a.id);
      if (qi >= 0) s.blockedQueue.splice(qi, 1);
    }
    s.agents.splice(i, 1);
  }
}

/** Drop a contract to free the pod. Banks nothing. */
export function abandonProject(s: RunState, pod: number): boolean {
  if (!s.pods[pod]) return false;
  clearPod(s, pod);
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

  // --- token burn -------------------------------------------------------
  let burn = 0;
  for (const a of s.agents) {
    if (a.pod === null) continue;
    const p = s.pods[a.pod];
    if (!p) continue;
    const counts =
      a.state === "running" || (a.state === "blocked" && cfg.tokens.blockedAgentsBurn);
    if (!counts) continue;
    burn +=
      cfg.tokens.burnPerAgentSecond *
      cfg.classes[a.cls].burnMult *
      cfg.reasoning[p.reasoning].burn;
  }
  const wanted = burn * dtSeconds;
  const stalled = s.tokens <= 0 && wanted > 0;
  if (stalled) {
    s.telemetry.stalledSeconds += dtSeconds;
  } else {
    s.tokens = Math.max(0, s.tokens - wanted);
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

  // A snapshot, not a live view: a successful run in this loop can trigger
  // `deliver()`, which now removes agents from `s.agents` outright instead
  // of idling them in place. Splicing the very array a `for...of` is
  // iterating skips or re-visits entries; iterating a copy keeps every
  // agent visited exactly once this tick regardless of who gets removed
  // along the way.
  for (const a of s.agents.slice()) {
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
    if (stalled) continue; // zero tokens: frozen, while the payout keeps falling

    // Reasoning no longer changes how fast work accrues — every agent of a
    // class takes the same time. It's spent on accuracy instead (see the
    // reasoning bonus in effectiveOneShot below) and on token burn.
    a.progress += dtSeconds;
    const runWork = cfg.classes[a.cls].runWork;
    if (a.progress < runWork) continue;

    // Run resolves.
    a.progress = 0;
    const chance = effectiveOneShot(
      cfg,
      a.cls,
      p.difficulty,
      podOccupancy[a.pod] ?? 1,
      p.reasoning
    );
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
  // Delivering lets the whole team on it go, all at once — free to hire,
  // free to let go, and there's no idle tray for them to wait around in.
  clearPod(s, pod);
}

/**
 * At the buzzer: delivered work has already banked. Everything still in
 * progress pays its completion percentage of its CURRENT, decayed value.
 * Leftover tokens are worth nothing.
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

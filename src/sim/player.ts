import { ClassName, Reasoning } from "./config";
import { RunState, Project } from "./state";
import {
  acceptProject,
  assignAgent,
  buyTokens,
  hireAgent,
  retryAgent,
  setReasoning,
} from "./tick";

/**
 * The player is modelled as a finite click budget plus a decision policy.
 *
 * The click cap is the whole point. "You are the bottleneck" only means
 * something if the sim can run out of hands, so blocked agents queue up and
 * are served at a fixed rate with a reaction delay. Everything the harness
 * reports about overwhelm comes from this.
 */
export interface Strategy {
  name: string;
  /** Retries per second the player can physically serve. */
  clicksPerSecond: number;
  /** Seconds before a newly blocked agent is even noticed. */
  reactionSeconds: number;
  /** Which blocked agent gets served first. */
  triage: "fifo" | "richest-pod" | "most-decayed";
  decide: (s: RunState, api: PlayerApi) => void;
}

export interface PlayerApi {
  accept(boardIndex: number, pod: number): void;
  assign(agentId: number, pod: number): void;
  reason(pod: number, r: Reasoning): void;
  /** Buys one flat lot of tokens — there's only one size. */
  buy(): void;
  hire(cls: ClassName): void;
}

const DECISION_INTERVAL = 0.5; // the player re-reads the floor twice a second

export class Player {
  private clickCredit = 0;
  private nextDecisionAt = 0;

  constructor(public strat: Strategy) {}

  step(s: RunState, dt: number): void {
    const bucket = Math.min(
      s.telemetry.clicksDemanded.length - 1,
      Math.floor(s.t / s.telemetry.bucketSeconds)
    );

    // --- serve the click queue -------------------------------------------
    this.clickCredit = Math.min(
      this.strat.clicksPerSecond, // no hoarding: unclicked capacity is lost
      this.clickCredit + this.strat.clicksPerSecond * dt
    );

    const ready = this.orderQueue(s).filter((id) => {
      const a = s.agents.find((x) => x.id === id);
      return a && s.t - a.blockedSince >= this.strat.reactionSeconds;
    });

    s.telemetry.blockedBacklog[bucket] = Math.max(
      s.telemetry.blockedBacklog[bucket],
      s.blockedQueue.length
    );

    for (const id of ready) {
      if (this.clickCredit < 1) break;
      if (retryAgent(s, id)) {
        this.clickCredit -= 1;
        s.telemetry.clicksServed[bucket]++;
      }
    }

    // --- policy decisions -------------------------------------------------
    if (s.t >= this.nextDecisionAt) {
      this.nextDecisionAt = s.t + DECISION_INTERVAL;
      this.strat.decide(s, this.api(s));
    }
  }

  private orderQueue(s: RunState): number[] {
    const q = [...s.blockedQueue];
    if (this.strat.triage === "fifo") return q;
    const value = (id: number) => {
      const a = s.agents.find((x) => x.id === id);
      if (!a || a.pod === null) return 0;
      const p = s.pods[a.pod];
      if (!p) return 0;
      return this.strat.triage === "richest-pod"
        ? p.payout
        : (p.originalPayout - p.payout) / Math.max(1, p.originalPayout);
    };
    return q.sort((a, b) => value(b) - value(a));
  }

  private api(s: RunState): PlayerApi {
    return {
      accept: (b, pod) => acceptProject(s, b, pod),
      assign: (id, pod) => assignAgent(s, id, pod),
      reason: (pod, r) => setReasoning(s, pod, r),
      buy: () => buyTokens(s),
      hire: (c) => hireAgent(s, c),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers shared by the scripted strategies
// ---------------------------------------------------------------------------

function fillPods(s: RunState, api: PlayerApi, pickBest: (a: Project, b: Project) => number) {
  for (let pod = 0; pod < s.pods.length; pod++) {
    if (s.pods[pod]) continue;
    if (!s.board.length) break;
    // Don't take on a job you can't finish — huge jobs late are a trap.
    const timeLeft = s.cfg.runSeconds - s.t;
    const viable = s.board
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => timeLeft > 30 && p.work / 4 < timeLeft);
    if (!viable.length) break;
    viable.sort((a, b) => pickBest(a.p, b.p));
    api.accept(viable[0].i, pod);
  }
}

function keepTokensTopped(s: RunState, api: PlayerApi, targetSeconds: number) {
  const running = s.agents.filter((a) => a.state === "running").length;
  if (running === 0) return;
  const burnRate = running * s.cfg.tokens.burnPerAgentSecond * 1.4;
  const runway = s.tokens / Math.max(0.01, burnRate);
  if (runway > targetSeconds) return;
  // Only one lot size exists — buy it, cash or no cash. Going negative is
  // harmless now (debt was removed); it just caps what you can afford next.
  api.buy();
}

function scatterIdle(s: RunState, api: PlayerApi, pick: (pods: number[]) => number) {
  const open = s.pods.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  if (!open.length) return;
  for (const a of s.agents) {
    if (a.state !== "idle") continue;
    api.assign(a.id, pick(open));
  }
}

const HARVEST_AT = 0.833; // last 5 minutes of a 30-minute run

function harvestMode(s: RunState): boolean {
  return s.t / s.cfg.runSeconds >= HARVEST_AT;
}

// ---------------------------------------------------------------------------
// Scripted strategies
// ---------------------------------------------------------------------------

/** The intended run shape from the handover: build, keep pace, harvest. */
export const balanced: Strategy = {
  name: "Balanced (intended shape)",
  clicksPerSecond: 2.5,
  reactionSeconds: 0.35,
  triage: "richest-pod",
  decide(s, api) {
    fillPods(s, api, (a, b) => b.payout / b.work - a.payout / a.work);
    scatterIdle(s, api, (open) => {
      // Even spread, favouring the pod with fewest bodies.
      const counts = open.map(
        (pod) => s.agents.filter((a) => a.pod === pod).length
      );
      return open[counts.indexOf(Math.min(...counts))];
    });

    const harvest = harvestMode(s);
    for (let pod = 0; pod < s.pods.length; pod++) {
      const p = s.pods[pod];
      if (!p) continue;
      if (harvest) api.reason(pod, "high");
      else {
        const decayed = 1 - p.payout / p.originalPayout;
        api.reason(pod, decayed > 0.3 ? "high" : decayed > 0.12 ? "medium" : "low");
      }
    }

    keepTokensTopped(s, api, harvest ? 20 : 70);

    // Hiring is free — the brake is crowding and burn, not cash. Build
    // toward a moderate roster (2 elite, then senior, then fill with
    // starters) rather than maxing the cap immediately.
    if (!harvest && s.t < s.cfg.runSeconds * 0.6 && s.agents.length < 10) {
      const elites = s.agents.filter((a) => a.cls === "elite").length;
      const seniors = s.agents.filter((a) => a.cls === "senior").length;
      if (elites < 2) api.hire("elite");
      else if (seniors < 4) api.hire("senior");
      else api.hire("starter");
    }
  },
};

/** Cluster on the bleeding contract, bank it, scatter. */
export const swarmer: Strategy = {
  name: "Swarm the bleeder",
  clicksPerSecond: 2.5,
  reactionSeconds: 0.35,
  triage: "most-decayed",
  decide(s, api) {
    fillPods(s, api, (a, b) => b.payout - a.payout);
    scatterIdle(s, api, (open) => {
      let worst = open[0];
      let worstLoss = -1;
      for (const pod of open) {
        const p = s.pods[pod]!;
        const loss = p.originalPayout - p.payout;
        if (loss > worstLoss) {
          worstLoss = loss;
          worst = pod;
        }
      }
      return worst;
    });
    for (let pod = 0; pod < s.pods.length; pod++) {
      if (s.pods[pod]) api.reason(pod, harvestMode(s) ? "high" : "high");
    }
    keepTokensTopped(s, api, 60);
    // A deliberately small roster: this strategy's whole plan is stacking
    // everyone it has onto one bleeding contract, so the crowding penalty
    // is the cost it's choosing to pay, not something to hire around.
    if (s.t < s.cfg.runSeconds * 0.5 && s.agents.length < 6) {
      api.hire("senior");
    }
  },
};

/** Buy quality, run few bodies, click rarely. */
export const eliteOnly: Strategy = {
  name: "Quality over coverage",
  clicksPerSecond: 2.5,
  reactionSeconds: 0.35,
  triage: "richest-pod",
  decide(s, api) {
    fillPods(s, api, (a, b) => a.difficulty - b.difficulty);
    scatterIdle(s, api, (open) => {
      const counts = open.map((pod) => s.agents.filter((a) => a.pod === pod).length);
      return open[counts.indexOf(Math.min(...counts))];
    });
    for (let pod = 0; pod < s.pods.length; pod++) {
      if (s.pods[pod]) api.reason(pod, harvestMode(s) ? "high" : "medium");
    }
    keepTokensTopped(s, api, 80);
    // Quality over coverage means few, expensive-to-run bodies spread thin —
    // hiring more elites than there are pods just buys more crowding.
    if (s.t < s.cfg.runSeconds * 0.7 && s.agents.length < s.pods.length + 2) {
      api.hire("elite");
    }
  },
};

/** Cheap bodies, maximum coverage — the lever the design wants protected. */
export const swarmCheap: Strategy = {
  name: "Cheap coverage",
  clicksPerSecond: 2.5,
  reactionSeconds: 0.35,
  triage: "fifo",
  decide(s, api) {
    fillPods(s, api, (a, b) => a.difficulty - b.difficulty);
    scatterIdle(s, api, (open) => {
      const counts = open.map((pod) => s.agents.filter((a) => a.pod === pod).length);
      return open[counts.indexOf(Math.min(...counts))];
    });
    for (let pod = 0; pod < s.pods.length; pod++) {
      if (s.pods[pod]) api.reason(pod, harvestMode(s) ? "high" : "medium");
    }
    keepTokensTopped(s, api, 70);
    // Free hiring makes this the strategy it always wanted to be: coverage
    // is limited only by the roster cap and how much crowding you can stand.
    if (s.t < s.cfg.runSeconds * 0.7 && s.agents.length < 16) {
      api.hire("starter");
    }
  },
};

/** Never invests. The floor a run should beat. */
export const idleHands: Strategy = {
  name: "No investment (control)",
  clicksPerSecond: 2.5,
  reactionSeconds: 0.35,
  triage: "fifo",
  decide(s, api) {
    fillPods(s, api, (a, b) => b.payout - a.payout);
    scatterIdle(s, api, (open) => open[0]);
    keepTokensTopped(s, api, 60);
  },
};

export const STRATEGIES: Strategy[] = [
  balanced,
  swarmer,
  eliteOnly,
  swarmCheap,
  idleHands,
];

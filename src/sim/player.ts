import { ClassName, Dial } from "./config";
import { RunState, Project } from "./state";
import {
  acceptProject,
  assignAgent,
  buyCreditBlock,
  buyModelLicence,
  classUnlocked,
  hireAgent,
  retryAgent,
  setDial,
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
  dial(pod: number, d: Dial): void;
  buy(blockIndex: number): void;
  hire(cls: ClassName): void;
  /** Buy the model licence that makes a class hireable in the first place. */
  unlock(cls: ClassName): void;
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
      dial: (pod, d) => setDial(s, pod, d),
      buy: (b) => buyCreditBlock(s, b),
      hire: (c) => hireAgent(s, c),
      unlock: (c) => buyModelLicence(s, c),
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

function keepCreditsTopped(s: RunState, api: PlayerApi, targetSeconds: number) {
  const running = s.agents.filter((a) => a.state === "running").length;
  if (running === 0) return;
  const burnRate = running * s.cfg.credits.burnPerAgentSecond * 1.4;
  const runway = s.credits / Math.max(0.01, burnRate);
  if (runway > targetSeconds) return;
  const timeLeft = s.cfg.runSeconds - s.t;
  // Don't buy more runway than there is run left — leftover credits score zero.
  const blocks = s.cfg.credits.blocks;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const secondsBought = blocks[i].tokens / burnRate;
    if (secondsBought > timeLeft * 1.3 && i > 0) continue;
    if (s.cash >= blocks[i].price) {
      api.buy(i);
      return;
    }
  }
  // Broke: buy the smallest anyway. This is the poverty tax biting.
  api.buy(0);
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

/**
 * Walk a preference order of classes top-down and make at most one purchase.
 *
 * Classes are gated behind a model licence now, so "I want an elite" is two
 * transactions, not one. A strategy that wants the top of the ladder has to be
 * able to afford the licence AND the first body before it commits, or it will
 * strand cash on a licence it can't use. Buying the licence counts as this
 * decision's purchase — the hire lands on a later decision, once the money has
 * come back.
 */
function investLadder(
  s: RunState,
  api: PlayerApi,
  order: ClassName[],
  reserve: number
): void {
  const spare = s.cash - reserve;
  for (const cls of order) {
    const c = s.cfg.classes[cls];
    if (classUnlocked(s, cls)) {
      if (spare >= c.cost) {
        api.hire(cls);
        return;
      }
      continue;
    }
    if (spare >= c.licenceCost + c.cost) {
      api.unlock(cls);
      return;
    }
  }
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
      if (harvest) api.dial(pod, "fast");
      else {
        const decayed = 1 - p.payout / p.originalPayout;
        api.dial(pod, decayed > 0.3 ? "fast" : decayed > 0.12 ? "normal" : "slow");
      }
    }

    keepCreditsTopped(s, api, harvest ? 20 : 70);

    if (!harvest && s.t < s.cfg.runSeconds * 0.7) {
      const order: ClassName[] = ["elite", "senior"];
      if (s.agents.length < 8) order.push("starter");
      investLadder(s, api, order, 2500);
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
      if (s.pods[pod]) api.dial(pod, harvestMode(s) ? "fast" : "fast");
    }
    keepCreditsTopped(s, api, 60);
    if (s.t < s.cfg.runSeconds * 0.5) {
      investLadder(s, api, ["senior", "starter"], 6000);
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
      if (s.pods[pod]) api.dial(pod, harvestMode(s) ? "fast" : "normal");
    }
    keepCreditsTopped(s, api, 80);
    if (s.t < s.cfg.runSeconds * 0.7) {
      // Quality only: it climbs the licence ladder and never buys a starter,
      // so it stays short-handed for a long time before it pays off.
      investLadder(s, api, ["elite", "senior"], 4000);
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
      if (s.pods[pod]) api.dial(pod, harvestMode(s) ? "fast" : "normal");
    }
    keepCreditsTopped(s, api, 70);
    if (s.t < s.cfg.runSeconds * 0.7) {
      // Never licences anything: bodies are the whole plan.
      investLadder(s, api, ["starter"], 4000);
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
    keepCreditsTopped(s, api, 60);
  },
};

export const STRATEGIES: Strategy[] = [
  balanced,
  swarmer,
  eliteOnly,
  swarmCheap,
  idleHands,
];

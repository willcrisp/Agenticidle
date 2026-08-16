import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, cloneConfig } from "./config";
import {
  createRun,
  effectiveOneShot,
  tokenPriceMult,
  spawnProject,
  hallucinationTierIndex,
  podFailRate,
  HALLUCINATION_TIERS,
} from "./state";
import {
  tick,
  acceptProject,
  assignAgent,
  retryAgent,
  benchAgent,
  hireAgent,
  buyTokens,
  finalise,
} from "./tick";
import { simulateRun } from "../harness/run";
import { balanced } from "./player";

const step = (s: any, seconds: number) => {
  const dt = 1 / s.cfg.tickHz;
  for (let i = 0; i < seconds * s.cfg.tickHz; i++) tick(s, dt);
};

describe("determinism", () => {
  it("same seed and strategy produces an identical score", () => {
    const a = simulateRun(DEFAULT_CONFIG, balanced, "abc");
    const b = simulateRun(DEFAULT_CONFIG, balanced, "abc");
    expect(a.score).toBe(b.score);
    expect(a.deliveries).toBe(b.deliveries);
  });

  it("different seeds diverge", () => {
    const a = simulateRun(DEFAULT_CONFIG, balanced, "abc");
    const b = simulateRun(DEFAULT_CONFIG, balanced, "xyz");
    expect(a.score).not.toBe(b.score);
  });
});

describe("the clock ends the run", () => {
  it("finishes at exactly runSeconds and never after", () => {
    const s = simulateRun(DEFAULT_CONFIG, balanced, "clock");
    expect(s.finished).toBe(true);
    expect(s.t).toBeGreaterThanOrEqual(DEFAULT_CONFIG.runSeconds);
    expect(s.t).toBeLessThan(DEFAULT_CONFIG.runSeconds + 1);
  });

  it("there is no game over — debt never stops the run", () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.startingCash = -50_000;
    const s = simulateRun(cfg, balanced, "debt");
    expect(s.finished).toBe(true);
    expect(s.t).toBeGreaterThanOrEqual(cfg.runSeconds);
  });
});

describe("pro-rata on decayed value", () => {
  it("in-progress work pays completion % of the CURRENT payout, not the original", () => {
    const s = createRun(DEFAULT_CONFIG, "prorata");
    acceptProject(s, 0, 0);
    const p = s.pods[0]!;
    p.workDone = p.work / 2;
    step(s, 120); // let it decay
    expect(p.payout).toBeLessThan(p.originalPayout);

    const cashBefore = s.cash;
    const decayedHalf = p.payout * 0.5;
    const originalHalf = p.originalPayout * 0.5;
    finalise(s);
    const banked = s.cash - cashBefore;

    expect(banked).toBeCloseTo(decayedHalf, 0);
    expect(banked).toBeLessThan(originalHalf);
  });

  it("leftover tokens are worth nothing at the buzzer", () => {
    const a = createRun(DEFAULT_CONFIG, "tok");
    const b = createRun(DEFAULT_CONFIG, "tok");
    b.tokens += 99_999;
    finalise(a);
    finalise(b);
    expect(a.score).toBe(b.score);
  });
});

describe("agents", () => {
  it("a green run auto-starts the next without input", () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.classes.starter.oneShot = 1;
    cfg.difficulty.penaltyPerPip = 0;
    const s = createRun(cfg, "green");
    acceptProject(s, 0, 0);
    const a = s.agents.find((x) => x.cls === "starter")!;
    assignAgent(s, a.id, 0);
    step(s, cfg.classes.starter.runWork + 1);
    expect(a.state).toBe("running");
    expect(s.pods[0]!.workDone).toBeGreaterThan(0);
  });

  it("a red run blocks the agent and contributes nothing", () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.classes.starter.oneShot = 0;
    cfg.difficulty.floor = 0;
    cfg.difficulty.penaltyPerPip = 0;
    const s = createRun(cfg, "red");
    acceptProject(s, 0, 0);
    const a = s.agents.find((x) => x.cls === "starter")!;
    assignAgent(s, a.id, 0);
    step(s, cfg.classes.starter.runWork + 1);
    expect(a.state).toBe("blocked");
    expect(s.pods[0]!.workDone).toBe(0);
    expect(s.blockedQueue).toContain(a.id);
  });

  it("retry restarts the run from zero — lost time stays lost", () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.classes.starter.oneShot = 0;
    cfg.difficulty.floor = 0;
    cfg.difficulty.penaltyPerPip = 0;
    const s = createRun(cfg, "retry");
    acceptProject(s, 0, 0);
    const a = s.agents.find((x) => x.cls === "starter")!;
    assignAgent(s, a.id, 0);
    step(s, cfg.classes.starter.runWork + 1);
    retryAgent(s, a.id);
    expect(a.state).toBe("running");
    expect(a.progress).toBe(0);
  });

  it("idle agents burn nothing — benching is a survival move", () => {
    const s = createRun(DEFAULT_CONFIG, "bench");
    acceptProject(s, 0, 0);
    for (const a of s.agents) assignAgent(s, a.id, 0);
    const before = s.tokens;
    step(s, 5);
    const burned = before - s.tokens;
    expect(burned).toBeGreaterThan(0);

    for (const a of s.agents) benchAgent(s, a.id);
    const mid = s.tokens;
    step(s, 5);
    expect(s.tokens).toBe(mid);
  });

  it("delivering frees every agent on the project at once", () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.classes.starter.oneShot = 1;
    cfg.classes.senior.oneShot = 1;
    cfg.difficulty.penaltyPerPip = 0;
    const s = createRun(cfg, "free");
    acceptProject(s, 0, 0);
    s.pods[0]!.work = 12;
    for (const a of s.agents) assignAgent(s, a.id, 0);
    step(s, 40);
    expect(s.pods[0]).toBeNull();
    expect(s.agents.every((a) => a.state === "idle")).toBe(true);
    expect(s.deliveries).toBe(1);
  });
});

describe("hiring", () => {
  it("adds an idle agent of the requested class for free", () => {
    const s = createRun(DEFAULT_CONFIG, "hire");
    s.cash = 0;
    const before = s.agents.length;
    expect(hireAgent(s, "elite")).toBe(true);
    expect(s.agents.length).toBe(before + 1);
    const hired = s.agents[s.agents.length - 1]!;
    expect(hired.cls).toBe("elite");
    expect(hired.state).toBe("idle");
    expect(s.cash).toBe(0); // free — hiring never touches cash
  });

  it("refuses once the roster is at its cap", () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.maxRoster = cfg.startingRoster.length;
    cfg.startingCash = 1_000_000;
    const s = createRun(cfg, "hire-full");
    expect(hireAgent(s, "starter")).toBe(false);
    expect(s.agents.length).toBe(cfg.startingRoster.length);
  });

  it("a hired agent can join a swarm already on a project, same as any other", () => {
    const s = createRun(DEFAULT_CONFIG, "hire-swarm");
    acceptProject(s, 0, 0);
    for (const a of s.agents) assignAgent(s, a.id, 0);
    hireAgent(s, "starter");
    const hired = s.agents[s.agents.length - 1]!;
    expect(assignAgent(s, hired.id, 0)).toBe(true);
    expect(s.agents.filter((a) => a.pod === 0).length).toBe(s.agents.length);
  });
});

describe("no seats", () => {
  it("any number of agents can pile onto one project", () => {
    const s = createRun(DEFAULT_CONFIG, "swarm");
    acceptProject(s, 0, 0);
    for (const a of s.agents) expect(assignAgent(s, a.id, 0)).toBe(true);
    expect(s.agents.filter((a) => a.pod === 0).length).toBe(s.agents.length);
  });

  it("swarming costs proportionally more tokens", () => {
    const one = createRun(DEFAULT_CONFIG, "burn1");
    acceptProject(one, 0, 0);
    assignAgent(one, one.agents[0].id, 0);
    const b1 = one.tokens;
    step(one, 5);
    const burn1 = b1 - one.tokens;

    const many = createRun(DEFAULT_CONFIG, "burn1");
    acceptProject(many, 0, 0);
    for (const a of many.agents) assignAgent(many, a.id, 0);
    const b2 = many.tokens;
    step(many, 5);
    const burnMany = b2 - many.tokens;

    expect(burnMany).toBeGreaterThan(burn1 * 1.5);
  });

  it("swarming a project also raises everyone's error rate on it", () => {
    const solo = effectiveOneShot(DEFAULT_CONFIG, "starter", 1, 1);
    const crowded = effectiveOneShot(DEFAULT_CONFIG, "starter", 1, 5);
    expect(crowded).toBeLessThan(solo);
  });

  it("the crowding penalty stacks with the difficulty penalty and respects the same floor", () => {
    const s = effectiveOneShot(DEFAULT_CONFIG, "starter", 5, 8);
    expect(s).toBe(DEFAULT_CONFIG.difficulty.floor);
  });

  it("a second agent joining the pod can turn a guaranteed-green agent red", () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.classes.starter.oneShot = 1;
    cfg.difficulty.floor = 0;
    cfg.difficulty.penaltyPerPip = 0;
    cfg.crowding.penaltyPerExtraAgent = 1; // a second body on the pod guarantees red
    const s = createRun(cfg, "blocked-crowds");
    acceptProject(s, 0, 0);
    const [a, b] = s.agents;

    assignAgent(s, a!.id, 0);
    step(s, cfg.classes.starter.runWork + 1);
    expect(a!.state).toBe("running"); // alone on the pod: still guaranteed green
    expect(s.pods[0]!.workDone).toBeGreaterThan(0);

    // b joins — a hasn't done anything differently, but the pod is crowded now.
    assignAgent(s, b!.id, 0);
    step(s, cfg.classes.starter.runWork + 1);
    expect(a!.state).toBe("blocked"); // same agent, same job — crowding did this
    expect(b!.state).toBe("blocked");
  });
});

describe("hallucination rate", () => {
  it("has no reading on a pod nobody's been assigned to yet", () => {
    const s = createRun(DEFAULT_CONFIG, "hallu-empty");
    acceptProject(s, 0, 0);
    expect(podFailRate(s, 0)).toBeNull();
  });

  it("climbs as more agents pile onto the same pod", () => {
    const s = createRun(DEFAULT_CONFIG, "hallu-climb");
    acceptProject(s, 0, 0);
    assignAgent(s, s.agents[0]!.id, 0);
    const solo = podFailRate(s, 0)!;

    for (const a of s.agents.slice(1)) assignAgent(s, a.id, 0);
    const crowded = podFailRate(s, 0)!;

    expect(crowded).toBeGreaterThan(solo);
  });

  it("buckets a fail rate into LOW..EXTREME using the configured thresholds", () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.hallucination.tierThresholds = [0.25, 0.4, 0.55, 0.7];
    expect(HALLUCINATION_TIERS[hallucinationTierIndex(cfg, 0)]).toBe("LOW");
    expect(HALLUCINATION_TIERS[hallucinationTierIndex(cfg, 0.24)]).toBe("LOW");
    expect(HALLUCINATION_TIERS[hallucinationTierIndex(cfg, 0.25)]).toBe("MEDIUM");
    expect(HALLUCINATION_TIERS[hallucinationTierIndex(cfg, 0.4)]).toBe("HIGH");
    expect(HALLUCINATION_TIERS[hallucinationTierIndex(cfg, 0.55)]).toBe("VERY HIGH");
    expect(HALLUCINATION_TIERS[hallucinationTierIndex(cfg, 0.7)]).toBe("EXTREME");
    expect(HALLUCINATION_TIERS[hallucinationTierIndex(cfg, 1)]).toBe("EXTREME");
  });

  it("averages across mixed classes on the same pod, not just the newest arrival", () => {
    const cfg = cloneConfig(DEFAULT_CONFIG);
    cfg.difficulty.penaltyPerPip = 0;
    const s = createRun(cfg, "hallu-mixed"); // default roster: starter, starter, senior
    acceptProject(s, 0, 0);
    const senior = s.agents.find((a) => a.cls === "senior")!;
    const starter = s.agents.find((a) => a.cls === "starter")!;
    assignAgent(s, senior.id, 0);
    assignAgent(s, starter.id, 0);

    const rate = podFailRate(s, 0)!;
    const seniorFail = 1 - effectiveOneShot(cfg, "senior", 1, 2);
    const starterFail = 1 - effectiveOneShot(cfg, "starter", 1, 2);
    expect(rate).toBeCloseTo((seniorFail + starterFail) / 2, 10);
  });
});

describe("economy", () => {
  it("difficulty lowers effective one-shot for every class", () => {
    for (const cls of ["starter", "senior", "elite"] as const) {
      const easy = effectiveOneShot(DEFAULT_CONFIG, cls, 1);
      const hard = effectiveOneShot(DEFAULT_CONFIG, cls, 5);
      expect(hard).toBeLessThan(easy);
    }
  });

  it("a starter on a 5-pip job is a token bonfire versus an elite", () => {
    const starter = effectiveOneShot(DEFAULT_CONFIG, "starter", 5);
    const elite = effectiveOneShot(DEFAULT_CONFIG, "elite", 5);
    expect(elite / starter).toBeGreaterThan(1.5);
  });

  it("zero tokens stalls work while the payout keeps decaying", () => {
    const s = createRun(DEFAULT_CONFIG, "stall");
    s.tokens = 0;
    acceptProject(s, 0, 0);
    const p = s.pods[0]!;
    for (const a of s.agents) assignAgent(s, a.id, 0);
    const payBefore = p.payout;
    step(s, 30);
    expect(p.workDone).toBe(0);
    expect(s.agents.every((a) => a.progress === 0)).toBe(true);
    expect(p.payout).toBeLessThan(payBefore);
    expect(s.telemetry.stalledSeconds).toBeGreaterThan(25);
  });

  it("token prices fall with deliveries, not clock time", () => {
    const s = createRun(DEFAULT_CONFIG, "price");
    const start = tokenPriceMult(s);
    step(s, 300);
    expect(tokenPriceMult(s)).toBe(start);
    s.deliveries = 10;
    expect(tokenPriceMult(s)).toBeLessThan(start);
  });

  it("BUY MORE always buys the same flat lot, no matter how many times", () => {
    const s = createRun(DEFAULT_CONFIG, "buy");
    const cashBefore = s.cash;
    const tokensBefore = s.tokens;
    expect(buyTokens(s)).toBe(true);
    expect(s.tokens).toBe(tokensBefore + DEFAULT_CONFIG.tokens.lotSize);
    expect(s.cash).toBeLessThan(cashBefore);
    expect(s.tokensBought).toBe(DEFAULT_CONFIG.tokens.lotSize);
    expect(s.telemetry.moneySpentOnTokens).toBe(cashBefore - s.cash);

    const spentOnce = cashBefore - s.cash;
    buyTokens(s);
    // Second lot costs the same as the first — price only moves with
    // deliveries banked (tokenPriceMult), never with purchase count.
    expect(cashBefore - spentOnce - s.cash).toBe(spentOnce);
  });

  it("debt locks reasoning to LOW", () => {
    const s = createRun(DEFAULT_CONFIG, "lock");
    acceptProject(s, 0, 0);
    s.pods[0]!.reasoning = "high";
    s.cash = DEFAULT_CONFIG.debt.lowLockAt - 1;
    step(s, 1);
    expect(s.lowLocked).toBe(true);
    expect(s.pods[0]!.reasoning).toBe("low");
  });

  it("deep debt repossesses agents", () => {
    const s = createRun(DEFAULT_CONFIG, "repo");
    s.cash = DEFAULT_CONFIG.debt.repoAt - 1000;
    const before = s.agents.length;
    step(s, DEFAULT_CONFIG.debt.repoIntervalSeconds * 2 + 2);
    expect(s.agents.length).toBeLessThan(before);
    expect(s.telemetry.agentsRepossessed).toBeGreaterThan(0);
  });
});

describe("the board", () => {
  it("keeps refilling to the slot count", () => {
    const s = createRun(DEFAULT_CONFIG, "board");
    expect(s.board.length).toBe(DEFAULT_CONFIG.boardSlots);
    acceptProject(s, 0, 0);
    expect(s.board.length).toBe(DEFAULT_CONFIG.boardSlots - 1);
    step(s, DEFAULT_CONFIG.boardRefillSeconds + 2);
    expect(s.board.length).toBe(DEFAULT_CONFIG.boardSlots);
  });

  it("gets richer and harder over the run", () => {
    const s = createRun(DEFAULT_CONFIG, "escalate");
    const early = [...Array(40)].map(() => {
      const p = s.board[0];
      s.board.splice(0, 1);
      s.board.push(spawnProject(s));
      return p;
    });
    s.t = DEFAULT_CONFIG.runSeconds * 0.95;
    const late = [...Array(40)].map(() => spawnProject(s));

    const perWork = (arr: any[]) =>
      arr.reduce((a, p) => a + p.originalPayout / p.work, 0) / arr.length;
    const diff = (arr: any[]) => arr.reduce((a, p) => a + p.difficulty, 0) / arr.length;

    expect(perWork(late)).toBeGreaterThan(perWork(early));
    expect(diff(late)).toBeGreaterThan(diff(early));
  });

  it("also escalates from deliveries, independent of the clock", () => {
    const s = createRun(DEFAULT_CONFIG, "escalate-deliveries");
    const early = [...Array(40)].map(() => {
      const p = s.board[0];
      s.board.splice(0, 1);
      s.board.push(spawnProject(s));
      return p;
    });
    // Clock barely moved, but this player has banked a lot of work.
    s.deliveries = DEFAULT_CONFIG.escalation.deliveriesToMax;
    const late = [...Array(40)].map(() => spawnProject(s));

    const perWork = (arr: any[]) =>
      arr.reduce((a, p) => a + p.originalPayout / p.work, 0) / arr.length;
    const diff = (arr: any[]) => arr.reduce((a, p) => a + p.difficulty, 0) / arr.length;

    expect(perWork(late)).toBeGreaterThan(perWork(early));
    expect(diff(late)).toBeGreaterThan(diff(early));
  });

  it("starts cheap and easy: t=0, no deliveries yields the lowest pips", () => {
    const s = createRun(DEFAULT_CONFIG, "start-easy");
    const spawned = [...Array(60)].map(() => spawnProject(s));
    const avgDiff = spawned.reduce((a, p) => a + p.difficulty, 0) / spawned.length;
    expect(avgDiff).toBeLessThan(2);
  });
});

describe("the attention cap is a real constraint", () => {
  it("a slower player serves a smaller fraction of the clicks demanded", () => {
    const slow = simulateRun(DEFAULT_CONFIG, { ...balanced, clicksPerSecond: 0.5 }, "cap");
    const fast = simulateRun(DEFAULT_CONFIG, { ...balanced, clicksPerSecond: 6 }, "cap");
    const rate = (s: any) => {
      const t = s.telemetry;
      const d = t.clicksDemanded.reduce((a: number, b: number) => a + b, 0);
      const v = t.clicksServed.reduce((a: number, b: number) => a + b, 0);
      return v / Math.max(1, d);
    };
    expect(rate(slow)).toBeLessThan(rate(fast));
    expect(slow.telemetry.agentBlockedSeconds).toBeGreaterThan(
      fast.telemetry.agentBlockedSeconds
    );
  });
});

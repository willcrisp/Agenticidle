import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, cloneConfig, SIZE_ORDER } from "./config";
import {
  createRun,
  effectiveOneShot,
  tokenPriceMult,
  spawnProject,
  sizeUnlocked,
  deliveriesUntilSize,
} from "./state";
import {
  tick,
  acceptProject,
  assignAgent,
  retryAgent,
  benchAgent,
  finalise,
  hireAgent,
  buyModelLicence,
  classUnlocked,
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

  it("leftover credits are worth nothing at the buzzer", () => {
    const a = createRun(DEFAULT_CONFIG, "cred");
    const b = createRun(DEFAULT_CONFIG, "cred");
    b.credits += 99_999;
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
    const before = s.credits;
    step(s, 5);
    const burned = before - s.credits;
    expect(burned).toBeGreaterThan(0);

    for (const a of s.agents) benchAgent(s, a.id);
    const mid = s.credits;
    step(s, 5);
    expect(s.credits).toBe(mid);
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

describe("no seats", () => {
  it("any number of agents can pile onto one project", () => {
    const s = createRun(DEFAULT_CONFIG, "swarm");
    acceptProject(s, 0, 0);
    for (const a of s.agents) expect(assignAgent(s, a.id, 0)).toBe(true);
    expect(s.agents.filter((a) => a.pod === 0).length).toBe(s.agents.length);
  });

  it("swarming costs proportionally more credits", () => {
    const one = createRun(DEFAULT_CONFIG, "burn1");
    acceptProject(one, 0, 0);
    assignAgent(one, one.agents[0].id, 0);
    const b1 = one.credits;
    step(one, 5);
    const burn1 = b1 - one.credits;

    const many = createRun(DEFAULT_CONFIG, "burn1");
    acceptProject(many, 0, 0);
    for (const a of many.agents) assignAgent(many, a.id, 0);
    const b2 = many.credits;
    step(many, 5);
    const burnMany = b2 - many.credits;

    expect(burnMany).toBeGreaterThan(burn1 * 1.5);
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

  it("a starter on a 5-pip job is a credit bonfire versus an elite", () => {
    const starter = effectiveOneShot(DEFAULT_CONFIG, "starter", 5);
    const elite = effectiveOneShot(DEFAULT_CONFIG, "elite", 5);
    expect(elite / starter).toBeGreaterThan(1.5);
  });

  it("zero credits stalls work while the payout keeps decaying", () => {
    const s = createRun(DEFAULT_CONFIG, "stall");
    s.credits = 0;
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

  it("bigger blocks have a better per-token rate (the poverty tax)", () => {
    const blocks = DEFAULT_CONFIG.credits.blocks;
    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1].price / blocks[i - 1].tokens;
      const cur = blocks[i].price / blocks[i].tokens;
      expect(cur).toBeLessThan(prev);
    }
  });

  it("debt locks the dial to SLOW", () => {
    const s = createRun(DEFAULT_CONFIG, "lock");
    acceptProject(s, 0, 0);
    s.pods[0]!.dial = "fast";
    s.cash = DEFAULT_CONFIG.debt.slowLockAt - 1;
    step(s, 1);
    expect(s.slowLocked).toBe(true);
    expect(s.pods[0]!.dial).toBe("slow");
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
});

describe("the board ramps", () => {
  it("opens with nothing but the two smallest sizes, at one pip", () => {
    const s = createRun(DEFAULT_CONFIG, "ramp-open");
    const early = [...Array(200)].map(() => spawnProject(s));
    const sizes = new Set(early.map((p) => p.size));
    expect(sizes.has("medium")).toBe(false);
    expect(sizes.has("large")).toBe(false);
    expect(sizes.has("huge")).toBe(false);
    expect(Math.max(...early.map((p) => p.difficulty))).toBeLessThanOrEqual(2);
    // A first contract has to be something you can clear in a couple of runs.
    expect(Math.max(...early.map((p) => p.work))).toBeLessThanOrEqual(
      DEFAULT_CONFIG.sizes.small.work
    );
  });

  it("the opening offers are a fraction of the closing ones", () => {
    const s = createRun(DEFAULT_CONFIG, "ramp-money");
    const mean = (arr: { payout: number }[]) =>
      arr.reduce((a, p) => a + p.payout, 0) / arr.length;
    const early = mean([...Array(120)].map(() => spawnProject(s)));
    s.t = DEFAULT_CONFIG.runSeconds * 0.9;
    s.deliveries = 60;
    const late = mean([...Array(120)].map(() => spawnProject(s)));
    expect(late).toBeGreaterThan(early * 5);
  });

  it("big contracts unlock on the clock", () => {
    const s = createRun(DEFAULT_CONFIG, "ramp-clock");
    expect(sizeUnlocked(s, "huge")).toBe(false);
    s.t = DEFAULT_CONFIG.runSeconds * DEFAULT_CONFIG.sizes.huge.unlockAtRunFraction;
    expect(sizeUnlocked(s, "huge")).toBe(true);
  });

  it("...or on deliveries banked, whichever lands first", () => {
    const s = createRun(DEFAULT_CONFIG, "ramp-deliv");
    expect(sizeUnlocked(s, "large")).toBe(false);
    expect(deliveriesUntilSize(s, "large")).toBe(
      DEFAULT_CONFIG.sizes.large.unlockAtDeliveries
    );
    s.deliveries = DEFAULT_CONFIG.sizes.large.unlockAtDeliveries;
    expect(sizeUnlocked(s, "large")).toBe(true);
    expect(deliveriesUntilSize(s, "large")).toBe(0);
    expect(s.t).toBe(0); // the clock never moved — deliveries did this
  });

  it("every size is reachable by the buzzer", () => {
    const s = createRun(DEFAULT_CONFIG, "ramp-all");
    s.t = DEFAULT_CONFIG.runSeconds;
    for (const size of SIZE_ORDER) expect(sizeUnlocked(s, size)).toBe(true);
    const late = [...Array(300)].map(() => spawnProject(s));
    for (const size of SIZE_ORDER) {
      expect(late.some((p) => p.size === size)).toBe(true);
    }
  });
});

describe("model licences", () => {
  it("a class with no licence cannot be hired at any price", () => {
    const s = createRun(DEFAULT_CONFIG, "licence-gate");
    s.cash = 1_000_000;
    expect(classUnlocked(s, "elite")).toBe(false);
    expect(hireAgent(s, "elite")).toBe(false);
    expect(s.agents.some((a) => a.cls === "elite")).toBe(false);
    expect(s.cash).toBe(1_000_000);
  });

  it("buying the licence is what makes the class hireable", () => {
    const s = createRun(DEFAULT_CONFIG, "licence-buy");
    s.cash = 1_000_000;
    expect(buyModelLicence(s, "elite")).toBe(true);
    expect(classUnlocked(s, "elite")).toBe(true);
    expect(hireAgent(s, "elite")).toBe(true);
    expect(s.agents.some((a) => a.cls === "elite")).toBe(true);
    expect(s.cash).toBe(
      1_000_000 - DEFAULT_CONFIG.classes.elite.licenceCost - DEFAULT_CONFIG.classes.elite.cost
    );
  });

  it("a licence you cannot afford is not sold — unlike credits, it never lends", () => {
    const s = createRun(DEFAULT_CONFIG, "licence-broke");
    s.cash = DEFAULT_CONFIG.classes.senior.licenceCost - 1;
    expect(buyModelLicence(s, "senior")).toBe(false);
    expect(classUnlocked(s, "senior")).toBe(false);
    expect(s.cash).toBe(DEFAULT_CONFIG.classes.senior.licenceCost - 1);
  });

  it("the run starts with the free class only", () => {
    const s = createRun(DEFAULT_CONFIG, "licence-start");
    for (const cls of ["starter", "senior", "elite"] as const) {
      const free = DEFAULT_CONFIG.classes[cls].licenceCost <= 0;
      expect(classUnlocked(s, cls)).toBe(free);
    }
    expect(classUnlocked(s, "starter")).toBe(true);
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

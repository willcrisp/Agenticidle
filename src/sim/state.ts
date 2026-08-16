import { Config, ClassName, SizeName, Reasoning, DEFAULT_CONFIG } from "./config";
import { Rng } from "./rng";

export type AgentState = "idle" | "running" | "blocked";

export interface Agent {
  id: number;
  name: string;
  cls: ClassName;
  state: AgentState;
  /** Pod index, or null when idle. */
  pod: number | null;
  /** Work-seconds accrued into the current run. */
  progress: number;
  /** Wall-seconds this agent has spent blocked, total. */
  blockedTime: number;
  /** Sim-time this agent became blocked, for queue ordering. */
  blockedSince: number;
}

export interface Project {
  id: number;
  name: string;
  size: SizeName;
  /** Total work-seconds to reach 100%. */
  work: number;
  /** 1..5 */
  difficulty: number;
  /** Headline offer at spawn. */
  originalPayout: number;
  /** Decayed value right now. */
  payout: number;
  /** Work-seconds delivered so far. */
  workDone: number;
  /** Slices landed, for the segmented bar. */
  slices: number[];
  reasoning: Reasoning;
  /** Sim-time this was accepted onto the floor. */
  acceptedAt: number;
}

export interface RunState {
  cfg: Config;
  rng: Rng;
  seed: string;
  /** Sim-time elapsed, seconds. */
  t: number;
  finished: boolean;

  cash: number;
  credits: number;
  /** Cumulative tokens bought, for spend accounting. */
  creditsBought: number;
  deliveries: number;

  agents: Agent[];
  /** One slot per pod; null = empty pod. */
  pods: (Project | null)[];
  board: Project[];
  boardRefillAt: number;

  /** Agents waiting on a click, in the order they broke. */
  blockedQueue: number[];

  /** Forced to LOW reasoning by the credit limit. */
  lowLocked: boolean;
  lastRepoAt: number;

  score: number;
  telemetry: Telemetry;
}

export interface Telemetry {
  /** One bucket per 10 sim-seconds. */
  bucketSeconds: number;
  /** Clicks the game demanded of the player in each bucket. */
  clicksDemanded: number[];
  /** Clicks the player actually served. */
  clicksServed: number[];
  /** Mean number of agents sitting blocked, sampled per bucket. */
  blockedBacklog: number[];
  /** Cash at the end of each bucket. */
  cashCurve: number[];
  /** Credits at the end of each bucket. */
  creditCurve: number[];
  /** Seconds spent with zero credits and work outstanding. */
  stalledSeconds: number;
  /** Seconds spent in debt. */
  debtSeconds: number;
  agentsRepossessed: number;
  runsAttempted: number;
  runsFailed: number;
  /** Work-seconds thrown away by overflow past 100%. */
  overflowWasted: number;
  /** Total wall-seconds agents spent blocked. */
  agentBlockedSeconds: number;
  peakRoster: number;
  moneySpentOnCredits: number;
  moneySpentOnAgents: number;
}

const NAMES = [
  "PIXEL", "NIA", "HARU-7", "TAM", "SORA", "MIRA", "KODA", "ECHO", "VEX",
  "BYTE-9", "LUMA", "ONYX", "RIVET", "PIP", "AXEL", "NOVA", "DOT", "KEEN",
  "SABLE", "TILT", "WREN", "ZEPH", "CORVID", "FLUX",
];

const PROJECT_NOUNS = [
  "Billing migration", "Dashboard retainer", "Nuxt upgrade", "Flaky test triage",
  "Payments SDK rewrite", "Analytics event audit", "Auth service split",
  "Search reindex", "Mobile parity pass", "Webhook fan-out", "Legacy cron rescue",
  "Design token sweep", "Checkout regression", "Data warehouse backfill",
  "Notification overhaul", "Rate limiter rebuild",
];

let nextAgentId = 1;
let nextProjectId = 1;

export function createRun(cfg: Config = DEFAULT_CONFIG, seed = "seed-1"): RunState {
  const rng = new Rng(seed);
  nextAgentId = 1;
  nextProjectId = 1;

  const agents = cfg.startingRoster.map((cls) => makeAgent(cls, rng));

  const state: RunState = {
    cfg,
    rng,
    seed,
    t: 0,
    finished: false,
    cash: cfg.startingCash,
    credits: cfg.startingCredits,
    creditsBought: 0,
    deliveries: 0,
    agents,
    pods: new Array(cfg.podCount).fill(null),
    board: [],
    boardRefillAt: 0,
    blockedQueue: [],
    lowLocked: false,
    lastRepoAt: -999,
    score: 0,
    telemetry: emptyTelemetry(cfg),
  };

  for (let i = 0; i < cfg.boardSlots; i++) state.board.push(spawnProject(state));
  return state;
}

export function makeAgent(cls: ClassName, rng: Rng): Agent {
  return {
    id: nextAgentId++,
    name: NAMES[Math.floor(rng.next() * NAMES.length)],
    cls,
    state: "idle",
    pod: null,
    progress: 0,
    blockedTime: 0,
    blockedSince: 0,
  };
}

/** Escalation: how far through the run's difficulty/payout curve are we? */
export function escalationT(state: RunState): number {
  const raw = Math.min(1, state.t / state.cfg.runSeconds);
  const e = state.cfg.escalation;
  switch (e.shape) {
    case "stepped":
      return Math.floor(raw * e.steps) / Math.max(1, e.steps - 1);
    case "accelerating":
      return raw * raw;
    default:
      return raw;
  }
}

export function spawnProject(state: RunState): Project {
  const { cfg, rng } = state;
  const size = rng.weighted(cfg.sizeWeights);
  const sc = cfg.sizes[size];
  const k = escalationT(state);

  const payoutMult = 1 + (cfg.escalation.payoutEndMult - 1) * k;
  const diffTarget =
    cfg.escalation.difficultyStart +
    (cfg.escalation.difficultyEnd - cfg.escalation.difficultyStart) * k;
  const difficulty = Math.max(
    1,
    Math.min(5, Math.round(diffTarget + rng.range(-0.7, 0.7)))
  );

  // Harder jobs pay more; the board gets richer AND harder together.
  const diffBonus = 1 + (difficulty - 1) * 0.12;
  const payout = Math.round(
    sc.work * sc.payoutPerWork * payoutMult * diffBonus * rng.range(0.88, 1.12)
  );

  return {
    id: nextProjectId++,
    name: PROJECT_NOUNS[Math.floor(rng.next() * PROJECT_NOUNS.length)],
    size,
    work: sc.work,
    difficulty,
    originalPayout: payout,
    payout,
    workDone: 0,
    slices: [],
    reasoning: "medium",
    acceptedAt: 0,
  };
}

export function emptyTelemetry(cfg: Config): Telemetry {
  const buckets = Math.ceil(cfg.runSeconds / 10);
  return {
    bucketSeconds: 10,
    clicksDemanded: new Array(buckets).fill(0),
    clicksServed: new Array(buckets).fill(0),
    blockedBacklog: new Array(buckets).fill(0),
    cashCurve: new Array(buckets).fill(0),
    creditCurve: new Array(buckets).fill(0),
    stalledSeconds: 0,
    debtSeconds: 0,
    agentsRepossessed: 0,
    runsAttempted: 0,
    runsFailed: 0,
    overflowWasted: 0,
    agentBlockedSeconds: 0,
    peakRoster: cfg.startingRoster.length,
    moneySpentOnCredits: 0,
    moneySpentOnAgents: 0,
  };
}

/** Effective one-shot chance for this agent on this project. */
export function effectiveOneShot(
  cfg: Config,
  cls: ClassName,
  difficulty: number
): number {
  const base = cfg.classes[cls].oneShot;
  const penalty = cfg.difficulty.penaltyPerPip * (difficulty - 1);
  return Math.max(cfg.difficulty.floor, base - penalty);
}

/** Current token price multiplier — falls with deliveries, not clock time. */
export function tokenPriceMult(state: RunState): number {
  const { credits } = state.cfg;
  return Math.max(
    credits.priceFloorMult,
    1 - state.deliveries * credits.priceDropPerDelivery
  );
}

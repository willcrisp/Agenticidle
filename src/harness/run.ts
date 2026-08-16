import { Config } from "../sim/config";
import { createRun, RunState, Telemetry } from "../sim/state";
import { tick, finalise } from "../sim/tick";
import { Player, Strategy } from "../sim/player";

/** One full 30-minute run, headless, at the configured fixed timestep. */
export function simulateRun(cfg: Config, strat: Strategy, seed: string): RunState {
  const s = createRun(cfg, seed);
  const player = new Player(strat);
  const dt = 1 / cfg.tickHz;
  const maxSteps = Math.ceil(cfg.runSeconds * cfg.tickHz) + 2;

  for (let i = 0; i < maxSteps && !s.finished; i++) {
    player.step(s, dt);
    tick(s, dt);
    const bucket = Math.min(
      s.telemetry.cashCurve.length - 1,
      Math.floor(s.t / s.telemetry.bucketSeconds)
    );
    s.telemetry.cashCurve[bucket] = Math.round(s.cash);
    s.telemetry.tokenCurve[bucket] = Math.round(s.tokens);
  }
  finalise(s);
  return s;
}

export interface Stats {
  strategy: string;
  runs: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
  /** Spread as a fraction of the median — how swingy the game is. */
  spread: number;
  deliveries: number;
  failRate: number;
  /** Fraction of runs that ended in the red. */
  debtRate: number;
  stalledSeconds: number;
  peakClicksPerSecond: number;
  meanBacklog: number;
  /** Fraction of demanded clicks the player could actually serve. */
  clickServeRate: number;
  meanBlockedWait: number;
  finalRoster: number;
  demandCurve: number[];
  servedCurve: number[];
  backlogCurve: number[];
  cashCurve: number[];
}

export function batch(
  cfg: Config,
  strat: Strategy,
  runs = 200,
  seedPrefix = "s"
): Stats {
  const scores: number[] = [];
  const agg = {
    deliveries: 0,
    attempts: 0,
    fails: 0,
    debt: 0,
    stalled: 0,
    backlog: 0,
    blockedSeconds: 0,
    blockedEvents: 0,
    roster: 0,
    demanded: 0,
    served: 0,
  };
  const buckets = Math.ceil(cfg.runSeconds / 10);
  const demandCurve = new Array(buckets).fill(0);
  const servedCurve = new Array(buckets).fill(0);
  const backlogCurve = new Array(buckets).fill(0);
  const cashCurve = new Array(buckets).fill(0);
  let peakCps = 0;

  for (let i = 0; i < runs; i++) {
    const s = simulateRun(cfg, strat, `${seedPrefix}-${i}`);
    const t: Telemetry = s.telemetry;
    scores.push(s.score);
    agg.deliveries += s.deliveries;
    agg.attempts += t.runsAttempted;
    agg.fails += t.runsFailed;
    if (s.cash < 0) agg.debt++;
    agg.stalled += t.stalledSeconds;
    agg.blockedSeconds += t.agentBlockedSeconds;
    agg.blockedEvents += t.runsFailed;
    agg.roster += s.agents.length;

    for (let b = 0; b < buckets; b++) {
      demandCurve[b] += t.clicksDemanded[b];
      servedCurve[b] += t.clicksServed[b];
      backlogCurve[b] += t.blockedBacklog[b];
      cashCurve[b] += t.cashCurve[b];
      agg.demanded += t.clicksDemanded[b];
      agg.served += t.clicksServed[b];
      agg.backlog += t.blockedBacklog[b];
      peakCps = Math.max(peakCps, t.clicksDemanded[b] / t.bucketSeconds);
    }
  }

  for (let b = 0; b < buckets; b++) {
    demandCurve[b] /= runs * 10; // → clicks per second
    servedCurve[b] /= runs * 10;
    backlogCurve[b] /= runs;
    cashCurve[b] /= runs;
  }

  scores.sort((a, b) => a - b);
  const q = (p: number) => scores[Math.min(scores.length - 1, Math.floor(scores.length * p))];
  const median = q(0.5);

  return {
    strategy: strat.name,
    runs,
    mean: Math.round(scores.reduce((a, b) => a + b, 0) / runs),
    median,
    p10: q(0.1),
    p90: q(0.9),
    min: scores[0],
    max: scores[scores.length - 1],
    spread: median !== 0 ? (q(0.9) - q(0.1)) / Math.abs(median) : 0,
    deliveries: +(agg.deliveries / runs).toFixed(1),
    failRate: +(agg.fails / Math.max(1, agg.attempts)).toFixed(3),
    debtRate: +(agg.debt / runs).toFixed(2),
    stalledSeconds: +(agg.stalled / runs).toFixed(1),
    peakClicksPerSecond: +peakCps.toFixed(2),
    meanBacklog: +(agg.backlog / (runs * buckets)).toFixed(2),
    clickServeRate: +(agg.served / Math.max(1, agg.demanded)).toFixed(3),
    meanBlockedWait: +(agg.blockedSeconds / Math.max(1, agg.blockedEvents)).toFixed(2),
    finalRoster: +(agg.roster / runs).toFixed(1),
    demandCurve,
    servedCurve,
    backlogCurve,
    cashCurve,
  };
}

/** Move one lever across a range and report how the score responds. */
export function sweep(
  base: Config,
  strat: Strategy,
  label: string,
  apply: (c: Config, v: number) => void,
  values: number[],
  runs = 80
): { value: number; stats: Stats }[] {
  return values.map((v) => {
    const cfg: Config = JSON.parse(JSON.stringify(base));
    apply(cfg, v);
    return { value: v, stats: batch(cfg, strat, runs, `${label}-${v}`) };
  });
}

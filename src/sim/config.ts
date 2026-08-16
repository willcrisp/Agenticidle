/**
 * Agent Idol — every tunable number lives here and nowhere else.
 *
 * Nothing in this file is a design decision that has been signed off. These are
 * starting values chosen to be *plausible*, so the harness has something to
 * chew on. Expect all of them to move.
 */

export type ClassName = "starter" | "senior" | "elite";
export type SizeName = "small" | "medium" | "large" | "huge";
/** How hard the agents on a pod are told to think. */
export type Reasoning = "low" | "medium" | "high";

export interface AgentClassConfig {
  /** Work-seconds delivered by one successful run. Also sets slice size. */
  runWork: number;
  /** Base chance a run resolves green, before difficulty and crowding. 0..1 */
  oneShot: number;
  /** Multiplier on credit burn while running. 1 = baseline. */
  burnMult: number;
}

export interface SizeConfig {
  /** Total work-seconds to reach 100%. */
  work: number;
  /** Payout = work * payoutPerWork, before escalation. */
  payoutPerWork: number;
}

export interface Config {
  runSeconds: number;
  tickHz: number;
  startingCash: number;
  startingCredits: number;
  /** Roster you begin the run with (reputation buys this between runs). */
  startingRoster: ClassName[];
  maxRoster: number;
  /** Pods on the floor. */
  podCount: number;
  /** Cards on the board at once. */
  boardSlots: number;
  boardRefillSeconds: number;

  classes: Record<ClassName, AgentClassConfig>;
  sizes: Record<SizeName, SizeConfig>;
  /**
   * Relative frequency of each size appearing on the board, at the very
   * start of the run (k=0) and at full escalation (k=1). Interpolated by
   * the same escalation curve as payout and difficulty, so the board
   * starts small-job-heavy and only starts offering large/huge work once
   * escalation has actually moved — a seeded run shouldn't be able to
   * open on a huge-payout job.
   */
  sizeWeightsStart: Record<SizeName, number>;
  sizeWeightsEnd: Record<SizeName, number>;

  difficulty: {
    /** One-shot penalty per pip above 1. Subtractive. */
    penaltyPerPip: number;
    /** One-shot can never fall below this. */
    floor: number;
  };

  crowding: {
    /**
     * One-shot penalty per agent stacked on a project beyond the first.
     * Subtractive, same shape as the difficulty penalty, and stacks with it.
     * Hiring is free — this, plus each extra agent's own credit burn, is the
     * whole brake on swarming. No seat limit; a bad idea just gets worse the
     * harder you lean on it.
     */
    penaltyPerExtraAgent: number;
  };

  hallucination: {
    /**
     * The fail-rate readout on a project card, labelled LOW / MEDIUM / HIGH /
     * VERY HIGH / EXTREME. Four ascending thresholds (0..1) carve the five
     * bands — a fail rate below the first threshold reads LOW, at or above
     * the last reads EXTREME. This is what makes crowding legible without a
     * number: the player sees the label climb as they pile agents on.
     */
    tierThresholds: [number, number, number, number];
  };

  decay: {
    /**
     * Renegotiation, not drain: payout holds perfectly flat while a project is
     * inside its deadline window, then steps down once the window is missed and
     * the client renegotiates. Seconds of grace before the FIRST miss, at a
     * zero-work job — see intervalPerWork for how bigger jobs get more.
     */
    baseIntervalSeconds: number;
    /**
     * Extra seconds of grace per work-second of job size, added to
     * baseIntervalSeconds. Bigger jobs are slower by nature, so they get a
     * longer window per miss — this is the "some need to be done fast, some
     * have slower timers" axis.
     */
    intervalPerWork: number;
    /** Fraction of the ORIGINAL payout lost at difficulty 1 on each missed deadline. */
    basePenaltyFraction: number;
    /**
     * Extra penalty fraction per difficulty pip above 1. Harder jobs punish a
     * miss harder — this is the "but punish you harder" axis, independent of
     * the timer length above.
     */
    penaltyPerDifficultyPip: number;
    /** Payout never decays below this fraction of original, no matter how many misses. */
    floor: number;
  };

  /**
   * The reasoning dial. Thinking harder gets through the work faster and costs
   * proportionally more tokens; `speed` multiplies work-seconds accrued,
   * `burn` multiplies credit spend.
   */
  reasoning: Record<Reasoning, { speed: number; burn: number }>;

  credits: {
    /** Tokens per second per running agent at MEDIUM, burnMult 1. */
    burnPerAgentSecond: number;
    /** Does a blocked agent keep burning while it waits for a click? */
    blockedAgentsBurn: boolean;
    /** Blocks the player can buy: bigger = better rate. */
    blocks: { tokens: number; price: number }[];
    /** Token prices fall as projects are delivered. */
    priceDropPerDelivery: number;
    priceFloorMult: number;
  };

  debt: {
    /** Interest per second on negative cash, as a fraction. */
    interestPerSecond: number;
    /** Cash below this forces every pod down to LOW reasoning. */
    lowLockAt: number;
    /** Cash below this starts repossessing agents. */
    repoAt: number;
    repoIntervalSeconds: number;
  };

  escalation: {
    shape: "linear" | "stepped" | "accelerating";
    /** Payout multiplier reached at the end of the run. */
    payoutEndMult: number;
    /** Difficulty pips at the very start and at full escalation (fractional, rounded on spawn). */
    difficultyStart: number;
    difficultyEnd: number;
    /** For 'stepped': how many steps across the run. */
    steps: number;
    /**
     * Deliveries needed to reach full escalation on your own, independent of
     * the clock. Whichever driver — elapsed time or deliveries banked — is
     * further along wins, so a prolific player gets outrun by their own
     * throughput even with half the clock left.
     */
    deliveriesToMax: number;
  };

  /** A failed run contributes 0% but has already burned its credits. */
  failedRunsCostCredits: boolean;
  /** Slice overflow past 100% is discarded (a hidden crowding penalty if true). */
  discardOverflow: boolean;
}

export const DEFAULT_CONFIG: Config = {
  runSeconds: 1800,
  tickHz: 30,
  startingCash: 5000,
  startingCredits: 900,
  startingRoster: ["starter", "starter", "senior"],
  maxRoster: 24,
  podCount: 4,
  boardSlots: 3,
  boardRefillSeconds: 4,

  classes: {
    starter: { runWork: 6, oneShot: 0.62, burnMult: 1.0 },
    senior: { runWork: 9, oneShot: 0.76, burnMult: 1.3 },
    elite: { runWork: 15, oneShot: 0.88, burnMult: 1.7 },
  },

  sizes: {
    small: { work: 50, payoutPerWork: 11 },
    medium: { work: 100, payoutPerWork: 13 },
    large: { work: 200, payoutPerWork: 15 },
    huge: { work: 400, payoutPerWork: 17 },
  },
  // At k=0 the board is almost entirely small/medium (a seeded run's first
  // jobs should read as $500-1000, not a huge-sized payday). Large and huge
  // phase in as escalation climbs, reaching the old flat distribution by k=1.
  sizeWeightsStart: { small: 8, medium: 3, large: 0, huge: 0 },
  sizeWeightsEnd: { small: 3, medium: 4, large: 2, huge: 1 },

  difficulty: { penaltyPerPip: 0.09, floor: 0.15 },

  crowding: { penaltyPerExtraAgent: 0.04 },

  hallucination: { tierThresholds: [0.25, 0.4, 0.55, 0.7] },

  decay: {
    baseIntervalSeconds: 40,
    intervalPerWork: 0.2,
    basePenaltyFraction: 0.12,
    penaltyPerDifficultyPip: 0.03,
    floor: 0.12,
  },

  reasoning: {
    low: { speed: 0.6, burn: 0.45 },
    medium: { speed: 1.0, burn: 1.0 },
    high: { speed: 1.7, burn: 2.4 },
  },

  credits: {
    burnPerAgentSecond: 3.0,
    blockedAgentsBurn: false,
    blocks: [
      { tokens: 500, price: 750 },
      { tokens: 1500, price: 2050 },
      { tokens: 5000, price: 6250 },
      { tokens: 15000, price: 17250 },
    ],
    priceDropPerDelivery: 0.03,
    priceFloorMult: 0.45,
  },

  debt: {
    interestPerSecond: 0.0004,
    lowLockAt: -3000,
    repoAt: -12000,
    repoIntervalSeconds: 20,
  },

  escalation: {
    shape: "linear",
    payoutEndMult: 3.2,
    difficultyStart: 1.0,
    difficultyEnd: 4.6,
    steps: 5,
    deliveriesToMax: 40,
  },

  failedRunsCostCredits: true,
  discardOverflow: false,
};

export function cloneConfig(c: Config): Config {
  return JSON.parse(JSON.stringify(c));
}

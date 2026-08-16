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
  /** Relative frequency of each size appearing on the board. */
  sizeWeights: Record<SizeName, number>;

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

  decay: {
    /** Fraction of the ORIGINAL payout lost per second, once accepted. */
    perSecond: number;
    /** Payout never decays below this fraction of original. */
    floor: number;
    /** Larger jobs decay slower (they're longer by nature). 0 = off. */
    sizeDamping: number;
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
    /** Difficulty pips at t=0 and at t=end (fractional, rounded on spawn). */
    difficultyStart: number;
    difficultyEnd: number;
    /** For 'stepped': how many steps across the run. */
    steps: number;
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
    small: { work: 50, payoutPerWork: 22 },
    medium: { work: 100, payoutPerWork: 26 },
    large: { work: 200, payoutPerWork: 30 },
    huge: { work: 400, payoutPerWork: 34 },
  },
  sizeWeights: { small: 3, medium: 4, large: 2, huge: 1 },

  difficulty: { penaltyPerPip: 0.09, floor: 0.15 },

  crowding: { penaltyPerExtraAgent: 0.04 },

  decay: { perSecond: 0.0022, floor: 0.12, sizeDamping: 0.35 },

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
    difficultyStart: 1.4,
    difficultyEnd: 4.6,
    steps: 5,
  },

  failedRunsCostCredits: true,
  discardOverflow: false,
};

export function cloneConfig(c: Config): Config {
  return JSON.parse(JSON.stringify(c));
}

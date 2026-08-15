/**
 * Agent Idol — every tunable number lives here and nowhere else.
 *
 * Nothing in this file is a design decision that has been signed off. These are
 * starting values chosen to be *plausible*, so the harness has something to
 * chew on. Expect all of them to move.
 */

export type ClassName = "starter" | "senior" | "elite";
export type SizeName = "tiny" | "small" | "medium" | "large" | "huge";
export type Dial = "slow" | "normal" | "fast";

export interface AgentClassConfig {
  /** Shop name. Display only — never branch on it. */
  label: string;
  /** One line in the shop about what this model is for. Display only. */
  blurb: string;
  /** Work-seconds delivered by one successful run. Also sets slice size. */
  runWork: number;
  /** Base chance a run resolves green, before difficulty. 0..1 */
  oneShot: number;
  /** Hire cost, mid-run. */
  cost: number;
  /** Multiplier on credit burn while running. 1 = baseline. */
  burnMult: number;
  /**
   * One-off price to make this class hireable at all — the "invest in a better
   * model" lever. 0 = hireable from the first second of the run.
   */
  licenceCost: number;
}

export interface SizeConfig {
  /** Board label. Display only. */
  label: string;
  /** Total work-seconds to reach 100%. */
  work: number;
  /** Payout = work * payoutPerWork, before escalation. */
  payoutPerWork: number;
  /**
   * Added to the escalation difficulty target before rounding. Keeps the small
   * jobs approachable all run, and stops a flagship ever looking trivial.
   */
  difficultyBias: number;
  /** Relative frequency on the board at t=0... */
  weightEarly: number;
  /** ...and at the buzzer. Lerped by the escalation curve in between. */
  weightLate: number;
  /**
   * Fraction of the run that must elapse before this size can appear at all.
   * 0 = on the board from the first second.
   */
  unlockAtRunFraction: number;
  /** ...or this many deliveries banked, whichever lands first. */
  unlockAtDeliveries: number;
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

  difficulty: {
    /** One-shot penalty per pip above 1. Subtractive. */
    penaltyPerPip: number;
    /** One-shot can never fall below this. */
    floor: number;
  };

  decay: {
    /** Fraction of the ORIGINAL payout lost per second, once accepted. */
    perSecond: number;
    /** Payout never decays below this fraction of original. */
    floor: number;
    /** Larger jobs decay slower (they're longer by nature). 0 = off. */
    sizeDamping: number;
  };

  dials: Record<Dial, { speed: number; burn: number }>;

  credits: {
    /** Tokens per second per running agent at NORMAL, burnMult 1. */
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
    /** Cash below this forces every dial to SLOW. */
    slowLockAt: number;
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
  startingCash: 2500,
  startingCredits: 900,
  // You start with two cheap bodies and no licence for anything better. The
  // whole ladder — more hands, then better models, then bigger contracts — is
  // bought with money earned inside the run.
  startingRoster: ["starter", "starter"],
  maxRoster: 24,
  podCount: 4,
  boardSlots: 3,
  boardRefillSeconds: 4,

  classes: {
    starter: {
      label: "STARTER",
      blurb: "Cheap hands. Breaks often, costs almost nothing to run.",
      runWork: 6,
      oneShot: 0.62,
      cost: 1400,
      burnMult: 1.0,
      licenceCost: 0,
    },
    senior: {
      label: "SENIOR",
      blurb: "Longer runs, fewer questions. Costs more to keep running.",
      runWork: 9,
      oneShot: 0.76,
      cost: 5200,
      burnMult: 1.3,
      licenceCost: 4500,
    },
    elite: {
      label: "ELITE",
      blurb: "Barely ever blocks. Burns tokens like a furnace.",
      runWork: 15,
      oneShot: 0.88,
      cost: 15000,
      burnMult: 1.7,
      licenceCost: 18000,
    },
  },

  // The board ramps. Only the two smallest sizes exist at the start of a run;
  // the rest unlock on the clock OR on deliveries banked, whichever comes
  // first, so a fast opening is rewarded with a bigger board sooner. The
  // weights then lerp from `weightEarly` to `weightLate` across the run, which
  // is what retires the quick fixes rather than a hard cutoff.
  sizes: {
    tiny: {
      label: "QUICK FIX",
      work: 16,
      payoutPerWork: 18,
      difficultyBias: -0.9,
      weightEarly: 7,
      weightLate: 0.5,
      unlockAtRunFraction: 0,
      unlockAtDeliveries: 0,
    },
    small: {
      label: "SMALL JOB",
      work: 45,
      payoutPerWork: 21,
      difficultyBias: -0.35,
      weightEarly: 4,
      weightLate: 1.5,
      unlockAtRunFraction: 0,
      unlockAtDeliveries: 0,
    },
    medium: {
      label: "MEDIUM JOB",
      work: 110,
      payoutPerWork: 24,
      difficultyBias: 0,
      weightEarly: 0.6,
      weightLate: 4,
      unlockAtRunFraction: 0.1,
      unlockAtDeliveries: 5,
    },
    large: {
      label: "LARGE JOB",
      work: 240,
      payoutPerWork: 27,
      difficultyBias: 0.4,
      weightEarly: 0.2,
      weightLate: 3,
      unlockAtRunFraction: 0.28,
      unlockAtDeliveries: 14,
    },
    huge: {
      label: "FLAGSHIP",
      work: 500,
      payoutPerWork: 30,
      difficultyBias: 0.9,
      weightEarly: 0.1,
      weightLate: 1.5,
      unlockAtRunFraction: 0.5,
      unlockAtDeliveries: 26,
    },
  },

  difficulty: { penaltyPerPip: 0.09, floor: 0.15 },

  decay: { perSecond: 0.0022, floor: 0.12, sizeDamping: 0.35 },

  dials: {
    slow: { speed: 0.6, burn: 0.45 },
    normal: { speed: 1.0, burn: 1.0 },
    fast: { speed: 1.7, burn: 2.4 },
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
    slowLockAt: -3000,
    repoAt: -12000,
    repoIntervalSeconds: 20,
  },

  escalation: {
    shape: "linear",
    payoutEndMult: 3.2,
    difficultyStart: 1.0,
    difficultyEnd: 4.6,
    steps: 5,
  },

  failedRunsCostCredits: true,
  discardOverflow: false,
};

/** Declaration order, which is also the ladder order shown in the UI. */
export const SIZE_ORDER: readonly SizeName[] = ["tiny", "small", "medium", "large", "huge"];
export const CLASS_ORDER: readonly ClassName[] = ["starter", "senior", "elite"];

export function cloneConfig(c: Config): Config {
  return JSON.parse(JSON.stringify(c));
}

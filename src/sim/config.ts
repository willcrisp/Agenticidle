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
  /** Multiplier on token burn while running. 1 = baseline. */
  burnMult: number;
  /** Player-facing name shown on the sprite/card. Render reads this; the ClassName key stays stable. */
  label: string;
  /** Intelligence rank, army-badge chevrons — more chevrons = smarter. Render draws this many pips. */
  chevrons: number;
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
  /** Tokens the reserve starts a run with. Drains, never refills on its own. */
  startingTokens: number;
  /** Roster you begin the run with (reputation buys this between runs). */
  startingRoster: ClassName[];
  maxRoster: number;
  /**
   * Hard cap on agents stacked on a single pod at once. There's no seat
   * *cost* below this — the crowding penalty and credit burn already tax
   * every extra body — but past it the desks stop being legible on screen,
   * so ADD just stops working. Sized to what the shrink-as-you-add art in
   * `src/render/agent.ts` was built to handle.
   */
  maxAgentsPerPod: number;
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
     * Hiring is free — this, plus each extra agent's own token burn, is the
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
    /** seconds-to-deadline below which the card's countdown shows urgency (render-only; the sim never reads it). */
    deadlineWarnSeconds: number;
  };

  /**
   * The reasoning dial. Thinking harder no longer changes how fast work
   * accrues — every agent of a class takes the same time on a run regardless
   * of reasoning. Instead it trades tokens for accuracy: `oneShotBonus` is
   * ADDED to the agent's effective one-shot chance (positive = fewer
   * hallucinations/errors, negative = more), and `burn` multiplies token spend.
   */
  reasoning: Record<Reasoning, { oneShotBonus: number; burn: number }>;

  tokens: {
    /** Tokens per second per running agent at MEDIUM, burnMult 1. */
    burnPerAgentSecond: number;
    /** Does a blocked agent keep burning while it waits for a click? */
    blockedAgentsBurn: boolean;
    /**
     * BUY MORE always buys the same lot — a flat top-up, no picker, no
     * ceiling on how many you can stack. Just cash for tokens, over and over.
     */
    lotSize: number;
    /** Cash cost of one lot, before the delivery discount below. */
    lotPrice: number;
    /** Lot price falls as projects are delivered. */
    priceDropPerDelivery: number;
    priceFloorMult: number;
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

  /** A failed run contributes 0% but has already burned its tokens. */
  failedRunsCostTokens: boolean;
  /** Slice overflow past 100% is discarded (a hidden crowding penalty if true). */
  discardOverflow: boolean;
}

export const DEFAULT_CONFIG: Config = {
  runSeconds: 1800,
  tickHz: 30,
  startingCash: 5000,
  startingTokens: 100_000,
  startingRoster: ["starter", "starter", "senior"],
  maxRoster: 24,
  maxAgentsPerPod: 15,
  podCount: 4,
  boardSlots: 6,
  boardRefillSeconds: 4,

  classes: {
    // label/chevrons are player-facing dressing (nobody's signed off the
    // names either); the "starter"/"senior"/"elite" keys are the stable API.
    // runWork is deliberately short (agents cycle ~2x faster than the first
    // pass) and oneShot deliberately lower: fast, failure-prone runs are what
    // push peak retry demand past the player's hands, so "you are the
    // bottleneck" actually binds. Reasoning effort buys the accuracy back.
    starter: { runWork: 2, oneShot: 0.52, burnMult: 1.0, label: "Haikuu", chevrons: 1 },
    senior: { runWork: 3, oneShot: 0.66, burnMult: 1.3, label: "Sonneteer", chevrons: 2 },
    elite: { runWork: 5, oneShot: 0.78, burnMult: 1.7, label: "Opulent", chevrons: 3 },
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
    deadlineWarnSeconds: 8,
  },

  // Reasoning trades tokens for accuracy now, not speed. oneShotBonus is added
  // to the run's one-shot chance; burn multiplies token spend. Starting guesses,
  // nobody's signed off: LOW is cheap but hallucinates more, HIGH is dear but
  // steadier.
  reasoning: {
    low: { oneShotBonus: -0.12, burn: 0.5 },
    medium: { oneShotBonus: 0, burn: 1.0 },
    high: { oneShotBonus: 0.1, burn: 2.4 },
  },

  tokens: {
    burnPerAgentSecond: 300,
    blockedAgentsBurn: false,
    lotSize: 100_000,
    lotPrice: 500,
    priceDropPerDelivery: 0.03,
    priceFloorMult: 0.45,
  },

  escalation: {
    shape: "linear",
    payoutEndMult: 3.2,
    difficultyStart: 1.0,
    difficultyEnd: 4.6,
    steps: 5,
    deliveriesToMax: 40,
  },

  failedRunsCostTokens: true,
  discardOverflow: false,
};

export function cloneConfig(c: Config): Config {
  return JSON.parse(JSON.stringify(c));
}

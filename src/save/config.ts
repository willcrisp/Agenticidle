/**
 * Save-layer tunables — every number the identity/persistence layer uses lives
 * here, mirroring the convention in `src/sim/config.ts`.
 *
 * These are deliberately NOT in the sim config. That file is serialised into
 * the balance harness and the tuning dashboard, and it describes the *game*;
 * none of these values change how a run plays. The rule in CLAUDE.md exists to
 * keep magic numbers out of tick/render/fx, and the save layer is none of
 * those.
 */

/** localStorage key holding the versioned save blob. */
export const LOCAL_SAVE_KEY = "agent-idol.save.v1";

/** localStorage key holding this browser's studio key, in plaintext. */
export const LOCAL_KEY_KEY = "agent-idol.key.v1";

/** Schema version. Bump when the shape changes; loads of other versions reset. */
export const SAVE_VERSION = 1 as const;

/**
 * Words drawn per generated key.
 *
 * Drawn without replacement from a 256-word list, so this is 256·255·254·253 ≈
 * 4.2e9 combinations — just under 32 bits. Combined with server-side rate
 * limiting, guessing your way into someone else's studio is not a realistic
 * attack. Raising this to 5 costs one more word to type and buys a factor of
 * ~250.
 *
 * Must stay well below the wordlist length: generation draws distinct words, so
 * a value near 256 would spin on collisions.
 */
export const KEY_WORDS = 4;

/** Separator between words in a generated key. Cosmetic — parsing is lenient. */
export const KEY_SEPARATOR = "-";

/**
 * Minimum length for a player-chosen key, after normalisation. Custom keys are
 * the one place weak credentials can enter the system, so this is the floor
 * that stops `agent` or `test` from ever being accepted.
 */
export const MIN_CUSTOM_KEY_LENGTH = 12;

/** How many best-run entries to keep, highest score first. */
export const BEST_RUNS_KEPT = 10;

/**
 * Longest display name accepted. Long enough for a real handle, short enough
 * that one player cannot blow the leaderboard layout apart.
 */
export const MAX_NAME_LENGTH = 18;

/** Name used on the leaderboard by a player who has not set one. */
export const DEFAULT_NAME = "ANONYMOUS";

/** Rows fetched for the high scores table. */
export const LEADERBOARD_LIMIT = 25;

/** Requests to the save API that fail are retried this many times. */
export const REMOTE_RETRIES = 2;

/** Milliseconds before a save API request is abandoned. */
export const REMOTE_TIMEOUT_MS = 8000;

/** Base for retry backoff, in milliseconds. Doubles each attempt. */
export const REMOTE_BACKOFF_MS = 400;

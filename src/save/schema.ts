/**
 * The save blob and its guarded loader.
 *
 * Shape is the one specified in `docs/agentidoltechstack.pdf` §7, kept
 * field-for-field so the shop and reputation work (steps 5 and 7-9) drops into
 * it without a migration:
 *
 *     type Save = {
 *       v: 1;
 *       reputation: number;
 *       unlocked: string[];
 *       roster: { class: string }[];
 *       best: { score: number; seed: string }[];
 *     };
 *
 * Two additions, both additive and defaulted, so `v` stays at 1:
 *
 *   runs  §8 of the handover makes the tutorial run 1 only ("Re-teaching for
 *         five minutes on run 12 is unplayable"), which is unimplementable
 *         without knowing how many runs you have played.
 *   name  the leaderboard needs something to print. It is a display name, not
 *         an account: not unique, not verified, and not a credential.
 *
 * What is NOT here, on purpose: a run in progress. Tech stack §7 — "A run in
 * progress is not saved — the clock is the point." Resuming a timed
 * score-attack from a snapshot would make the one number at the end meaningless.
 */

import { BEST_RUNS_KEPT, DEFAULT_NAME, MAX_NAME_LENGTH, SAVE_VERSION } from "./config";

/** Agent classes that may legally appear in a saved roster. */
const KNOWN_CLASSES = ["starter", "senior", "elite"];

export interface BestRun {
  score: number;
  seed: string;
}

export interface RosterEntry {
  class: string;
}

export interface Save {
  v: typeof SAVE_VERSION;
  /** Permanent meta-currency. Final cash converts to this — handover §8. */
  reputation: number;
  /** Ids from the unlock catalogue the player has bought. */
  unlocked: string[];
  /** Agents the next run starts with. */
  roster: RosterEntry[];
  /** Best runs, highest score first, trimmed to BEST_RUNS_KEPT. */
  best: BestRun[];
  /** Completed runs. Gates the run-1-only tutorial. */
  runs: number;
  /** Display name on the leaderboard. Not an account, not unique. */
  name: string;
}

export function emptySave(): Save {
  return {
    v: SAVE_VERSION,
    reputation: 0,
    unlocked: [],
    roster: [],
    best: [],
    runs: 0,
    name: "",
  };
}

/**
 * Cleans a display name for storage and for a leaderboard row.
 *
 * Control characters and the bidirectional-override codepoints are stripped:
 * those are the ones that let a name reorder or overwrite the text around it in
 * a table. Everything else — including non-Latin scripts — is left alone.
 * Rendering is always via textContent, so this is defence in depth, not the
 * only thing standing between a name and the DOM.
 *
 * The server re-runs the equivalent of this on submission. Cleaning here is for
 * the player's benefit; cleaning there is because the result is shown to
 * everyone else.
 */
export function cleanName(raw: string): string {
  return (
    raw
      // Whitespace collapses FIRST. Tabs and newlines are control characters
      // too, and stripping them before this ran would silently weld words
      // together — "tab\there" becoming "tabhere" rather than "tab here".
      .replace(/\s+/g, " ")
      // What is left of the control range, plus zero-width characters and the
      // bidirectional overrides: the codepoints that let a name reorder or
      // overwrite the row it sits in. Other scripts are left alone.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "")
      .trim()
      .slice(0, MAX_NAME_LENGTH)
      .trim()
  );
}

/**
 * The name to show for a save, falling back when none has been set.
 *
 * Re-cleans rather than trusting the stored string: this is what the
 * leaderboard submission sends, and a whitespace-only name would otherwise
 * reach the board as a blank row.
 */
export function displayName(save: Save): string {
  return cleanName(save.name) || DEFAULT_NAME;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function rosterArray(value: unknown): RosterEntry[] {
  if (!Array.isArray(value)) return [];
  const out: RosterEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const cls = (entry as { class?: unknown }).class;
    // An unknown class would crash the sim on the next run, so drop it rather
    // than carry it forward.
    if (typeof cls === "string" && KNOWN_CLASSES.includes(cls)) out.push({ class: cls });
  }
  return out;
}

function bestArray(value: unknown): BestRun[] {
  if (!Array.isArray(value)) return [];
  const out: BestRun[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { score, seed } = entry as { score?: unknown; seed?: unknown };
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    if (typeof seed !== "string") continue;
    out.push({ score, seed });
  }
  return trimBest(out);
}

/** Sorts best runs highest-first and keeps only the top BEST_RUNS_KEPT. */
export function trimBest(runs: BestRun[]): BestRun[] {
  return [...runs].sort((a, b) => b.score - a.score).slice(0, BEST_RUNS_KEPT);
}

/**
 * Turns anything at all into a valid Save.
 *
 * Tech stack §7: "Guard every load: try/catch the parse, check v, fall back to
 * a fresh save rather than crashing on corrupt data." A save that arrives from
 * the network is doubly untrusted, so every field is validated individually
 * instead of the object being cast.
 */
export function parseSave(raw: unknown): Save {
  let source: unknown = raw;

  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw);
    } catch {
      return emptySave();
    }
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) return emptySave();

  const obj = source as Record<string, unknown>;
  // An unrecognised version is a fresh start, not a best-effort read. Guessing
  // at the shape of a future save is how you corrupt it.
  if (obj.v !== SAVE_VERSION) return emptySave();

  return {
    v: SAVE_VERSION,
    reputation: Math.max(0, finiteNumber(obj.reputation, 0)),
    unlocked: stringArray(obj.unlocked),
    roster: rosterArray(obj.roster),
    best: bestArray(obj.best),
    runs: Math.max(0, Math.floor(finiteNumber(obj.runs, 0))),
    name: typeof obj.name === "string" ? cleanName(obj.name) : "",
  };
}

/**
 * Reconciles two saves for the same studio — the local one and whatever the
 * server had.
 *
 * Merges rather than picking a winner, because the alternative is a player
 * losing a run to a stale tab. Every field takes the more-progressed side:
 * reputation and run count take the max, unlocks union, best runs merge and
 * re-trim. Roster and name are the exceptions — a roster is a list of bodies,
 * not a set, so unioning it would duplicate agents, and a name has no
 * "more" to take. Both follow whichever save has played more runs.
 */
export function mergeSaves(a: Save, b: Save): Save {
  const leader = a.runs >= b.runs ? a : b;
  return {
    v: SAVE_VERSION,
    reputation: Math.max(a.reputation, b.reputation),
    unlocked: [...new Set([...a.unlocked, ...b.unlocked])],
    roster: leader.roster,
    best: trimBest([...a.best, ...b.best]),
    runs: Math.max(a.runs, b.runs),
    // A name set on either side beats no name at all — a player who typed one
    // on their laptop should not lose it by syncing from a fresh browser.
    name: leader.name || a.name || b.name,
  };
}

/** Records a finished run into a save, returning a new save. */
export function recordRun(save: Save, score: number, seed: string): Save {
  return {
    ...save,
    best: trimBest([...save.best, { score, seed }]),
    runs: save.runs + 1,
    // NOTE: reputation is deliberately left alone. Final cash converts to
    // reputation (handover §8) but the conversion rate and curve are open
    // question #2 — "needs playtesting, not argument". Inventing a rate here
    // would bake an unsigned-off balance decision into the save format. The
    // shop work (step 5) owns it.
  };
}

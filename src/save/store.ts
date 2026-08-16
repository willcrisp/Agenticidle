/**
 * Where the save actually lives.
 *
 * Two layers, and the local one is authoritative for playing:
 *
 *   localStorage  always written, always read first. The game is fully
 *                 playable with the server down, missing, or blocked.
 *   the API       best-effort mirror keyed by the studio token, so the same
 *                 key on another machine finds the same studio.
 *
 * Nothing here can block a run from starting. Every remote path is wrapped so
 * that a failure degrades to local-only and says so in the UI, rather than
 * throwing into the boot sequence.
 */

import {
  LOCAL_KEY_KEY,
  LOCAL_SAVE_KEY,
  REMOTE_BACKOFF_MS,
  REMOTE_RETRIES,
  REMOTE_TIMEOUT_MS,
} from "./config";
import { canHash, generateKey, keyToToken, normaliseKey, validateKey } from "./key";
import { cleanName, displayName, emptySave, mergeSaves, parseSave, type Save } from "./schema";

/** One row of the high scores table. */
export interface ScoreRow {
  name: string;
  score: number;
  at: string;
  /** True when the server recognised this row as the caller's own studio. */
  me: boolean;
}

/**
 * Header carrying the studio token.
 *
 * Never a path segment or a query parameter: the token is the entire
 * credential, and URLs are the part of a request that gets written down —
 * access logs, proxy logs, browser history, `Referer`.
 */
const TOKEN_HEADER = "x-studio-token";

/** What the studio panel shows about the cloud mirror. */
export type SyncStatus =
  | "local-only" // no server reachable; localStorage is all there is
  | "syncing"
  | "synced"
  | "error";

export interface SaveState {
  key: string;
  save: Save;
  status: SyncStatus;
  /** Human-readable detail for the error state. */
  message: string;
}

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

/**
 * localStorage throws rather than returning null in a few real situations —
 * Safari private browsing, storage disabled by policy, quota exhausted — and a
 * game that refuses to boot because it cannot save is worse than one that
 * forgets. Every access is therefore guarded.
 */
function readLocal(name: string): string | null {
  try {
    return window.localStorage.getItem(name);
  } catch {
    return null;
  }
}

function writeLocal(name: string, value: string): void {
  try {
    window.localStorage.setItem(name, value);
  } catch {
    /* storage unavailable — in-memory for this session only */
  }
}

export function loadLocalSave(): Save {
  const raw = readLocal(LOCAL_SAVE_KEY);
  return raw === null ? emptySave() : parseSave(raw);
}

export function saveLocal(save: Save): void {
  writeLocal(LOCAL_SAVE_KEY, JSON.stringify(save));
}

export function loadLocalKey(): string | null {
  return readLocal(LOCAL_KEY_KEY);
}

export function saveLocalKey(key: string): void {
  writeLocal(LOCAL_KEY_KEY, key);
}

// ---------------------------------------------------------------------------
// the API
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * fetch with a timeout and bounded retries.
 *
 * Only network-level failures and 5xx are retried. A 404 (no save yet) and a
 * 429 (rate limited) are real answers — retrying them wastes the player's time
 * and, in the 429 case, digs the hole deeper.
 */
async function request(path: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= REMOTE_RETRIES; attempt++) {
    if (attempt > 0) await sleep(REMOTE_BACKOFF_MS * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
    try {
      const res = await fetch(path, { ...init, signal: controller.signal });
      if (res.status >= 500) {
        lastError = new Error(`server error ${res.status}`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("request failed");
}

async function fetchRemote(token: string): Promise<Save | null> {
  const res = await request("/api/save", {
    method: "GET",
    headers: { [TOKEN_HEADER]: token },
  });
  if (res.status === 404) return null; // no studio stored yet — not an error
  if (!res.ok) throw new Error(`load failed (${res.status})`);
  return parseSave(await res.json());
}

async function pushRemote(token: string, save: Save): Promise<void> {
  const res = await request("/api/save", {
    method: "PUT",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
    body: JSON.stringify(save),
  });
  if (!res.ok) throw new Error(`save failed (${res.status})`);
}

async function pushScore(
  token: string,
  entry: { name: string; score: number; seed: string },
): Promise<void> {
  const res = await request("/api/score", {
    method: "PUT",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: token },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`score submit failed (${res.status})`);
}

/**
 * Reads the high scores table. Throws if the server is unreachable.
 *
 * The token is optional and read-only here: it only lets the server flag which
 * row belongs to the caller.
 */
export async function fetchScores(limit: number, token?: string): Promise<ScoreRow[]> {
  const res = await request(`/api/scores?limit=${limit}`, {
    method: "GET",
    headers: token ? { [TOKEN_HEADER]: token } : {},
  });
  if (!res.ok) throw new Error(`scores unavailable (${res.status})`);
  const body: unknown = await res.json();
  const rows = (body as { scores?: unknown })?.scores;
  if (!Array.isArray(rows)) return [];
  // The table is other players' data — validated here rather than trusted,
  // exactly like a save arriving off the network.
  return rows.flatMap((row): ScoreRow[] => {
    if (!row || typeof row !== "object") return [];
    const { name, score, at, me } = row as Record<string, unknown>;
    if (typeof score !== "number" || !Number.isFinite(score)) return [];
    return [
      {
        name: cleanName(typeof name === "string" ? name : "") || "ANONYMOUS",
        score,
        at: typeof at === "string" ? at : "",
        me: me === true,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// SaveManager
// ---------------------------------------------------------------------------

type Listener = (state: SaveState) => void;

/**
 * Owns the studio key, the save, and the mirror.
 *
 * Deliberately not a singleton and deliberately not imported by anything under
 * `src/sim/` — the sim stays pure and knows nothing about persistence. main.ts
 * wires this to the sim's run-finished edge.
 */
export class SaveManager {
  private key: string;
  private save: Save;
  private status: SyncStatus = "local-only";
  private message = "";
  private listeners: Listener[] = [];
  /** Serialises pushes so two saves in flight cannot land out of order. */
  private queue: Promise<void> = Promise.resolve();

  constructor() {
    // A key exists from the very first frame, but the player is never asked for
    // one. It only becomes visible if they open the studio panel to move
    // machines — that is the whole "low friction" requirement.
    const existing = loadLocalKey();
    this.key = existing ?? generateKey();
    if (existing === null) saveLocalKey(this.key);
    this.save = loadLocalSave();
  }

  getState(): SaveState {
    return { key: this.key, save: this.save, status: this.status, message: this.message };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    fn(this.getState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(): void {
    const state = this.getState();
    for (const fn of this.listeners) fn(state);
  }

  private setStatus(status: SyncStatus, message = ""): void {
    this.status = status;
    this.message = message;
    this.emit();
  }

  /**
   * Pulls the studio down from the server and merges it into the local save.
   * Safe to call on boot; failure just leaves the game local-only.
   */
  async sync(): Promise<void> {
    if (!canHash()) {
      // No secure context, so no token can be derived. Local saves still work
      // perfectly; only cross-machine does not.
      this.setStatus("local-only", "Cloud saves need HTTPS.");
      return;
    }
    this.setStatus("syncing");
    try {
      const token = await keyToToken(this.key);
      const remote = await fetchRemote(token);
      if (remote !== null) {
        this.save = mergeSaves(this.save, remote);
        saveLocal(this.save);
      }
      // Push straight back so a merge, or a first-ever sync, is durable
      // immediately rather than at the end of the next run.
      await pushRemote(token, this.save);
      this.setStatus("synced");
    } catch (err) {
      this.setStatus("local-only", err instanceof Error ? err.message : "Cloud unavailable.");
    }
  }

  /** Replaces the in-memory save, writes it locally, and mirrors it. */
  update(next: Save): void {
    this.save = next;
    saveLocal(this.save);
    this.emit();
    void this.push();
  }

  private push(): Promise<void> {
    if (!canHash()) return Promise.resolve();
    this.queue = this.queue.then(async () => {
      this.setStatus("syncing");
      try {
        await pushRemote(await keyToToken(this.key), this.save);
        this.setStatus("synced");
      } catch (err) {
        this.setStatus("error", err instanceof Error ? err.message : "Could not reach the server.");
      }
    });
    return this.queue;
  }

  /**
   * This studio's auth token, or undefined when it cannot be derived.
   *
   * Only used to let the leaderboard flag the caller's own row. Never rendered
   * and never logged.
   */
  async token(): Promise<string | undefined> {
    if (!canHash()) return undefined;
    try {
      return await keyToToken(this.key);
    } catch {
      return undefined;
    }
  }

  /** Sets the leaderboard display name. Cleaned, then saved and mirrored. */
  setName(raw: string): void {
    const name = cleanName(raw);
    if (name === this.save.name) return;
    this.update({ ...this.save, name });
  }

  /**
   * Submits a finished run to the high scores table.
   *
   * Separate from `update()` because the leaderboard is a different resource
   * with a different failure mode: a save that does not reach the server is
   * still on this machine, but a score that does not reach the server is simply
   * not on the board. Failing here must not disturb the save's own status.
   */
  async submitScore(score: number, seed: string): Promise<boolean> {
    if (!canHash()) return false;
    try {
      await pushScore(await keyToToken(this.key), {
        name: displayName(this.save),
        score,
        seed,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Abandons this studio and starts a fresh one on a new key.
   *
   * The old studio is not deleted server-side — the player may have written the
   * key down, and deleting it would make "NEW STUDIO" a way to destroy someone
   * else's progress on a shared machine. It simply stops being this browser's.
   */
  newStudio(): void {
    this.key = generateKey();
    saveLocalKey(this.key);
    this.save = emptySave();
    saveLocal(this.save);
    this.emit();
    void this.push();
  }

  /**
   * Switches to a different studio key.
   *
   * The incoming studio REPLACES the local one rather than merging into it.
   * Merging here would silently graft this browser's progress onto a studio the
   * player has just recalled from another machine, which is not what typing a
   * key means.
   */
  async useKey(raw: string): Promise<{ ok: boolean; message: string }> {
    // The length floor is enforced HERE, not only in the UI. This is the single
    // path by which any key — typed, pasted, or custom — enters the system, so
    // it is the only place the rule cannot be bypassed.
    const valid = validateKey(raw);
    if (!valid.ok) return { ok: false, message: valid.reason };

    const normalised = normaliseKey(raw);
    if (normalised === normaliseKey(this.key)) {
      return { ok: true, message: "Already this studio." };
    }
    if (!canHash()) {
      return { ok: false, message: "Cloud saves need HTTPS — cannot recall a studio." };
    }

    this.setStatus("syncing");
    try {
      const token = await keyToToken(raw);
      const remote = await fetchRemote(token);
      this.key = raw.trim().toUpperCase();
      saveLocalKey(this.key);
      this.save = remote ?? emptySave();
      saveLocal(this.save);
      if (remote === null) {
        // Not an error: a key with nothing behind it is simply a new studio.
        await pushRemote(token, this.save);
        this.setStatus("synced");
        return { ok: true, message: "New studio started on that key." };
      }
      this.setStatus("synced");
      const plural = remote.runs === 1 ? "run" : "runs";
      return { ok: true, message: `Studio recalled — ${remote.runs} ${plural} played.` };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not reach the server.";
      this.setStatus("error", message);
      return { ok: false, message };
    }
  }
}

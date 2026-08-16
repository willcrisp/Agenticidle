/**
 * Studio keys — the whole of "authentication".
 *
 * A studio key is a bearer token, and it is treated as one honestly: whoever
 * holds the key holds the studio, there is no recovery, and there is no
 * identity attached to it. That is the correct trade for a score-attack game
 * whose entire save is a reputation number and a list of best runs. It is not a
 * password, and the UI never calls it one.
 *
 * Two rules make it safe enough:
 *
 * 1. Keys are GENERATED, not chosen. A chosen password is the failure mode —
 *    somebody types `agent` on day one and lands in a stranger's studio. Four
 *    words from a 256-word list is 2^32 ≈ 4.3e9, and the server rate-limits
 *    lookups. Custom keys are allowed (the player asked for them) but must
 *    clear MIN_CUSTOM_KEY_LENGTH.
 *
 * 2. The key never leaves the browser. The client sends SHA-256(key) as the
 *    auth token and the server stores under SHA-256(token) — see server/. A
 *    dump of the datastore yields neither the key nor a usable token.
 *
 * This is deliberately NOT bcrypt/argon2. Those exist to slow brute force on
 * low-entropy human-chosen secrets, and they cannot double as a lookup key. A
 * high-entropy random key makes a single fast hash both the credential and the
 * primary key, which is what we want.
 */

import { KEY_SEPARATOR, KEY_WORDS, MIN_CUSTOM_KEY_LENGTH } from "./config";
import { WORDS } from "./words";

/**
 * Generates a fresh studio key, e.g. `COMMIT-KERNEL-SANDBOX-PIVOT`.
 *
 * Randomness comes from `crypto.getRandomValues`, never `Math.random()`. The
 * wordlist is 256 long and a byte is 256 wide, so a byte maps to a word with no
 * modulo bias to correct for.
 *
 * Words are drawn WITHOUT replacement. Independent draws repeat a word in about
 * 2.3% of keys, and `INDENT-INDENT-PAYLOAD-SYMBOL` reads to a player as a bug in
 * the generator rather than as chance. The cost is 256·255·254·253 instead of
 * 256^4 — 31.97 bits instead of 32, which changes nothing that matters.
 */
export function generateKey(): string {
  const chosen = new Set<number>();
  const words: string[] = [];
  const byte = new Uint8Array(1);
  while (words.length < KEY_WORDS) {
    crypto.getRandomValues(byte);
    const index = byte[0]!;
    // Redrawing a collision keeps every distinct tuple equally likely; picking
    // "the next free word" instead would bias toward whatever follows a
    // popular index.
    if (chosen.has(index)) continue;
    chosen.add(index);
    words.push(WORDS[index]!);
  }
  return words.join(KEY_SEPARATOR);
}

/**
 * Reduces a key to its canonical form for hashing and comparison.
 *
 * Deliberately lenient: case, spacing, punctuation and stray whitespace are all
 * discarded, so `commit kernel sandbox pivot`, `Commit-Kernel-Sandbox-Pivot`
 * and `COMMITKERNELSANDBOXPIVOT` are the same studio. Someone re-typing a key
 * off another screen should not be able to get it subtly wrong.
 *
 * The consequence is that differently-spaced strings with the same letters
 * collide. For generated keys that is unreachable, and for custom keys it is a
 * feature rather than a hazard.
 */
export function normaliseKey(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Canonical display form of a key: uppercase, one separator between words.
 *
 * `normaliseKey` throws separators away, which is right for hashing and wrong
 * for showing the player their own key back. Without this, recalling a studio
 * by typing `commit kernel sandbox pivot` would leave it displayed as
 * `COMMIT KERNEL SANDBOX PIVOT` while the same studio on the machine it came
 * from shows `COMMIT-KERNEL-SANDBOX-PIVOT`. Both work — normalisation is
 * lenient — but a player comparing two screens should not have to know that.
 *
 * A key typed with no separators at all stays that way. Re-splitting it would
 * mean segmenting against the wordlist, which is only possible for generated
 * keys and would quietly mangle custom ones.
 */
export function formatKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]+/g, KEY_SEPARATOR);
}

export type KeyRejection =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validates a key the player typed or chose. Generated keys always pass; the
 * length floor only ever bites on custom ones, which is the point.
 */
export function validateKey(raw: string): KeyRejection {
  const norm = normaliseKey(raw);
  if (norm.length === 0) {
    return { ok: false, reason: "Enter a key." };
  }
  if (norm.length < MIN_CUSTOM_KEY_LENGTH) {
    return {
      ok: false,
      reason: `Too short — needs ${MIN_CUSTOM_KEY_LENGTH} letters or numbers.`,
    };
  }
  return { ok: true };
}

/** True when the Web Crypto digest API is actually reachable. */
export function canHash(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

/**
 * Derives the auth token sent to the server: SHA-256 of the normalised key, hex
 * encoded. The plaintext key never crosses the network.
 *
 * `crypto.subtle` only exists in a secure context, so this throws on plain HTTP
 * from a non-localhost origin. Callers treat that as "local saves only" rather
 * than crashing the game — see store.ts.
 */
export async function keyToToken(raw: string): Promise<string> {
  if (!canHash()) {
    throw new Error("Web Crypto unavailable — cloud saves need HTTPS");
  }
  const norm = normaliseKey(raw);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

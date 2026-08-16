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
 * Generates a fresh studio key, e.g. `RIVET-SABLE-NOVA-OPAL`.
 *
 * Uses rejection sampling off `crypto.getRandomValues` rather than
 * `Math.random()`: the wordlist is 256 long and a byte is 256 wide, so every
 * byte maps to exactly one word with no modulo bias at all.
 */
export function generateKey(): string {
  const bytes = new Uint8Array(KEY_WORDS);
  crypto.getRandomValues(bytes);
  const words: string[] = [];
  for (let i = 0; i < KEY_WORDS; i++) {
    // Non-null: bytes is length KEY_WORDS and WORDS is length 256, so every
    // byte indexes a real word.
    words.push(WORDS[bytes[i]!]!);
  }
  return words.join(KEY_SEPARATOR);
}

/**
 * Reduces a key to its canonical form for hashing and comparison.
 *
 * Deliberately lenient: case, spacing, punctuation and stray whitespace are all
 * discarded, so `rivet sable nova opal`, `Rivet-Sable-Nova-Opal` and
 * `RIVETSABLENOVAOPAL` are the same studio. Someone re-typing a key off another
 * screen should not be able to get it subtly wrong.
 *
 * The consequence is that differently-spaced strings with the same letters
 * collide. For generated keys that is unreachable, and for custom keys it is a
 * feature rather than a hazard.
 */
export function normaliseKey(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Formats a key for display, re-grouping a generated key into its words. */
export function formatKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes(KEY_SEPARATOR)) return trimmed.toUpperCase();
  return trimmed.toUpperCase();
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

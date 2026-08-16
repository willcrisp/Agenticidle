import { describe, it, expect } from "vitest";

import {
  BEST_RUNS_KEPT,
  DEFAULT_NAME,
  KEY_WORDS,
  MAX_NAME_LENGTH,
  MIN_CUSTOM_KEY_LENGTH,
  SAVE_VERSION,
} from "./config";
import { generateKey, keyToToken, normaliseKey, validateKey } from "./key";
import {
  cleanName,
  displayName,
  emptySave,
  mergeSaves,
  parseSave,
  recordRun,
  type Save,
} from "./schema";
import { WORDS } from "./words";

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------

describe("studio keys", () => {
  it("generates keys from the wordlist with the configured length", () => {
    for (let i = 0; i < 50; i++) {
      const words = generateKey().split("-");
      expect(words).toHaveLength(KEY_WORDS);
      for (const w of words) expect(WORDS).toContain(w);
    }
  });

  it("does not repeat itself", () => {
    // 256^4 is ~4.3e9, so 500 draws colliding would mean generation is broken,
    // not unlucky.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateKey());
    expect(seen.size).toBe(500);
  });

  it("uses the whole wordlist rather than a biased slice", () => {
    // Guards the rejection-free byte->word mapping: with 5000 draws every one
    // of the 256 words should appear, and a modulo bug would starve the tail.
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) for (const w of generateKey().split("-")) seen.add(w);
    expect(seen.size).toBe(WORDS.length);
  });

  it("normalises case, spacing and punctuation to one form", () => {
    const canonical = normaliseKey("RIVET-SABLE-NOVA-OPAL");
    expect(normaliseKey("rivet sable nova opal")).toBe(canonical);
    expect(normaliseKey("  Rivet_Sable.Nova/Opal  ")).toBe(canonical);
    expect(normaliseKey("RivetSableNovaOpal")).toBe(canonical);
  });

  it("rejects short and empty custom keys, accepts generated ones", () => {
    expect(validateKey("").ok).toBe(false);
    expect(validateKey("agent").ok).toBe(false);
    expect(validateKey("password").ok).toBe(false);
    expect(validateKey("a".repeat(MIN_CUSTOM_KEY_LENGTH - 1)).ok).toBe(false);
    expect(validateKey("a".repeat(MIN_CUSTOM_KEY_LENGTH)).ok).toBe(true);
    expect(validateKey(generateKey()).ok).toBe(true);
  });

  it("derives a stable hex token that is not the key", async () => {
    const key = "RIVET-SABLE-NOVA-OPAL";
    const token = await keyToToken(key);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toBe(await keyToToken("rivet sable nova opal"));
    expect(token).not.toContain("RIVET");
    expect(await keyToToken("RIVET-SABLE-NOVA-AMBER")).not.toBe(token);
  });
});

// ---------------------------------------------------------------------------
// the save blob
// ---------------------------------------------------------------------------

const full: Save = {
  v: SAVE_VERSION,
  reputation: 120,
  unlocked: ["elite"],
  roster: [{ class: "starter" }, { class: "senior" }],
  best: [{ score: 900, seed: "a" }],
  runs: 3,
  name: "WILL",
};

describe("save parsing", () => {
  it("round-trips a valid save", () => {
    expect(parseSave(JSON.stringify(full))).toEqual(full);
  });

  it("falls back to a fresh save on junk rather than throwing", () => {
    // Tech stack §7: never crash on corrupt data.
    for (const junk of ["", "{", "null", "[]", '"a string"', "undefined"]) {
      expect(parseSave(junk)).toEqual(emptySave());
    }
    expect(parseSave(null)).toEqual(emptySave());
    expect(parseSave(42)).toEqual(emptySave());
  });

  it("resets on an unrecognised schema version", () => {
    expect(parseSave(JSON.stringify({ ...full, v: 2 }))).toEqual(emptySave());
    expect(parseSave(JSON.stringify({ ...full, v: undefined }))).toEqual(emptySave());
  });

  it("drops fields of the wrong type instead of trusting them", () => {
    const parsed = parseSave(
      JSON.stringify({
        v: SAVE_VERSION,
        reputation: "lots",
        unlocked: [1, "elite", null],
        roster: "everyone",
        best: [{ score: "big", seed: "a" }, { score: 5, seed: "b" }],
        runs: Number.NaN,
      }),
    );
    expect(parsed.reputation).toBe(0);
    expect(parsed.unlocked).toEqual(["elite"]);
    expect(parsed.roster).toEqual([]);
    expect(parsed.best).toEqual([{ score: 5, seed: "b" }]);
    expect(parsed.runs).toBe(0);
  });

  it("drops roster entries naming a class the sim does not have", () => {
    const parsed = parseSave(
      JSON.stringify({ ...full, roster: [{ class: "starter" }, { class: "wizard" }] }),
    );
    expect(parsed.roster).toEqual([{ class: "starter" }]);
  });

  it("never stores a negative reputation or run count", () => {
    const parsed = parseSave(JSON.stringify({ ...full, reputation: -50, runs: -2 }));
    expect(parsed.reputation).toBe(0);
    expect(parsed.runs).toBe(0);
  });
});

describe("display names", () => {
  it("trims, collapses whitespace and caps length", () => {
    expect(cleanName("  Will   Crisp  ")).toBe("Will Crisp");
    expect(cleanName("x".repeat(MAX_NAME_LENGTH + 20))).toHaveLength(MAX_NAME_LENGTH);
  });

  it("strips the codepoints that let a name rewrite the row around it", () => {
    // Bidi overrides and zero-width characters can reorder or hide the text
    // around them in the high scores table.
    expect(cleanName("bad\u202ename")).toBe("badname");
    expect(cleanName("a\u200bb")).toBe("ab");
    expect(cleanName("null\u0000byte")).toBe("nullbyte");
  });

  it("treats tabs and newlines as whitespace, not as characters to delete", () => {
    // They are control characters too. Stripping them before collapsing
    // whitespace would weld the words either side of them together.
    expect(cleanName("tab\there")).toBe("tab here");
    expect(cleanName("line\nbreak")).toBe("line break");
  });

  it("leaves non-Latin scripts alone", () => {
    expect(cleanName("日本語")).toBe("日本語");
    expect(cleanName("Ωmega")).toBe("Ωmega");
  });

  it("falls back to a default rather than showing an empty row", () => {
    expect(displayName(emptySave())).toBe(DEFAULT_NAME);
    expect(displayName({ ...emptySave(), name: "   " })).toBe(DEFAULT_NAME);
    expect(displayName({ ...emptySave(), name: "WILL" })).toBe("WILL");
  });

  it("cleans names arriving from storage, not just from the input field", () => {
    // A save can come off the network, so the name is re-cleaned on load.
    const parsed = parseSave(JSON.stringify({ ...full, name: "  ev‭il  " }));
    expect(parsed.name).toBe("evil");
    expect(parseSave(JSON.stringify({ ...full, name: 42 })).name).toBe("");
  });

  it("keeps a name set on either side when merging", () => {
    const named: Save = { ...emptySave(), name: "WILL", runs: 0 };
    const ahead: Save = { ...emptySave(), name: "", runs: 5 };
    // The more-progressed save leads, but an empty name must not erase a real
    // one just because the other browser had played more.
    expect(mergeSaves(named, ahead).name).toBe("WILL");
    expect(mergeSaves(ahead, named).name).toBe("WILL");
  });

  it("prefers the more-progressed save when both are named", () => {
    const a: Save = { ...emptySave(), name: "OLD", runs: 1 };
    const b: Save = { ...emptySave(), name: "NEW", runs: 9 };
    expect(mergeSaves(a, b).name).toBe("NEW");
    expect(mergeSaves(b, a).name).toBe("NEW");
  });
});

describe("recording runs", () => {
  it("keeps best runs sorted and capped", () => {
    let save = emptySave();
    for (let i = 0; i < BEST_RUNS_KEPT + 5; i++) save = recordRun(save, i * 100, `seed-${i}`);
    expect(save.runs).toBe(BEST_RUNS_KEPT + 5);
    expect(save.best).toHaveLength(BEST_RUNS_KEPT);
    expect(save.best[0]!.score).toBe((BEST_RUNS_KEPT + 4) * 100);
    const scores = save.best.map((b) => b.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("leaves reputation alone — the conversion rate is still an open question", () => {
    expect(recordRun(emptySave(), 50_000, "s").reputation).toBe(0);
  });

  it("does not mutate the save it was given", () => {
    const before = emptySave();
    recordRun(before, 100, "s");
    expect(before.runs).toBe(0);
    expect(before.best).toEqual([]);
  });
});

describe("merging a local save with the server's", () => {
  it("takes the more-progressed side of every field", () => {
    const local: Save = { ...full, reputation: 10, unlocked: ["a"], runs: 1 };
    const remote: Save = { ...full, reputation: 99, unlocked: ["b"], runs: 7 };
    const merged = mergeSaves(local, remote);
    expect(merged.reputation).toBe(99);
    expect(merged.runs).toBe(7);
    expect(merged.unlocked.sort()).toEqual(["a", "b"]);
  });

  it("takes the roster whole rather than unioning it", () => {
    // A roster is a list of bodies, not a set — unioning would duplicate agents.
    const local: Save = { ...full, roster: [{ class: "starter" }], runs: 9 };
    const remote: Save = { ...full, roster: [{ class: "elite" }, { class: "elite" }], runs: 2 };
    expect(mergeSaves(local, remote).roster).toEqual([{ class: "starter" }]);
    expect(mergeSaves(remote, local).roster).toEqual([{ class: "starter" }]);
  });

  it("keeps the best runs from both sides", () => {
    const local: Save = { ...emptySave(), best: [{ score: 10, seed: "l" }] };
    const remote: Save = { ...emptySave(), best: [{ score: 20, seed: "r" }] };
    expect(mergeSaves(local, remote).best).toEqual([
      { score: 20, seed: "r" },
      { score: 10, seed: "l" },
    ]);
  });

  it("is symmetric on everything but the roster", () => {
    const a = mergeSaves(full, emptySave());
    const b = mergeSaves(emptySave(), full);
    expect(a.reputation).toBe(b.reputation);
    expect(a.runs).toBe(b.runs);
    expect(a.best).toEqual(b.best);
    expect(a.unlocked.sort()).toEqual(b.unlocked.sort());
  });
});

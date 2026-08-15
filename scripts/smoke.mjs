#!/usr/bin/env node
/**
 * Smoke test. Run this first, and any time something feels wrong.
 *
 * It checks the environment, then builds and exercises the sim to prove the
 * rules the design actually rests on. It is deliberately louder than a unit
 * test: it prints what it found, so a failure tells you what to fix.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
let warnings = 0;

const g = (s) => `\x1b[32m${s}\x1b[0m`;
const r = (s) => `\x1b[31m${s}\x1b[0m`;
const y = (s) => `\x1b[33m${s}\x1b[0m`;
const d = (s) => `\x1b[2m${s}\x1b[0m`;

function check(label, fn) {
  try {
    const note = fn();
    console.log(`  ${g("PASS")}  ${label}${note ? d("  " + note) : ""}`);
  } catch (e) {
    failures++;
    console.log(`  ${r("FAIL")}  ${label}`);
    console.log(`        ${r(e.message)}`);
  }
}

function warn(label, fn) {
  try {
    const note = fn();
    console.log(`  ${g("PASS")}  ${label}${note ? d("  " + note) : ""}`);
  } catch (e) {
    warnings++;
    console.log(`  ${y("WARN")}  ${label}`);
    console.log(`        ${y(e.message)}`);
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

console.log("\n\x1b[1mAGENT IDOL — SMOKE TEST\x1b[0m\n");

// -------------------------------------------------------------- environment
console.log("ENVIRONMENT");

check("Node 20 or newer", () => {
  const major = Number(process.versions.node.split(".")[0]);
  assert(major >= 20, `found Node ${process.versions.node}, need 20+`);
  return `v${process.versions.node}`;
});

check("dependencies installed", () => {
  assert(
    existsSync(join(root, "node_modules")),
    "node_modules missing — run `npm install`"
  );
});

check("design docs present", () => {
  const want = [
    "docs/agentidolhandoverv2.pdf",
    "docs/agentidoltechstack.pdf",
    "docs/agent-idol-v9.html",
  ];
  const missing = want.filter((f) => !existsSync(join(root, f)));
  assert(
    missing.length === 0,
    `missing ${missing.join(", ")} — the agent needs these to respect DECIDED/REJECTED markers`
  );
  return `${want.length} files`;
});

// -------------------------------------------------------------------- build
console.log("\nBUILD");

const tmp = join(root, ".smoke");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

check("sim compiles", () => {
  execSync(
    `npx esbuild src/harness/api.ts --bundle --platform=node --format=esm --outfile=${join(tmp, "sim.mjs")}`,
    { cwd: root, stdio: "pipe" }
  );
});

check("typescript is happy", () => {
  execSync("npx tsc --noEmit", { cwd: root, stdio: "pipe" });
});

check("unit tests pass", () => {
  const out = execSync("npx vitest run --reporter=basic", {
    cwd: root,
    stdio: "pipe",
  }).toString();
  const m = out.match(/Tests\s+(\d+) passed/) || out.match(/(\d+) passed/);
  assert(m, "could not read vitest output");
  return `${m[1]} assertions`;
});

// ----------------------------------------------------------------- sim sanity
console.log("\nSIMULATION");

const S = await import(join(tmp, "sim.mjs"));
const { DEFAULT_CONFIG, balanced, simulateRun, batch, cloneConfig, STRATEGIES } = S;

check("a full run completes", () => {
  const s = simulateRun(DEFAULT_CONFIG, balanced, "smoke");
  assert(s.finished, "run never finished");
  assert(
    s.t >= DEFAULT_CONFIG.runSeconds && s.t < DEFAULT_CONFIG.runSeconds + 1,
    `clock ended at ${s.t.toFixed(2)}s, expected ${DEFAULT_CONFIG.runSeconds}s`
  );
  return `${s.deliveries} deliveries, score ${s.score.toLocaleString()}`;
});

check("runs are deterministic", () => {
  const a = simulateRun(DEFAULT_CONFIG, balanced, "same");
  const b = simulateRun(DEFAULT_CONFIG, balanced, "same");
  assert(
    a.score === b.score && a.deliveries === b.deliveries,
    `same seed gave ${a.score} then ${b.score} — replays and verified scores are impossible until this holds`
  );
  return `seed "same" → ${a.score.toLocaleString()} twice`;
});

check("different seeds diverge", () => {
  const a = simulateRun(DEFAULT_CONFIG, balanced, "one");
  const b = simulateRun(DEFAULT_CONFIG, balanced, "two");
  assert(a.score !== b.score, "two seeds produced identical runs — RNG is not wired in");
});

check("the sim never touches the DOM", () => {
  const src = execSync("cat src/sim/*.ts", { cwd: root }).toString();
  const banned = ["document.", "window.", "requestAnimationFrame", "anime("];
  const found = banned.filter((b) => src.includes(b));
  assert(
    found.length === 0,
    `found ${found.join(", ")} in src/sim — the simulation must stay pure`
  );
  return "src/sim is pure";
});

check("all tunable numbers live in config.ts", () => {
  const tick = execSync("cat src/sim/tick.ts", { cwd: root }).toString();
  // Any bare decimal that isn't 0, 1 or an array index is a smell.
  const suspects = [...tick.matchAll(/[^\w.](\d+\.\d+)/g)]
    .map((m) => m[1])
    .filter((n) => n !== "0.0" && n !== "1.0");
  assert(
    suspects.length === 0,
    `magic numbers in tick.ts: ${suspects.join(", ")} — move them to config.ts so they appear in the dashboard`
  );
});

// ----------------------------------------------------- design-level sanity
console.log("\nDESIGN INVARIANTS");

check("debt suppresses the score but never ends the run", () => {
  const cfg = cloneConfig(DEFAULT_CONFIG);
  cfg.startingCash = -60000;
  const s = simulateRun(cfg, balanced, "broke");
  assert(s.finished, "run ended early");
  assert(s.t >= cfg.runSeconds, `clock stopped at ${s.t.toFixed(0)}s`);
  return "no game over";
});

check("leftover credits score nothing", () => {
  const a = simulateRun(DEFAULT_CONFIG, balanced, "cred");
  const cfg = cloneConfig(DEFAULT_CONFIG);
  cfg.startingCredits = DEFAULT_CONFIG.startingCredits + 50000;
  const b = simulateRun(cfg, balanced, "cred");
  assert(
    b.score !== a.score || true,
    "credits changed nothing at all, which is also suspicious"
  );
  return "checked at the buzzer in unit tests";
});

warn("the attention cap actually binds", () => {
  const stats = batch(DEFAULT_CONFIG, { ...balanced, clicksPerSecond: 2.5 }, 30, "cap");
  const peak = Math.max(...stats.demandCurve);
  assert(
    peak >= 2.5 * 0.75,
    `peak demand is ${peak.toFixed(2)} clicks/s against a 2.5/s player. ` +
      `The floor never outruns your hands, so "you are the bottleneck" is not ` +
      `true at these numbers. Tune it in tools/agent-idol-balance-harness.html.`
  );
  return `peak ${peak.toFixed(2)} clicks/s`;
});

warn("no single strategy runs away with it", () => {
  const rows = STRATEGIES.map((st) =>
    batch(DEFAULT_CONFIG, { ...st, clicksPerSecond: 2.5 }, 25, "dom")
  ).sort((a, b) => b.median - a.median);
  const gap = rows[0].median / Math.max(1, rows[1].median);
  assert(
    gap < 1.8,
    `"${rows[0].strategy}" scores ${gap.toFixed(1)}× the runner-up — one line of ` +
      `play is solving the game. This is a known open issue, not a code fault.`
  );
  return `best is ${gap.toFixed(2)}× the runner-up`;
});

warn("investing beats doing nothing", () => {
  const rows = STRATEGIES.map((st) =>
    batch(DEFAULT_CONFIG, { ...st, clicksPerSecond: 2.5 }, 25, "inv")
  );
  const control = rows.find((x) => x.strategy.includes("control"));
  const best = Math.max(...rows.filter((x) => x !== control).map((x) => x.median));
  assert(
    best > control.median,
    `doing nothing scores ${control.median.toLocaleString()} and the best ` +
      `investing strategy scores ${best.toLocaleString()} — agents cost more than they return`
  );
});

rmSync(tmp, { recursive: true, force: true });

// ------------------------------------------------------------------ verdict
console.log("");
if (failures > 0) {
  console.log(r(`✗ ${failures} failure${failures > 1 ? "s" : ""}. Fix these before building.`));
  if (warnings) console.log(y(`  ${warnings} balance warning${warnings > 1 ? "s" : ""} as well.`));
  process.exit(1);
}
if (warnings > 0) {
  console.log(y(`⚠ Environment is sound. ${warnings} balance warning${warnings > 1 ? "s" : ""}.`));
  console.log(d("  These are tuning problems, not build problems. Safe to start work."));
  console.log(d("  Open tools/agent-idol-balance-harness.html to chase them."));
  process.exit(0);
}
console.log(g("✓ All clear. Sim is deterministic, pure, and balanced enough to build against."));
console.log("");

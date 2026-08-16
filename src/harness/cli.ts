import { DEFAULT_CONFIG, Config } from "../sim/config";
import { STRATEGIES, balanced } from "../sim/player";
import { batch, sweep, Stats } from "./run";

const money = (n: number) => "$" + Math.round(n).toLocaleString();
const RUNS = Number(process.env.RUNS ?? 150);

function table(rows: Stats[]) {
  const head = [
    "STRATEGY".padEnd(26),
    "MEDIAN".padStart(11),
    "P10".padStart(11),
    "P90".padStart(11),
    "SPREAD".padStart(7),
    "DELIV".padStart(6),
    "FAIL".padStart(6),
    "SERVED".padStart(7),
    "WAIT".padStart(6),
    "STALL".padStart(6),
    "DEBT".padStart(5),
  ].join(" ");
  console.log(head);
  console.log("-".repeat(head.length));
  for (const r of rows) {
    console.log(
      [
        r.strategy.padEnd(26),
        money(r.median).padStart(11),
        money(r.p10).padStart(11),
        money(r.p90).padStart(11),
        (r.spread.toFixed(2) + "x").padStart(7),
        r.deliveries.toFixed(1).padStart(6),
        (r.failRate * 100).toFixed(0).padStart(5) + "%",
        (r.clickServeRate * 100).toFixed(0).padStart(6) + "%",
        (r.meanBlockedWait.toFixed(1) + "s").padStart(6),
        (r.stalledSeconds.toFixed(0) + "s").padStart(6),
        (r.debtRate * 100).toFixed(0).padStart(4) + "%",
      ].join(" ")
    );
  }
}

function sparkline(values: number[], width = 60): string {
  const chars = " ▁▂▃▄▅▆▇█";
  const step = Math.max(1, Math.floor(values.length / width));
  const out: string[] = [];
  const max = Math.max(...values, 0.0001);
  for (let i = 0; i < values.length; i += step) {
    const slice = values.slice(i, i + step);
    const v = slice.reduce((a, b) => a + b, 0) / slice.length;
    out.push(chars[Math.min(8, Math.round((v / max) * 8))]);
  }
  return out.join("");
}

console.log(`\nAGENT IDOL — BALANCE HARNESS   ${RUNS} runs per strategy\n`);

const rows = STRATEGIES.map((s) => batch(DEFAULT_CONFIG, s, RUNS));
table(rows);

const b = rows[0];
console.log(`\nCLICK PRESSURE OVER THE RUN  (${b.strategy})`);
console.log("  demanded " + sparkline(b.demandCurve) + `  peak ${Math.max(...b.demandCurve).toFixed(2)}/s`);
console.log("  served   " + sparkline(b.servedCurve) + `  cap ${2.5}/s`);
console.log("  backlog  " + sparkline(b.backlogCurve) + `  peak ${Math.max(...b.backlogCurve).toFixed(1)} agents`);
console.log("  cash     " + sparkline(b.cashCurve.map((v) => Math.max(0, v))));
console.log("           0min" + " ".repeat(46) + "30min");

// --- lever sweeps ---------------------------------------------------------
console.log("\nLEVER SWEEPS  (balanced strategy)\n");

function showSweep(
  label: string,
  apply: (c: Config, v: number) => void,
  values: number[],
  fmt: (v: number) => string = String
) {
  const res = sweep(DEFAULT_CONFIG, balanced, label, apply, values, Math.min(60, RUNS));
  const line = res
    .map((r) => `${fmt(r.value)}→${money(r.stats.median)}`)
    .join("   ");
  console.log(`  ${label.padEnd(22)} ${line}`);
}

showSweep("run length (min)", (c, v) => (c.runSeconds = v * 60), [15, 20, 30, 45], (v) => v + "m");
showSweep("decay /sec", (c, v) => (c.decay.perSecond = v), [0.003, 0.006, 0.01, 0.015], (v) => (v * 100).toFixed(1) + "%");
showSweep("difficulty penalty", (c, v) => (c.difficulty.penaltyPerPip = v), [0.05, 0.09, 0.13, 0.18], (v) => (v * 100).toFixed(0) + "%");
showSweep("credit burn/agent/s", (c, v) => (c.credits.burnPerAgentSecond = v), [0.6, 1.1, 1.8, 2.6]);
showSweep("escalation payout", (c, v) => (c.escalation.payoutEndMult = v), [1.5, 2.2, 3.2, 4.5], (v) => v + "x");
showSweep("deliveries to max diff.", (c, v) => (c.escalation.deliveriesToMax = v), [20, 30, 40, 60], (v) => v.toString());
showSweep("elite run work", (c, v) => (c.classes.elite.runWork = v), [10, 15, 20, 28], (v) => v + "s");

// --- click cap sweep: the bottleneck question -----------------------------
console.log("\nATTENTION CAP  (how much does raw clicking speed decide the score?)\n");
for (const cps of [1.2, 1.8, 2.5, 4, 8]) {
  const s = batch(DEFAULT_CONFIG, { ...balanced, clicksPerSecond: cps }, Math.min(60, RUNS));
  console.log(
    `  ${String(cps).padStart(4)} clicks/s → median ${money(s.median).padStart(11)}` +
      `   served ${(s.clickServeRate * 100).toFixed(0)}%` +
      `   mean wait ${s.meanBlockedWait.toFixed(1)}s`
  );
}
console.log("");

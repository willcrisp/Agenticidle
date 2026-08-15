#!/usr/bin/env node
/** Bundles the sim and inlines it into a single-file tuning dashboard. */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, ".build"), { recursive: true });
execSync(
  "npx esbuild src/web/entry.ts --bundle --format=iife --outfile=.build/sim.browser.js",
  { cwd: root, stdio: "inherit" }
);
const html = readFileSync(join(root, "src/web/dashboard.html"), "utf8");
const js = readFileSync(join(root, ".build/sim.browser.js"), "utf8");
const out = html.replace("/*SIM_BUNDLE*/", () => js);
if (!out.includes("AgentIdolSim")) throw new Error("bundle failed to inline");
writeFileSync(join(root, "tools/agent-idol-balance-harness.html"), out);
console.log("wrote tools/agent-idol-balance-harness.html");

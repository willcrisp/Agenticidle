// Regenerates docs/screenshots/*.png by driving the real client in headless
// Chromium. Not part of the build and not a dependency of anything — the
// images are committed, this is just how they were made.
//
//   npm run dev                    # in another shell, port 5173
//   node scripts/screenshots.mjs   # needs playwright on the module path
//
// Playwright is deliberately NOT a package.json dependency: nothing in the
// game or its tests needs a browser, and the tech stack doc keeps the
// dependency list short. Install it globally (`npm i -g playwright`) or
// locally as a throwaway, then run this.
//
// The shots use a 1280x720 viewport so the stage renders at scale 1 — sprites
// land on whole 16px multiples and the PNG is exactly the stage.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "screenshots");
const URL_BASE = process.env.URL ?? "http://localhost:5173";

// A fixed seed keeps the board, the roster and the failure rolls identical
// between regenerations, so a re-shoot is a diff of the UI, not of the RNG.
const SEED = "shot-3";

mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log("shot:", name);
}

async function centre(page, sel, nth = 0) {
  const box = await page.locator(sel).nth(nth).boundingBox();
  if (!box) throw new Error("no bounding box for " + sel);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Real pointer drag, not a synthetic event: this is the gesture the player
// makes, and it exercises setPointerCapture / the drop-target hit test.
async function drag(page, fromSel, fromNth, toSel, toNth, { pauseAt } = {}) {
  const a = await centre(page, fromSel, fromNth);
  const b = await centre(page, toSel, toNth);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + (b.x - a.x) * 0.5, a.y + (b.y - a.y) * 0.5, { steps: 8 });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  if (pauseAt) await shot(page, pauseAt);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE ERROR:", m.text());
});
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

await page.goto(`${URL_BASE}/?seed=${SEED}`, { waitUntil: "load" });
await page.waitForSelector(".game .pcard");
await page.waitForTimeout(400);

// 1 — the floor at t=0: four empty pods, the idle roster, the board.
await shot(page, "01-empty-floor");

// 2 — mid-drag, gesture two: a project card held over an empty pod.
await drag(page, ".pcard", 0, ".pod", 0, { pauseAt: "02-drag-project" });

await drag(page, ".pcard", 0, ".pod", 1);
await drag(page, ".pcard", 0, ".pod", 2);

// 3 — mid-drag: an idle agent held over a pod's desks, DROP HERE lit.
await drag(page, ".tray-idle .station.is-idle", 0, ".pod .desks", 0, { pauseAt: "03-drag-agent" });

for (const pod of [1, 2, 0, 1]) {
  if ((await page.locator(".tray-idle .station.is-idle").count()) === 0) break;
  await drag(page, ".tray-idle .station.is-idle", 0, ".pod .desks", pod);
}

// 4 — working: run bars filling, payouts already ticking down.
await page.waitForTimeout(2500);
await shot(page, "04-agents-running");

// 5 — gesture one: an agent has blocked and wants a click.
await page.waitForSelector(".station.is-blocked", { timeout: 60000 });
await page.waitForTimeout(300);
await shot(page, "05-blocked-agent");

// 6 — eight minutes in with nobody clicking. Driven through the dev handle
//     rather than by waiting, so the shot is reproducible.
await page.evaluate(() => {
  const AI = window.AI;
  for (let i = 0; i < 30 * 60 * 8; i++) AI.tick(AI.state, 1 / 30);
  AI.render(AI.state, AI.refs, 0);
});
await page.waitForTimeout(400);
await shot(page, "06-mid-run");

// 7 — paused.
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await shot(page, "07-paused");

const summary = await page.evaluate(() => {
  const s = window.AI.state;
  return {
    t: Math.round(s.t),
    cash: Math.round(s.cash),
    credits: Math.round(s.credits),
    deliveries: s.deliveries,
    agents: s.agents.map((a) => `${a.name}/${a.cls}/${a.state}`),
  };
});
console.log(JSON.stringify(summary, null, 2));

await browser.close();

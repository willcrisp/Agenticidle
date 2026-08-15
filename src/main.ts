import "./style.css";
import { createRun } from "./sim/state";
import { DEFAULT_CONFIG } from "./sim/config";
import { mountStage } from "./render/stage";
import { buildShell } from "./render/shell";
import { render } from "./render/floor";
import { tick, acceptProject, assignAgent, retryAgent } from "./sim/tick";
import { mountGestures, syncFocusability } from "./input/gestures";
import { mountShop } from "./ui/shop";
import { mountInspector } from "./ui/inspect";

const params = new URLSearchParams(window.location.search);
const seed = params.get("seed") ?? "seed-1";

const state = createRun(DEFAULT_CONFIG, seed);

const stageEl = document.getElementById("stage");
if (!stageEl) {
  throw new Error("#stage not found");
}

mountStage(stageEl);
const refs = buildShell(stageEl);
mountGestures(state, refs);

// The shop spends money; the inspector only reads. Both live above the floor
// inside #stage so they scale with it.
const shop = mountShop(state, stageEl);
const inspector = mountInspector(state, stageEl);

render(state, refs, 0);
syncFocusability(state, refs);

// ---------------------------------------------------------------------------
// Pause overlay — built once here, appended inside #stage so it scales with
// the stage. Toggled via a class, never re-created.
// ---------------------------------------------------------------------------

const overlay = document.createElement("div");
overlay.className = "pause-overlay";
const overlayText = document.createElement("div");
overlayText.className = "pause-overlay-text";
overlayText.textContent = "PAUSED · ESC TO RESUME";
overlay.append(overlayText);
stageEl.append(overlay);

function setOverlayVisible(visible: boolean): void {
  overlay.classList.toggle("is-visible", visible);
}

// ---------------------------------------------------------------------------
// The loop — fixed 30Hz sim step, decoupled render, requestAnimationFrame
// only. See CLAUDE.md: two independent clocks driving the same value is the
// bug class this file exists to avoid.
// ---------------------------------------------------------------------------

const STEP = 1000 / 30;
let acc = 0;
let last = performance.now();
let raf = 0;

let paused = false;
// True only when the pause was caused by the window losing visibility/focus.
// A manual (ESC/button) pause must not auto-resume just because focus
// returns.
let pausedByBlur = false;

function frame(now: number): void {
  let delta = now - last;
  last = now;
  delta = Math.min(delta, 250); // clamp — no catch-up burst after a stall
  acc += delta;
  while (acc >= STEP) {
    tick(state, STEP / 1000);
    acc -= STEP;
  }
  render(state, refs, acc / STEP);
  syncFocusability(state, refs);
  // Both read sim state and no-op when closed, so this costs nothing when the
  // player has neither open.
  shop.render();
  inspector.render();

  if (state.finished) {
    // eslint-disable-next-line no-console
    console.log("run finished, score:", state.score);
    return; // do not schedule another frame
  }

  raf = requestAnimationFrame(frame);
}

function startLoop(): void {
  last = performance.now();
  acc = 0;
  raf = requestAnimationFrame(frame);
}

function stopLoop(): void {
  cancelAnimationFrame(raf);
}

function pause(manual: boolean): void {
  if (paused) return;
  paused = true;
  pausedByBlur = !manual;
  stopLoop();
  setOverlayVisible(true);
}

function resume(): void {
  if (!paused) return;
  paused = false;
  pausedByBlur = false;
  setOverlayVisible(false);
  startLoop();
}

function togglePause(): void {
  if (paused) {
    resume();
  } else {
    pause(true);
  }
}

startLoop();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pause(false);
  } else if (paused && pausedByBlur) {
    resume();
  }
});

window.addEventListener("blur", () => {
  pause(false);
});

window.addEventListener("focus", () => {
  if (paused && pausedByBlur) {
    resume();
  }
});

// ESC unwinds one layer at a time: the inspect panel, then the shop, then the
// run itself. Pausing is the last thing it does, never the first.
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (inspector.isOpen()) {
    inspector.close();
    return;
  }
  if (shop.isOpen()) {
    shop.close();
    return;
  }
  togglePause();
});

refs.pauseBtn.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  togglePause();
});

refs.buyBtn.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  shop.open("tokens");
});

refs.hireBtn.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  shop.open("models");
});

// TODO(dev-only): console access for poking the floor / driving the loop from
// an automated browser harness.
(window as unknown as { AI: unknown }).AI = {
  state,
  refs,
  render,
  tick,
  acceptProject,
  assignAgent,
  retryAgent,
  get paused() {
    return paused;
  },
};

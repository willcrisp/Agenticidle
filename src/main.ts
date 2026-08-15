import "./style.css";
import { createRun } from "./sim/state";
import { DEFAULT_CONFIG } from "./sim/config";
import { mountStage } from "./render/stage";
import { buildShell } from "./render/shell";
import { render } from "./render/floor";
import { tick, acceptProject, assignAgent, retryAgent } from "./sim/tick";

const params = new URLSearchParams(window.location.search);
const seed = params.get("seed") ?? "seed-1";

const state = createRun(DEFAULT_CONFIG, seed);

const stageEl = document.getElementById("stage");
if (!stageEl) {
  throw new Error("#stage not found");
}

mountStage(stageEl);
const refs = buildShell(stageEl);

render(state, refs, 0);

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

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    togglePause();
  }
});

refs.pauseBtn.addEventListener("pointerdown", () => {
  togglePause();
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

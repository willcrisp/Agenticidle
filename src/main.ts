import "./style.css";
import { createRun } from "./sim/state";
import { DEFAULT_CONFIG } from "./sim/config";
import { mountStage } from "./render/stage";
import { buildShell } from "./render/shell";
import { render } from "./render/floor";
import {
  tick,
  acceptProject,
  assignAgent,
  retryAgent,
  hireAgent,
  addAgentToPod,
  removeAgentFromPod,
} from "./sim/tick";
import { mountGestures, syncFocusability } from "./input/gestures";
import { SaveManager } from "./save/store";
import { recordRun } from "./save/schema";
import { mountStudio } from "./ui/studio";
import { mountStart } from "./ui/start";

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
// Saves. The sim knows nothing about any of this — it stays pure and
// deterministic, and main.ts is the only place the two meet.
//
// Only reputation, unlocks and best runs persist. A run in progress is never
// saved: the clock is the point, and a resumable timed run makes the one number
// at the end meaningless. See docs/agentidoltechstack.pdf §7.
// ---------------------------------------------------------------------------

const saves = new SaveManager();
// Fire-and-forget: the game is fully playable while this is in flight, and
// fully playable if it never succeeds.
void saves.sync();

/**
 * Records the finished run exactly once, however the loop got here.
 *
 * Score is final cash — the sim's `finalise()` sets `s.score = round(s.cash)`.
 * The save is written first and unconditionally; the leaderboard submission is
 * allowed to fail, because a board the server never received is a lesser
 * failure than a run the player loses.
 */
let runRecorded = false;
function recordFinishedRun(): void {
  if (runRecorded) return;
  runRecorded = true;
  saves.update(recordRun(saves.getState().save, state.score, state.seed));
  void saves.submitScore(state.score, state.seed);
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

  if (state.finished) {
    // eslint-disable-next-line no-console
    console.log("run finished, score:", state.score);
    recordFinishedRun();
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

// The studio panel pauses the run, but the PAUSED banner behind it is just
// noise — the panel is its own explanation.
let studioOpen = false;

/**
 * False until the player presses START.
 *
 * Every entry point into the loop is guarded on this. Without it, blurring and
 * refocusing the window while the start screen is up would run `resume()` and
 * quietly start the clock behind the start screen.
 */
let runStarted = false;

function syncPauseOverlay(): void {
  setOverlayVisible(runStarted && paused && !studioOpen);
}

function pause(manual: boolean): void {
  if (!runStarted || paused) return;
  paused = true;
  pausedByBlur = !manual;
  stopLoop();
  syncPauseOverlay();
}

function resume(): void {
  if (!runStarted || !paused) return;
  paused = false;
  pausedByBlur = false;
  syncPauseOverlay();
  startLoop();
}

function togglePause(): void {
  if (paused) {
    resume();
  } else {
    pause(true);
  }
}

// A pause the studio panel opened must not resume a run the player had already
// paused deliberately.
let pausedBeforeStudio = false;

const studio = mountStudio(stageEl, saves, (open) => {
  studioOpen = open;
  if (open) {
    pausedBeforeStudio = paused;
    pause(true);
  } else if (!pausedBeforeStudio) {
    resume();
  }
  syncPauseOverlay();
});

refs.studioBtn.addEventListener("pointerdown", () => {
  // The start screen carries the same controls, so the panel would only be
  // covering itself.
  if (start.isVisible()) return;
  if (studio.isOpen()) studio.close();
  else studio.open();
});

// ---------------------------------------------------------------------------
// The start screen gates the clock.
//
// The run does not begin at boot: the loop starts when the player presses
// START. That matters more here than in most games — the clock is the score,
// so a run that has already begun while someone reads their studio key has
// silently cost them.
// ---------------------------------------------------------------------------

const start = mountStart(stageEl, saves, () => {
  runStarted = true;
  // startLoop() reseeds `last`, so the time spent reading the start screen
  // never arrives as one enormous delta on the first frame.
  startLoop();
});

start.show();

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
    // Escape backs out of the studio panel before it touches the run's own
    // pause state, so one key never means two things at once. There is nothing
    // to pause before the run has started.
    if (start.isVisible()) return;
    if (studio.isOpen()) studio.close();
    else togglePause();
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
  hireAgent,
  addAgentToPod,
  removeAgentFromPod,
  get paused() {
    return paused;
  },
};

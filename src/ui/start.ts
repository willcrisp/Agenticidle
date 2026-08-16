/**
 * The start screen — the first thing the player sees, and the gate on the run
 * clock.
 *
 * It exists so a returning player can pick their studio back up before the
 * 30-minute clock starts, rather than discovering their save state while a run
 * is already burning. Nothing here runs the sim: main.ts owns the loop and this
 * only tells it when the player is ready.
 *
 * Three views behind one menu — MENU, STUDIO, SCORES — swapped by class rather
 * than rebuilt, same as everything else in this codebase.
 *
 * "Continue" means your studio continues: reputation, unlocks and best runs
 * carry into a fresh 30 minutes. It does not mean resuming a half-finished run.
 * See the note at the top of src/save/schema.ts.
 */

import type { SaveManager } from "../save/store";
import { buildIdentity, describeSave, el } from "./identity";
import { buildScores } from "./scores";

export interface StartScreen {
  show(): void;
  hide(): void;
  isVisible(): boolean;
}

type View = "menu" | "studio" | "scores";

export function mountStart(
  stage: HTMLElement,
  manager: SaveManager,
  onStart: () => void,
): StartScreen {
  const overlay = el("div", "start-overlay");
  const panel = el("div", "start-panel");

  const title = el("h1", "start-title", "AGENT IDOL");
  const tagline = el("p", "start-tagline", "Thirty minutes. You are the bottleneck.");
  const summary = el("div", "start-summary");

  // ---- menu view ----
  // The one thing worth clicking, so it is the one thing that takes red. That
  // is the floor's vocabulary (red = click it) applied consistently, not an
  // exception to it.
  const startBtn = el("button", "start-btn", "START RUN");
  const scoresBtn = el("button", "studio-btn", "HIGH SCORES");
  // No ampersand: Silkscreen's "&" glyph reads as a "¢" at this size.
  const studioBtn = el("button", "studio-btn", "STUDIO KEY");
  const menuRow = el("div", "studio-actions");
  menuRow.append(scoresBtn, studioBtn);

  const menuView = el("div", "start-view");
  menuView.append(summary, startBtn, menuRow);

  // ---- studio view ----
  const identity = buildIdentity(manager);
  const studioBack = el("button", "studio-btn", "BACK");
  const studioView = el("div", "start-view");
  studioView.append(identity.root, studioBack);

  // ---- scores view ----
  const scores = buildScores(manager);
  const scoresH = el("div", "studio-h", "HIGH SCORES · FINAL CASH");
  const scoresBack = el("button", "studio-btn", "BACK");
  const scoresView = el("div", "start-view");
  scoresView.append(scoresH, scores.root, scoresBack);

  panel.append(title, tagline, menuView, studioView, scoresView);
  overlay.append(panel);
  stage.append(overlay);

  // -------------------------------------------------------------------------

  // The button text is the whole "continue vs new" affordance: a returning
  // player is told which run they are about to play, and a first-time player is
  // never shown a concept they do not have yet.
  manager.subscribe((state) => {
    const { runs } = state.save;
    startBtn.textContent = runs === 0 ? "START YOUR FIRST RUN" : `CONTINUE · START RUN ${runs + 1}`;
    summary.textContent = runs === 0 ? "" : describeSave(state);
  });

  let view: View = "menu";

  function setView(next: View): void {
    view = next;
    menuView.classList.toggle("is-visible", next === "menu");
    studioView.classList.toggle("is-visible", next === "studio");
    scoresView.classList.toggle("is-visible", next === "scores");
    if (next === "studio") identity.reset();
    if (next === "scores") scores.refresh();
  }

  scoresBtn.addEventListener("click", () => setView("scores"));
  studioBtn.addEventListener("click", () => setView("studio"));
  scoresBack.addEventListener("click", () => setView("menu"));
  studioBack.addEventListener("click", () => setView("menu"));

  let visible = false;

  const api: StartScreen = {
    isVisible: () => visible,
    show(): void {
      if (visible) return;
      visible = true;
      setView("menu");
      overlay.classList.add("is-visible");
    },
    hide(): void {
      if (!visible) return;
      visible = false;
      overlay.classList.remove("is-visible");
    },
  };

  startBtn.addEventListener("click", () => {
    api.hide();
    onStart();
  });

  // Escape backs out of a sub-view rather than doing nothing. main.ts leaves
  // Escape alone while the start screen is up, so this is the only handler.
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && view !== "menu") {
      setView("menu");
      e.stopPropagation();
    }
  });

  setView("menu");
  return api;
}

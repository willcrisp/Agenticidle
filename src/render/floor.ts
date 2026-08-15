// Floor orchestrator: binds the whole shell to live sim state each frame and
// reports discrete events for a later WP to consume. Pure — reads state,
// writes DOM, never mutates state.

import type { RunState } from "../sim/state";
import type { Refs } from "./shell";
import { renderTopbar } from "./topbar";
import { renderPod } from "./pod";
import { renderAgents } from "./agent";

export type FloorEvent =
  | { kind: "slice"; agentId: number; pod: number }
  | { kind: "failed"; agentId: number; pod: number }
  | { kind: "delivered"; pod: number; projectId: number; payout: number };

interface BoardCard {
  root: HTMLElement;
  nameEl: HTMLElement;
  payEl: HTMLElement;
  pips: HTMLElement[];
}

const boardCards = new Map<number, BoardCard>();
let lastBoardIds: number[] = [];
const lastBoardPayout = new Map<number, number>();

function createCard(): BoardCard {
  const root = document.createElement("div");
  root.className = "pcard";

  const nameEl = document.createElement("div");
  nameEl.className = "pcard-n";

  const payEl = document.createElement("div");
  payEl.className = "pcard-p";

  const diffrow = document.createElement("div");
  diffrow.className = "diffrow";
  const em = document.createElement("em");
  em.textContent = "DIFFICULTY";
  const pipsWrap = document.createElement("div");
  pipsWrap.className = "pips";
  const pips: HTMLElement[] = [];
  for (let i = 0; i < 5; i++) {
    const pip = document.createElement("i");
    pips.push(pip);
    pipsWrap.appendChild(pip);
  }
  diffrow.append(em, pipsWrap);

  const footer = document.createElement("div");
  footer.className = "pcard-f";

  root.append(nameEl, payEl, diffrow, footer);

  return { root, nameEl, payEl, pips };
}

function renderBoard(state: RunState, refs: Refs): void {
  const ids = state.board.map((p) => p.id);
  const idsChanged =
    ids.length !== lastBoardIds.length || ids.some((id, i) => id !== lastBoardIds[i]);

  if (idsChanged) {
    for (const [id, card] of Array.from(boardCards)) {
      if (ids.includes(id)) continue;
      card.root.remove();
      boardCards.delete(id);
      lastBoardPayout.delete(id);
    }

    for (const p of state.board) {
      let card = boardCards.get(p.id);
      if (!card) {
        card = createCard();
        boardCards.set(p.id, card);
        card.root.dataset.projectId = String(p.id);
        card.nameEl.textContent = p.name;
        for (let i = 0; i < card.pips.length; i++) {
          const pip = card.pips[i];
          if (pip) pip.classList.toggle("on", i < p.difficulty);
        }
        const footer = card.root.querySelector(".pcard-f");
        if (footer) footer.textContent = state.cfg.sizes[p.size].label;
      }
      refs.trayBoard.appendChild(card.root);
    }

    lastBoardIds = ids;
  }

  for (const p of state.board) {
    const card = boardCards.get(p.id);
    if (!card) continue;
    const rounded = Math.round(p.payout);
    if (lastBoardPayout.get(p.id) !== rounded) {
      card.payEl.textContent = "$" + rounded.toLocaleString();
      lastBoardPayout.set(p.id, rounded);
    }
  }
}

interface PrevAgent {
  state: string;
  progress: number;
  pod: number | null;
}

const prevAgents = new Map<number, PrevAgent>();
let prevPods: Array<number | null> = [];
const prevPodPayout = new Map<number, number>();

function detectEvents(state: RunState): FloorEvent[] {
  const events: FloorEvent[] = [];

  for (const a of state.agents) {
    const prev = prevAgents.get(a.id);
    if (prev) {
      if (prev.state === "running" && a.state === "running" && a.progress < prev.progress) {
        if (a.pod !== null) events.push({ kind: "slice", agentId: a.id, pod: a.pod });
      }
      if (prev.state === "running" && a.state === "blocked") {
        const pod = a.pod ?? prev.pod;
        if (pod !== null) events.push({ kind: "failed", agentId: a.id, pod });
      }
    }
  }

  for (let i = 0; i < state.pods.length; i++) {
    const prevId = prevPods[i] ?? null;
    const curProject = state.pods[i] ?? null;
    if (prevId !== null && curProject === null) {
      const payout = prevPodPayout.get(prevId) ?? 0;
      events.push({ kind: "delivered", pod: i, projectId: prevId, payout });
    }
  }

  // ---- update memos ----
  prevAgents.clear();
  for (const a of state.agents) {
    prevAgents.set(a.id, { state: a.state, progress: a.progress, pod: a.pod });
  }

  const nextPrevPods: Array<number | null> = [];
  for (let i = 0; i < state.pods.length; i++) {
    const p = state.pods[i] ?? null;
    nextPrevPods.push(p ? p.id : null);
    if (p) prevPodPayout.set(p.id, p.payout);
  }
  prevPods = nextPrevPods;

  return events;
}

// `alpha` is the interpolation factor from the loop. Accepted and ignored in
// this WP — noUnusedParameters is off, so this is not a lint violation.
export function render(state: RunState, refs: Refs, alpha: number): FloorEvent[] {
  renderTopbar(state, refs);
  for (let i = 0; i < state.pods.length; i++) {
    renderPod(state, refs, i);
  }
  renderAgents(state, refs);
  renderBoard(state, refs);

  return detectEvents(state);
}

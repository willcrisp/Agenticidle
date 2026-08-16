// Hire row binding: whether each hire button is currently a live option.
// Hiring is free, so the only thing that can take a button out of play is
// the roster cap. Pure — reads state, writes DOM, never mutates state.

import type { RunState } from "../sim/state";
import type { Refs } from "./shell";

let lastGreyed: boolean | null = null;

export function renderHire(state: RunState, refs: Refs): void {
  const rosterFull = state.agents.length >= state.cfg.maxRoster;

  // Grey = ignore: the roster's full, so hiring is a no-op right now. Still
  // clickable — like every other drop/retry, a no-op costs nothing.
  if (lastGreyed !== rosterFull) {
    for (const btn of refs.hireButtons) {
      btn.classList.toggle("is-unaffordable", rosterFull);
    }
    lastGreyed = rosterFull;
  }
}

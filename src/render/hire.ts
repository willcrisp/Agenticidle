// Hire row binding: the price on each of the three hire buttons, and whether
// it's currently a live option. Pure — reads state, writes DOM, never
// mutates state.

import type { RunState } from "../sim/state";
import type { Refs } from "./shell";
import { HIRE_CLASSES } from "./shell";
import type { ClassName } from "../sim/config";

const lastCost: (number | null)[] = [];
const lastGreyed: (boolean | null)[] = [];

export function renderHire(state: RunState, refs: Refs): void {
  const rosterFull = state.agents.length >= state.cfg.maxRoster;

  for (let i = 0; i < refs.hireButtons.length; i++) {
    const cls = HIRE_CLASSES[i] as ClassName | undefined;
    if (!cls) continue;
    const cost = state.cfg.classes[cls].cost;

    if (lastCost[i] !== cost) {
      const costEl = refs.hireCosts[i];
      if (costEl) costEl.textContent = "$" + cost.toLocaleString();
      lastCost[i] = cost;
    }

    // Grey = ignore: this hire isn't a live option right now. Still
    // clickable — like every other drop/retry, a no-op costs nothing.
    const greyed = rosterFull || state.cash < cost;
    if (lastGreyed[i] !== greyed) {
      const btn = refs.hireButtons[i];
      if (btn) btn.classList.toggle("is-unaffordable", greyed);
      lastGreyed[i] = greyed;
    }
  }
}

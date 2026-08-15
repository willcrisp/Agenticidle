// Topbar binding: money, credit bar, run clock. Pure — reads state, writes
// DOM, never mutates state. Writes are memoized so unchanged values don't
// thrash layout every frame.

import type { RunState } from "../sim/state";
import type { Refs } from "./shell";

let lastMoney: number | null = null;
let lastMoneyNegative: boolean | null = null;
let lastClock: string | null = null;

function pad2(n: number): string {
  return n < 10 ? "0" + String(n) : String(n);
}

export function renderTopbar(state: RunState, refs: Refs): void {
  // ---- money ----
  const rounded = Math.round(state.cash);
  if (rounded !== lastMoney) {
    refs.money.textContent = "$" + rounded.toLocaleString();
    lastMoney = rounded;
  }
  const negative = state.cash < 0;
  if (negative !== lastMoneyNegative) {
    refs.money.classList.toggle("is-negative", negative);
    lastMoneyNegative = negative;
  }

  // ---- credit bar ----
  const f = Math.max(0, Math.min(1, state.credits / state.cfg.startingCredits));
  refs.creditFill.style.transform = "scaleX(" + f + ")";

  // ---- run clock ----
  const left = Math.max(0, Math.floor(state.cfg.runSeconds - state.t));
  const mins = Math.floor(left / 60);
  const secs = left % 60;
  const clockStr = pad2(mins) + ":" + pad2(secs);
  if (clockStr !== lastClock) {
    refs.clock.textContent = clockStr;
    lastClock = clockStr;
  }
}

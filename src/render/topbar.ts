// Topbar binding: money, tokens, run clock. Pure — reads state, writes to
// the DOM, never mutates state. Writes are memoized so unchanged values don't
// thrash layout every frame.

import type { RunState } from "../sim/state";
import type { Refs } from "./shell";

let lastMoney: number | null = null;
let lastMoneyNegative: boolean | null = null;
let lastTokens: number | null = null;
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

  // ---- tokens ----
  // Just a number. No ceiling, no bar — it decrements as agents burn it and
  // BUY MORE tops it up by a flat lot.
  const tokens = Math.round(state.tokens);
  if (tokens !== lastTokens) {
    refs.tokens.textContent = tokens.toLocaleString();
    lastTokens = tokens;
  }

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

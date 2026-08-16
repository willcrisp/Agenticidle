// Pod binding: open/occupied state, project header, segmented slice bar,
// reasoning dial. Pure — reads state, writes DOM, never mutates state.

import type { Project, RunState } from "../sim/state";
import { HALLUCINATION_TIERS, hallucinationTierIndex, podFailRate } from "../sim/state";
import type { PodRefs, Refs } from "./shell";

const REASONING_ORDER: readonly Project["reasoning"][] = ["low", "medium", "high"];

interface PodMemo {
  projectId: number | null;
  name: string | null;
  payout: number | null;
  halluTier: number | null; // -1 for the "—" no-agents state
}

const memos: PodMemo[] = [];

function memoFor(i: number): PodMemo {
  const existing = memos[i];
  if (existing) return existing;
  const created: PodMemo = { projectId: null, name: null, payout: null, halluTier: null };
  memos[i] = created;
  return created;
}

function renderPips(pips: HTMLElement[], difficulty: number): void {
  for (let i = 0; i < pips.length; i++) {
    const pip = pips[i];
    if (!pip) continue;
    pip.classList.toggle("on", i < difficulty);
  }
}

function renderReasoning(buttons: HTMLElement[], reasoning: Project["reasoning"]): void {
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (!b) continue;
    b.classList.toggle("on", REASONING_ORDER[i] === reasoning);
  }
}

function renderSegments(podRefs: PodRefs, memo: PodMemo, p: Project): void {
  const rest = podRefs.segs.querySelector(".rest");

  // If the project changed, clear out any previously-landed slice elements
  // (everything that isn't the .rest filler) before laying down this
  // project's own slices.
  if (memo.projectId !== p.id) {
    const stale = Array.from(podRefs.segs.children).filter((c) => c !== rest);
    for (const node of stale) node.remove();
    memo.projectId = p.id;
  }

  const currentCount = podRefs.segs.children.length - (rest ? 1 : 0);
  for (let n = currentCount; n < p.slices.length; n++) {
    const width = p.work > 0 ? (p.slices[n] ?? 0) / p.work : 0;
    const seg = document.createElement("i");
    seg.style.width = width * 100 + "%";
    if (rest) {
      podRefs.segs.insertBefore(seg, rest);
    } else {
      podRefs.segs.appendChild(seg);
    }
  }
}

function renderHallucination(podRefs: PodRefs, memo: PodMemo, state: RunState, index: number): void {
  const failRate = podFailRate(state, index);
  // -1 stands in for "no agents on the pod yet" — there's nothing to rate.
  const tier = failRate === null ? -1 : hallucinationTierIndex(state.cfg, failRate);
  if (memo.halluTier === tier) return;
  memo.halluTier = tier;

  const label = tier === -1 ? "—" : HALLUCINATION_TIERS[tier];
  podRefs.halluValue.textContent = label ?? "—";
  for (let i = 0; i < HALLUCINATION_TIERS.length; i++) {
    podRefs.halluValue.classList.toggle("tier-" + i, i === tier);
  }
}

export function renderPod(state: RunState, refs: Refs, index: number): void {
  const podRefs = refs.pods[index];
  if (!podRefs) return;
  const p = state.pods[index] ?? null;
  const memo = memoFor(index);

  podRefs.root.classList.toggle("is-open", p === null);

  if (p === null) {
    if (memo.projectId !== null) {
      const rest = podRefs.segs.querySelector(".rest");
      const stale = Array.from(podRefs.segs.children).filter((c) => c !== rest);
      for (const node of stale) node.remove();
      memo.projectId = null;
      memo.name = null;
      memo.payout = null;
      memo.halluTier = null;
    }
    return;
  }

  if (memo.name !== p.name) {
    podRefs.name.textContent = p.name;
    memo.name = p.name;
  }

  const roundedPayout = Math.round(p.payout);
  if (memo.payout !== roundedPayout) {
    podRefs.payout.textContent = "$" + roundedPayout.toLocaleString();
    memo.payout = roundedPayout;
  }

  renderPips(podRefs.pips, p.difficulty);
  renderReasoning(podRefs.reasoning, p.reasoning);
  renderSegments(podRefs, memo, p);
  renderHallucination(podRefs, memo, state, index);
}

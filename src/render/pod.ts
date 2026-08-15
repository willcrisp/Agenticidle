// Pod binding: open/occupied state, project header, segmented slice bar,
// dial. Pure — reads state, writes DOM, never mutates state.

import type { Project, RunState } from "../sim/state";
import type { PodRefs, Refs } from "./shell";

const DIAL_ORDER: readonly Project["dial"][] = ["slow", "normal", "fast"];

interface PodMemo {
  projectId: number | null;
  name: string | null;
  payout: number | null;
}

const memos: PodMemo[] = [];

function memoFor(i: number): PodMemo {
  const existing = memos[i];
  if (existing) return existing;
  const created: PodMemo = { projectId: null, name: null, payout: null };
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

function renderDials(dials: HTMLElement[], dial: Project["dial"]): void {
  for (let i = 0; i < dials.length; i++) {
    const b = dials[i];
    if (!b) continue;
    b.classList.toggle("on", DIAL_ORDER[i] === dial);
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
  renderDials(podRefs.dials, p.dial);
  renderSegments(podRefs, memo, p);
}

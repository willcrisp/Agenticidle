// Input: the two gestures, and the two plain buttons riding along with them.
// Click anything red (retry a blocked agent). Drag anything amber (an idle
// agent, a board card) into a dashed drop target. No DOM reparenting here —
// the renderer owns that; a drag only ever applies `transform` to the node
// in place and clears it on release.
//
// Why hand-rolled Pointer Events instead of anime.js v4's `createDraggable`:
// Draggable owns the element's transform via its own spring/animatable
// system and assumes the node stays put in the DOM tree it was constructed
// against (it caches container/target bounds). Our stations and cards are
// pooled nodes that `render()` reparents every frame based on sim state —
// exactly the thing WP-5's brief says a drag must never fight. Handing an
// external library ownership of `transform` on a node the renderer also
// reads next frame, across a reparent it doesn't know about, across a
// reduced-motion contract that means "no spring", buys nothing but a footgun
// for a two-gesture, four-drop-target game. A plain
// pointerdown/pointermove/pointerup with `setPointerCapture` gives full
// control over exactly when transform is written and cleared, needs no
// spring config to disable under reduced motion, and keeps every mutation
// routed through `sim/tick.ts` actions as required.

import type { RunState } from "../sim/state";
import type { Refs } from "../render/shell";
import { HIRE_CLASSES } from "../render/shell";
import { stageScale } from "../render/stage";
import type { ClassName } from "../sim/config";
import {
  retryAgent,
  assignAgent,
  acceptProject,
  setReasoning,
  buyTokens,
  hireAgent,
} from "../sim/tick";

const DRAG_THRESHOLD_PX = 4;

type DragState =
  | {
      kind: "agent";
      pointerId: number;
      el: HTMLElement;
      startX: number;
      startY: number;
      moved: boolean;
      agentId: number;
    }
  | {
      kind: "project";
      pointerId: number;
      el: HTMLElement;
      startX: number;
      startY: number;
      moved: boolean;
      boardIndex: number;
    };

// Scale comes from the stage module so there is exactly one copy of the
// formula. A second copy that drifts makes dragged nodes track the cursor at
// the wrong speed.

function isReasoning(v: string | undefined): v is "low" | "medium" | "high" {
  return v === "low" || v === "medium" || v === "high";
}

/**
 * Attaches all input: delegated pointerdown for retry/drag-start/reasoning,
 * document-level pointermove/up for the active drag, and a keydown listener
 * for Enter-to-retry. Returns a teardown fn.
 */
export function mountGestures(state: RunState, refs: Refs): () => void {
  let activeDrag: DragState | null = null;

  function candidatePodIndex(kind: "agent" | "project", x: number, y: number): number | null {
    for (let i = 0; i < refs.pods.length; i++) {
      const pod = refs.pods[i];
      if (!pod) continue;
      const isOpen = pod.root.classList.contains("is-open");
      if (kind === "agent") {
        if (isOpen) continue; // agents need a pod that already has a project
        const r = pod.desks.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
      } else {
        if (!isOpen) continue; // cards only land on an empty, open pod
        const r = pod.root.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
      }
    }
    return null;
  }

  function clearDropHighlights(): void {
    for (const pod of refs.pods) {
      pod.emptySlot.classList.remove("is-drop-target");
      pod.root.classList.remove("is-drop-target");
    }
  }

  function updateDropHighlight(kind: "agent" | "project", x: number, y: number): void {
    clearDropHighlights();
    const idx = candidatePodIndex(kind, x, y);
    if (idx === null) return;
    const pod = refs.pods[idx];
    if (!pod) return;
    if (kind === "agent") pod.emptySlot.classList.add("is-drop-target");
    else pod.root.classList.add("is-drop-target");
  }

  function endDragListeners(el: HTMLElement): void {
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerCancel);
  }

  function settle(drag: DragState): void {
    drag.el.classList.remove("is-dragging");
    drag.el.style.transform = "";
    clearDropHighlights();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
    const rawDx = e.clientX - activeDrag.startX;
    const rawDy = e.clientY - activeDrag.startY;

    if (!activeDrag.moved) {
      if (Math.hypot(rawDx, rawDy) < DRAG_THRESHOLD_PX) return;
      activeDrag.moved = true;
      activeDrag.el.classList.add("is-dragging");
    }

    const scale = stageScale();
    const dx = rawDx / scale;
    const dy = rawDy / scale;
    activeDrag.el.style.transform = `translate(${dx}px, ${dy}px)`;
    updateDropHighlight(activeDrag.kind, e.clientX, e.clientY);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
    const drag = activeDrag;
    activeDrag = null;
    endDragListeners(drag.el);
    if (drag.el.hasPointerCapture(e.pointerId)) {
      drag.el.releasePointerCapture(e.pointerId);
    }

    if (drag.moved) {
      const idx = candidatePodIndex(drag.kind, e.clientX, e.clientY);
      if (idx !== null) {
        if (drag.kind === "agent") {
          assignAgent(state, drag.agentId, idx);
        } else {
          acceptProject(state, drag.boardIndex, idx);
        }
      }
      // idx === null: drop outside any valid target — no penalty, falls
      // through to settle() below which returns the node home.
    }

    settle(drag);
  }

  function onPointerCancel(e: PointerEvent): void {
    if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
    const drag = activeDrag;
    activeDrag = null;
    endDragListeners(drag.el);
    settle(drag);
  }

  function beginDrag(
    e: PointerEvent,
    base: { kind: "agent"; el: HTMLElement; agentId: number } | { kind: "project"; el: HTMLElement; boardIndex: number },
  ): void {
    if (base.kind === "agent") {
      activeDrag = {
        kind: "agent",
        pointerId: e.pointerId,
        el: base.el,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        agentId: base.agentId,
      };
    } else {
      activeDrag = {
        kind: "project",
        pointerId: e.pointerId,
        el: base.el,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        boardIndex: base.boardIndex,
      };
    }
    base.el.setPointerCapture(e.pointerId);
    base.el.addEventListener("pointermove", onPointerMove);
    base.el.addEventListener("pointerup", onPointerUp);
    base.el.addEventListener("pointercancel", onPointerCancel);
  }

  function onPointerDown(e: PointerEvent): void {
    const target = e.target;
    if (!(target instanceof Element)) return;

    // ---- reasoning buttons: never a drag, never a retry ----
    const reasoningBtn = target.closest<HTMLElement>(".reasoning b");
    if (reasoningBtn) {
      const podEl = reasoningBtn.closest<HTMLElement>("[data-pod]");
      const podIndex = podEl ? Number(podEl.dataset.pod) : NaN;
      const reasoning = reasoningBtn.dataset.reasoning;
      if (!Number.isNaN(podIndex) && isReasoning(reasoning)) {
        setReasoning(state, podIndex, reasoning);
      }
      return;
    }

    // ---- click-to-retry: fires on pointerdown, not click, for latency ----
    const blockedStation = target.closest<HTMLElement>(".station.is-blocked");
    if (blockedStation) {
      const id = Number(blockedStation.dataset.agentId);
      if (!Number.isNaN(id)) retryAgent(state, id);
      return;
    }

    // ---- drag source: idle agent station ----
    const idleStation = target.closest<HTMLElement>(".station.is-idle");
    if (idleStation) {
      const id = Number(idleStation.dataset.agentId);
      if (Number.isNaN(id)) return;
      beginDrag(e, { kind: "agent", el: idleStation, agentId: id });
      return;
    }

    // ---- drag source: board project card ----
    const card = target.closest<HTMLElement>(".pcard");
    if (card) {
      const idx = Array.from(refs.trayBoard.children).indexOf(card);
      if (idx < 0) return;
      beginDrag(e, { kind: "project", el: card, boardIndex: idx });
      return;
    }
  }

  // ---- keyboard parity: Enter retries a focused blocked station ----
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== "Enter") return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (!active.classList.contains("station") || !active.classList.contains("is-blocked")) return;
    const id = Number(active.dataset.agentId);
    if (Number.isNaN(id)) return;
    retryAgent(state, id);
  }

  // Always the same lot — no picker. See `buyTokens` in sim/tick.ts.
  function onBuyPointerDown(): void {
    buyTokens(state);
  }

  // Hiring is a plain click, same vocabulary as BUY MORE: it isn't one of the
  // two floor gestures (nothing is dragged, nothing blocked is retried), it's
  // chrome around the economy, styled in the currency it deals in — agents.
  const hireHandlers = refs.hireButtons.map((btn, i) => {
    const cls = HIRE_CLASSES[i] as ClassName | undefined;
    const handler = (): void => {
      if (!cls) return;
      hireAgent(state, cls);
    };
    btn.addEventListener("pointerdown", handler);
    return { btn, handler };
  });

  refs.game.addEventListener("pointerdown", onPointerDown);
  refs.game.addEventListener("keydown", onKeyDown);
  refs.buyBtn.addEventListener("pointerdown", onBuyPointerDown);

  return function teardown(): void {
    refs.game.removeEventListener("pointerdown", onPointerDown);
    refs.game.removeEventListener("keydown", onKeyDown);
    refs.buyBtn.removeEventListener("pointerdown", onBuyPointerDown);
    for (const { btn, handler } of hireHandlers) {
      btn.removeEventListener("pointerdown", handler);
    }
    if (activeDrag) {
      endDragListeners(activeDrag.el);
      settle(activeDrag);
      activeDrag = null;
    }
  };
}

/**
 * Blocked stations are tab-focusable with a visible focus ring; everything
 * else is not. `render()` swaps `.is-blocked` on and off every frame as sim
 * state changes, so this must be re-synced after every render call — wired
 * from the main loop, not from here.
 */
export function syncFocusability(_state: RunState, refs: Refs): void {
  const stations = refs.game.querySelectorAll(".station");
  Array.from(stations).forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.classList.contains("is-blocked")) {
      node.tabIndex = 0;
    } else {
      node.removeAttribute("tabindex");
    }
  });
}

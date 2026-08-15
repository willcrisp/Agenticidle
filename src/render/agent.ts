// Agent binding: a reused node pool, one `.station` per agent for its whole
// lifetime. Reparents between the idle tray and pod desks only when the
// target actually differs. Pure — reads state, writes DOM, never mutates
// state.

import type { Agent, RunState } from "../sim/state";
import type { Refs } from "./shell";
import { buildSprites, type SpriteState } from "./sprites";

const BLOCKED_QUESTIONS: readonly string[] = ["tabs or spaces?", "is it done?", "rebase?"];

interface StationNodes {
  root: HTMLElement;
  bub: HTMLElement;
  sprite: HTMLImageElement;
  plateName: HTMLElement;
  runbarFill: HTMLElement;
}

interface AgentMemo {
  visualState: SpriteState | null;
  stateClass: Agent["state"] | null;
}

const pool = new Map<number, StationNodes>();
const memos = new Map<number, AgentMemo>();

let sprites: Record<string, string> | null = null;

function getSprites(): Record<string, string> {
  if (!sprites) sprites = buildSprites();
  return sprites;
}

function simStateToSprite(state: Agent["state"]): SpriteState {
  switch (state) {
    case "running":
      return "running";
    case "blocked":
      return "blocked";
    default:
      return "idle";
  }
}

function createStation(a: Agent): StationNodes {
  const root = document.createElement("div");
  root.className = "station";
  root.dataset.agentId = String(a.id);

  const bub = document.createElement("div");
  bub.className = "bub";
  bub.textContent = BLOCKED_QUESTIONS[a.id % BLOCKED_QUESTIONS.length] ?? "";
  bub.style.display = "none";

  const sprite = document.createElement("img");
  sprite.className = "sprite";
  sprite.width = 16;
  sprite.height = 16;

  const desk = document.createElement("div");
  desk.className = "desk";

  const plate = document.createElement("div");
  plate.className = "plate";
  const plateName = document.createElement("b");
  plateName.textContent = a.name;
  plate.appendChild(plateName);

  const runbar = document.createElement("div");
  runbar.className = "runbar";
  const runbarFill = document.createElement("i");
  runbar.appendChild(runbarFill);

  root.append(bub, sprite, desk, plate, runbar);

  return { root, bub, sprite, plateName, runbarFill };
}

function targetParent(a: Agent, refs: Refs): HTMLElement | null {
  if (a.pod !== null) {
    const podRefs = refs.pods[a.pod];
    return podRefs ? podRefs.desks : null;
  }
  return refs.trayIdle;
}

export function renderAgents(state: RunState, refs: Refs): void {
  const seen = new Set<number>();

  for (const a of state.agents) {
    seen.add(a.id);

    let nodes = pool.get(a.id);
    if (!nodes) {
      nodes = createStation(a);
      pool.set(a.id, nodes);
      memos.set(a.id, { visualState: null, stateClass: null });
    }
    const memo = memos.get(a.id);
    if (!memo) continue;

    // ---- reparent, only when necessary ----
    const target = targetParent(a, refs);
    if (target && nodes.root.parentElement !== target) {
      if (a.pod !== null) {
        const podRefs = refs.pods[a.pod];
        const emptySlot = podRefs ? podRefs.emptySlot.parentElement : null;
        if (emptySlot) {
          target.insertBefore(nodes.root, emptySlot);
        } else {
          target.appendChild(nodes.root);
        }
      } else {
        target.appendChild(nodes.root);
      }
    }

    // ---- state classes ----
    if (memo.stateClass !== a.state) {
      nodes.root.classList.remove("is-running", "is-blocked", "is-idle");
      nodes.root.classList.add("is-" + a.state);
      memo.stateClass = a.state;
    }

    // ---- sprite ----
    const visual = simStateToSprite(a.state);
    if (memo.visualState !== visual) {
      const src = getSprites()[`${a.cls}:${visual}`];
      if (src) nodes.sprite.src = src;
      memo.visualState = visual;
    }

    // ---- run bar ----
    const runWork = state.cfg.classes[a.cls].runWork;
    const frac = runWork > 0 ? Math.max(0, Math.min(1, a.progress / runWork)) : 0;
    nodes.runbarFill.style.transform = "scaleX(" + frac + ")";

    // ---- blocked bubble ----
    nodes.bub.style.display = a.state === "blocked" ? "" : "none";
  }

  // ---- repossession: drop nodes for agents no longer in state.agents ----
  for (const [id, nodes] of Array.from(pool)) {
    if (seen.has(id)) continue;
    nodes.root.remove();
    pool.delete(id);
    memos.delete(id);
  }

  // ---- swarm: >4 stations in a pod's desks ----
  for (const podRefs of refs.pods) {
    const count = podRefs.desks.querySelectorAll(".station").length;
    podRefs.desks.classList.toggle("swarm", count > 4);
  }
}

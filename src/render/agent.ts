// Agent binding: a reused node pool, one `.station` per agent for its whole
// lifetime. Reparents into a pod's desks only when the target actually
// differs. Pure — reads state, writes DOM, never mutates state.

import type { Agent, RunState } from "../sim/state";
import type { Config } from "../sim/config";
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

function createStation(a: Agent, cfg: Config): StationNodes {
  const cls = cfg.classes[a.cls];

  const root = document.createElement("div");
  root.className = "station";
  root.dataset.agentId = String(a.id);

  const bub = document.createElement("div");
  bub.className = "bub";
  bub.textContent = BLOCKED_QUESTIONS[a.id % BLOCKED_QUESTIONS.length] ?? "";
  bub.style.display = "none";

  // Intelligence rank as stacked chevrons — army-insignia style, more chevrons
  // = smarter. Grey: this is information, not a click/drag/money/token, so it
  // stays in the "ignore" colour per the five-colours rule. An absolute overlay
  // on the sprite corner, so it adds no layout height and doesn't touch the
  // pre-rendered sprite pipeline (the badge overlays, it doesn't resize it).
  const chevrons = document.createElement("div");
  chevrons.className = "chevrons";
  const rank = cls?.chevrons ?? 0;
  for (let i = 0; i < rank; i++) {
    const chev = document.createElement("i");
    chev.className = "chev";
    chevrons.appendChild(chev);
  }

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
  // The class's player-facing name under the agent's own name. Grey = info.
  const clsLabel = document.createElement("small");
  clsLabel.className = "cls-label";
  clsLabel.textContent = cls?.label ?? a.cls;
  plate.append(plateName, clsLabel);

  const runbar = document.createElement("div");
  runbar.className = "runbar";
  const runbarFill = document.createElement("i");
  runbar.appendChild(runbarFill);

  root.append(bub, chevrons, sprite, desk, plate, runbar);

  return { root, bub, sprite, plateName, runbarFill };
}

/**
 * There's no idle tray anymore — ADD hires straight onto a pod and REMOVE
 * fires outright. An idle agent (the run's starting roster, before anyone's
 * touched a control) is simply never mounted: `null` here means "leave its
 * node wherever it already is, unattached," which for a fresh station is
 * nowhere at all.
 */
function targetParent(a: Agent, refs: Refs): HTMLElement | null {
  if (a.pod === null) return null;
  const podRefs = refs.pods[a.pod];
  return podRefs ? podRefs.desks : null;
}

export function renderAgents(state: RunState, refs: Refs): void {
  const seen = new Set<number>();

  for (const a of state.agents) {
    seen.add(a.id);

    let nodes = pool.get(a.id);
    if (!nodes) {
      nodes = createStation(a, state.cfg);
      pool.set(a.id, nodes);
      memos.set(a.id, { visualState: null, stateClass: null });
    }
    const memo = memos.get(a.id);
    if (!memo) continue;

    // ---- reparent, only when necessary ----
    const target = targetParent(a, refs);
    if (target && nodes.root.parentElement !== target) {
      target.appendChild(nodes.root);
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

  // ---- reap orphaned nodes: an agent that's left state.agents (REMOVE fired
  // it) keeps no station. This is plain node-pool cleanup, not a debt/
  // repossession treatment — those mechanics are gone from the sim, so there's
  // no stagger or `.is-repossessed` styling to run here, just the drop. ----
  for (const [id, nodes] of Array.from(pool)) {
    if (seen.has(id)) continue;
    nodes.root.remove();
    pool.delete(id);
    memos.delete(id);
  }

  // ---- density: shrink the stations as a pod fills, up to maxAgentsPerPod.
  // Four tiers at clean pixel-art multiples (64/48/32/16px sprites) so a pod
  // stays legible instead of what the un-tiered version did at 10+ agents —
  // stations and blocked-bubbles overlapping into an unreadable pile.
  for (const podRefs of refs.pods) {
    const count = podRefs.desks.querySelectorAll(".station").length;
    const tier = count > 12 ? "packed" : count > 8 ? "dense" : count > 4 ? "swarm" : "";
    podRefs.desks.classList.toggle("swarm", tier === "swarm");
    podRefs.desks.classList.toggle("dense", tier === "dense");
    podRefs.desks.classList.toggle("packed", tier === "packed");
  }
}

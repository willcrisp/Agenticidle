// Right-click to inspect. One panel, pooled, repositioned and repainted.
//
// Rules this file keeps to:
//
//  * The native browser menu never appears anywhere over the game. Right-click
//    on something with nothing to say shows nothing at all — not an empty
//    panel, not the browser's.
//  * The panel is READ-ONLY. Nothing in it is clickable and nothing it shows
//    can be changed from it. The game still has exactly two gestures; this is
//    a third *look*, not a third gesture, which is why it can afford to carry
//    numbers the HUD is forbidden.
//  * It stays live. Payouts decay and agents block while the panel is open, so
//    every value is repainted from sim state each frame rather than snapshotted
//    at open time.
//
// Presentation only — this module reads sim state and never writes it.

import { CLASS_ORDER, SIZE_ORDER, type ClassName, type SizeName } from "../sim/config";
import type { Project, RunState } from "../sim/state";
import {
  blockPrice,
  deliveriesUntilSize,
  effectiveOneShot,
  escalationT,
  sizeUnlocked,
  tokenPriceMult,
} from "../sim/state";
import { classUnlocked } from "../sim/tick";
import { buildSprites } from "../render/sprites";
import { clock, money, mult, pct, secs } from "./format";

/** Maps onto the five meanings. Anything without a tone is plain text. */
type Tone = "money" | "credit" | "idle" | "fail" | "run" | "dim";

interface Row {
  label: string;
  value: string;
  tone?: Tone;
}

interface Panel {
  title: string;
  /** Small label on the right of the title, e.g. the job size. */
  tag?: string;
  tagTone?: Tone;
  /** Data URL of a 16×16 agent sprite. */
  sprite?: string;
  /** 1..5 difficulty pips, or undefined for none. */
  pips?: number;
  rows: Row[];
  hint?: string;
  hintTone?: Tone;
}

type Builder = () => Panel | null;

export interface Inspector {
  /** Repaint the open panel from live state. Closes it if the subject is gone. */
  render(): void;
  close(): void;
  isOpen(): boolean;
  teardown(): void;
}

const STAGE_W = 1280;
const STAGE_H = 720;
const EDGE = 6;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  content?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function toneClass(tone: Tone | undefined): string {
  return tone ? "t-" + tone : "";
}

function pips(n: number): string {
  return n + (n === 1 ? " PIP" : " PIPS");
}

export function mountInspector(state: RunState, stage: HTMLElement): Inspector {
  const sprites = buildSprites();

  // ---- the pooled panel -------------------------------------------------
  const root = el("div", "inspect");
  const head = el("div", "inspect-head");
  const titleEl = el("div", "inspect-title", "");
  const tagEl = el("div", "inspect-tag", "");
  head.append(titleEl, tagEl);

  const spriteEl = el("img", "sprite inspect-sprite");
  spriteEl.width = 16;
  spriteEl.height = 16;

  const pipsEl = el("div", "inspect-pips");
  const pipNodes: HTMLElement[] = [];
  for (let i = 0; i < 5; i++) {
    const pip = el("i");
    pipNodes.push(pip);
    pipsEl.append(pip);
  }

  const rowsEl = el("div", "inspect-rows");
  const hintEl = el("div", "inspect-hint", "");

  root.append(head, spriteEl, pipsEl, rowsEl, hintEl);
  stage.append(root);

  interface RowNodes {
    root: HTMLElement;
    label: HTMLElement;
    value: HTMLElement;
  }
  const rowPool: RowNodes[] = [];

  let builder: Builder | null = null;
  let anchor = { x: 0, y: 0 };
  // Row labels joined, to know when the panel needs rebuilding rather than
  // repainting. `null` means "nothing painted yet" — distinct from the empty
  // string, which is what a genuinely row-less panel (an empty bay) produces.
  let shape: string | null = null;

  // ---- painting ---------------------------------------------------------

  function ensureRows(n: number): void {
    while (rowPool.length < n) {
      const rowRoot = el("div", "inspect-row");
      const label = el("em", "");
      const value = el("b", "");
      rowRoot.append(label, value);
      rowsEl.append(rowRoot);
      rowPool.push({ root: rowRoot, label, value });
    }
    for (let i = 0; i < rowPool.length; i++) {
      const row = rowPool[i];
      if (row) row.root.style.display = i < n ? "" : "none";
    }
  }

  function paint(panel: Panel): boolean {
    titleEl.textContent = panel.title;

    tagEl.textContent = panel.tag ?? "";
    tagEl.className = "inspect-tag " + toneClass(panel.tagTone);
    tagEl.style.display = panel.tag ? "" : "none";

    if (panel.sprite) {
      if (spriteEl.getAttribute("src") !== panel.sprite) spriteEl.src = panel.sprite;
      spriteEl.style.display = "";
    } else {
      spriteEl.style.display = "none";
    }

    if (panel.pips === undefined) {
      pipsEl.style.display = "none";
    } else {
      pipsEl.style.display = "";
      const hard = panel.pips >= 4;
      pipsEl.classList.toggle("hard", hard);
      for (let i = 0; i < pipNodes.length; i++) {
        const pip = pipNodes[i];
        if (pip) pip.classList.toggle("on", i < panel.pips);
      }
    }

    const nextShape = panel.rows.map((r) => r.label).join("|");
    const rebuilt = nextShape !== shape;
    if (rebuilt) {
      ensureRows(panel.rows.length);
      shape = nextShape;
    }
    for (let i = 0; i < panel.rows.length; i++) {
      const row = panel.rows[i];
      const nodes = rowPool[i];
      if (!row || !nodes) continue;
      if (rebuilt) {
        nodes.label.textContent = row.label;
        nodes.root.classList.toggle("is-gap", row.label === "");
      }
      nodes.value.textContent = row.value;
      nodes.value.className = toneClass(row.tone);
    }

    hintEl.textContent = panel.hint ?? "";
    hintEl.className = "inspect-hint " + toneClass(panel.hintTone);
    hintEl.style.display = panel.hint ? "" : "none";

    return rebuilt;
  }

  /** Anchor is in client pixels; the stage may be scaled by an integer. */
  function place(): void {
    const r = stage.getBoundingClientRect();
    const scale = r.width / STAGE_W || 1;
    const x = (anchor.x - r.left) / scale;
    const y = (anchor.y - r.top) / scale;
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    const px = Math.max(EDGE, Math.min(STAGE_W - w - EDGE, x + EDGE));
    const py = Math.max(EDGE, Math.min(STAGE_H - h - EDGE, y + EDGE));
    root.style.transform = `translate(${px}px, ${py}px)`;
  }

  function render(): void {
    if (!builder) return;
    const panel = builder();
    if (!panel) {
      close();
      return;
    }
    if (paint(panel)) place();
  }

  function close(): void {
    if (!builder) return;
    builder = null;
    shape = null;
    root.classList.remove("is-visible");
  }

  function openWith(next: Builder, clientX: number, clientY: number): void {
    const panel = next();
    if (!panel) {
      close();
      return;
    }
    builder = next;
    anchor = { x: clientX, y: clientY };
    shape = null;
    root.classList.add("is-visible");
    paint(panel);
    place();
  }

  // ---- panel builders ---------------------------------------------------

  const GAP: Row = { label: "", value: "" };

  function stateTone(s: "idle" | "running" | "blocked"): Tone {
    return s === "blocked" ? "fail" : s === "idle" ? "idle" : "run";
  }

  function agentPanel(id: number): Panel | null {
    const a = state.agents.find((x) => x.id === id);
    if (!a) return null;
    const c = state.cfg.classes[a.cls];
    const project = a.pod !== null ? state.pods[a.pod] : null;
    const chance = effectiveOneShot(state.cfg, a.cls, project ? project.difficulty : 1);

    const rows: Row[] = [
      { label: "STATUS", value: a.state.toUpperCase(), tone: stateTone(a.state) },
      { label: "WORKING ON", value: project ? project.name : "NOTHING" },
      { label: "RUN LENGTH", value: c.runWork + "s" },
      {
        label: project ? "ONE-SHOT HERE" : "ONE-SHOT AT 1 PIP",
        value: pct(chance),
      },
      { label: "TOKEN BURN", value: mult(c.burnMult), tone: "credit" },
      GAP,
      { label: "RUNS LANDED", value: String(a.runsGreen), tone: "run" },
      { label: "RUNS BLOCKED", value: String(a.runsRed), tone: "fail" },
      { label: "WORK DELIVERED", value: Math.round(a.workDelivered) + "s" },
      { label: "BLOCKED, TOTAL", value: secs(a.blockedTime) },
      { label: "ON THE FLOOR", value: secs(state.t - a.hiredAt) },
    ];

    if (a.state === "blocked") {
      rows.splice(1, 0, {
        label: "WAITING",
        value: secs(state.t - a.blockedSince),
        tone: "fail",
      });
    }

    return {
      title: a.name,
      tag: c.label,
      sprite: sprites[`${a.cls}:${a.state}`],
      rows,
      hint:
        a.state === "blocked"
          ? "CLICK TO RETRY"
          : a.state === "idle"
            ? "DRAG ONTO A POD"
            : undefined,
      hintTone: a.state === "blocked" ? "fail" : "idle",
    };
  }

  function podPanel(index: number): Panel | null {
    const p = state.pods[index];
    if (!p) {
      return {
        title: "BAY " + (index + 1),
        tag: "EMPTY",
        rows: [],
        hint: "DRAG A PROJECT HERE",
        hintTone: "idle",
      };
    }

    const crew = state.agents.filter((a) => a.pod === index);
    const blocked = crew.filter((a) => a.state === "blocked").length;
    const done = Math.min(1, p.work > 0 ? p.workDone / p.work : 0);

    const rows: Row[] = [
      { label: "OFFERED", value: money(p.originalPayout), tone: "money" },
      { label: "WORTH NOW", value: money(p.payout), tone: "money" },
      { label: "BLED AWAY", value: money(p.originalPayout - p.payout), tone: "dim" },
      GAP,
      { label: "PROGRESS", value: Math.round(p.workDone) + " / " + p.work + "s" },
      { label: "COMPLETE", value: pct(done) },
      { label: "AT THE BUZZER", value: money(p.payout * done), tone: "money" },
      GAP,
      { label: "CREW", value: String(crew.length) },
      { label: "WAITING ON YOU", value: String(blocked), tone: blocked > 0 ? "fail" : "dim" },
      { label: "SPEED", value: p.dial.toUpperCase(), tone: "credit" },
      { label: "ON THE FLOOR", value: secs(state.t - p.acceptedAt) },
    ];

    return {
      title: p.name,
      tag: state.cfg.sizes[p.size].label,
      tagTone: "dim",
      pips: p.difficulty,
      rows,
    };
  }

  function cardPanel(projectId: number): Panel | null {
    const p: Project | undefined = state.board.find((x) => x.id === projectId);
    if (!p) return null;
    const rows: Row[] = [
      { label: "OFFER", value: money(p.payout), tone: "money" },
      { label: "WORK", value: p.work + "s" },
      GAP,
    ];
    for (const cls of CLASS_ORDER) {
      if (!state.agents.some((a) => a.cls === cls)) continue;
      rows.push({
        label: state.cfg.classes[cls].label + " ONE-SHOT",
        value: pct(effectiveOneShot(state.cfg, cls, p.difficulty)),
      });
    }
    return {
      title: p.name,
      tag: state.cfg.sizes[p.size].label,
      tagTone: "dim",
      pips: p.difficulty,
      rows,
      hint: "DRAG ONTO AN EMPTY BAY",
      hintTone: "idle",
    };
  }

  function dialPanel(podIndex: number, dial: "slow" | "normal" | "fast"): Panel | null {
    const d = state.cfg.dials[dial];
    const p = state.pods[podIndex];
    if (!p) return null;
    const rows: Row[] = [
      { label: "WORK SPEED", value: mult(d.speed), tone: "run" },
      { label: "TOKEN BURN", value: mult(d.burn), tone: "credit" },
      { label: "SET NOW", value: p.dial === dial ? "YES" : "NO" },
    ];
    if (state.slowLocked) {
      rows.push({ label: "DEBT LOCK", value: "SLOW ONLY", tone: "fail" });
    }
    return { title: dial.toUpperCase(), tag: "DIAL", tagTone: "dim", rows };
  }

  function creditsPanel(): Panel {
    const running = state.agents.filter((a) => a.state === "running").length;
    const discount = 1 - tokenPriceMult(state);
    const rows: Row[] = [
      { label: "TOKENS LEFT", value: Math.round(state.credits).toLocaleString(), tone: "credit" },
      { label: "AGENTS BURNING", value: String(running) },
      { label: "BOUGHT THIS RUN", value: state.creditsBought.toLocaleString() },
      { label: "SPENT ON TOKENS", value: money(state.telemetry.moneySpentOnCredits), tone: "money" },
      GAP,
    ];
    for (let i = 0; i < state.cfg.credits.blocks.length; i++) {
      const block = state.cfg.credits.blocks[i];
      if (!block) continue;
      rows.push({
        label: block.tokens.toLocaleString() + " TOKENS",
        value: money(blockPrice(state, i)),
        tone: "money",
      });
    }
    if (discount > 0) {
      rows.push({ label: "DELIVERY DISCOUNT", value: pct(discount), tone: "money" });
    }
    return {
      title: "CREDITS",
      rows,
      hint: "LEFTOVERS SCORE NOTHING",
      hintTone: "dim",
    };
  }

  function moneyPanel(): Panel {
    const t = state.telemetry;
    const rows: Row[] = [
      { label: "CASH", value: money(state.cash), tone: "money" },
      { label: "DELIVERED", value: String(state.deliveries) },
      GAP,
      { label: "SPENT ON TOKENS", value: money(t.moneySpentOnCredits), tone: "money" },
      { label: "SPENT ON HIRING", value: money(t.moneySpentOnAgents), tone: "money" },
      { label: "SPENT ON LICENCES", value: money(t.moneySpentOnModels), tone: "money" },
    ];
    if (state.cash < 0) {
      rows.push(
        GAP,
        { label: "SLOW LOCK AT", value: money(state.cfg.debt.slowLockAt), tone: "fail" },
        { label: "REPOSSESSION AT", value: money(state.cfg.debt.repoAt), tone: "fail" },
      );
    }
    return {
      title: "MONEY",
      rows,
      hint: state.cash < 0 ? "THE RUN NEVER ENDS EARLY" : undefined,
      hintTone: "dim",
    };
  }

  function clockPanel(): Panel {
    const left = Math.max(0, state.cfg.runSeconds - state.t);
    const k = escalationT(state);
    const e = state.cfg.escalation;
    return {
      title: "RUN CLOCK",
      rows: [
        { label: "ELAPSED", value: clock(state.t) },
        { label: "REMAINING", value: clock(left) },
        GAP,
        { label: "DELIVERED", value: String(state.deliveries) },
        {
          label: "BOARD PAYOUT",
          value: mult(1 + (e.payoutEndMult - 1) * k),
          tone: "money",
        },
        {
          label: "BOARD DIFFICULTY",
          value: pips(
            Math.round(e.difficultyStart + (e.difficultyEnd - e.difficultyStart) * k)
          ),
        },
      ],
      hint: "UNFINISHED WORK PAYS ITS %",
      hintTone: "dim",
    };
  }

  function rosterPanel(): Panel {
    const rows: Row[] = [];
    for (const cls of CLASS_ORDER) {
      const c = state.cfg.classes[cls];
      const owned = state.agents.filter((a) => a.cls === cls).length;
      if (classUnlocked(state, cls)) {
        rows.push({
          label: c.label,
          value: owned > 0 ? "×" + owned + "  ·  " + money(c.cost) : money(c.cost),
          tone: "money",
        });
      } else {
        rows.push({
          label: c.label,
          value: "LICENCE " + money(c.licenceCost),
          tone: "dim",
        });
      }
    }
    rows.push(
      GAP,
      { label: "IDLE", value: String(state.agents.filter((a) => a.state === "idle").length), tone: "idle" },
      { label: "RUNNING", value: String(state.agents.filter((a) => a.state === "running").length), tone: "run" },
      { label: "BLOCKED", value: String(state.agents.filter((a) => a.state === "blocked").length), tone: "fail" },
      { label: "ROSTER CAP", value: state.agents.length + " / " + state.cfg.maxRoster },
    );
    return { title: "ROSTER", rows, hint: "HIRE OPENS PROCUREMENT", hintTone: "dim" };
  }

  function sizeStatus(size: SizeName): Row {
    const sc = state.cfg.sizes[size];
    if (sizeUnlocked(state, size)) {
      return { label: sc.label, value: "ON THE BOARD", tone: "money" };
    }
    const left = deliveriesUntilSize(state, size);
    const at = sc.unlockAtRunFraction * state.cfg.runSeconds;
    return {
      label: sc.label,
      value: left > 0 ? left + " MORE  ·  " + clock(at) : clock(at),
      tone: "dim",
    };
  }

  function boardPanel(): Panel {
    const rows: Row[] = SIZE_ORDER.map(sizeStatus);
    if (state.board.length < state.cfg.boardSlots) {
      rows.push(GAP, {
        label: "NEXT CARD IN",
        value: secs(Math.max(0, state.boardRefillAt - state.t)),
      });
    }
    return {
      title: "THE BOARD",
      rows,
      hint: "DELIVERIES OPEN BIGGER JOBS",
      hintTone: "dim",
    };
  }

  function modelPanel(cls: ClassName): Panel {
    const c = state.cfg.classes[cls];
    const unlocked = classUnlocked(state, cls);
    const owned = state.agents.filter((a) => a.cls === cls).length;
    return {
      title: c.label,
      tag: unlocked ? "LICENSED" : "LOCKED",
      tagTone: unlocked ? "money" : "dim",
      sprite: sprites[`${cls}:idle`],
      rows: [
        { label: "LICENCE", value: unlocked ? "OWNED" : money(c.licenceCost), tone: "money" },
        { label: "PER HIRE", value: money(c.cost), tone: "money" },
        { label: "ON THE FLOOR", value: "×" + owned },
        GAP,
        { label: "RUN LENGTH", value: c.runWork + "s" },
        { label: "ONE-SHOT AT 1 PIP", value: pct(effectiveOneShot(state.cfg, cls, 1)) },
        { label: "ONE-SHOT AT 5 PIPS", value: pct(effectiveOneShot(state.cfg, cls, 5)) },
        { label: "TOKEN BURN", value: mult(c.burnMult), tone: "credit" },
      ],
      hint: unlocked ? "CLICK TO HIRE ONE" : "CLICK TO BUY THE LICENCE",
      hintTone: "dim",
    };
  }

  function blockPanel(index: number): Panel | null {
    const block = state.cfg.credits.blocks[index];
    if (!block) return null;
    const discount = 1 - tokenPriceMult(state);
    const rows: Row[] = [
      { label: "TOKENS", value: block.tokens.toLocaleString(), tone: "credit" },
      { label: "LIST PRICE", value: money(block.price), tone: "dim" },
      { label: "PRICE NOW", value: money(blockPrice(state, index)), tone: "money" },
      { label: "DELIVERY DISCOUNT", value: pct(discount) },
    ];
    return {
      title: block.tokens.toLocaleString() + " TOKENS",
      tag: "BLOCK",
      tagTone: "dim",
      rows,
      hint: "BUYING CAN PUT YOU IN DEBT",
      hintTone: "dim",
    };
  }

  // ---- target resolution ------------------------------------------------

  function isDial(v: string | undefined): v is "slow" | "normal" | "fast" {
    return v === "slow" || v === "normal" || v === "fast";
  }

  function podIndexOf(node: Element): number | null {
    const podEl = node.closest<HTMLElement>("[data-pod]");
    if (!podEl) return null;
    const i = Number(podEl.dataset.pod);
    return Number.isNaN(i) ? null : i;
  }

  function resolve(target: Element): Builder | null {
    const dialBtn = target.closest<HTMLElement>(".dial b");
    if (dialBtn) {
      const dial = dialBtn.dataset.dial;
      const pod = podIndexOf(dialBtn);
      if (isDial(dial) && pod !== null) return () => dialPanel(pod, dial);
      return null;
    }

    const station = target.closest<HTMLElement>(".station[data-agent-id]");
    if (station) {
      const id = Number(station.dataset.agentId);
      if (!Number.isNaN(id)) return () => agentPanel(id);
      return null;
    }

    const card = target.closest<HTMLElement>(".pcard[data-project-id]");
    if (card) {
      const id = Number(card.dataset.projectId);
      if (!Number.isNaN(id)) return () => cardPanel(id);
      return null;
    }

    const modelRow = target.closest<HTMLElement>(".shop-row.model[data-cls]");
    if (modelRow) {
      const cls = modelRow.dataset.cls as ClassName | undefined;
      if (cls) return () => modelPanel(cls);
      return null;
    }

    const tokenRow = target.closest<HTMLElement>(".shop-row.tok[data-block]");
    if (tokenRow) {
      const i = Number(tokenRow.dataset.block);
      if (!Number.isNaN(i)) return () => blockPanel(i);
      return null;
    }

    const pod = podIndexOf(target);
    if (pod !== null) return () => podPanel(pod);

    const inspect = target.closest<HTMLElement>("[data-inspect]");
    switch (inspect?.dataset.inspect) {
      case "credits":
        return creditsPanel;
      case "money":
        return moneyPanel;
      case "clock":
        return clockPanel;
      case "roster":
        return rosterPanel;
      case "board":
        return boardPanel;
      default:
        return null;
    }
  }

  // ---- input ------------------------------------------------------------

  function onContextMenu(e: MouseEvent): void {
    // Suppressed everywhere, unconditionally. Whether we then have something
    // to show is a separate question.
    e.preventDefault();
    const target = e.target;
    if (!(target instanceof Element)) {
      close();
      return;
    }
    const next = resolve(target);
    if (!next) {
      close();
      return;
    }
    openWith(next, e.clientX, e.clientY);
  }

  function onPointerDown(e: PointerEvent): void {
    // The right-button press that is about to open a panel arrives here first;
    // closing on it is harmless, since `contextmenu` reopens immediately.
    if (e.button === 2) return;
    close();
  }

  function onBlur(): void {
    close();
  }

  document.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("blur", onBlur);

  return {
    render,
    close,
    isOpen: () => builder !== null,
    teardown() {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
      root.remove();
    },
  };
}

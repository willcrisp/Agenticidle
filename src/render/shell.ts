// The static floor shell: builds the entire 1280x720 game DOM once, with
// every element the renderer will need to touch later returned as typed
// handles. Nothing here binds to sim state, attaches listeners, or animates
// anything. Ported from docs/agent-idol-v9.html's `.game` markup with all
// fake demo data stripped — see CLAUDE.md and the WP-2 brief for the list of
// deliberate deviations from the mockup (run clock, `.is-open` instead of
// `.open`, `<img class="sprite">` nodes instead of pixel-plotted elements,
// no `.cred-v`, etc).

const POD_COUNT = 4;
const REASONING_KEYS: readonly string[] = ["low", "medium", "high"];
const REASONING_LABELS: readonly string[] = ["LOW", "MEDIUM", "HIGH"];
/** The three agent classes on offer. Order matches the hire row, left to right. */
export const HIRE_CLASSES: readonly string[] = ["starter", "senior", "elite"];
const HIRE_LABELS: readonly string[] = ["STARTER", "SENIOR", "ELITE"];

export interface PodRefs {
  root: HTMLElement;
  name: HTMLElement;
  pips: HTMLElement[]; // length 5
  payout: HTMLElement;
  segs: HTMLElement; // slice container
  reasoning: HTMLElement[]; // length 3, order [low, medium, high]
  halluValue: HTMLElement; // the LOW/MEDIUM/HIGH/VERY HIGH/EXTREME text
  desks: HTMLElement; // agent stations reparent into here
  emptySlot: HTMLElement; // the dashed DROP HERE target inside .desks
  open: HTMLElement; // the "EMPTY / DRAG A PROJECT HERE" message div
}

export interface Refs {
  game: HTMLElement;
  money: HTMLElement;
  creditFill: HTMLElement; // the scaleX target
  creditLabel: HTMLElement;
  buyBtn: HTMLElement;
  clock: HTMLElement;
  pauseBtn: HTMLElement;
  studioBtn: HTMLElement;
  pods: PodRefs[]; // length 4
  trayIdle: HTMLElement; // container for idle agent nodes
  trayBoard: HTMLElement; // container for project cards
  hireButtons: HTMLElement[]; // length 3, order matches HIRE_CLASSES
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function text(tag: keyof HTMLElementTagNameMap, className: string, content: string): HTMLElement {
  const node = el(tag, className);
  node.textContent = content;
  return node;
}

function buildTopbar(): {
  topbar: HTMLElement;
  money: HTMLElement;
  creditFill: HTMLElement;
  creditLabel: HTMLElement;
  buyBtn: HTMLElement;
  clock: HTMLElement;
  pauseBtn: HTMLElement;
  studioBtn: HTMLElement;
} {
  const topbar = el("div", "topbar");

  // The value lives in its own node so the renderer can write textContent to
  // it every frame without clobbering the "MONEY" label beside it.
  const money = el("div", "money");
  const moneyValue = text("b", "money-v", "$0");
  const moneyLabel = text("span", "", "MONEY");
  money.append(moneyValue, moneyLabel);

  const credits = el("div", "credits");
  const credTop = el("div", "cred-top");
  const creditLabel = text("span", "cred-l", "CREDITS");
  credTop.append(creditLabel);
  const credBar = el("div", "cred-bar");
  const creditFill = el("i");
  const credTick = el("u");
  credBar.append(creditFill, credTick);
  credits.append(credTop, credBar);

  const buyBtn = text("div", "buy", "BUY MORE");
  buyBtn.id = "buy";

  const spacer = el("div", "spacer");

  const clock = text("div", "clock", "30:00");
  clock.id = "clock";

  const pauseBtn = text("div", "pause", "❚❚");
  pauseBtn.id = "pause";

  // Grey, and sat with the pause button rather than the money/credit cluster:
  // it is chrome, not a game action. Nothing on the floor depends on it.
  const studioBtn = text("div", "studio-btn-top", "STUDIO");
  studioBtn.id = "studio";

  topbar.append(money, credits, buyBtn, spacer, clock, studioBtn, pauseBtn);

  return {
    topbar,
    money: moneyValue,
    creditFill,
    creditLabel,
    buyBtn,
    clock,
    pauseBtn,
    studioBtn,
  };
}

function buildPod(index: number): PodRefs {
  const root = el("div", "pod");
  root.dataset.pod = String(index);

  // ---- header ----
  const podH = el("div", "pod-h");
  const r1 = el("div", "pod-r1");
  const name = el("div", "pod-name");

  const podDiff = el("span", "pod-diff");
  const pips: HTMLElement[] = [];
  for (let i = 0; i < 5; i++) {
    const pip = el("i");
    pips.push(pip);
    podDiff.append(pip);
  }

  const payout = text("div", "pod-pay", "$0");
  payout.style.marginLeft = "auto";

  r1.append(name, podDiff, payout);

  const segs = el("div", "segs");
  const rest = el("span", "rest");
  segs.append(rest);

  // The caption sits inline with the buttons rather than on its own line: the
  // pod header is fixed-height inside the 720px stage, so a second row would
  // come out of the desks below it.
  const dialRow = el("div", "reasoning");
  dialRow.append(text("span", "reasoning-l", "REASONING"));
  const reasoning: HTMLElement[] = [];
  for (let i = 0; i < REASONING_KEYS.length; i++) {
    const key = REASONING_KEYS[i];
    const label = REASONING_LABELS[i];
    if (key === undefined || label === undefined) continue;
    const b = text("b", "", label);
    b.dataset.reasoning = key;
    reasoning.push(b);
    dialRow.append(b);
  }

  // Its own row, not crammed onto REASONING's — three dial buttons plus a
  // caption already use most of that row's width, and this is a readout,
  // not a fourth button. The desks area below has slack for it (agent
  // stations bottom-align and don't use their full height budget).
  const halluRow = el("div", "hallu");
  halluRow.append(text("span", "hallu-l", "HALLUCINATION"));
  const halluValue = text("b", "hallu-v", "—");
  halluRow.append(halluValue);

  podH.append(r1, segs, dialRow, halluRow);

  // ---- desks ----
  const desks = el("div", "desks");
  const empty = el("div", "empty");
  const emptySlot = text("div", "empty-slot", "DROP HERE");
  empty.append(emptySlot);
  desks.append(empty);

  // ---- open-pod message ----
  const open = el("div", "pod-open");
  const openLine1 = text("div", "", "EMPTY");
  const openLine2 = text("div", "", "DRAG A PROJECT HERE");
  open.append(openLine1, openLine2);

  root.append(podH, desks, open);

  return { root, name, pips, payout, segs, reasoning, halluValue, desks, emptySlot, open };
}

function buildHireRow(): { hireRow: HTMLElement; hireButtons: HTMLElement[] } {
  const hireRow = el("div", "hire-row");
  const hireButtons: HTMLElement[] = [];
  for (let i = 0; i < HIRE_CLASSES.length; i++) {
    const cls = HIRE_CLASSES[i];
    const label = HIRE_LABELS[i];
    if (cls === undefined || label === undefined) continue;
    // No price on the button — hiring is free. The only thing worth
    // learning by trying is that a bigger fleet costs you in crowding and
    // credits once you actually put it to work, not at the door.
    const btn = text("button", "hire-btn", "+" + label);
    btn.dataset.hire = cls;
    hireButtons.push(btn);
    hireRow.append(btn);
  }
  return { hireRow, hireButtons };
}

function buildTray(): {
  tray: HTMLElement;
  trayIdle: HTMLElement;
  trayBoard: HTMLElement;
  hireButtons: HTMLElement[];
} {
  const tray = el("div", "tray");

  const idleHalf = el("div", "tray-half");
  const idleHeadingRow = el("div", "tray-h-row");
  const idleHeading = text("div", "tray-h a", "DOING NOTHING");
  const { hireRow, hireButtons } = buildHireRow();
  idleHeadingRow.append(idleHeading, hireRow);
  const trayIdle = el("div", "tray-row tray-idle");
  idleHalf.append(idleHeadingRow, trayIdle);

  const boardHalf = el("div", "tray-half");
  const boardHeading = text("div", "tray-h b", "PROJECTS AVAILABLE");
  const trayBoard = el("div", "tray-row");
  boardHalf.append(boardHeading, trayBoard);

  tray.append(idleHalf, boardHalf);

  return { tray, trayIdle, trayBoard, hireButtons };
}

/**
 * Builds the whole floor once: clears `root`, constructs the full DOM tree
 * with `document.createElement`, appends it, and returns typed handles to
 * every element the renderer needs. No sim binding, no listeners, no
 * animation — those belong to later work packages.
 */
export function buildShell(root: HTMLElement): Refs {
  while (root.firstChild) {
    root.removeChild(root.firstChild);
  }

  const game = el("div", "game");

  const { topbar, money, creditFill, creditLabel, buyBtn, clock, pauseBtn, studioBtn } =
    buildTopbar();

  const podsContainer = el("div", "pods");
  const pods: PodRefs[] = [];
  for (let i = 0; i < POD_COUNT; i++) {
    const pod = buildPod(i);
    pods.push(pod);
    podsContainer.append(pod.root);
  }

  const { tray, trayIdle, trayBoard, hireButtons } = buildTray();

  game.append(topbar, podsContainer, tray);
  root.append(game);

  return {
    game,
    money,
    creditFill,
    creditLabel,
    buyBtn,
    clock,
    pauseBtn,
    studioBtn,
    pods,
    trayIdle,
    trayBoard,
    hireButtons,
  };
}

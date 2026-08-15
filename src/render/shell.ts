// The static floor shell: builds the entire 1280x720 game DOM once, with
// every element the renderer will need to touch later returned as typed
// handles. Nothing here binds to sim state, attaches listeners, or animates
// anything. Ported from docs/agent-idol-v9.html's `.game` markup with all
// fake demo data stripped — see CLAUDE.md and the WP-2 brief for the list of
// deliberate deviations from the mockup (run clock, `.is-open` instead of
// `.open`, `<img class="sprite">` nodes instead of pixel-plotted elements,
// no `.cred-v`, etc).

const POD_COUNT = 4;
const DIAL_KEYS: readonly string[] = ["slow", "normal", "fast"];
const DIAL_LABELS: readonly string[] = ["SLOW", "NORMAL", "FAST"];

export interface PodRefs {
  root: HTMLElement;
  name: HTMLElement;
  pips: HTMLElement[]; // length 5
  payout: HTMLElement;
  segs: HTMLElement; // slice container
  dials: HTMLElement[]; // length 3, order [slow, normal, fast]
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
  hireBtn: HTMLElement;
  clock: HTMLElement;
  pauseBtn: HTMLElement;
  pods: PodRefs[]; // length 4
  trayIdle: HTMLElement; // container for idle agent nodes
  trayBoard: HTMLElement; // container for project cards
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
  hireBtn: HTMLElement;
  clock: HTMLElement;
  pauseBtn: HTMLElement;
} {
  const topbar = el("div", "topbar");

  // The value lives in its own node so the renderer can write textContent to
  // it every frame without clobbering the "MONEY" label beside it.
  const money = el("div", "money");
  money.dataset.inspect = "money";
  const moneyValue = text("b", "money-v", "$0");
  const moneyLabel = text("span", "", "MONEY");
  money.append(moneyValue, moneyLabel);

  const credits = el("div", "credits");
  credits.dataset.inspect = "credits";
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
  buyBtn.dataset.inspect = "credits";

  // Money-coloured, because what it spends is money — the same rule that makes
  // the token button credit-blue.
  const hireBtn = text("div", "hire", "HIRE");
  hireBtn.id = "hire";
  hireBtn.dataset.inspect = "roster";

  const spacer = el("div", "spacer");

  const clock = text("div", "clock", "30:00");
  clock.id = "clock";
  clock.dataset.inspect = "clock";

  const pauseBtn = text("div", "pause", "❚❚");
  pauseBtn.id = "pause";

  topbar.append(money, credits, buyBtn, hireBtn, spacer, clock, pauseBtn);

  return { topbar, money: moneyValue, creditFill, creditLabel, buyBtn, hireBtn, clock, pauseBtn };
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

  const dial = el("div", "dial");
  const dials: HTMLElement[] = [];
  for (let i = 0; i < DIAL_KEYS.length; i++) {
    const key = DIAL_KEYS[i];
    const label = DIAL_LABELS[i];
    if (key === undefined || label === undefined) continue;
    const b = text("b", "", label);
    b.dataset.dial = key;
    dials.push(b);
    dial.append(b);
  }

  podH.append(r1, segs, dial);

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

  return { root, name, pips, payout, segs, dials, desks, emptySlot, open };
}

function buildTray(): { tray: HTMLElement; trayIdle: HTMLElement; trayBoard: HTMLElement } {
  const tray = el("div", "tray");

  const idleHalf = el("div", "tray-half");
  idleHalf.dataset.inspect = "roster";
  const idleHeading = text("div", "tray-h a", "DOING NOTHING");
  const trayIdle = el("div", "tray-row tray-idle");
  idleHalf.append(idleHeading, trayIdle);

  const boardHalf = el("div", "tray-half");
  boardHalf.dataset.inspect = "board";
  const boardHeading = text("div", "tray-h b", "PROJECTS AVAILABLE");
  const trayBoard = el("div", "tray-row");
  boardHalf.append(boardHeading, trayBoard);

  tray.append(idleHalf, boardHalf);

  return { tray, trayIdle, trayBoard };
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

  const { topbar, money, creditFill, creditLabel, buyBtn, hireBtn, clock, pauseBtn } =
    buildTopbar();

  const podsContainer = el("div", "pods");
  const pods: PodRefs[] = [];
  for (let i = 0; i < POD_COUNT; i++) {
    const pod = buildPod(i);
    pods.push(pod);
    podsContainer.append(pod.root);
  }

  const { tray, trayIdle, trayBoard } = buildTray();

  game.append(topbar, podsContainer, tray);
  root.append(game);

  return {
    game,
    money,
    creditFill,
    creditLabel,
    buyBtn,
    hireBtn,
    clock,
    pauseBtn,
    pods,
    trayIdle,
    trayBoard,
  };
}

// PROCUREMENT — the one place money leaves the floor.
//
// Two columns, because there are exactly two things worth buying: tokens to
// keep the agents you have running, and models to get better ones. Both were
// already sim actions; this is the surface that lets a player reach them.
//
// The panel does not pause the run. Spending while the clock burns and four
// pods decay is the decision — a paused shop would hand it back for free.
//
// Every node is built once here and only its text/classes are rewritten each
// frame. Nothing in this file mutates sim state except through the actions in
// sim/tick.ts.

import { CLASS_ORDER, type ClassName } from "../sim/config";
import type { RunState } from "../sim/state";
import { blockPrice } from "../sim/state";
import {
  buyCreditBlock,
  buyModelLicence,
  classUnlocked,
  hireAgent,
} from "../sim/tick";
import { buildSprites } from "../render/sprites";
import { money, mult, pct } from "./format";

export type ShopSection = "tokens" | "models";

export interface Shop {
  open(section?: ShopSection): void;
  close(): void;
  isOpen(): boolean;
  /** Repaint prices and affordability. Cheap; safe to call every frame. */
  render(): void;
  teardown(): void;
}

interface TokenRow {
  root: HTMLElement;
  price: HTMLElement;
}

interface ModelRow {
  root: HTMLElement;
  owned: HTMLElement;
  action: HTMLElement;
  cls: ClassName;
}

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

export function mountShop(state: RunState, stage: HTMLElement): Shop {
  const sprites = buildSprites();

  const scrim = el("div", "shop-scrim");
  const panel = el("div", "shop");

  // ---- header ----
  const head = el("div", "shop-head");
  const title = el("div", "shop-title", "PROCUREMENT");
  const roster = el("div", "shop-roster", "");
  const closeBtn = el("div", "shop-close", "×");
  head.append(title, roster, closeBtn);

  // ---- tokens column ----
  const tokensCol = el("div", "shop-col");
  tokensCol.dataset.section = "tokens";
  tokensCol.append(el("div", "shop-h tok", "TOKENS"));
  tokensCol.append(
    el("div", "shop-note", "Agents burn these while they run. Buying in bulk costs less per token, and every delivery drops the price."),
  );
  const tokenRows: TokenRow[] = state.cfg.credits.blocks.map((block, i) => {
    const root = el("div", "shop-row tok");
    root.dataset.block = String(i);
    const label = el("div", "shop-row-n", block.tokens.toLocaleString() + " TOKENS");
    const price = el("div", "shop-row-p", "");
    root.append(label, price);
    tokensCol.append(root);
    return { root, price };
  });

  // ---- models column ----
  const modelsCol = el("div", "shop-col");
  modelsCol.dataset.section = "models";
  modelsCol.append(el("div", "shop-h ok", "MODELS"));
  modelsCol.append(
    el("div", "shop-note", "A licence is a one-off. Once you hold it you can hire that model as often as you can afford it."),
  );
  const modelRows: ModelRow[] = CLASS_ORDER.map((cls) => {
    const c = state.cfg.classes[cls];
    const root = el("div", "shop-row model");
    root.dataset.cls = cls;

    const sprite = el("img", "sprite");
    sprite.src = sprites[`${cls}:idle`] ?? "";
    sprite.width = 16;
    sprite.height = 16;

    const body = el("div", "shop-row-body");
    const nameLine = el("div", "shop-row-top");
    const name = el("div", "shop-row-n", c.label);
    const owned = el("div", "shop-owned", "");
    nameLine.append(name, owned);
    const stats = el(
      "div",
      "shop-stats",
      `${c.runWork}s RUNS  ·  ${pct(c.oneShot)} ONE-SHOT  ·  ${mult(c.burnMult)} BURN`,
    );
    const blurb = el("div", "shop-blurb", c.blurb);
    body.append(nameLine, stats, blurb);

    const action = el("div", "shop-buy", "");

    root.append(sprite, body, action);
    modelsCol.append(root);
    return { root, owned, action, cls };
  });

  const cols = el("div", "shop-cols");
  cols.append(tokensCol, modelsCol);
  panel.append(head, cols);
  scrim.append(panel);
  stage.append(scrim);

  let open = false;

  function render(): void {
    if (!open) return;

    roster.textContent = `ROSTER ${state.agents.length} / ${state.cfg.maxRoster}`;

    for (let i = 0; i < tokenRows.length; i++) {
      const row = tokenRows[i];
      if (!row) continue;
      // Tokens can always be bought, even into debt. That is the sim's rule and
      // the reason there is no game over — so no row is ever disabled here.
      row.price.textContent = money(blockPrice(state, i));
    }

    const full = state.agents.length >= state.cfg.maxRoster;
    for (const row of modelRows) {
      const c = state.cfg.classes[row.cls];
      const count = state.agents.filter((a) => a.cls === row.cls).length;
      row.owned.textContent = count > 0 ? "×" + count : "";

      const unlocked = classUnlocked(state, row.cls);
      const price = unlocked ? c.cost : c.licenceCost;
      const affordable = state.cash >= price && (!unlocked || !full);
      row.action.textContent = (unlocked ? "HIRE " : "LICENCE ") + money(price);
      row.root.classList.toggle("is-locked", !unlocked);
      row.root.classList.toggle("is-unaffordable", !affordable);
    }
  }

  function setOpen(next: boolean, section?: ShopSection): void {
    if (open === next) {
      if (next && section) focusSection(section);
      return;
    }
    open = next;
    scrim.classList.toggle("is-visible", open);
    if (open) {
      if (section) focusSection(section);
      render();
    }
  }

  function focusSection(section: ShopSection): void {
    tokensCol.classList.toggle("is-focus", section === "tokens");
    modelsCol.classList.toggle("is-focus", section === "models");
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const target = e.target;
    if (!(target instanceof Element)) return;

    if (target === scrim || target.closest(".shop-close")) {
      setOpen(false);
      return;
    }

    const tokenRow = target.closest<HTMLElement>(".shop-row.tok");
    if (tokenRow) {
      const i = Number(tokenRow.dataset.block);
      if (!Number.isNaN(i)) {
        buyCreditBlock(state, i);
        render();
      }
      return;
    }

    const modelRow = target.closest<HTMLElement>(".shop-row.model");
    if (modelRow) {
      const cls = modelRow.dataset.cls as ClassName | undefined;
      if (cls) {
        if (classUnlocked(state, cls)) hireAgent(state, cls);
        else buyModelLicence(state, cls);
        render();
      }
      return;
    }
  }

  // The scrim is a sibling of `.game`, not a child, so a pointerdown in here
  // never reaches the floor's delegated handler and cannot start a drag on a
  // node the renderer owns. No stopPropagation needed.
  scrim.addEventListener("pointerdown", onPointerDown);

  return {
    open: (section) => setOpen(true, section),
    close: () => setOpen(false),
    isOpen: () => open,
    render,
    teardown() {
      scrim.removeEventListener("pointerdown", onPointerDown);
      scrim.remove();
    },
  };
}

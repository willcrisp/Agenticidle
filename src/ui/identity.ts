/**
 * The studio identity block — your key, the recall field, and what the save
 * currently holds.
 *
 * Shared by the start screen (src/ui/start.ts) and the in-run studio panel
 * (src/ui/studio.ts), which frame it differently but need exactly the same
 * controls. Built once per host, bound to the manager, never rebuilt.
 *
 * Entirely grey by design. Five colours, five meanings (CLAUDE.md): red = click
 * it, amber = drag it, green = money, blue = credits, grey = ignore. Nothing
 * here is a game action, so nothing here takes a game colour.
 */

import { MAX_NAME_LENGTH } from "../save/config";
import type { SaveManager, SaveState } from "../save/store";

export interface IdentityBlock {
  root: HTMLElement;
  /** Clears any transient message. Call when the host opens. */
  reset(): void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  content?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

const STATUS_TEXT: Record<SaveState["status"], string> = {
  "local-only": "SAVED IN THIS BROWSER",
  syncing: "SYNCING…",
  synced: "SAVED IN THIS BROWSER · SYNCED",
  error: "SAVED IN THIS BROWSER · NOT SYNCED",
};

/** Formats the one-line summary of what a save actually contains. */
export function describeSave(state: SaveState): string {
  const best = state.save.best[0];
  if (state.save.runs === 0) return "NO RUNS YET";
  const plural = state.save.runs === 1 ? "RUN" : "RUNS";
  return best
    ? `${state.save.runs} ${plural} · BEST $${Math.round(best.score).toLocaleString()}`
    : `${state.save.runs} ${plural}`;
}

export function buildIdentity(manager: SaveManager): IdentityBlock {
  const root = el("div", "identity");

  // ---- display name ----
  const nameH = el("div", "studio-h", "NAME ON THE HIGH SCORES");
  const nameInput = el("input", "studio-input");
  nameInput.type = "text";
  nameInput.placeholder = "ANONYMOUS";
  nameInput.maxLength = MAX_NAME_LENGTH;
  nameInput.spellcheck = false;
  nameInput.autocomplete = "off";
  nameInput.setAttribute("aria-label", "Display name");
  const nameRow = el("div", "studio-actions");
  nameRow.append(nameInput);

  const keyH = el("div", "studio-h", "YOUR STUDIO KEY");
  const keyLine = el("div", "studio-key");
  const copyBtn = el("button", "studio-btn", "COPY");
  const newBtn = el("button", "studio-btn", "NEW STUDIO");
  const keyActions = el("div", "studio-actions");
  keyActions.append(copyBtn, newBtn);

  const note = el(
    "p",
    "studio-note",
    "Your progress is saved in this browser. Write the key down to pick the same " +
      "studio up on another machine — anyone who has it has your studio, and it " +
      "cannot be recovered if you lose it.",
  );

  const recallH = el("div", "studio-h", "RECALL A STUDIO");
  const input = el("input", "studio-input");
  input.type = "text";
  input.placeholder = "TYPE A KEY";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Studio key");
  const loadBtn = el("button", "studio-btn", "LOAD");
  const recallRow = el("div", "studio-actions");
  recallRow.append(input, loadBtn);

  const message = el("div", "studio-msg");
  const status = el("div", "studio-status");

  root.append(
    nameH,
    nameRow,
    el("div", "studio-sep"),
    keyH,
    keyLine,
    keyActions,
    note,
    el("div", "studio-sep"),
    recallH,
    recallRow,
    message,
    status,
  );

  // -------------------------------------------------------------------------

  let confirmingNew = false;

  manager.subscribe((state) => {
    keyLine.textContent = state.key;
    status.textContent = STATUS_TEXT[state.status] + (state.message ? ` · ${state.message}` : "");
    // Never fight the player for the caret: only adopt the stored name when
    // they are not the one typing. Recalling a studio while focused elsewhere
    // still updates it.
    if (document.activeElement !== nameInput) nameInput.value = state.save.name;
  });

  // Committed on blur rather than per-keystroke, so one rename is one save and
  // one network write instead of one per character.
  nameInput.addEventListener("change", () => manager.setName(nameInput.value));
  nameInput.addEventListener("blur", () => manager.setName(nameInput.value));
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nameInput.blur();
    e.stopPropagation();
  });

  function say(text: string): void {
    message.textContent = text;
  }

  function resetNewButton(): void {
    confirmingNew = false;
    newBtn.textContent = "NEW STUDIO";
    newBtn.classList.remove("is-confirming");
  }

  copyBtn.addEventListener("click", () => {
    // clipboard.writeText needs a secure context and a permission that can be
    // refused. The key is on screen either way, so failing is a nuisance and
    // never a dead end.
    navigator.clipboard?.writeText(manager.getState().key).then(
      () => say("Key copied."),
      () => say("Could not copy — select it by hand."),
    );
  });

  // Throwing away the current key is the one destructive control here, so it
  // asks twice.
  newBtn.addEventListener("click", () => {
    if (!confirmingNew) {
      confirmingNew = true;
      newBtn.textContent = "SURE? THIS ABANDONS IT";
      newBtn.classList.add("is-confirming");
      say("Your current key still works if you have written it down.");
      return;
    }
    resetNewButton();
    manager.newStudio();
    say("New studio started.");
  });

  async function submitKey(): Promise<void> {
    loadBtn.disabled = true;
    say("Looking…");
    const result = await manager.useKey(input.value);
    loadBtn.disabled = false;
    say(result.message);
    if (result.ok) input.value = "";
  }

  loadBtn.addEventListener("click", () => void submitKey());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void submitKey();
    // Typing a key must never reach the floor's own keyboard handlers.
    e.stopPropagation();
  });

  return {
    root,
    reset(): void {
      resetNewButton();
      say("");
    },
  };
}

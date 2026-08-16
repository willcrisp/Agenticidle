/**
 * The in-run studio panel: the identity block plus a way out.
 *
 * The start screen (src/ui/start.ts) is the main home for all of this. This
 * exists so a player mid-run can read their key without ending the run to get
 * at it — the case where you have just sat down at a machine and want to write
 * the key on paper.
 *
 * It is modal and pauses the run, because the clock is the point and reading
 * your key is not play.
 */

import type { SaveManager } from "../save/store";
import { buildIdentity, el } from "./identity";

export interface StudioPanel {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

/**
 * Builds the panel once and binds it to the manager.
 *
 * `onToggle` fires whenever the panel opens or closes, so main.ts can pause and
 * resume the run without this module knowing anything about the loop.
 */
export function mountStudio(
  stage: HTMLElement,
  manager: SaveManager,
  onToggle: (open: boolean) => void,
): StudioPanel {
  const overlay = el("div", "studio-overlay");
  const panel = el("div", "studio-panel");

  const identity = buildIdentity(manager);
  const closeBtn = el("button", "studio-btn studio-close", "BACK TO THE RUN");

  panel.append(identity.root, closeBtn);
  overlay.append(panel);
  stage.append(overlay);

  let open = false;

  const api: StudioPanel = {
    isOpen: () => open,
    open(): void {
      if (open) return;
      open = true;
      identity.reset();
      overlay.classList.add("is-visible");
      onToggle(true);
    },
    close(): void {
      if (!open) return;
      open = false;
      identity.reset();
      overlay.classList.remove("is-visible");
      onToggle(false);
    },
  };

  closeBtn.addEventListener("click", () => api.close());

  return api;
}

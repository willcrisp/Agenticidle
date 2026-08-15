import "./style.css";
import { createRun } from "./sim/state";
import { DEFAULT_CONFIG } from "./sim/config";
import { mountStage } from "./render/stage";
import { buildShell } from "./render/shell";
import { render } from "./render/floor";
import { tick, acceptProject, assignAgent, retryAgent } from "./sim/tick";

const state = createRun(DEFAULT_CONFIG, "seed-1");

const stageEl = document.getElementById("stage");
if (!stageEl) {
  throw new Error("#stage not found");
}

mountStage(stageEl);
const refs = buildShell(stageEl);

render(state, refs, 0);

// TODO(dev-only): console access for poking the floor before the real loop
// (WP-4) exists.
(window as unknown as { AI: unknown }).AI = {
  state,
  refs,
  render,
  tick,
  acceptProject,
  assignAgent,
  retryAgent,
};

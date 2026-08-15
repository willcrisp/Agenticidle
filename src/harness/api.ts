/** Re-export surface shared by the CLI, the smoke test and the dashboard. */
export { DEFAULT_CONFIG, cloneConfig } from "../sim/config";
export { STRATEGIES, balanced } from "../sim/player";
export { batch, simulateRun, sweep } from "./run";
export type { Config } from "../sim/config";
export type { Stats } from "./run";

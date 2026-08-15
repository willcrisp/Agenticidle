// Pixel sprites for the three agent classes, ported verbatim from
// docs/agent-idol-v9.html (the STARTER/SENIOR/ELITE grids, PAL palette and
// the plotting logic inside its draw() function). Do not redesign the art.

export type SpriteClass = "starter" | "senior" | "elite";
export type SpriteState = "running" | "ok" | "blocked" | "idle";

// Palette keyed exactly as in the mockup. '.' is transparent (skip).
const PAL: Record<string, string | null> = {
  "1": "#0A0C0E",
  "2": "#353B42",
  "3": "#4B525A",
  "4": "#646C75",
  "5": "#1A1E22",
  ".": null,
};

// Accent colour per sim state, mapped from the mockup's run/ok/fail/idle keys
// to ours (running/ok/blocked/idle).
const STATE_COLOR: Record<SpriteState, string> = {
  running: "#5F807A",
  ok: "#78906C",
  blocked: "#A5605A",
  idle: "#AC9463",
};

const STARTER = [
  "................", "................", "....111111 1....", "...12222222 1...",
  "...1255555521...", "...1259955521...", "...1255555521...", "...12222222 1...",
  "....11222211....", "..1111222211 1..", ".1222222222221..", ".1233333333321..",
  ".1239999993321..", ".1233333333321..", ".1222222222221..", ".11111111111 1..",
];
const SENIOR = [
  "................", ".....1111111....", "....122222221...", "....125555521...",
  "....125995521...", "....125555521...", "....125555521...", "....122222221...",
  ".....1122211....", "...111222221 1..", "..12222222222 1.", "..12333333333 1.",
  "..12399999933 1.", "..12333333333 1.", "..12222222222 1.", "..1111111111 11.",
];
const ELITE = [
  "........11......", "......1199 1....", "....1111111 1...", "...12222222 1...",
  "...1255555521...", "...1259995521...", "...1255555521...", "...1255555521...",
  "...12222222 1...", "....11222211....", "..1111222211 1..", ".14222222222 41.",
  ".14399999999 41.", ".14333333333 41.", ".14222222222 41.", ".11111111111 1..",
];

const GRIDS: Record<SpriteClass, string[]> = {
  starter: STARTER,
  senior: SENIOR,
  elite: ELITE,
};

const CLASSES: SpriteClass[] = ["starter", "senior", "elite"];
const STATES: SpriteState[] = ["running", "ok", "blocked", "idle"];

let cache: Record<string, string> | null = null;

function drawSprite(cls: SpriteClass, state: SpriteState): string {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error(`Failed to acquire 2d context for sprite ${cls}:${state}`);
  }

  const grid = GRIDS[cls];
  const accent = STATE_COLOR[state];
  const cols = 16;
  const rows = 16;
  // Natural size rendering: per-pixel size is 1, offsets are 0. All visual
  // scaling happens in CSS via image-rendering: pixelated.
  const s = 1;
  const ox = 0;
  const oy = 0;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < rows; y++) {
    const line = (grid[y] ?? "").padEnd(cols, ".");
    for (let x = 0; x < cols; x++) {
      const ch = line[x];
      const col = ch === "9" ? accent : ch === " " ? PAL["1"] : PAL[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(ox + x * s, oy + y * s, s, s);
    }
  }

  ctx.globalAlpha = state === "idle" ? 0.07 : 0.18;
  ctx.fillStyle = accent;
  ctx.fillRect(ox + 4 * s, oy + 4 * s, 8 * s, 3 * s);
  ctx.globalAlpha = 1;

  return canvas.toDataURL("image/png");
}

/** Called once at boot. Renders 12 offscreen canvases -> data URLs. */
export function buildSprites(): Record<string, string> {
  if (cache) return cache;

  const built: Record<string, string> = {};
  for (const cls of CLASSES) {
    for (const state of STATES) {
      built[`${cls}:${state}`] = drawSprite(cls, state);
    }
  }
  cache = built;
  return cache;
}

/** Convenience: an <img> for a given class+state, ready to reparent. */
export function spriteImg(cls: SpriteClass, state: SpriteState): HTMLImageElement {
  const sprites = cache ?? buildSprites();
  const key = `${cls}:${state}`;
  const src = sprites[key];
  if (!src) {
    throw new Error(`No sprite built for ${key}`);
  }
  const img = document.createElement("img");
  img.src = src;
  img.width = 16;
  img.height = 16;
  return img;
}

// Stage scaling: keeps the fixed 1280x720 #stage scaled to fit and centred in
// the viewport. Centring itself is handled by flexbox in style.css.
//
// This deliberately does NOT use the integer-only scale the design originally
// called for. Integer scaling needs a 2560x1440 *viewport* to reach scale 2,
// which browser chrome puts out of reach even on a 1440p monitor — so every
// real display floored to scale 1 and the game rendered as a small 1280x720
// island in a sea of black. Fit-to-viewport is the deliberate trade: the
// bitmap sprites keep hard edges via image-rendering: pixelated, and the only
// visible cost is that 1px rules and sprite pixels land on fractional device
// pixels at some window sizes.

export const STAGE_W = 1280;
export const STAGE_H = 720;

/**
 * The single source of truth for the stage scale. Input code must use this to
 * convert pointer deltas into stage space — two copies of this formula that
 * drift apart make drags track at the wrong speed.
 */
export function stageScale(): number {
  return Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
}

/** Attaches resize handling. Returns a teardown fn. */
export function mountStage(stageEl: HTMLElement): () => void {
  let pendingFrame: number | null = null;

  function applyScale(): void {
    stageEl.style.transform = `scale(${stageScale()})`;
    stageEl.style.transformOrigin = "center";
  }

  function onResize(): void {
    if (pendingFrame !== null) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      applyScale();
    });
  }

  applyScale();
  window.addEventListener("resize", onResize);

  return () => {
    window.removeEventListener("resize", onResize);
    if (pendingFrame !== null) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
  };
}

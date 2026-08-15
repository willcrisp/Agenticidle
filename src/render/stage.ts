// Stage scaling: keeps the fixed 1280x720 #stage integer-scaled and centred
// in the viewport. Centring itself is handled by flexbox in style.css.

/** Attaches resize handling. Returns a teardown fn. */
export function mountStage(stageEl: HTMLElement): () => void {
  let pendingFrame: number | null = null;

  function applyScale(): void {
    const scale = Math.max(
      1,
      Math.floor(Math.min(window.innerWidth / 1280, window.innerHeight / 720)),
    );
    stageEl.style.transform = `scale(${scale})`;
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

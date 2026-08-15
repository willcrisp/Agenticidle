// Display formatting shared by the shop and the inspect menus. Presentation
// only — nothing here reads or writes sim state.

export function money(n: number): string {
  const r = Math.round(n);
  return (r < 0 ? "-$" : "$") + Math.abs(r).toLocaleString();
}

export function pct(f: number): string {
  return Math.round(f * 100) + "%";
}

export function mult(f: number): string {
  return f.toFixed(2).replace(/\.?0+$/, "") + "×";
}

/** Seconds as a bare count, or m:ss once it stops fitting in a glance. */
export function secs(n: number): string {
  const t = Math.max(0, Math.floor(n));
  if (t < 60) return t + "s";
  const m = Math.floor(t / 60);
  const r = t % 60;
  return m + ":" + (r < 10 ? "0" : "") + r;
}

export function clock(n: number): string {
  const t = Math.max(0, Math.floor(n));
  const m = Math.floor(t / 60);
  const r = t % 60;
  return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
}

/**
 * mulberry32 — small, fast, good enough distribution for game RNG.
 * Seeded so any run is reproducible from (seed, input log).
 */
export class Rng {
  private s: number;

  constructor(seed: string | number) {
    this.s = typeof seed === "number" ? seed >>> 0 : hashString(seed);
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T extends string>(weights: Record<T, number>): T {
    const keys = Object.keys(weights) as T[];
    const total = keys.reduce((a, k) => a + weights[k], 0);
    let r = this.next() * total;
    for (const k of keys) {
      r -= weights[k];
      if (r <= 0) return k;
    }
    return keys[keys.length - 1];
  }
}

function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

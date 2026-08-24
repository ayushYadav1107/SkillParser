/**
 * @fileOverview Seeded pseudo-random number generation.
 *
 * `Math.random()` cannot be used anywhere in corpus construction. A reviewer who
 * clones this repository and runs `npm run eval:corpus` must get byte-identical
 * PDFs and the same labels, otherwise the reported numbers are not reproducible and
 * the whole exercise is decorative. mulberry32 is used because it is eleven lines,
 * has no dependency, and is identical on every platform and Node version — which a
 * library-provided PRNG is not guaranteed to be across major versions.
 */

export class Rng {
  private state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  bool(probabilityTrue = 0.5): boolean {
    return this.next() < probabilityTrue;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick called with an empty array.');
    return items[this.int(0, items.length - 1)];
  }

  /** `count` distinct items, or all of them when the pool is smaller. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    const n = Math.min(count, pool.length);
    for (let i = 0; i < n; i += 1) out.push(pool.splice(this.int(0, pool.length - 1), 1)[0]);
    return out;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Box–Muller, for the Gaussian sensor noise in the scan simulation. */
  gaussian(mean = 0, stdDev = 1): number {
    const u = Math.max(this.next(), Number.EPSILON);
    const v = this.next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

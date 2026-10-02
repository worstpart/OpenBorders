/**
 * Seeded pseudo-random number generator (sfc32: "small fast counter", 128-bit state).
 *
 * Uses only 32-bit integer operations, so every JS engine produces the same sequence
 * from the same seed. The state is four integers and can be saved/restored (snapshots,
 * hashing). This is the ONLY source of randomness the simulation may use.
 */
export type RngState = readonly [number, number, number, number];

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    // splitmix32 spreads any 32-bit seed (even 0 or 1) across the whole state.
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i++) this.nextUint32(); // warm up
  }

  static fromState(state: RngState): Rng {
    const rng = new Rng(0);
    [rng.a, rng.b, rng.c, rng.d] = state;
    return rng;
  }

  getState(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  /** Uniform integer in [0, 2^32). */
  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform integer in [0, maxExclusive). Unbiased (rejection sampling). */
  nextInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x100000000) {
      throw new RangeError(`nextInt: invalid bound ${maxExclusive}`);
    }
    const limit = 0x100000000 - (0x100000000 % maxExclusive);
    let value = this.nextUint32();
    while (value >= limit) value = this.nextUint32();
    return value % maxExclusive;
  }

  /** Uniform integer in [min, max] (inclusive). */
  nextIntBetween(min: number, max: number): number {
    return min + this.nextInt(max - min + 1);
  }

  /** Uniform float in [0, 1). Exact: a 32-bit integer divided by a power of two. */
  nextFloat(): number {
    return this.nextUint32() / 0x100000000;
  }
}

/** Derives a well-mixed 32-bit seed from a string (e.g. a lobby code). FNV-1a + finalizer. */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

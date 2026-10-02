/**
 * 32-bit hashing for state hashes (determinism checks, later desync detection) and
 * deterministic noise. Integer operations only.
 */

/** Scrambles a 32-bit integer so nearby inputs give unrelated outputs (murmur3 finalizer). */
export function mix32(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

const float64 = new Float64Array(1);
const float64Words = new Uint32Array(float64.buffer);

/** Incremental hash over a sequence of numbers (FNV-1a over mixed 32-bit words). */
export class Hasher {
  private h = 0x811c9dc5;

  /** Adds a 32-bit integer (or a boolean as 0/1). */
  addInt(value: number | boolean): this {
    this.h = Math.imul(this.h ^ mix32(Number(value)), 0x01000193);
    return this;
  }

  /** Adds any number by its exact bit pattern (works for non-integers too). */
  addNumber(value: number): this {
    float64[0] = value;
    return this.addInt(float64Words[0]!).addInt(float64Words[1]!);
  }

  addString(text: string): this {
    this.addInt(text.length);
    for (let i = 0; i < text.length; i++) this.addInt(text.charCodeAt(i));
    return this;
  }

  digest(): number {
    return mix32(this.h);
  }
}

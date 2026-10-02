import { describe, expect, it } from "vitest";
import { Rng, seedFromString } from "../../../src/sim/math/rng.ts";

describe("Rng", () => {
  it("produces the same sequence from the same seed (golden values)", () => {
    // Pinned: changing the generator would change every seeded game and map.
    const rng = new Rng(12345);
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32()]).toEqual([
      2142345551, 3083893245, 1997626643,
    ]);
  });

  it("produces different sequences from different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const sequenceA = Array.from({ length: 8 }, () => a.nextUint32());
    const sequenceB = Array.from({ length: 8 }, () => b.nextUint32());
    expect(sequenceA).not.toEqual(sequenceB);
  });

  it("continues identically after saving and restoring its state", () => {
    const original = new Rng(99);
    original.nextUint32();
    const copy = Rng.fromState(original.getState());
    for (let i = 0; i < 100; i++) expect(copy.nextUint32()).toBe(original.nextUint32());
  });

  it("nextInt stays in range and is roughly uniform", () => {
    const rng = new Rng(7);
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 60_000; i++) {
      const value = rng.nextInt(6);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      counts[value]!++;
    }
    for (const count of counts) expect(Math.abs(count - 10_000)).toBeLessThan(400);
    expect(new Rng(1).nextInt(1)).toBe(0);
  });

  it("nextIntBetween is inclusive and nextFloat is in [0, 1)", () => {
    const rng = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      seen.add(rng.nextIntBetween(-2, 2));
      const f = rng.nextFloat();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
  });

  it("rejects invalid bounds", () => {
    const rng = new Rng(1);
    expect(() => rng.nextInt(0)).toThrow(RangeError);
    expect(() => rng.nextInt(2.5)).toThrow(RangeError);
  });

  it("derives stable seeds from strings", () => {
    expect(seedFromString("borderline")).toBe(3577927669);
    expect(seedFromString("borderline")).not.toBe(seedFromString("Borderline"));
  });
});

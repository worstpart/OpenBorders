import { describe, expect, it } from "vitest";
import { detExp, detLog, detPow } from "../../../src/sim/math/detmath.ts";

// Tests may use Math.pow/log/exp as a reference; the simulation may not.
const relativeError = (actual: number, expected: number) =>
  Math.abs(actual - expected) / Math.max(Math.abs(expected), Number.MIN_VALUE);

describe("deterministic math", () => {
  it("detLog matches Math.log to ~1e-15", () => {
    for (const x of [1e-9, 0.001, 0.5, 0.75, 1.5, 2, Math.E, 10, 49, 12345.678, 1e6, 1e15]) {
      expect(relativeError(detLog(x), Math.log(x))).toBeLessThan(1e-14);
    }
  });

  it("detExp matches Math.exp to ~1e-15", () => {
    for (const x of [-30, -5, -1, -0.3, 0.001, 0.5, 1, 3.7, 10, 50, 300]) {
      expect(relativeError(detExp(x), Math.exp(x))).toBeLessThan(1e-14);
    }
  });

  it("detPow matches Math.pow over the ranges the game uses", () => {
    for (let tiles = 1; tiles <= 8_000_000; tiles = Math.ceil(tiles * 1.37)) {
      expect(relativeError(detPow(tiles, 0.6), Math.pow(tiles, 0.6))).toBeLessThan(1e-13);
      expect(relativeError(detPow(tiles, 0.75), Math.pow(tiles, 0.75))).toBeLessThan(1e-13);
    }
  });

  it("handles edge cases", () => {
    expect(detPow(0, 0.6)).toBe(0);
    expect(detPow(5, 0)).toBe(1);
    expect(detPow(1, 123.4)).toBe(1);
    expect(detPow(-2, 0.5)).toBeNaN();
    expect(detLog(0)).toBe(-Infinity);
    expect(detLog(1)).toBe(0);
    expect(detLog(-1)).toBeNaN();
    expect(detExp(0)).toBe(1);
    expect(detExp(1000)).toBe(Infinity);
    expect(detExp(-1000)).toBe(0);
  });

  it("returns pinned values (golden: any change here changes game balance)", () => {
    expect(detPow(49, 0.6)).toBe(10.330412131161859);
    expect(detPow(20330, 0.75)).toBe(1702.5623840511023);
  });
});

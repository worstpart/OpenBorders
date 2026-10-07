import { describe, expect, it } from "vitest";
import { isMapEdge, Terrain, type GameMap } from "../../../src/sim/map/gameMap.ts";
import { generateContinent } from "../../../src/sim/map/generate.ts";
import { Hasher } from "../../../src/sim/math/hash.ts";

function hashMap(map: GameMap): number {
  const h = new Hasher().addInt(map.width).addInt(map.height);
  for (const t of map.terrain) h.addInt(t);
  for (const r of map.relief) h.addInt(r);
  return h.digest();
}

/** Sizes of the separate 4-connected landmasses, biggest first. */
function landmasses(map: GameMap): number[] {
  const seen = new Uint8Array(map.terrain.length);
  const sizes: number[] = [];
  for (let start = 0; start < map.terrain.length; start++) {
    if (map.terrain[start] === Terrain.Water || seen[start]) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const tile = stack.pop()!;
      size++;
      const x = tile % map.width;
      const candidates = [
        tile >= map.width ? tile - map.width : -1,
        x < map.width - 1 ? tile + 1 : -1,
        tile + map.width < map.terrain.length ? tile + map.width : -1,
        x > 0 ? tile - 1 : -1,
      ];
      for (const next of candidates) {
        if (next >= 0 && !seen[next] && map.terrain[next] !== Terrain.Water) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

// Golden values of the island map (milestone 2.7, D-025).
const PINNED_ISLANDS_LAND = 14_536;
const PINNED_ISLANDS_HASH = 1_271_704_253;

describe("procedural continent", () => {
  it("is identical for the same seed and different for different seeds", () => {
    const a = generateContinent({ seed: 7, width: 300, height: 200 });
    const b = generateContinent({ seed: 7, width: 300, height: 200 });
    const c = generateContinent({ seed: 8, width: 300, height: 200 });
    expect(hashMap(a)).toBe(hashMap(b));
    expect(a.terrain).toEqual(b.terrain);
    expect(hashMap(a)).not.toBe(hashMap(c));
  });

  it("matches the pinned map for seed 1 (golden: a change here changes every map)", () => {
    const map = generateContinent({ seed: 1, width: 220, height: 140 });
    expect(map.landTiles).toBe(PINNED_ISLANDS_LAND);
    expect(hashMap(map)).toBe(PINNED_ISLANDS_HASH);
  });

  it("still makes the single-continent map of 1.1–2.6 without islands (D-025)", () => {
    const map = generateContinent({ seed: 1, width: 220, height: 140, islands: false });
    expect(map.landTiles).toBe(16_940);
    expect(hashMap(map)).toBe(3_185_958_371);
  });

  describe("the reference map with islands (1100×700, milestone 2.7)", () => {
    const map = generateContinent({ seed: 1 });

    it("has ~50% land: a continent and 4–8 islands, none of them tiny", () => {
      const share = map.landTiles / (map.width * map.height);
      expect(share).toBeGreaterThan(0.48);
      expect(share).toBeLessThanOrEqual(0.501);
      const sizes = landmasses(map);
      expect(sizes.length).toBeGreaterThanOrEqual(5);
      expect(sizes.length).toBeLessThanOrEqual(9);
      expect(sizes[0]! / map.landTiles).toBeGreaterThan(0.8);
      expect(sizes.at(-1)).toBeGreaterThanOrEqual(400);
    });

    it("keeps its islands apart from the continent by open sea", () => {
      // No island tile has continent within 17 steps (the strait is 18 tiles of sea).
      // Label the continent 1 and every island 2.
      const labels = new Int32Array(map.terrain.length);
      let biggest = 0;
      const sizes = landmasses(map);
      for (let start = 0; start < map.terrain.length && biggest === 0; start++) {
        if (map.terrain[start] === Terrain.Water || labels[start]) continue;
        const piece = [start];
        labels[start] = 1;
        for (let k = 0; k < piece.length; k++) {
          const t = piece[k]!;
          const x = t % map.width;
          for (const n of [
            t - map.width,
            t + map.width,
            x > 0 ? t - 1 : -1,
            x < map.width - 1 ? t + 1 : -1,
          ]) {
            if (
              n >= 0 &&
              n < map.terrain.length &&
              !labels[n] &&
              map.terrain[n] !== Terrain.Water
            ) {
              labels[n] = 1;
              piece.push(n);
            }
          }
        }
        if (piece.length === sizes[0]) biggest = 1;
        else for (const t of piece) labels[t] = 2;
      }
      expect(biggest).toBe(1);
      const step = 7;
      for (let tile = 0; tile < map.terrain.length; tile += step) {
        if (labels[tile] !== 2) continue;
        const x0 = tile % map.width;
        const y0 = Math.floor(tile / map.width);
        for (let y = Math.max(0, y0 - 12); y <= Math.min(map.height - 1, y0 + 12); y++) {
          for (let x = Math.max(0, x0 - 12); x <= Math.min(map.width - 1, x0 + 12); x++) {
            if (Math.abs(x - x0) + Math.abs(y - y0) <= 17)
              expect(labels[y * map.width + x]).not.toBe(1);
          }
        }
      }
    });
  });

  describe("the reference map without islands (1100×700)", () => {
    const map = generateContinent({ seed: 1, islands: false });
    const landShareOf = (terrain: Terrain) =>
      map.terrain.reduce((count, t) => count + (t === terrain ? 1 : 0), 0) / map.landTiles;

    it("has the reference size and ~55% land", () => {
      expect([map.width, map.height]).toEqual([1100, 700]);
      const landShare = map.landTiles / (map.width * map.height);
      expect(landShare).toBeGreaterThan(0.5);
      expect(landShare).toBeLessThanOrEqual(0.551);
    });

    it("is a single landmass surrounded by water", () => {
      expect(landmasses(map)).toHaveLength(1);
      for (let tile = 0; tile < map.terrain.length; tile++) {
        if (isMapEdge(map, tile)) expect(map.terrain[tile]).toBe(Terrain.Water);
      }
    });

    it("splits land into ~68% plains, ~22% highland, ~10% mountain", () => {
      expect(landShareOf(Terrain.Plains)).toBeCloseTo(0.68, 2);
      expect(landShareOf(Terrain.Highland)).toBeCloseTo(0.22, 2);
      expect(landShareOf(Terrain.Mountain)).toBeCloseTo(0.1, 2);
    });
  });
});

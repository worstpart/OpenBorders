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

/** Number of separate 4-connected landmasses. */
function countLandmasses(map: GameMap): number {
  const seen = new Uint8Array(map.terrain.length);
  let count = 0;
  for (let start = 0; start < map.terrain.length; start++) {
    if (map.terrain[start] === Terrain.Water || seen[start]) continue;
    count++;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const tile = stack.pop()!;
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
  }
  return count;
}

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
    expect(map.landTiles).toBe(16_940);
    expect(hashMap(map)).toBe(3_185_958_371);
  });

  describe("the reference map (1100×700)", () => {
    const map = generateContinent({ seed: 1 });
    const landShareOf = (terrain: Terrain) =>
      map.terrain.reduce((count, t) => count + (t === terrain ? 1 : 0), 0) / map.landTiles;

    it("has the reference size and ~55% land", () => {
      expect([map.width, map.height]).toEqual([1100, 700]);
      const landShare = map.landTiles / (map.width * map.height);
      expect(landShare).toBeGreaterThan(0.5);
      expect(landShare).toBeLessThanOrEqual(0.551);
    });

    it("is a single landmass surrounded by water", () => {
      expect(countLandmasses(map)).toBe(1);
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

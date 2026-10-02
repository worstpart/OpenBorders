import { describe, expect, it } from "vitest";
import { battleOutlook } from "../../src/sim/battle.ts";
import { buildFrame } from "../../src/sim/frame.ts";
import { DEFAULT_RULES } from "../../src/sim/rules.ts";
import { landNeighbors } from "../../src/sim/systems/attacks.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const outlook = (army: number, home: number, tiles = 100) =>
  battleOutlook(DEFAULT_RULES, army, home, tiles);

describe("battle outlook (shared by bots and the HUD)", () => {
  it("labels the odds from crushing to hopeless", () => {
    expect(outlook(25_000, 10_000).odds).toBe("overwhelming");
    expect(outlook(13_000, 10_000).odds).toBe("advantage");
    expect(outlook(10_000, 10_000).odds).toBe("even"); // equal armies stall (Lanchester)
    expect(outlook(7_000, 10_000).odds).toBe("costly");
    expect(outlook(4_000, 10_000).odds).toBe("hopeless"); // takes ~6%
  });

  it("expects equal armies to take about half the land, and a clear edge all of it", () => {
    expect(outlook(10_000, 10_000).landShare).toBeGreaterThan(0.4);
    expect(outlook(10_000, 10_000).landShare).toBeLessThan(0.6);
    expect(outlook(13_000, 10_000).landShare).toBe(1);
  });

  it("is limited by the per-tile cost: a huge, empty empire still costs troops per tile", () => {
    const vast = outlook(3_000, 100, 100_000);
    expect(vast.landShare).toBeLessThan(0.02);
    expect(vast.odds).toBe("hopeless");
  });

  it("never goes negative or above 1", () => {
    expect(outlook(0, 10_000).landShare).toBe(0);
    expect(outlook(1e9, 1).landShare).toBe(1);
  });
});

describe("land neighbours (who a click can reach)", () => {
  it("lists bordering players and neutral land, not players across water", () => {
    const world = worldFromAscii(`
      11222~33
      11..2~33
    `);
    const [p1, p2, p3] = world.players;
    expect(landNeighbors(world, p1!)).toEqual([0, 2]);
    expect(landNeighbors(world, p2!)).toEqual([0, 1]);
    expect(landNeighbors(world, p3!)).toEqual([]);
  });

  it("is reported in tick frames for humans only", () => {
    const world = worldFromAscii("11.22", { players: ["human", "bot"] });
    const frame = buildFrame(world);
    expect(frame.players[0]!.neighbors).toEqual([0]);
    expect(frame.players[1]!.neighbors).toBeNull();
  });
});

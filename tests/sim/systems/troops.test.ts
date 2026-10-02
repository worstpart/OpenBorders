import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "../../../src/sim/rules.ts";
import { startingTroops, troopCapacity, troopGrowth } from "../../../src/sim/systems/troops.ts";
import { runTick } from "../../../src/sim/tick.ts";
import { worldFromAscii } from "../../helpers/asciiMap.ts";

const rules = DEFAULT_RULES;

/** Ticks needed to grow from `from` to `to` (fractions of capacity) with nothing else happening. */
function ticksToGrow(tiles: number, from: number, to: number): number {
  const capacity = troopCapacity(rules, tiles);
  let troops = Math.floor(capacity * from);
  let ticks = 0;
  while (troops < capacity * to) {
    troops += troopGrowth(rules, troops, 0, capacity);
    ticks++;
  }
  return ticks;
}

describe("troop capacity (golden values)", () => {
  it("grows sublinearly with land", () => {
    expect(troopCapacity(rules, 0)).toBe(10_000);
    expect(troopCapacity(rules, 1)).toBe(11_000);
    expect(troopCapacity(rules, 49)).toBe(20_330); // a fresh spawn
    expect(troopCapacity(rules, 1_000)).toBe(73_095);
    expect(troopCapacity(rules, 10_000)).toBe(261_188);
    expect(troopCapacity(rules, 100_000)).toBe(1_009_999);
  });

  it("starts a fresh spawn at 30% of capacity", () => {
    expect(startingTroops(rules, 49)).toBe(6_099);
  });
});

describe("troop growth", () => {
  const capacity = troopCapacity(rules, 49);
  const growthAt = (share: number) => troopGrowth(rules, Math.floor(capacity * share), 0, capacity);

  it("follows the pinned curve (golden values)", () => {
    expect([0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1].map(growthAt)).toEqual([
      10, 35, 63, 79, 58, 27, 3, 0,
    ]);
  });

  it("is fastest at half capacity", () => {
    const peak = growthAt(0.5);
    for (const share of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      expect(growthAt(share)).toBeLessThanOrEqual(peak);
    }
  });

  it("counts troops in the field toward the cap", () => {
    const home = Math.floor(capacity * 0.5);
    expect(troopGrowth(rules, home, capacity - home - 5, capacity)).toBe(5);
    expect(troopGrowth(rules, home, capacity - home, capacity)).toBe(0);
    expect(troopGrowth(rules, home, capacity, capacity)).toBe(0); // over the cap: no growth, no loss
  });

  it("is driven by the home pool: sending troops away from above 50% speeds regrowth", () => {
    const home = Math.floor(capacity * 0.9);
    const sent = Math.floor(capacity * 0.4);
    expect(troopGrowth(rules, home - sent, sent, capacity)).toBeGreaterThan(
      troopGrowth(rules, home, 0, capacity),
    );
  });

  it("matches the design timings (GAME_DESIGN §3.4)", () => {
    // Fresh spawn: ~15 s (150 ticks) from 10% to 50% and from 50% to 90%.
    expect(ticksToGrow(49, 0.1, 0.5)).toBe(132);
    expect(ticksToGrow(49, 0.5, 0.9)).toBe(144);
    // Big empires refill proportionally slower: ~30 s at 10k tiles, ~40 s at 100k.
    expect(ticksToGrow(10_000, 0.1, 0.5)).toBe(277);
    expect(ticksToGrow(100_000, 0.1, 0.5)).toBe(394);
  });
});

describe("troop growth in the tick loop", () => {
  it("regenerates every living player each tick and refreshes capacity", () => {
    const world = worldFromAscii(
      `
      ~~~~~~~
      ~11.22~
      ~11.22~
      ~~~~~~~
      `,
      { homeTroops: [100, 0] },
    );
    const frame = runTick(world, { tick: 1, commands: [] });
    const [p1, p2] = frame.players;
    expect(p1!.capacity).toBe(troopCapacity(rules, 4));
    expect(p1!.homeTroops).toBe(100 + troopGrowth(rules, 100, 0, p1!.capacity));
    expect(p1!.growthPerTick).toBe(p1!.homeTroops - 100);
    expect(p2!.homeTroops).toBe(rules.troops.growthFloor);
  });
});

/** Tribes & Nations (GAME_DESIGN.md §3.13, D-017). */
import { describe, expect, it } from "vitest";
import { attackLossFactor, expectedLandShare } from "../../src/sim/battle.ts";
import type { StampedCommand } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { DEFAULT_RULES, makeRules } from "../../src/sim/rules.ts";
import { tileCost } from "../../src/sim/systems/attacks.ts";
import { troopCapacity, troopGrowth } from "../../src/sim/systems/troops.ts";
import { runTick } from "../../src/sim/tick.ts";
import { createWorld, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";
import { createMap, Terrain } from "../../src/sim/map/gameMap.ts";

const EVERY_TICK = { thinkMinTicks: 1, thinkMaxTicks: 1 };
const RULES = makeRules({
  ai: {
    difficulties: {
      easy: { ...DEFAULT_RULES.ai.difficulties.easy, ...EVERY_TICK },
      medium: { ...DEFAULT_RULES.ai.difficulties.medium, ...EVERY_TICK },
      hard: { ...DEFAULT_RULES.ai.difficulties.hard, ...EVERY_TICK },
    },
  },
  tribe: EVERY_TICK,
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
});

function run(world: World, ticks: number, commands: StampedCommand[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    const frame = runTick(world, { tick: world.tick + 1, commands: k === 0 ? commands : [] });
    events.push(...frame.events);
  }
  return events;
}

describe("tribe handicaps", () => {
  it("have a third of the capacity and half the growth", () => {
    const world = worldFromAscii("1111" + "2222", { players: ["human", "tribe"] });
    runTick(world, { tick: world.tick + 1, commands: [] });
    const [human, tribe] = world.players;
    expect(tribe!.capacity).toBe(Math.floor(troopCapacity(DEFAULT_RULES, 4) / 3));
    expect(human!.capacity).toBe(troopCapacity(DEFAULT_RULES, 4));
    const full = troopGrowth(DEFAULT_RULES, 3_000, 0, 6_000);
    expect(troopGrowth(DEFAULT_RULES, 3_000, 0, 6_000, 0.5)).toBe(Math.floor(full / 2));
  });

  it("start with 30% of their (smaller) capacity", () => {
    const map = createMap(20, 20, new Uint8Array(400).fill(Terrain.Plains));
    const world = createWorld({
      seed: 3,
      map,
      players: [
        { name: "N", kind: "bot" },
        { name: "T", kind: "bot", tier: "tribe" },
      ],
    });
    runTick(world, { tick: 1, commands: [] });
    const [nation, tribe] = world.players;
    expect(tribe!.homeTroops).toBeLessThan(0.4 * nation!.homeTroops);
  });

  it("cost nations and humans 30% less to attack — but not other tribes", () => {
    expect(attackLossFactor(DEFAULT_RULES, false, true)).toBe(0.7);
    expect(attackLossFactor(DEFAULT_RULES, true, true)).toBe(1);
    expect(attackLossFactor(DEFAULT_RULES, true, false)).toBe(1);
    expect(attackLossFactor(DEFAULT_RULES, false, false)).toBe(1);

    const costAgainst = (kind: "human" | "tribe"): number => {
      const world = worldFromAscii("1111" + "2222", {
        rules: RULES, // no growth: both defenders keep exactly 1,000
        players: ["human", kind],
        homeTroops: [10_000, 1_000],
      });
      run(world, 1, [
        { playerId: 1, command: { type: "attack", target: 2, focusTile: 4, percentBp: 5_000 } },
      ]);
      return tileCost(world, world.attacks[0]!, 4);
    };
    expect(costAgainst("tribe")).toBeCloseTo(0.7 * costAgainst("human"), 9);
  });

  it("are included in the battle estimate the HUD and the bots use", () => {
    const fair = expectedLandShare(DEFAULT_RULES, 800, 1_000);
    expect(expectedLandShare(DEFAULT_RULES, 800, 1_000, 0.7)).toBeGreaterThan(fair);
  });
});

describe("tribe AI", () => {
  it("expands into open land", () => {
    const world = worldFromAscii("1111" + ".".repeat(30), {
      rules: RULES,
      players: ["tribe"],
      homeTroops: [2_000],
    });
    expect(run(world, 3)).toContainEqual(
      expect.objectContaining({ type: "attackStarted", attacker: 1, target: 0 }),
    );
  });

  it("attacks a neighbour it can beat with a small share once the land is taken", () => {
    const world = worldFromAscii("~111122222~", {
      rules: RULES,
      players: ["tribe", "human"],
      homeTroops: [5_000, 200],
    });
    run(world, 3); // first think on tick 2, command applied on tick 3
    const war = world.attacks.find((a) => a.attacker === 1 && a.target === 2);
    expect(war).toBeDefined();
    expect(war!.troops).toBeCloseTo(DEFAULT_RULES.tribe.attackShare * 5_000, -1);
  });

  it("leaves a neighbour it can't beat alone", () => {
    const world = worldFromAscii("~111122222~", {
      rules: RULES,
      players: ["tribe", "human"],
      homeTroops: [5_000, 100_000],
    });
    expect(run(world, 5).filter((e) => e.type === "attackStarted")).toEqual([]);
  });

  it("never counters an incoming army", () => {
    const world = worldFromAscii("11111" + "22222", {
      rules: RULES,
      players: ["human", "tribe"],
      homeTroops: [100_000, 6_000],
    });
    const events = run(world, 5, [
      { playerId: 1, command: { type: "attack", target: 2, focusTile: 9, percentBp: 100 } },
    ]);
    expect(events.filter((e) => e.type === "attackStarted" && e.attacker === 2)).toEqual([]);
  });
});

describe("nation difficulty", () => {
  const counters = (difficulty: "easy" | "medium" | "hard"): boolean => {
    const world = worldFromAscii("11111" + "22222", {
      rules: RULES,
      players: ["human", "bot"],
      personality: "turtle",
      difficulty,
      // Below the turtle's attack threshold, but enough to counter a 5,000 army.
      homeTroops: [100_000, 8_000],
    });
    const events = run(world, 5, [
      { playerId: 1, command: { type: "attack", target: 2, focusTile: 9, percentBp: 500 } },
    ]);
    return events.some((e) => e.type === "attackStarted" && e.attacker === 2);
  };

  it("easy nations don't counter; medium and hard ones do", () => {
    expect(counters("easy")).toBe(false);
    expect(counters("medium")).toBe(true);
    expect(counters("hard")).toBe(true);
  });

  it("reacts more slowly at lower difficulty — and never gets stat bonuses (D-012)", () => {
    const { easy, medium, hard } = DEFAULT_RULES.ai.difficulties;
    expect(easy.thinkMinTicks).toBeGreaterThan(medium.thinkMinTicks);
    expect(medium.thinkMinTicks).toBeGreaterThan(hard.thinkMinTicks);
    const world = worldFromAscii("1111" + "2222", {
      players: ["bot", "bot"],
      difficulty: "easy",
    });
    runTick(world, { tick: world.tick + 1, commands: [] });
    expect(world.players[0]!.capacity).toBe(troopCapacity(DEFAULT_RULES, 4));
  });
});

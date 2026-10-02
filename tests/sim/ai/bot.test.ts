import { describe, expect, it } from "vitest";
import { expectedLandShare } from "../../../src/sim/battle.ts";
import type { StampedCommand } from "../../../src/sim/commands.ts";
import type { SimEvent } from "../../../src/sim/events.ts";
import { tileAt } from "../../../src/sim/map/gameMap.ts";
import { DEFAULT_RULES, makeRules } from "../../../src/sim/rules.ts";
import { troopCapacity } from "../../../src/sim/systems/troops.ts";
import { runTick } from "../../../src/sim/tick.ts";
import type { World } from "../../../src/sim/world.ts";
import { worldFromAscii } from "../../helpers/asciiMap.ts";

/** Bots think every tick, no randomness in fronts, no growth, no victory: exact scenarios. */
const RULES = makeRules({
  ai: { thinkMinTicks: 1, thinkMaxTicks: 1 },
  attack: { noiseTicks: 0 },
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

const capacityOf = (tiles: number) => troopCapacity(DEFAULT_RULES, tiles);

describe("bots", () => {
  it("expand into neutral land once their troops have regrown", () => {
    const world = worldFromAscii("1111" + ".".repeat(30), {
      rules: RULES,
      players: ["bot"],
      personality: "expander",
      homeTroops: [0.6 * capacityOf(4)],
    });
    const events = run(world, 4);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "attackStarted", attacker: 1, target: 0 }),
    );
  });

  it("wait while their troops are low (growth is fastest near half capacity)", () => {
    const world = worldFromAscii("1111" + ".".repeat(30), {
      rules: RULES,
      players: ["bot"],
      personality: "expander",
      homeTroops: [0.1 * capacityOf(4)],
    });
    expect(run(world, 10).filter((e) => e.type === "attackStarted")).toEqual([]);
  });

  it("counter an incoming army, so the two armies cancel out", () => {
    // Player 1 (a person) attacks bot 2, which has plenty of troops at home.
    const world = worldFromAscii("11111" + "22222", {
      rules: RULES,
      players: ["human", "bot"],
      personality: "turtle",
      homeTroops: [100_000, 400_000],
    });
    const events = run(world, 5, [
      {
        playerId: 1,
        command: { type: "attack", target: 2, focusTile: 9, percentBp: 1_000 },
      },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "attackStarted", attacker: 2, target: 1 }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "attackEnded", attacker: 1, reason: "cancelled" }),
    );
  });

  it("counter the army they can stop, even while a bigger one they can't is also coming", () => {
    const world = worldFromAscii("1111" + "222222" + "3333", {
      rules: RULES,
      players: ["human", "bot", "human"],
      personality: "turtle",
      homeTroops: [100_000, 400_000, 10_000_000],
    });
    const events = run(world, 5, [
      { playerId: 3, command: { type: "attack", target: 2, focusTile: 6, percentBp: 5_000 } },
      { playerId: 1, command: { type: "attack", target: 2, focusTile: 5, percentBp: 1_000 } },
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "attackStarted", attacker: 2, target: 1 }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "attackEnded", attacker: 1, reason: "cancelled" }),
    );
  });

  it("retreat an attack that can no longer win", () => {
    const world = worldFromAscii("11111" + "22222", {
      rules: RULES,
      players: ["bot", "human"],
      personality: "aggressor",
      homeTroops: [10_000, 1_000_000],
    });
    // Make the bot launch a doomed attack (as if it had misjudged), then let it think.
    const events = run(world, 3, [
      { playerId: 1, command: { type: "attack", target: 2, focusTile: 9, percentBp: 5_000 } },
    ]);
    expect(world.attacks.every((a) => a.retreatTick >= 0)).toBe(true);
    expect(events.filter((e) => e.type === "commandRejected")).toEqual([]);
  });

  it("attack a neighbour they can beat once the land is all taken", () => {
    const world = worldFromAscii(
      `
      ~~~~~~~~~~~~
      ~1111222222~
      ~1111222222~
      ~~~~~~~~~~~~
      `,
      {
        rules: RULES,
        players: ["human", "bot"],
        personality: "aggressor",
        homeTroops: [500, 0.9 * capacityOf(12)],
      },
    );
    const events = run(world, 3);
    const launched = events.find((e) => e.type === "attackStarted" && e.attacker === 2);
    expect(launched).toMatchObject({ target: 1 });
    // Aimed at the heart of player 1's land (their start tile) when they still hold it.
    expect(world.attacks[0]?.focusTile).toBe(world.players[0]!.spawnTile);
    expect(world.owner[tileAt(world.map, 1, 1)]).toBe(1); // nothing taken yet on tick 3
  });

  it("reinforce a war that is too small to finish the job", () => {
    const world = worldFromAscii("11" + "2".repeat(60), {
      rules: makeRules({ ...RULES, combat: { layerDelayTicks: 1_000 } }), // a slow front
      players: ["bot", "human"],
      personality: "aggressor",
      homeTroops: [0.9 * capacityOf(2), 2_000],
    });
    // The bot's own (too small) attack: 2% of its pool against 60 tiles.
    run(world, 1, [
      { playerId: 1, command: { type: "attack", target: 2, focusTile: 30, percentBp: 200 } },
    ]);
    const before = world.attacks[0]!;
    const sent = before.troops;
    run(world, 3);
    expect(world.attacks).toHaveLength(1);
    expect(world.attacks[0]!.id).toBe(before.id); // merged into the same attack
    expect(world.attacks[0]!.troops).toBeGreaterThan(sent * 2);
  });

  it("hold off attacking a much stronger neighbour", () => {
    const world = worldFromAscii("111111" + "222222", {
      rules: RULES,
      players: ["human", "bot"],
      personality: "turtle",
      homeTroops: [1_000_000, 0.9 * capacityOf(6)],
    });
    expect(run(world, 5).filter((e) => e.type === "attackStarted")).toEqual([]);
  });

  it("predict how much land an army takes before it runs out (Lanchester)", () => {
    const k = DEFAULT_RULES.combat.lossDensity * 1.15;
    expect(expectedLandShare(world0().rules, 0, 1_000)).toBe(0);
    expect(expectedLandShare(world0().rules, Math.sqrt(k) * 1_000, 1_000)).toBe(1);
    const half = expectedLandShare(world0().rules, 0.75 * 1_000, 1_000);
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.35);
    expect(expectedLandShare(world0().rules, 900, 1_000)).toBeGreaterThan(half);
  });
});

function world0(): World {
  return worldFromAscii("1.", { rules: RULES });
}

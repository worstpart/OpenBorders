/** Buildings: build, upgrade, cancel, capture, effects (GAME_DESIGN.md §3.17). */
import { describe, expect, it } from "vitest";
import type { Command, StampedCommand } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { distance, distanceSq, travelTicks, withinRange } from "../../src/sim/geometry.ts";
import { makeRules, type GameRules } from "../../src/sim/rules.ts";
import { buildingPrice, levelsOwned } from "../../src/sim/systems/buildings.ts";
import { goldIncome } from "../../src/sim/systems/economy.ts";
import { capacityOf } from "../../src/sim/systems/troops.ts";
import { runTick } from "../../src/sim/tick.ts";
import { setOwner, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
});
const HOUSING = RULES.buildings.types.housing.levels;
const FACTORY = RULES.buildings.types.factory.levels;

// 32 × 5: player 1 on the left, player 2 on the right, water in the corner (tile 0).
const MAP = `
  ~1111111111111112222222222222222
  11111111111111112222222222222222
  11111111111111112222222222222222
  11111111111111112222222222222222
  11111111111111112222222222222222
`;
const WIDTH = 32;
const at = (x: number, y: number) => y * WIDTH + x;

function world(options: { rules?: GameRules; players?: ("human" | "tribe")[] } = {}): World {
  const w = worldFromAscii(MAP, {
    rules: options.rules ?? RULES,
    homeTroops: [5_000, 5_000],
    players: options.players,
  });
  for (const p of w.players) p.gold = 1_000_000;
  return w;
}

function run(w: World, ticks: number, commands: StampedCommand[] = []): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) {
    const frame = runTick(w, { tick: w.tick + 1, commands: k === 0 ? commands : [] });
    events.push(...frame.events);
  }
  return events;
}

function send(w: World, playerId: number, command: Command): SimEvent[] {
  return run(w, 1, [{ playerId, command }]);
}

function rejection(events: SimEvent[]): string | null {
  const rejected = events.find((e) => e.type === "commandRejected");
  return rejected?.type === "commandRejected" ? rejected.reason : null;
}

/** Builds a housing at (x, y) for player 1 and waits until it is finished. */
function builtHousing(w: World, x = 4, y = 2): number {
  send(w, 1, { type: "build", buildingType: "housing", tile: at(x, y) });
  run(w, HOUSING[0].buildTicks);
  return w.buildings.at(-1)!.id;
}

describe("the range module", () => {
  const map = world().map;
  it("measures straight lines in tiles, exactly", () => {
    expect(distanceSq(map, at(0, 0), at(3, 4))).toBe(25);
    expect(distance(map, at(0, 0), at(3, 4))).toBe(5);
    expect(withinRange(map, at(0, 0), at(3, 4), 5)).toBe(true);
    expect(withinRange(map, at(0, 0), at(3, 4), 4.99)).toBe(false);
    expect(travelTicks(10, 3)).toBe(4);
    expect(travelTicks(0, 3)).toBe(1);
  });
});

describe("prices", () => {
  it("start at the base price and grow 25% per level owned of the type, at most ×3", () => {
    expect(buildingPrice(RULES, "housing", 1, 0)).toBe(HOUSING[0].cost);
    expect(buildingPrice(RULES, "housing", 1, 1)).toBe(50_000);
    expect(buildingPrice(RULES, "housing", 2, 2)).toBe(135_000);
    expect(buildingPrice(RULES, "housing", 1, 40)).toBe(3 * HOUSING[0].cost);
  });

  it("count levels being built too", () => {
    const list = [
      { owner: 1, type: "housing" as const, targetLevel: 2 },
      { owner: 1, type: "factory" as const, targetLevel: 1 },
      { owner: 2, type: "housing" as const, targetLevel: 3 },
    ];
    expect(levelsOwned(list, 1, "housing")).toBe(2);
    expect(levelsOwned(list, 2, "factory")).toBe(0);
  });
});

describe("building", () => {
  it("costs gold up front and finishes after its build time", () => {
    const w = world();
    const me = w.players[0]!;
    const before = me.gold;
    const events = send(w, 1, { type: "build", buildingType: "housing", tile: at(4, 2) });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "buildingStarted", level: 1, gold: HOUSING[0].cost }),
    );
    expect(me.gold).toBe(before - HOUSING[0].cost + me.lastIncome);
    const building = w.buildings[0]!;
    expect(building).toMatchObject({ owner: 1, tile: at(4, 2), level: 0, targetLevel: 1 });
    expect(w.buildingAt[at(4, 2)]).toBe(building.id);

    const finished = run(w, HOUSING[0].buildTicks);
    expect(finished).toContainEqual(
      expect.objectContaining({ type: "buildingCompleted", buildingId: building.id, level: 1 }),
    );
    expect(building.level).toBe(1);
  });

  it("is rejected off your land, on water, too close to another building, or without gold", () => {
    const w = world();
    const build = (tile: number) =>
      rejection(send(w, 1, { type: "build", buildingType: "housing", tile }));
    expect(build(at(24, 2))).toBe("you can only build on your own land");
    expect(build(at(0, 0))).toBe("you can only build on land");
    expect(build(at(4, 2))).toBeNull();
    expect(build(at(10, 2))).toBe("too close to another building"); // 6 tiles away
    expect(build(at(4 + RULES.buildings.minSpacing, 2))).toBeNull(); // exactly the spacing
    const poor = world();
    poor.players[0]!.gold = 100;
    expect(
      rejection(send(poor, 1, { type: "build", buildingType: "housing", tile: at(4, 2) })),
    ).toBe("not enough gold");
  });

  it("is rejected in the spawn phase and when buildings are off", () => {
    const spawn = worldFromAscii(`....\n....`, { rules: RULES, phase: "spawn" });
    expect(rejection(send(spawn, 1, { type: "build", buildingType: "housing", tile: 0 }))).toBe(
      "the match hasn't started",
    );
    const off = world({ rules: makeRules({ buildings: { enabled: false } }) });
    expect(
      rejection(send(off, 1, { type: "build", buildingType: "housing", tile: at(4, 2) })),
    ).toBe("there are no buildings in this game");
  });
});

describe("effects", () => {
  it("Housing adds troop capacity once finished", () => {
    const w = world();
    const me = w.players[0]!;
    const base = capacityOf(RULES, me);
    send(w, 1, { type: "build", buildingType: "housing", tile: at(4, 2) });
    expect(me.capacity).toBe(base); // not while it is being built
    run(w, HOUSING[0].buildTicks);
    expect(me.capacity).toBe(base + HOUSING[0].capacity!);
  });

  it("an upgrade keeps the old level working until it is done", () => {
    const w = world();
    const me = w.players[0]!;
    const base = capacityOf(RULES, me);
    const id = builtHousing(w);
    send(w, 1, { type: "upgrade", buildingId: id });
    expect(w.buildings[0]).toMatchObject({ level: 1, targetLevel: 2 });
    run(w, 5);
    expect(me.capacity).toBe(base + HOUSING[0].capacity!);
    expect(me.bonus.growth).toBe(0);
    run(w, HOUSING[1].buildTicks);
    expect(me.capacity).toBe(base + HOUSING[1].capacity!);
    expect(me.bonus.growth).toBe(HOUSING[1].growthBonus);
  });

  it("all growth bonuses together stay under the cap", () => {
    const w = world();
    const me = w.players[0]!;
    // Four Metropolises (+10% each) would be +40%; the cap is 20%.
    for (const x of [2, 10]) {
      for (const y of [0, 4]) {
        const id = w.nextBuildingId;
        w.buildings.push({
          id,
          type: "housing",
          owner: 1,
          tile: at(x + (y === 0 ? 1 : 0), y),
          level: 3,
          targetLevel: 3,
          startTick: -1,
          readyTick: -1,
          paid: 0,
          reloads: [],
          cooldowns: [],
          disabledUntil: -1,
        });
        w.nextBuildingId++;
      }
    }
    run(w, 1);
    expect(me.bonus.growth).toBe(RULES.buildings.maxGrowthBonus);
  });

  it("Factories add gold per tick and make Mobilize cheaper", () => {
    const w = world();
    const me = w.players[0]!;
    send(w, 1, { type: "build", buildingType: "factory", tile: at(4, 2) });
    run(w, FACTORY[0].buildTicks);
    expect(me.lastIncome).toBe(goldIncome(RULES, me.tiles) + FACTORY[0].income!);
    send(w, 1, { type: "upgrade", buildingId: w.buildings[0]!.id });
    run(w, FACTORY[1].buildTicks);
    expect(me.bonus.mobilizeDiscount).toBe(FACTORY[1].mobilizeDiscount);

    me.gold = 1_000;
    const events = send(w, 1, { type: "mobilize", percentBp: 10_000 });
    const mobilized = events.find((e) => e.type === "mobilized");
    // 10% off: 1,000 gold buys 1,111 troops.
    expect(mobilized).toMatchObject({ troops: 1_111, gold: 1_000 });
  });
});

describe("upgrades and cancelling", () => {
  it("upgrades step by step to level III, priced by the levels owned", () => {
    const w = world();
    const me = w.players[0]!;
    const id = builtHousing(w);
    const gold = me.gold;
    const events = send(w, 1, { type: "upgrade", buildingId: id });
    const price = buildingPrice(RULES, "housing", 2, 1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "buildingStarted", level: 2, gold: price }),
    );
    expect(me.gold).toBe(gold - price + me.lastIncome);
    expect(rejection(send(w, 1, { type: "upgrade", buildingId: id }))).toBe(
      "it is still being built",
    );
    run(w, HOUSING[1].buildTicks);
    send(w, 1, { type: "upgrade", buildingId: id });
    run(w, HOUSING[2].buildTicks);
    expect(w.buildings[0]!.level).toBe(3);
    expect(rejection(send(w, 1, { type: "upgrade", buildingId: id }))).toBe(
      "already at the top level",
    );
    expect(rejection(send(w, 2, { type: "upgrade", buildingId: id }))).toBe("not your building");
  });

  it("cancelling a construction removes it and refunds half", () => {
    const w = world();
    const me = w.players[0]!;
    send(w, 1, { type: "build", buildingType: "housing", tile: at(4, 2) });
    const gold = me.gold;
    const events = send(w, 1, { type: "cancelBuild", buildingId: w.buildings[0]!.id });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "buildingCancelled", refund: HOUSING[0].cost / 2 }),
    );
    expect(me.gold).toBe(gold + HOUSING[0].cost / 2 + me.lastIncome);
    expect(w.buildings).toHaveLength(0);
    expect(w.buildingAt[at(4, 2)]).toBe(-1);
  });

  it("cancelling an upgrade keeps the building at its level", () => {
    const w = world();
    const id = builtHousing(w);
    send(w, 1, { type: "upgrade", buildingId: id });
    send(w, 1, { type: "cancelBuild", buildingId: id });
    expect(w.buildings[0]).toMatchObject({ level: 1, targetLevel: 1, readyTick: -1 });
    expect(rejection(send(w, 1, { type: "cancelBuild", buildingId: id }))).toBe(
      "nothing is being built there",
    );
  });
});

describe("capture", () => {
  it("hands the building over at its level (the taker adopts it)", () => {
    const w = world();
    const id = builtHousing(w);
    send(w, 1, { type: "upgrade", buildingId: id });
    run(w, HOUSING[1].buildTicks);
    setOwner(w, at(4, 2), 2);
    const events = run(w, 1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "buildingCaptured", from: 1, to: 2, level: 2 }),
    );
    expect(w.buildings[0]).toMatchObject({ owner: 2, level: 2 });
    expect(w.players[1]!.bonus.capacity).toBe(HOUSING[1].capacity);
    expect(w.players[0]!.bonus.capacity).toBe(0);
  });

  it("cancels an upgrade in progress: the taker gets the working level", () => {
    const w = world();
    const id = builtHousing(w);
    send(w, 1, { type: "upgrade", buildingId: id });
    setOwner(w, at(4, 2), 2);
    run(w, 1);
    expect(w.buildings[0]).toMatchObject({ owner: 2, level: 1, targetLevel: 1, readyTick: -1 });
  });

  it("destroys an unfinished building, or anything a tribe takes", () => {
    const building = world();
    send(building, 1, { type: "build", buildingType: "housing", tile: at(4, 2) });
    setOwner(building, at(4, 2), 2);
    expect(run(building, 1)).toContainEqual(
      expect.objectContaining({ type: "buildingDestroyed", by: 2, reason: "captured" }),
    );
    expect(building.buildings).toHaveLength(0);
    expect(building.buildingAt[at(4, 2)]).toBe(-1);

    const tribe = world({ players: ["human", "tribe"] });
    builtHousing(tribe);
    setOwner(tribe, at(4, 2), 2);
    run(tribe, 1);
    expect(tribe.buildings).toHaveLength(0);
  });

  it("ignores a tile taken and retaken in the same tick", () => {
    const w = world();
    builtHousing(w);
    setOwner(w, at(4, 2), 2);
    setOwner(w, at(4, 2), 1);
    run(w, 1);
    expect(w.buildings[0]).toMatchObject({ owner: 1, level: 1 });
  });
});

describe("troop gifts (D-023)", () => {
  it("need a shared border", () => {
    const apart = worldFromAscii(
      `
      11~22
      11~22
      `,
      { rules: RULES, homeTroops: [5_000, 1_000] },
    );
    send(apart, 1, { type: "allianceRequest", target: 2 });
    send(apart, 2, { type: "allianceReply", from: 1, accept: true });
    const events = send(apart, 1, { type: "donate", to: 2, resource: "troops", percentBp: 2500 });
    expect(rejection(events)).toBe("troops only go to a friend you border");
    apart.players[0]!.gold = 1_000;
    expect(
      rejection(send(apart, 1, { type: "donate", to: 2, resource: "gold", percentBp: 2500 })),
    ).toBeNull();
  });
});

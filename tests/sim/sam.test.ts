/** SAM I–III and the interception rule (GAME_DESIGN.md §3.17.7, milestone 2B.2). */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { makeRules, type GameRules } from "../../src/sim/rules.ts";
import {
  airliftCapacity,
  airliftSite,
  interceptorsOnRoute,
} from "../../src/sim/systems/flights.ts";
import { decideBuild } from "../../src/sim/ai/build.ts";
import { runTick } from "../../src/sim/tick.ts";
import { areFriendly } from "../../src/sim/systems/diplomacy.ts";
import { type Building, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  economy: { incomeBase: 0, incomePerSqrtTile: 0 },
});

// 60 × 7: player 1 (Airport) on the left, its teammate 2 on the right, and player 3 (another
// team) on an island right under the route between them.
const MAP = `
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  ~111111~~~~~~~~~~~~~~~~33333~~~~~~~~~~~~~~~~~~~~~~~2222~~~~~
  ~111111~~~~~~~~~~~~~~~~33333~~~~~~~~~~~~~~~~~~~~~~~2222~~~~~
  ~111111~~~~~~~~~~~~~~~~33333~~~~~~~~~~~~~~~~~~~~~~~2222~~~~~
  ~111111~~~~~~~~~~~~~~~~33333~~~~~~~~~~~~~~~~~~~~~~~2222~~~~~
  ~111111~~~~~~~~~~~~~~~~33333~~~~~~~~~~~~~~~~~~~~~~~2222~~~~~
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;
const WIDTH = 60;
const at = (x: number, y: number) => y * WIDTH + x;
const AIRPORT_TILE = at(3, 3);
const FRIEND_TILE = at(52, 3);
const ISLAND = [at(25, 3), at(24, 1), at(26, 5), at(23, 2), at(27, 4)];

function building(w: World, type: Building["type"], owner: number, tile: number, level = 1) {
  const b: Building = {
    id: w.nextBuildingId++,
    type,
    owner,
    tile,
    level,
    targetLevel: level,
    startTick: -1,
    readyTick: -1,
    paid: 0,
    reloads: [],
    cooldowns: [],
  };
  w.buildings.push(b);
  w.buildingAt[tile] = b.id;
  return b;
}

/** Players 1 and 2 are teammates, 3 is not. Player 1 owns a working Airport (id 1). */
function world(rules: GameRules = RULES): World {
  const w = worldFromAscii(MAP, { rules, homeTroops: [20_000, 1_000, 5_000], teams: [1, 1, 2] });
  w.nextBuildingId = 1;
  building(w, "airport", 1, AIRPORT_TILE);
  return w;
}

function step(w: World, commands: { playerId: number; command: Command }[] = []): SimEvent[] {
  return [...runTick(w, { tick: w.tick + 1, commands }).events];
}

function run(w: World, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) events.push(...step(w));
  return events;
}

const AIRLIFT: Command = { type: "airlift", buildingId: 1, tile: FRIEND_TILE, percentBp: 10_000 };

/** Sends the airlift and flies it to the end; returns every event on the way. */
function fly(w: World): SimEvent[] {
  return [...step(w, [{ playerId: 1, command: AIRLIFT }]), ...run(w, 40)];
}

const intercepted = (events: SimEvent[]) =>
  events.filter((e): e is Extract<SimEvent, { type: "flightIntercepted" }> => {
    return e.type === "flightIntercepted";
  });

describe("SAMs shoot down hostile planes", () => {
  it("a third player's SAM I under the route fires its one interceptor: one plane, a quarter of the troops", () => {
    const w = world();
    const sam = building(w, "sam", 3, ISLAND[0]!);
    const lift = airliftCapacity(w.rules, 1, w.players[0]!.capacity);
    const events = fly(w);
    const shots = intercepted(events);
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({
      owner: 1,
      by: 3,
      fromTile: sam.tile,
      planes: 1,
      planesLeft: 3,
    });
    expect(shots[0]!.troopsLost).toBeCloseTo(lift / 4);
    const delivered = events.find((e) => e.type === "airliftDelivered");
    expect(delivered).toMatchObject({ from: 1, to: 2 });
    expect(delivered?.type === "airliftDelivered" && delivered.troops).toBeCloseTo(lift * 0.75);
    expect(w.players[1]!.homeTroops).toBeCloseTo(1_000 + lift * 0.75);
    // The interceptor is reloading (10 s).
    expect(sam.reloads).toHaveLength(1);
    expect(sam.reloads[0]! - w.tick).toBeGreaterThan(0);
    expect(sam.reloads[0]! - w.tick).toBeLessThan(100);
  });

  it("each interceptor destroys exactly one plane: SAM III fires three, one plane gets through", () => {
    const w = world();
    building(w, "sam", 3, ISLAND[0]!, 3);
    // One shot per SAM per tick (the first as it takes off: the Airport is inside the radius).
    const perTick: number[] = [];
    const events: SimEvent[] = [];
    for (let k = 0; k < 40; k++) {
      const tick = step(w, k === 0 ? [{ playerId: 1, command: AIRLIFT }] : []);
      events.push(...tick);
      perTick.push(intercepted(tick).length);
    }
    expect(Math.max(...perTick)).toBe(1);
    expect(intercepted(events).map((s) => s.planesLeft)).toEqual([3, 2, 1]);
    expect(events.some((e) => e.type === "airliftDelivered")).toBe(true);
  });

  it("overlapping SAMs add interceptors, not multipliers; more interceptors than planes waste none", () => {
    const two = world();
    building(two, "sam", 3, ISLAND[0]!);
    building(two, "sam", 3, ISLAND[1]!);
    expect(intercepted(fly(two)).map((s) => s.planesLeft)).toEqual([3, 2]);

    const five = world();
    const sams = ISLAND.map((tile) => building(five, "sam", 3, tile));
    const me = five.players[0]!;
    const before = me.homeTroops;
    const events = fly(five);
    expect(intercepted(events).map((s) => s.planesLeft)).toEqual([3, 2, 1, 0]);
    expect(events.some((e) => e.type === "airliftDelivered")).toBe(false);
    expect(five.flights).toHaveLength(0);
    expect(me.fieldTroops).toBe(0);
    expect(five.players[1]!.homeTroops).toBe(1_000);
    expect(me.homeTroops).toBe(before - airliftCapacity(five.rules, 1, me.capacity));
    // The fifth SAM had nothing left to shoot at and keeps its interceptor.
    expect(sams.filter((s) => s.reloads.length === 0)).toHaveLength(1);
  });

  it("never fires at its owner's or a friend's planes", () => {
    const w = world();
    building(w, "sam", 2, at(52, 1), 3); // the teammate's own SAM at the landing site
    building(w, "sam", 1, at(5, 5), 3); // the sender's own
    expect(intercepted(fly(w))).toHaveLength(0);

    const allied = world();
    building(allied, "sam", 3, ISLAND[0]!, 3);
    allied.alliances.set(1 * 0x10000 + 3, {
      a: 1,
      b: 3,
      formedTick: 0,
      expiresTick: 10_000,
      renewA: false,
      renewB: false,
    });
    expect(areFriendly(allied, 1, 3)).toBe(true);
    expect(intercepted(fly(allied))).toHaveLength(0);
  });

  it("a SAM under construction doesn't fire; one being upgraded keeps its old level working", () => {
    const building0 = world();
    const sam = building(building0, "sam", 3, ISLAND[0]!, 0);
    sam.targetLevel = 1;
    sam.startTick = 0;
    sam.readyTick = 10_000;
    expect(intercepted(fly(building0))).toHaveLength(0);

    const upgrading = world();
    const old = building(upgrading, "sam", 3, ISLAND[0]!, 1);
    old.targetLevel = 2;
    old.startTick = 0;
    old.readyTick = 10_000;
    expect(intercepted(fly(upgrading))).toHaveLength(1);
  });

  it("a spent interceptor is back after its reload", () => {
    const w = world();
    const sam = building(w, "sam", 3, ISLAND[0]!, 2); // 2 interceptors, 8 s each
    const shots = intercepted(fly(w));
    expect(shots).toHaveLength(2);
    // They reload one at a time: the second is back 8 s after the first.
    expect(sam.reloads).toHaveLength(2);
    expect(sam.reloads[1]! - sam.reloads[0]!).toBe(80);
    run(w, 200);
    expect(sam.reloads).toHaveLength(0);
  });

  it("the route preview counts exactly the interceptors the flight meets", () => {
    const w = world();
    building(w, "sam", 3, ISLAND[0]!, 2);
    building(w, "sam", 3, at(24, 1), 1); // also on the island
    building(w, "sam", 2, at(52, 1), 3); // a friend's: never counts
    const route = interceptorsOnRoute(
      w.rules,
      w.map,
      w.buildings,
      (owner) => owner !== 1 && !areFriendly(w, 1, owner),
      AIRPORT_TILE,
      FRIEND_TILE,
      "transport",
      w.tick,
    );
    expect(route.sams.map((s) => s.owner)).toEqual([3, 3]);
    expect(route.interceptors).toBe(3);
    expect(intercepted(fly(w))).toHaveLength(3);
  });
});

describe("SAM building", () => {
  it("is built like any building — and only in games with flights", () => {
    const w = world();
    const build: Command = { type: "build", buildingType: "sam", tile: ISLAND[0]! };
    w.players[2]!.gold = 100_000;
    const built = step(w, [{ playerId: 3, command: build }]);
    expect(built.find((e) => e.type === "commandRejected")).toBeUndefined();
    expect(w.players[2]!.gold).toBe(20_000);
    run(w, w.rules.buildings.types.sam.levels[0]!.buildTicks);
    expect(w.buildings.find((b) => b.type === "sam")).toMatchObject({ owner: 3, level: 1 });

    const off = world(makeRules({ ...RULES, flights: { ...RULES.flights, enabled: false } }));
    off.players[2]!.gold = 100_000;
    const rejected = step(off, [{ playerId: 3, command: build }]).find(
      (e) => e.type === "commandRejected",
    );
    expect(rejected).toMatchObject({ reason: "there are no flights in this game" });
  });

  it("has the §3.17.7 numbers: radius 25/35/45, interceptors 1/2/3, reload 10/8/6 s", () => {
    const levels = RULES.buildings.types.sam.levels;
    expect(levels.map((l) => l.range)).toEqual([25, 35, 45]);
    expect(levels.map((l) => l.interceptors)).toEqual([1, 2, 3]);
    expect(levels.map((l) => (l.reloadTicks! * RULES.tickMs) / 1000)).toEqual([10, 8, 6]);
    expect(levels.map((l) => l.cost)).toEqual([80_000, 180_000, 400_000]);
  });
});

/** A tall world: Airport (player 1) on the left, its teammate's long island on the right. */
function tallWorld(): World {
  const rows: string[] = [];
  for (let y = 0; y < 60; y++) {
    const edge = y === 0 || y === 59;
    rows.push(
      edge
        ? "~".repeat(60)
        : "~111111" + "~".repeat(16) + "33333" + "~".repeat(22) + "22222" + "~~~~~",
    );
  }
  const w = worldFromAscii(rows.join("\n"), {
    rules: RULES,
    homeTroops: [20_000, 1_000, 5_000],
    teams: [1, 1, 2],
  });
  w.nextBuildingId = 1;
  building(w, "airport", 1, at(3, 30));
  return w;
}

describe("nations and SAMs", () => {
  it("a nation's airlift flies around hostile SAMs — or not at all if every route loses every plane", () => {
    const w = tallWorld();
    const airport = w.buildings[0]!;
    const friend = w.players[1]!;
    expect(airliftSite(w, airport, friend)).toBe(at(50, 30)); // no SAMs: the nearest tile
    building(w, "sam", 3, at(25, 10));
    const site = airliftSite(w, airport, friend);
    const met = (tile: number) =>
      interceptorsOnRoute(
        w.rules,
        w.map,
        w.buildings,
        (owner) => owner === 3,
        airport.tile,
        tile,
        "transport",
        w.tick,
      ).interceptors;
    expect(met(at(50, 30))).toBe(1);
    expect(site).toBeGreaterThanOrEqual(0);
    expect(met(site)).toBe(0);

    const blocked = world();
    for (const tile of ISLAND.slice(0, 4)) building(blocked, "sam", 3, tile);
    expect(airliftSite(blocked, blocked.buildings[0]!, blocked.players[1]!)).toBe(-1);
  });

  it("a nation builds a SAM among its buildings only when a hostile Airport can reach them", () => {
    // Player 1 (a nation) owns the left; player 2 (no friend) the right, with an Airport.
    const rows: string[] = [];
    for (let y = 0; y < 30; y++) rows.push("1".repeat(40) + "2".repeat(20));
    const rules = makeRules({
      ...RULES,
      ai: {
        ...RULES.ai,
        build: { ...RULES.ai.build, tilesPerBuilding: 100, samWorth: 10 },
      },
    });
    const setup = (airportOwner: number | null) => {
      const w = worldFromAscii(rows.join("\n"), { rules, players: ["bot", "human"] });
      w.nextBuildingId = 1;
      building(w, "housing", 1, at(12, 15), 2);
      if (airportOwner !== null) building(w, "airport", airportOwner, at(55, 15));
      const bot = w.players[0]!;
      bot.gold = 1_000_000;
      bot.lastIncome = 1_000;
      return { w, bot };
    };
    const { w, bot } = setup(2);
    const decision = decideBuild(w, bot, 0);
    expect(decision).toMatchObject({ type: "build", buildingType: "sam" });
    if (decision?.type !== "build") return;
    // It stands within reach of the Housing it covers.
    expect(Math.abs((decision.tile % WIDTH) - 12)).toBeLessThanOrEqual(12);
    expect(Math.abs(Math.floor(decision.tile / WIDTH) - 15)).toBeLessThanOrEqual(12);

    for (const owner of [null, 1]) {
      const calm = setup(owner);
      const choice = decideBuild(calm.w, calm.bot, 0);
      expect(choice?.type === "build" && choice.buildingType).not.toBe("sam");
    }
  });
});

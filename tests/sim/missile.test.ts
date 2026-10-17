/** Missile Silos I–III, missiles, SAM interception, war production (GAME_DESIGN §3.17.8, 2B.5). */
import { describe, expect, it } from "vitest";
import { decideMissiles, runawayLeader } from "../../src/sim/ai/missile.ts";
import type { Command } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { makeRules } from "../../src/sim/rules.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import { tileCost } from "../../src/sim/systems/attacks.ts";
import { flightTicks } from "../../src/sim/systems/flights.ts";
import { scorchedFactor, siloReady, warheadTiles } from "../../src/sim/systems/missiles.ts";
import { isSuppressed } from "../../src/sim/systems/suppression.ts";
import { runTick } from "../../src/sim/tick.ts";
import { NEUTRAL, setOwner, type Attack, type Building, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  economy: { incomeBase: 0, incomePerSqrtTile: 0 },
});

// 320 × 45: player 1 (the Silo) on the left, enemy 2 across the middle, 1's teammate 3 on the
// right edge, and player 4 (team of their own) in a block of 2's land.
const WIDTH = 320;
const HEIGHT = 45;
const MAP = Array.from({ length: HEIGHT }, () =>
  Array.from({ length: WIDTH }, (_, x) =>
    x < 12 ? "1" : x >= 300 ? "3" : x >= 60 && x < 80 ? "4" : "2",
  ).join(""),
).join("\n");
const at = (x: number, y: number) => y * WIDTH + x;
const SILO_TILE = at(3, 22);
const TARGET = at(150, 22);

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
    disabledUntil: -1,
  };
  w.buildings.push(b);
  w.buildingAt[tile] = b.id;
  return b;
}

/** Player 1 owns a working Silo (id 1) at `level` and 10M gold; 1 and 3 are teammates. */
function world(level = 1): World {
  const w = worldFromAscii(MAP, {
    rules: RULES,
    homeTroops: [100_000, 100_000, 1_000, 1_000],
    teams: [1, 2, 1, 3],
  });
  w.nextBuildingId = 1;
  building(w, "silo", 1, SILO_TILE, level);
  w.players[0]!.gold = 10_000_000;
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

const fire = (
  tile = TARGET,
  missile: "missile" | "buster" | "warhead" = "missile",
): { playerId: number; command: Command } => ({
  playerId: 1,
  command: { type: "launchMissile", buildingId: 1, tile, missile },
});

function rejection(events: SimEvent[]): string | null {
  const rejected = events.find((e) => e.type === "commandRejected");
  return rejected?.type === "commandRejected" ? rejected.reason : null;
}

const missileTicks = (w: World, tile = TARGET) =>
  flightTicks(w.rules, w.map, SILO_TILE, tile, "missile");

/** Fires at `tile` and plays until just after the missile arrives. */
function fireAndWait(
  w: World,
  tile = TARGET,
  missile: "missile" | "buster" | "warhead" = "missile",
): SimEvent[] {
  const launch = step(w, [fire(tile, missile)]);
  expect(rejection(launch)).toBeNull();
  return [...launch, ...run(w, missileTicks(w, tile) + 1)];
}

/** Tiles within `r` of a tile (a blast's circle). */
function circleTiles(r: number): number {
  let n = 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) n++;
  return n;
}

const struck = (events: SimEvent[]) =>
  events.filter(
    (e): e is Extract<SimEvent, { type: "buildingStruck" }> => e.type === "buildingStruck",
  );

describe("Missile Silo", () => {
  it("is built like any building and destroyed when its tile is captured", () => {
    const w = world();
    w.players[1]!.gold = 1_000_000;
    const events = step(w, [
      { playerId: 2, command: { type: "build", buildingType: "silo", tile: at(200, 10) } },
    ]);
    expect(rejection(events)).toBeNull();
    expect(w.players[1]!.gold).toBe(750_000);
    run(w, 150);
    const silo = w.buildings.find((b) => b.owner === 2 && b.type === "silo")!;
    expect(silo.level).toBe(1);
    // Player 1 takes the Silo's tile: it is destroyed, not adopted.
    setOwner(w, silo.tile, 1);
    const destroyed = step(w);
    expect(w.buildings.some((b) => b.id === silo.id)).toBe(false);
    expect(destroyed.find((e) => e.type === "buildingDestroyed")).toMatchObject({
      buildingId: silo.id,
      reason: "captured",
    });
  });

  it("a strike missile costs 75k and a slot that reloads in 30 s", () => {
    const w = world();
    const launch = step(w, [fire()]);
    expect(rejection(launch)).toBeNull();
    expect(w.players[0]!.gold).toBe(10_000_000 - 75_000);
    expect(w.flights[0]).toMatchObject({ kind: "missile", planes: 1, troops: 0, target: 2 });
    // 6 tiles a tick (3 until the Phase 2B playtest: "missiles need to move faster").
    expect(w.flights[0]!.arriveTick - w.tick).toBe(Math.ceil(147 / 6));
    expect(siloReady(w.rules, w.buildings[0]!, w.tick)).toBe(0);
    expect(rejection(step(w, [fire()]))).toBe("no missile ready — the Silo is reloading");
    expect(w.buildings[0]!.reloads).toEqual([w.tick - 1 + 300]);
  });

  it("enemy buildings within 10 km (Silo I) lose two levels, 10% of the victim's troops die, the land is suppressed 30 s", () => {
    const w = world();
    const near = building(w, "factory", 2, at(150, 22), 3);
    const edge = building(w, "housing", 2, at(160, 22), 2); // exactly 10 km
    const far = building(w, "housing", 2, at(161, 22), 2);
    const enemy = w.players[1]!;
    const before = enemy.homeTroops;
    const tilesBefore = enemy.tiles;
    const events = fireAndWait(w);
    expect(near.level).toBe(1);
    expect(w.buildings.includes(edge)).toBe(false); // level II: destroyed
    expect(far.level).toBe(2);
    expect(struck(events)).toHaveLength(2);
    expect(near.disabledUntil).toBe(w.tick - 1 + 600);
    // The crater (D-033): the 7 km circle (Silo I) burns to neutral land — all but the
    // standing Factory's tile — and its share of the land's troops die too.
    const crater = circleTiles(7) - 1;
    expect(w.owner[at(150, 22)]).toBe(2);
    expect(w.owner[at(151, 22)]).toBe(NEUTRAL);
    expect(w.owner[at(157, 22)]).toBe(NEUTRAL);
    expect(w.owner[at(158, 22)]).toBe(2);
    expect(enemy.tiles).toBe(tilesBefore - crater);
    const afterShare = before * 0.9;
    const craterKills = (afterShare * crater) / tilesBefore;
    const hit = events.find((e) => e.type === "missileHit");
    expect(hit).toMatchObject({
      missile: "missile",
      victim: 2,
      buildings: 2,
      crater,
      radius: 10,
      craterRadius: 7,
    });
    expect(hit?.type === "missileHit" && hit.troops).toBeCloseTo(before * 0.1 + craterKills, 6);
    expect(enemy.homeTroops).toBeCloseTo(afterShare - craterKills, 6);
    expect(w.scorched).toEqual([{ tile: TARGET, radius: 7, by: 1, untilTick: w.tick - 1 + 300 }]);
    expect(w.suppressions[0]).toMatchObject({ radius: 10, victim: 2, by: 1 });
    expect(isSuppressed(w, at(150, 32))).toBe(true);
    expect(isSuppressed(w, at(150, 33))).toBe(false);
    run(w, 300);
    expect(w.suppressions).toHaveLength(0);
  });

  it("blasts grow with the Silo's level: crater 7 / 10 / 13 km, buildings 10 / 13 / 16 km", () => {
    for (const [level, crater, reach] of [
      [1, 7, 10],
      [2, 10, 13],
      [3, 13, 16],
    ] as const) {
      const w = world(level);
      const edge = building(w, "housing", 2, at(150 + reach, 22), 1);
      const far = building(w, "housing", 2, at(151 + reach, 22), 1);
      const tilesBefore = w.players[1]!.tiles;
      const hit = fireAndWait(w).find((e) => e.type === "missileHit");
      expect(hit).toMatchObject({ radius: reach, craterRadius: crater, buildings: 1 });
      expect(w.buildings.includes(edge)).toBe(false);
      expect(w.buildings.includes(far)).toBe(true);
      expect(w.players[1]!.tiles).toBe(tilesBefore - circleTiles(crater));
      expect(w.owner[at(150 + crater, 22)]).toBe(NEUTRAL);
      expect(w.owner[at(151 + crater, 22)]).toBe(2);
    }
  });

  it("the Silo's level at launch counts, not what it is when the missile lands", () => {
    const w = world(3);
    expect(rejection(step(w, [fire()]))).toBeNull();
    w.buildings[0]!.level = 1;
    const hit = run(w, missileTicks(w) + 1).find((e) => e.type === "missileHit");
    expect(hit).toMatchObject({ craterRadius: 13 });
  });

  it("a Silo I fires only strike missiles; out of range is refused", () => {
    const w = world();
    building(w, "factory", 2, TARGET, 3);
    expect(rejection(step(w, [fire(TARGET, "buster")]))).toBe(
      "a bunker buster needs an Advanced Silo (level II)",
    );
    expect(rejection(step(w, [fire(TARGET, "warhead")]))).toBe(
      "the strategic warhead needs a Strategic Missile Complex (level III)",
    );
    expect(rejection(step(w, [fire(at(260, 22))]))).toBe("out of the Silo's range");
    expect(rejection(step(w, [fire(at(5, 5))]))).toBe("that's your own land");
    expect(rejection(step(w, [fire(at(310, 5))]))).toBe("they're your teammate");
    w.players[0]!.gold = 1_000;
    expect(rejection(step(w, [fire()]))).toBe("not enough gold");
  });

  it("an Advanced Silo: two slots, 400 km, and bunker busters destroy their target", () => {
    const w = world(2);
    const fort = building(w, "factory", 2, TARGET, 3);
    const neighbour = building(w, "housing", 2, at(152, 22), 2);
    const edge = building(w, "housing", 2, at(156, 22), 2); // exactly 6 km (Silo II's splash)
    const beyond = building(w, "housing", 2, at(157, 22), 2);
    expect(rejection(step(w, [fire(at(140, 22), "buster")]))).toBe(
      "a bunker buster needs an enemy building to hit",
    );
    const launch = step(w, [fire(TARGET, "buster"), fire(at(260, 22))]);
    expect(rejection(launch)).toBeNull();
    expect(w.flights.map((f) => f.kind)).toEqual(["buster", "missile"]);
    const before = w.players[1]!.homeTroops;
    const hits = run(w, missileTicks(w) + 1);
    expect(w.buildings.includes(fort)).toBe(false); // even a level-III building
    // Its splash (D-033): a level off everything within 6 km (Silo II).
    expect(neighbour.level).toBe(1);
    expect(edge.level).toBe(1);
    expect(beyond.level).toBe(2);
    const buster = hits.find((e) => e.type === "missileHit" && e.missile === "buster");
    expect(buster).toMatchObject({
      victim: 2,
      troops: before * 0.05,
      buildings: 3,
      crater: 0,
      radius: 6,
    });
    // A level-II building hit by a buster is destroyed.
    const w2 = world(2);
    const house = building(w2, "housing", 2, TARGET, 2);
    const events = fireAndWait(w2, TARGET, "buster");
    expect(w2.buildings.some((b) => b.id === house.id)).toBe(false);
    expect(struck(events)[0]).toMatchObject({ levelBefore: 2, level: 0 });
  });

  it("SAM I ignores missiles, SAM II shoots conventional ones, only SAM III the warhead", () => {
    for (const [samLevel, missile, stopped] of [
      [1, "missile", false],
      [2, "missile", true],
      [2, "warhead", false],
      [3, "warhead", true],
    ] as const) {
      const w = world(3);
      building(w, "sam", 2, at(100, 22), samLevel);
      const events = [...step(w, [fire(TARGET, missile)]), ...run(w, missileTicks(w) + 1)];
      const shots = events.filter((e) => e.type === "flightIntercepted");
      expect(shots.length, `SAM ${samLevel} vs ${missile}`).toBe(stopped ? 1 : 0);
      const hit = events.some((e) => e.type === "missileHit" || e.type === "warheadDetonated");
      expect(hit, `SAM ${samLevel} vs ${missile}`).toBe(!stopped);
    }
  });

  it("one interceptor per missile: three missiles against a SAM II, one gets through", () => {
    const w = world(3);
    building(w, "sam", 2, at(100, 22), 2); // two interceptors
    const factory = building(w, "factory", 2, at(156, 22), 3);
    const events = [...step(w, [fire(), fire(), fire()]), ...run(w, missileTicks(w) + 1)];
    expect(events.filter((e) => e.type === "flightIntercepted")).toHaveLength(2);
    expect(factory.level).toBe(1); // one got through: −2 levels
  });

  it("Fortress Wall flak doesn't touch missiles", () => {
    const w = world();
    for (let y = 0; y < HEIGHT; y++) w.fortLevel[at(100, y)] = 3;
    w.walls.push({
      id: 1,
      owner: 2,
      points: [at(100, 0), at(100, HEIGHT - 1)],
      tiles: Array.from({ length: HEIGHT }, (_, y) => at(100, y)),
      intact: HEIGHT,
      level: 3,
      targetLevel: 3,
      startTick: -1,
      readyTick: -1,
      paid: 0,
    });
    for (let y = 0; y < HEIGHT; y++) w.wallAt[at(100, y)] = 1;
    const events = fireAndWait(w);
    expect(events.filter((e) => e.type === "flightIntercepted")).toHaveLength(0);
    expect(events.some((e) => e.type === "missileHit")).toBe(true);
  });
});

describe("strategic warhead (Silo III)", () => {
  it("scorches 20 km of the enemy's land: buildings gone, troops lost in proportion", () => {
    const w = world(3);
    const enemy = w.players[1]!;
    const factory = building(w, "factory", 2, at(160, 22), 3);
    const tilesBefore = enemy.tiles;
    const troopsBefore = enemy.homeTroops;
    const launch = step(w, [fire(TARGET, "warhead")]);
    expect(rejection(launch)).toBeNull();
    expect(w.players[0]!.gold).toBe(10_000_000 - 500_000);
    expect(w.buildings[0]!.cooldowns[0]).toBe(w.tick + 900);
    const events = run(w, missileTicks(w) + 1);
    const blast = events.find(
      (e): e is Extract<SimEvent, { type: "warheadDetonated" }> => e.type === "warheadDetonated",
    )!;
    // A full circle of radius 20: every tile with dx² + dy² <= 400.
    let circle = 0;
    for (let dy = -20; dy <= 20; dy++)
      for (let dx = -20; dx <= 20; dx++) if (dx * dx + dy * dy <= 400) circle++;
    expect(blast.tiles).toBe(circle);
    expect(enemy.tiles).toBe(tilesBefore - circle);
    expect(w.owner[TARGET]).toBe(NEUTRAL);
    expect(w.buildings.some((b) => b.id === factory.id)).toBe(false);
    expect(blast.buildings).toBe(1);
    expect(blast.victims).toHaveLength(1);
    expect(blast.victims[0]).toMatchObject({ id: 2, tiles: circle });
    expect(blast.victims[0]!.troops).toBeCloseTo((troopsBefore * circle) / tilesBefore, 6);
    expect(enemy.homeTroops).toBeCloseTo(troopsBefore * (1 - circle / tilesBefore), 6);
    expect(w.scorched).toEqual([{ tile: TARGET, radius: 20, by: 1, untilTick: w.tick - 1 + 600 }]);
  });

  it("spares the launcher's and teammates' land; the warhead has a 90 s cooldown", () => {
    const w = world(3);
    const near = at(20, 22);
    const tiles = warheadTiles(w, 1, near);
    expect(tiles.every((t) => w.owner[t] === 2)).toBe(true);
    expect(warheadTiles(w, 1, at(295, 22)).every((t) => w.owner[t] === 2)).toBe(true);
    fireAndWait(w, near, "warhead");
    expect(w.owner[at(11, 22)]).toBe(1);
    expect(w.owner[at(12, 22)]).toBe(NEUTRAL);
    w.buildings[0]!.reloads = [];
    expect(rejection(step(w, [fire(TARGET, "warhead")]))).toBe("the warhead is still on cooldown");
    // …but conventional missiles still fly (a slot each).
    expect(rejection(step(w, [fire(TARGET, "missile")]))).toBeNull();
  });

  it("hits the whole map, and breaking into an ally's land ends the alliance", () => {
    const w = world(3);
    step(w, [{ playerId: 1, command: { type: "allianceRequest", target: 4 } }]);
    step(w, [{ playerId: 4, command: { type: "allianceReply", from: 1, accept: true } }]);
    expect(w.alliances.size).toBe(1);
    const events = fireAndWait(w, at(50, 22), "warhead");
    expect(events.find((e) => e.type === "allianceBroken")).toMatchObject({
      breaker: 1,
      victim: 4,
    });
    expect(w.alliances.size).toBe(0);
    expect(w.players[0]!.traitorUntilTick).toBeGreaterThan(w.tick);
    // Whole map: far beyond Silo II's 400 km would still be fine (this map is 320 wide).
    expect(rejection(step(w, [fire(at(290, 2))]))).toBeNull();
  });

  it("scorched land costs 3× to expand into for 60 s, then heals", () => {
    const w = world(3);
    fireAndWait(w, TARGET, "warhead");
    expect(scorchedFactor(w, TARGET)).toBe(3);
    expect(scorchedFactor(w, at(150, 0))).toBe(1);
    const expansion = { target: NEUTRAL, lossFactor: 1 } as Attack;
    const base = tileCost(w, { ...expansion } as Attack, at(150, 0));
    expect(tileCost(w, expansion, TARGET)).toBeCloseTo(base * 3, 9);
    run(w, 600);
    expect(w.scorched).toHaveLength(0);
    expect(tileCost(w, expansion, TARGET)).toBeCloseTo(base, 9);
  });

  it("is deterministic and hashed (scorched zones only while they last)", () => {
    const play = () => {
      const w = world(3);
      fireAndWait(w, TARGET, "warhead");
      return w;
    };
    const a = play();
    const b = play();
    expect(hashWorld(a)).toBe(hashWorld(b));
    b.scorched = [];
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});

describe("war production (Factory III)", () => {
  it("Silos and Airports within 60 km of a working Factory III reload 25% faster", () => {
    const w = world();
    const factory = building(w, "factory", 1, at(5, 40), 3);
    step(w, [fire()]);
    expect(w.buildings[0]!.reloads).toEqual([w.tick + 225]);
    // A disabled factory doesn't help.
    const w2 = world();
    building(w2, "factory", 1, at(5, 40), 3).disabledUntil = 1_000;
    step(w2, [fire()]);
    expect(w2.buildings[0]!.reloads).toEqual([w2.tick + 300]);
    // An Airport's mission cooldown too (Military Airport: 25 s → 18.75 s).
    const airport = building(w, "airport", 1, at(8, 30), 2);
    const events = step(w, [
      {
        playerId: 1,
        command: { type: "assault", buildingId: airport.id, tile: at(100, 22), percentBp: 100 },
      },
    ]);
    expect(rejection(events)).toBeNull();
    expect(airport.cooldowns[0]).toBe(w.tick + 188);
    // A Factory II has no war production.
    factory.level = 2;
    factory.targetLevel = 2;
    run(w, 300);
    step(w, [fire(at(140, 22))]); // the first one's crater is no one's land now
    expect(w.buildings[0]!.reloads).toEqual([w.tick + 300]);
  });
});

describe("nations and missiles", () => {
  const decide = (w: World, actions: Command[] = []) => decideMissiles(w, w.players[0]!, actions);
  const war: Command = { type: "attack", target: 2, focusTile: at(12, 4), percentBp: 5_000 };

  it("at war, a cluster of buildings worth twice the launch — nothing in peace", () => {
    const w = world();
    building(w, "housing", 2, at(150, 22), 3);
    building(w, "factory", 2, at(155, 22), 3);
    expect(decide(w)).toEqual([]);
    expect(decide(w, [war])).toEqual([
      { type: "launchMissile", buildingId: 1, tile: at(150, 22), missile: "missile" },
    ]);
  });

  it("a lone cheap building isn't worth a missile; a bunker buster for a prize", () => {
    const w = world(2);
    building(w, "housing", 2, at(150, 22), 1);
    expect(decide(w, [war])).toEqual([]);
    const metropolis = building(w, "housing", 2, at(200, 22), 3);
    expect(decide(w, [war])).toEqual([
      { type: "launchMissile", buildingId: 1, tile: metropolis.tile, missile: "buster" },
    ]);
  });

  it("fires one more missile than the SAM II interceptors on the route", () => {
    const w = world(3);
    w.players[0]!.gold = 400_000; // not enough for a warhead
    building(w, "sam", 2, at(100, 22), 2);
    const metropolis = building(w, "housing", 2, TARGET, 3);
    building(w, "factory", 2, at(154, 22), 3);
    building(w, "factory", 2, at(146, 22), 3);
    const choice = decide(w, [war]);
    expect(choice).toHaveLength(3);
    expect(choice[0]).toMatchObject({ tile: metropolis.tile });
  });

  it("the warhead only at a runaway leader, where it hits their land, never through SAM III", () => {
    const w = world(3);
    expect(runawayLeader(w, w.players[0]!)?.id).toBe(2);
    expect(decide(w)).toEqual([
      { type: "launchMissile", buildingId: 1, tile: w.players[1]!.spawnTile, missile: "warhead" },
    ]);
    building(w, "sam", 2, w.players[1]!.spawnTile + 1, 3);
    expect(decide(w)).toEqual([]);
  });
});

/** Airport III air strikes, suppression and escorts (GAME_DESIGN.md §3.17.7, milestone 2B.4). */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { makeRules } from "../../src/sim/rules.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import { tileCost } from "../../src/sim/systems/attacks.ts";
import { airliftCapacity, flightTicks } from "../../src/sim/systems/flights.ts";
import { isSuppressed } from "../../src/sim/systems/suppression.ts";
import { wallBuildTicks, wallHoldTicks, wallLossFactor } from "../../src/sim/systems/walls.ts";
import { runTick } from "../../src/sim/tick.ts";
import type { Attack, Building, World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";
import { decideStrike } from "../../src/sim/ai/strike.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  economy: { incomeBase: 0, incomePerSqrtTile: 0 },
});

// 60 × 9: player 1 (Air Base) on the left, enemy 2 on the right, 1's teammate 3 in the
// bottom-right corner.
const MAP = `
  111111111111222222222222222222222222222222222222222222222222
  111111111111222222222222222222222222222222222222222222222222
  111111111111222222222222222222222222222222222222222222222222
  111111111111222222222222222222222222222222222222222222222222
  111111111111222222222222222222222222222222222222222222222222
  111111111111222222222222222222222222222222222222222222222222
  111111111111222222222222222222222222222222222222222222222222
  111111111111222222222222222222222222222222222222222222223333
  111111111111222222222222222222222222222222222222222222223333
`;
const WIDTH = 60;
const at = (x: number, y: number) => y * WIDTH + x;
const AIRPORT_TILE = at(3, 4);
const TARGET = at(40, 4);

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

/** Player 1 owns a working Airport (id 1) at `level`; 1 and 3 are teammates. */
function world(level = 3): World {
  const w = worldFromAscii(MAP, {
    rules: RULES,
    homeTroops: [50_000, 1_000, 1_000],
    teams: [1, 2, 1],
  });
  w.nextBuildingId = 1;
  building(w, "airport", 1, AIRPORT_TILE, level);
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

const strike = (tile = TARGET): { playerId: number; command: Command } => ({
  playerId: 1,
  command: { type: "airStrike", buildingId: 1, tile },
});

function rejection(events: SimEvent[]): string | null {
  const rejected = events.find((e) => e.type === "commandRejected");
  return rejected?.type === "commandRejected" ? rejected.reason : null;
}

const fighterTicks = (w: World, tile = TARGET) =>
  flightTicks(w.rules, w.map, AIRPORT_TILE, tile, "fighter");

/** Launches a strike at `tile` and plays until just after it arrives. */
function strikeAndWait(w: World, tile = TARGET): SimEvent[] {
  const launch = step(w, [strike(tile)]);
  expect(rejection(launch)).toBeNull();
  return [...launch, ...run(w, fighterTicks(w, tile) + 1)];
}

const struck = (events: SimEvent[]) =>
  events.filter(
    (e): e is Extract<SimEvent, { type: "buildingStruck" }> => e.type === "buildingStruck",
  );

describe("Air Base (Airport III)", () => {
  it("lifts 20% of capacity, 350 km, every 20 s — with two escort fighters", () => {
    const w = world();
    expect(airliftCapacity(w.rules, 3, w.players[0]!.capacity)).toBe(
      Math.floor(w.players[0]!.capacity * 0.2),
    );
    const events = step(w, [
      {
        playerId: 1,
        command: { type: "assault", buildingId: 1, tile: TARGET, percentBp: 10_000 },
      },
    ]);
    expect(rejection(events)).toBeNull();
    expect(w.flights[0]).toMatchObject({ kind: "assault", planes: 4, escorts: 2 });
    expect(events.find((e) => e.type === "flightLaunched")).toMatchObject({ escorts: 2 });
    expect(w.buildings[0]!.cooldowns[0]).toBe(w.tick + 200);
  });

  it("escorts take the first interceptors: every transport and all the troops get through", () => {
    const w = world();
    building(w, "sam", 2, at(25, 4), 2); // two interceptors on the route
    const launch = step(w, [
      {
        playerId: 1,
        command: { type: "assault", buildingId: 1, tile: TARGET, percentBp: 10_000 },
      },
    ]);
    const troops = w.players[0]!.fieldTroops;
    const events = [...launch, ...run(w, 40)];
    const shots = events.filter((e) => e.type === "flightIntercepted");
    expect(shots).toHaveLength(2);
    expect(shots[0]).toMatchObject({ planes: 0, escorts: 1, planesLeft: 4, troopsLost: 0 });
    expect(events.find((e) => e.type === "assaultLanded")).toMatchObject({ troops });
  });

  it("a Military Airport flies no escorts and no strikes", () => {
    const w = world(2);
    expect(rejection(step(w, [strike()]))).toBe("an air strike needs an Air Base (level III)");
    step(w, [
      {
        playerId: 1,
        command: { type: "assault", buildingId: 1, tile: TARGET, percentBp: 10_000 },
      },
    ]);
    expect(w.flights[0]!.escorts).toBe(0);
  });
});

describe("air strike on a building", () => {
  it("four fighters cost it a level and disable it for 20 s; the strike has its own cooldown", () => {
    const w = world();
    const factory = building(w, "factory", 2, TARGET, 3);
    const launch = step(w, [strike()]);
    expect(w.flights[0]).toMatchObject({ kind: "strike", planes: 4, troops: 0, target: 2 });
    const arrives = w.flights[0]!.arriveTick;
    expect(w.buildings[0]!.cooldowns[1]).toBe(w.tick + 300);
    // The lift is still ready: strikes don't share its cooldown.
    expect(w.buildings[0]!.cooldowns[0] ?? -1).toBeLessThanOrEqual(w.tick);
    expect(rejection(step(w, [strike()]))).toBe("the fighters are still on cooldown");
    expect(launch.find((e) => e.type === "flightLaunched")).toMatchObject({ kind: "strike" });

    const events = run(w, fighterTicks(w));
    expect(struck(events)).toMatchObject([
      { buildingId: factory.id, playerId: 2, by: 1, levelBefore: 3, level: 2 },
    ]);
    expect(factory.level).toBe(2);
    expect(factory.disabledUntil).toBe(arrives + 200);
    // Disabled: its income is gone until it works again.
    expect(w.players[1]!.bonus.income).toBe(0);
    run(w, 200);
    expect(w.players[1]!.bonus.income).toBe(90);
  });

  it("a level-I building is destroyed; an upgrade under way is lost", () => {
    const w = world();
    const housing = building(w, "housing", 2, TARGET, 1);
    const events = strikeAndWait(w);
    expect(events.find((e) => e.type === "buildingDestroyed")).toMatchObject({
      buildingId: housing.id,
      reason: "struck",
      by: 1,
    });
    expect(w.buildingAt[TARGET]).toBe(-1);

    const w2 = world();
    const upgrading = building(w2, "housing", 2, TARGET, 2);
    upgrading.targetLevel = 3;
    upgrading.startTick = 0;
    upgrading.readyTick = 10_000;
    strikeAndWait(w2);
    expect(upgrading).toMatchObject({ level: 1, targetLevel: 1, readyTick: -1 });
  });

  it("with only one fighter through, the building is disabled but keeps its level", () => {
    const w = world();
    const sam = building(w, "sam", 2, TARGET, 3); // three interceptors at the target itself
    const events = strikeAndWait(w);
    expect(events.filter((e) => e.type === "flightIntercepted")).toHaveLength(3);
    expect(struck(events)).toMatchObject([{ levelBefore: 3, level: 3 }]);
    expect(sam.level).toBe(3);
    expect(sam.disabledUntil).toBeGreaterThan(w.tick);
  });

  it("a struck SAM doesn't fire, and a struck Airport flies nothing, until it works again", () => {
    const w = world();
    const sam = building(w, "sam", 2, at(25, 4), 2);
    strikeAndWait(w, sam.tile);
    expect(sam.level).toBe(1);
    expect(sam.disabledUntil).toBeGreaterThan(w.tick);
    // An assault right over it now: no shot.
    step(w, [
      {
        playerId: 1,
        command: { type: "assault", buildingId: 1, tile: TARGET, percentBp: 10_000 },
      },
    ]);
    const events = run(w, 30);
    expect(events.some((e) => e.type === "flightIntercepted")).toBe(false);

    // Enemy 2's Air Base strikes player 1's Airport (a fresh game: the assault is spreading).
    const w2 = world();
    const enemyBase = building(w2, "airport", 2, at(50, 4), 3);
    const back = step(w2, [
      { playerId: 2, command: { type: "airStrike", buildingId: enemyBase.id, tile: AIRPORT_TILE } },
    ]);
    expect(rejection(back)).toBeNull();
    run(w2, flightTicks(w2.rules, w2.map, at(50, 4), AIRPORT_TILE, "fighter"));
    const airport = w2.buildings[0]!;
    expect(airport.level).toBe(2);
    expect(rejection(step(w2, [strike()]))).toBe("an air strike needs an Air Base (level III)");
    const lift = step(w2, [
      {
        playerId: 1,
        command: { type: "airlift", buildingId: 1, tile: at(58, 8), percentBp: 10_000 },
      },
    ]);
    expect(rejection(lift)).toBe("the Airport was hit by an air strike");
  });

  it("spares a building that became a friend's or the striker's own meanwhile", () => {
    const w = world();
    const factory = building(w, "factory", 3, at(58, 8), 2);
    // Teammate's land: refused at launch.
    expect(rejection(step(w, [strike(at(58, 8))]))).not.toBeNull();
    expect(factory.level).toBe(2);
  });
});

describe("air strike on a point: suppression", () => {
  /** Player 2's Stone Wall down column 30. */
  function wall(w: World): void {
    w.players[1]!.gold = 100_000_000;
    step(w, [{ playerId: 2, command: { type: "buildWall", points: [at(30, 0), at(30, 8)] } }]);
    const built = w.walls.at(-1)!;
    run(w, wallBuildTicks(w.rules, 1, 9));
    step(w, [{ playerId: 2, command: { type: "upgradeWall", wallId: built.id } }]);
    run(w, wallBuildTicks(w.rules, 2, built.intact));
    expect(built.level).toBe(2);
  }

  it("turns the walls off and makes the land cheaper in 10 km for 30 s", () => {
    const w = world();
    wall(w);
    const wallTile = at(30, 4);
    expect(wallLossFactor(w, wallTile)).toBe(5);
    const fakeAttack = { attacker: 1, target: 2, troops: 10_000, lossFactor: 1 } as Attack;
    const before = tileCost(w, fakeAttack, at(32, 4));
    const events = strikeAndWait(w, at(31, 4));
    const zone = events.find((e) => e.type === "suppressed");
    expect(zone).toMatchObject({ by: 1, victim: 2, tile: at(31, 4), radius: 10 });
    expect(w.suppressions).toHaveLength(1);
    expect(isSuppressed(w, wallTile)).toBe(true);
    expect(wallLossFactor(w, wallTile)).toBe(1);
    expect(wallHoldTicks(w, wallTile, 1)).toBe(0);
    expect(tileCost(w, fakeAttack, at(32, 4))).toBeCloseTo(before * 0.8, 6);
    // Only the victim's land, only within the radius.
    expect(isSuppressed(w, at(5, 4))).toBe(false);
    expect(isSuppressed(w, at(45, 4))).toBe(false);
    // It runs out.
    const until = zone?.type === "suppressed" ? zone.untilTick : 0;
    run(w, until - w.tick);
    expect(w.suppressions).toHaveLength(0);
    expect(wallLossFactor(w, wallTile)).toBe(5);
  });

  it("silences Fortress Wall flak", () => {
    const w = world();
    wall(w);
    const built = w.walls.at(-1)!;
    step(w, [{ playerId: 2, command: { type: "upgradeWall", wallId: built.id } }]);
    run(w, wallBuildTicks(w.rules, 3, built.intact));
    expect(built.level).toBe(3);
    // The strike crosses the wall itself: one fighter lost to flak, the rest suppress it.
    const events = strikeAndWait(w, at(31, 4));
    expect(events.filter((e) => e.type === "flightIntercepted")).toHaveLength(1);
    w.buildings[0]!.cooldowns = [];
    step(w, [
      {
        playerId: 1,
        command: { type: "assault", buildingId: 1, tile: TARGET, percentBp: 10_000 },
      },
    ]);
    expect(run(w, 30).some((e) => e.type === "flightIntercepted")).toBe(false);
  });

  it("is refused on your own, a teammate's or neutral land and out of range", () => {
    const w = world();
    expect(rejection(step(w, [strike(at(5, 4))]))).not.toBeNull();
    expect(rejection(step(w, [strike(at(58, 8))]))).not.toBeNull();
    expect(w.flights).toHaveLength(0);
  });

  it("same commands ⇒ same hash; zones, escorts and disabled buildings are state", () => {
    const play = () => {
      const w = world();
      building(w, "factory", 2, TARGET, 2);
      strikeAndWait(w);
      step(w, [
        {
          playerId: 1,
          command: { type: "assault", buildingId: 1, tile: at(45, 4), percentBp: 5_000 },
        },
      ]);
      return w;
    };
    const a = play();
    const b = play();
    expect(hashWorld(a)).toBe(hashWorld(b));
    b.buildings[1]!.disabledUntil++;
    expect(hashWorld(a)).not.toBe(hashWorld(b));
    b.buildings[1]!.disabledUntil--;
    b.flights[0]!.escorts--;
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});

describe("nations and air strikes", () => {
  const decide = (w: World, actions: Command[] = []) => decideStrike(w, w.players[0]!, actions);

  it("strike an enemy SAM in reach even before a war — SAMs first", () => {
    const w = world();
    building(w, "housing", 2, at(30, 2), 3);
    const sam = building(w, "sam", 2, at(40, 6), 1);
    expect(decide(w)).toEqual({ type: "airStrike", buildingId: 1, tile: sam.tile });
  });

  it("at war, the building worth the most gold — but not a teammate's, and not on cooldown", () => {
    const w = world();
    const metropolis = building(w, "housing", 2, at(30, 2), 3);
    building(w, "factory", 2, at(40, 6), 1);
    building(w, "factory", 3, at(58, 8), 3); // teammate
    const war: Command = { type: "attack", target: 2, focusTile: at(12, 4), percentBp: 5_000 };
    expect(decide(w)).toBeNull(); // not at war: economy buildings are left alone
    expect(decide(w, [war])).toEqual({ type: "airStrike", buildingId: 1, tile: metropolis.tile });
    w.buildings[0]!.cooldowns = [-1, w.tick + 10];
    expect(decide(w, [war])).toBeNull();
  });

  it("not where the SAMs would shoot down every fighter", () => {
    const w = world();
    // Two SAM IIIs over the target: six interceptors for four fighters.
    building(w, "sam", 2, at(38, 4), 3);
    building(w, "sam", 2, at(42, 4), 3);
    const factory = building(w, "factory", 2, at(40, 5), 3);
    const war: Command = { type: "attack", target: 2, focusTile: at(12, 4), percentBp: 5_000 };
    expect(decide(w, [war])).toBeNull();
    // With one SAM gone, one fighter would reach the factory (disabled only): it takes on the
    // SAM instead, which opens the sky.
    w.buildings = w.buildings.filter((b) => b.tile !== at(42, 4));
    expect(decide(w, [war])).toMatchObject({ tile: at(38, 4) });
    expect(factory.level).toBe(3);
  });

  it("suppress the walls in front of its army", () => {
    const w = world();
    w.players[1]!.gold = 100_000_000;
    step(w, [{ playerId: 2, command: { type: "buildWall", points: [at(16, 0), at(16, 8)] } }]);
    const built = w.walls.at(-1)!;
    run(w, wallBuildTicks(w.rules, 1, 9));
    for (const level of [2, 3]) {
      step(w, [{ playerId: 2, command: { type: "upgradeWall", wallId: built.id } }]);
      run(w, wallBuildTicks(w.rules, level, built.intact));
    }
    expect(decide(w)).toBeNull(); // no army there yet
    step(w, [
      {
        playerId: 1,
        command: { type: "attack", target: 2, focusTile: at(14, 4), percentBp: 2_000 },
      },
    ]);
    const choice = decide(w);
    expect(choice?.type).toBe("airStrike");
    const tile = choice?.type === "airStrike" ? choice.tile : -1;
    expect(tile % WIDTH).toBe(16);
  });
});

describe("combined arms", () => {
  it("strike the SAM, suppress the Fortress Wall, then the assault lands whole and takes land", () => {
    const w = world();
    const sam = building(w, "sam", 2, at(30, 4), 1);
    // Player 2's Fortress Wall down column 35.
    w.players[1]!.gold = 100_000_000;
    step(w, [{ playerId: 2, command: { type: "buildWall", points: [at(35, 0), at(35, 8)] } }]);
    const wall = w.walls.at(-1)!;
    run(w, wallBuildTicks(w.rules, 1, 9));
    for (const level of [2, 3]) {
      step(w, [{ playerId: 2, command: { type: "upgradeWall", wallId: wall.id } }]);
      run(w, wallBuildTicks(w.rules, level, wall.intact));
    }

    // 1. The SAM: three of four fighters get through, and a SAM I has no level to spare.
    const first = strikeAndWait(w, sam.tile);
    expect(first.find((e) => e.type === "buildingDestroyed")).toMatchObject({ reason: "struck" });
    // 2. The wall, once the fighters are back: flak takes one, the rest suppress it.
    run(w, 300);
    const second = strikeAndWait(w, at(36, 4));
    expect(second.some((e) => e.type === "suppressed")).toBe(true);
    // 3. The assault: no SAM, no flak — every plane and every troop lands.
    const launch = step(w, [
      {
        playerId: 1,
        command: { type: "assault", buildingId: 1, tile: TARGET, percentBp: 10_000 },
      },
    ]);
    const troops = w.flights.find((f) => f.kind === "assault")!.troops;
    const events = [...launch, ...run(w, 60)];
    expect(events.some((e) => e.type === "flightIntercepted")).toBe(false);
    expect(events.find((e) => e.type === "assaultLanded")).toMatchObject({ troops });
    const army = events.find((e) => e.type === "attackStarted");
    expect(army).toMatchObject({ attacker: 1, target: 2, airborne: true });
    expect(w.owner[TARGET]).toBe(1);
  });
});

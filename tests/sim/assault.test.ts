/** Airport II airborne assaults and Fortress Wall flak (GAME_DESIGN.md §3.17.7, milestone 2B.3). */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { makeRules, type GameRules } from "../../src/sim/rules.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import { airliftCapacity, flightTicks } from "../../src/sim/systems/flights.ts";
import { wallBuildTicks } from "../../src/sim/systems/walls.ts";
import { runTick } from "../../src/sim/tick.ts";
import { setOwner, type Building, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  economy: { incomeBase: 0, incomePerSqrtTile: 0 },
});

// 60 × 9: player 1 (Military Airport) on the left, enemy 2 on the right, 1's teammate 3 in
// the bottom-right corner.
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
function world(level = 2, rules: GameRules = RULES, enemyTroops = 1_000): World {
  const w = worldFromAscii(MAP, {
    rules,
    homeTroops: [50_000, enemyTroops, 1_000],
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

const assault = (tile = TARGET, percentBp = 10_000): Command => ({
  type: "assault",
  buildingId: 1,
  tile,
  percentBp,
});

function rejection(events: SimEvent[]): string | null {
  const rejected = events.find((e) => e.type === "commandRejected");
  return rejected?.type === "commandRejected" ? rejected.reason : null;
}

const arrival = (w: World, tile = TARGET) =>
  flightTicks(w.rules, w.map, AIRPORT_TILE, tile, "transport");

describe("airborne assault (Airport II)", () => {
  it("flies 15% of capacity as four transports and lands as an airborne beachhead attack", () => {
    const w = world();
    const lift = airliftCapacity(w.rules, 2, w.players[0]!.capacity);
    expect(lift).toBe(Math.floor(w.players[0]!.capacity * 0.15));
    const launch = step(w, [{ playerId: 1, command: assault() }]);
    expect(rejection(launch)).toBeNull();
    expect(w.flights).toHaveLength(1);
    expect(w.flights[0]).toMatchObject({ kind: "assault", owner: 1, target: 2, planes: 4 });
    expect(w.flights[0]!.troops).toBe(lift);
    expect(w.players[0]!.homeTroops).toBe(50_000 - lift);
    // The lift cooldown (25 s at level II).
    expect(w.buildings[0]!.cooldowns[0]).toBe(w.tick + 250);

    const events = run(w, arrival(w) + 1);
    const landed = events.find((e) => e.type === "assaultLanded");
    expect(landed).toMatchObject({ owner: 1, target: 2, tile: TARGET, troops: lift });
    const attack = w.attacks.find((a) => a.attacker === 1)!;
    expect(attack).toMatchObject({
      target: 2,
      landingTile: TARGET,
      focusTile: TARGET,
      airborne: true,
      lossFactor: 1.25,
    });
    expect(landed?.type === "assaultLanded" && landed.attackId).toBe(attack.id);
    // It takes the landing tile and then spreads like any attack.
    run(w, 30);
    expect(w.owner[TARGET]).toBe(1);
    expect(attack.tilesTaken).toBeGreaterThan(3);
  });

  it("is refused by an Airport I, on your own, a teammate's or neutral land, out of range and on cooldown", () => {
    expect(rejection(step(world(1), [{ playerId: 1, command: assault() }]))).toMatch(
      /Military Airport/,
    );
    const w = world();
    expect(rejection(step(w, [{ playerId: 1, command: assault(at(8, 4)) }]))).toBe(
      "that's your own land",
    );
    expect(rejection(step(w, [{ playerId: 1, command: assault(at(58, 8)) }]))).toBe(
      "they're your teammate",
    );
    setOwner(w, at(30, 0), 0);
    expect(rejection(step(w, [{ playerId: 1, command: assault(at(30, 0)) }]))).toBe(
      "assaults land on an enemy's land",
    );
    const short = makeRules({
      ...RULES,
      buildings: {
        ...RULES.buildings,
        types: {
          ...RULES.buildings.types,
          airport: {
            ...RULES.buildings.types.airport,
            levels: [
              RULES.buildings.types.airport.levels[0]!,
              { ...RULES.buildings.types.airport.levels[1]!, range: 20 },
            ],
          },
        },
      },
    });
    expect(rejection(step(world(2, short), [{ playerId: 1, command: assault() }]))).toBe(
      "out of the Airport's range",
    );
    expect(rejection(step(w, [{ playerId: 1, command: assault() }]))).toBeNull();
    expect(rejection(step(w, [{ playerId: 1, command: assault() }]))).toBe(
      "the Airport is still on cooldown",
    );
  });

  it("an airlift from a Military Airport carries the bigger lift too", () => {
    const w = world();
    const lift = airliftCapacity(w.rules, 2, w.players[0]!.capacity);
    step(w, [
      {
        playerId: 1,
        command: { type: "airlift", buildingId: 1, tile: at(58, 8), percentBp: 10_000 },
      },
    ]);
    expect(w.flights[0]).toMatchObject({ kind: "airlift", troops: lift });
  });

  it("troops landing on land that became their own join the home troops", () => {
    // Next to player 1's land, so it isn't simply encircled back.
    const edge = at(12, 4);
    const w = world();
    step(w, [{ playerId: 1, command: assault(edge) }]);
    const troops = w.flights[0]!.troops;
    const home = w.players[0]!.homeTroops;
    setOwner(w, edge, 1);
    const events = run(w, arrival(w, edge) + 1);
    expect(events.find((e) => e.type === "assaultLanded")).toMatchObject({ attackId: -1 });
    expect(w.attacks.filter((a) => a.attacker === 1)).toHaveLength(0);
    expect(w.players[0]!.homeTroops).toBeCloseTo(home + troops);
  });

  it("troops landing on a friend's land fly back home", () => {
    const edge = at(55, 8); // next to teammate 3's corner
    const w = world();
    step(w, [{ playerId: 1, command: assault(edge) }]);
    const troops = w.flights[0]!.troops;
    setOwner(w, edge, 3);
    run(w, arrival(w, edge) + 1);
    expect(w.flights).toHaveLength(1);
    expect(w.flights[0]).toMatchObject({ kind: "return", troops });
  });

  it("the landing pocket holds while its attack advances, and can be encircled once it stops", () => {
    // A strong defender: the airdrop spends itself quickly.
    const w = world(2, RULES, 40_000);
    step(w, [{ playerId: 1, command: assault() }]);
    run(w, arrival(w) + 1);
    const attack = w.attacks.find((a) => a.attacker === 1)!;
    expect(w.owner[TARGET]).toBe(1);
    // While it advances the pocket stands.
    run(w, 2);
    if (w.attacks.includes(attack)) expect(w.owner[TARGET]).toBe(1);
    // Spent (or retreated): the enclosed pocket falls to the player around it.
    if (w.attacks.includes(attack)) {
      step(w, [{ playerId: 1, command: { type: "retreat", attackId: attack.id } }]);
    }
    run(w, 80);
    expect(w.owner[TARGET]).toBe(2);
  });

  it("a counter-attack doesn't cancel the landed army: it must take the pocket tile by tile", () => {
    const w = world(2, RULES, 30_000);
    step(w, [{ playerId: 1, command: assault() }]);
    run(w, arrival(w) + 1);
    const landed = w.attacks.find((a) => a.airborne)!;
    const troops = landed.troops;
    // Player 2 strikes back at player 1 with far more troops than landed.
    const events = step(w, [
      {
        playerId: 2,
        command: { type: "attack", target: 1, focusTile: TARGET, percentBp: 9_000 },
      },
    ]);
    expect(events.some((e) => e.type === "attackEnded" && e.attackId === landed.id)).toBe(false);
    expect(landed.ended).toBe(false);
    // Only its own fighting costs it troops, never a collision with the counter.
    expect(landed.troops).toBeGreaterThan(troops * 0.9);
    expect(events.some((e) => e.type === "encircled")).toBe(false);
  });

  it("is shot down by SAMs like any flight", () => {
    const w = world();
    building(w, "sam", 2, at(25, 4));
    const lift = airliftCapacity(w.rules, 2, w.players[0]!.capacity);
    const events = [...step(w, [{ playerId: 1, command: assault() }]), ...run(w, arrival(w) + 1)];
    const shot = events.find((e) => e.type === "flightIntercepted");
    expect(shot).toMatchObject({ owner: 1, by: 2, weapon: "sam", planesLeft: 3 });
    const landed = events.find((e) => e.type === "assaultLanded");
    expect(landed?.type === "assaultLanded" && landed.troops).toBeCloseTo(lift * 0.75, 6);
  });

  it("same commands ⇒ same hash; the airborne flag is part of the state", () => {
    const play = () => {
      const w = world();
      step(w, [{ playerId: 1, command: assault() }]);
      run(w, arrival(w) + 10);
      return w;
    };
    const a = play();
    const b = play();
    expect(hashWorld(a)).toBe(hashWorld(b));
    const attack = b.attacks.find((x) => x.airborne)!;
    (attack as { airborne: boolean }).airborne = false;
    expect(hashWorld(b)).not.toBe(hashWorld(a));
  });
});

describe("Fortress Wall flak", () => {
  /** Player 2's wall down column `x`, finished at `level`. */
  function wall(w: World, x: number, level: number): void {
    w.players[1]!.gold = 100_000_000;
    step(w, [{ playerId: 2, command: { type: "buildWall", points: [at(x, 0), at(x, 8)] } }]);
    const built = w.walls.at(-1)!;
    run(w, wallBuildTicks(w.rules, 1, 9));
    for (let l = 2; l <= level; l++) {
      step(w, [{ playerId: 2, command: { type: "upgradeWall", wallId: built.id } }]);
      run(w, wallBuildTicks(w.rules, l, built.intact));
    }
    expect(built.level).toBe(level);
  }

  const shots = (events: SimEvent[]) =>
    events.filter(
      (e): e is Extract<SimEvent, { type: "flightIntercepted" }> => e.type === "flightIntercepted",
    );

  it("a hostile flight crossing a Fortress Wall loses one plane, once", () => {
    const w = world();
    wall(w, 20, 3);
    const events = [...step(w, [{ playerId: 1, command: assault() }]), ...run(w, arrival(w) + 1)];
    const hits = shots(events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ owner: 1, by: 2, weapon: "flak", planes: 1, planesLeft: 3 });
    // From the wall tile nearest the plane, within 3 km of it.
    expect(hits[0]!.fromTile % WIDTH).toBe(20);
    expect(Math.abs((hits[0]!.tile % WIDTH) - 20)).toBeLessThanOrEqual(3);
    expect(events.find((e) => e.type === "assaultLanded")).toBeDefined();
  });

  it("Stone Walls have no flak, and a wall never shoots at its owner's friends", () => {
    const stone = world();
    wall(stone, 20, 2);
    expect(
      shots([...step(stone, [{ playerId: 1, command: assault() }]), ...run(stone, 30)]),
    ).toHaveLength(0);
    // Player 1's own Fortress Wall under its own flight: nothing.
    const own = world();
    own.players[0]!.gold = 100_000_000;
    step(own, [{ playerId: 1, command: { type: "buildWall", points: [at(9, 0), at(9, 8)] } }]);
    const built = own.walls.at(-1)!;
    run(own, wallBuildTicks(own.rules, 1, 9));
    for (let l = 2; l <= 3; l++) {
      step(own, [{ playerId: 1, command: { type: "upgradeWall", wallId: built.id } }]);
      run(own, wallBuildTicks(own.rules, l, built.intact));
    }
    expect(built.level).toBe(3);
    expect(
      shots([...step(own, [{ playerId: 1, command: assault() }]), ...run(own, 30)]),
    ).toHaveLength(0);
  });

  it("flak reaches airlifts over hostile walls too (airspace matters)", () => {
    const w = world();
    wall(w, 30, 3);
    const events = [
      ...step(w, [
        {
          playerId: 1,
          command: { type: "airlift", buildingId: 1, tile: at(58, 8), percentBp: 10_000 },
        },
      ]),
      ...run(w, 40),
    ];
    expect(shots(events)).toMatchObject([{ weapon: "flak", by: 2, planesLeft: 3 }]);
  });
});

// 50 × 7: nation 1 (Military Airport) and its enemy nation 2 on islands apart.
const ISLANDS = `
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  ~1111111~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~22222222~~
  ~1111111~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~22222222~~
  ~1111111~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~22222222~~
  ~1111111~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~22222222~~
  ~1111111~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~22222222~~
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;
const IW = 50;

function nations(enemyTroops: number): World {
  const w = worldFromAscii(ISLANDS, {
    rules: RULES,
    players: ["bot", "bot"],
    homeTroops: [30_000, enemyTroops],
  });
  w.nextBuildingId = 1;
  building(w, "airport", 1, 3 * IW + 4, 2);
  w.players[1]!.brain!.nextThinkTick = 1_000_000; // the enemy just sits there
  w.players[0]!.brain!.nextThinkTick = w.tick + 2;
  return w;
}

describe("nations and airborne assaults", () => {
  it("a nation with a ready Military Airport assaults a weak enemy across the sea at its heart", () => {
    const w = nations(200);
    const events = run(w, 5);
    const launch = events.find((e) => e.type === "flightLaunched");
    expect(launch).toMatchObject({ owner: 1, kind: "assault", target: 2 });
    expect(launch?.type === "flightLaunched" && launch.toTile).toBe(w.players[1]!.spawnTile);
  });

  it("not against an enemy far too strong for what one lift carries", () => {
    const w = nations(1_000_000);
    const events = run(w, 5);
    expect(events.some((e) => e.type === "flightLaunched")).toBe(false);
  });

  it("not when every route would lose every plane to SAMs", () => {
    const w = nations(200);
    // Four interceptors right over its Airport: every route loses all four planes.
    building(w, "sam", 2, 1 * IW + 12, 3);
    building(w, "sam", 2, 5 * IW + 12, 1);
    const events = run(w, 5);
    expect(events.some((e) => e.type === "flightLaunched")).toBe(false);
  });
});

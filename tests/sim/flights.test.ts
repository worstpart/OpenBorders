/** Flights (GAME_DESIGN.md §3.17.7, milestone 2B.0 — the flight foundation). */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { pointAlong, tileAlong } from "../../src/sim/geometry.ts";
import { generateContinent } from "../../src/sim/map/generate.ts";
import { makeRules, type GameRules } from "../../src/sim/rules.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import {
  cooldownLeft,
  readyCharges,
  spendCharge,
  startCooldown,
} from "../../src/sim/systems/buildings.ts";
import {
  flightPoint,
  flightProgress,
  flightTicks,
  flightTile,
  launchFlight,
  shootDown,
} from "../../src/sim/systems/flights.ts";
import { runTick } from "../../src/sim/tick.ts";
import { createWorld, setOwner, type Building, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  economy: { incomeBase: 0, incomePerSqrtTile: 0 },
  flights: { testFlights: true },
});

// 40 × 7: player 1 on the left, player 2 on the right, sea between.
const MAP = `
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  ~111111~~~~~~~~~~~~~~~~~~~~~~~~~~222222~
  ~111111~~~~~~~~~~~~~~~~~~~~~~~~~~222222~
  ~111111~~~~~~~~~~~~~~~~~~~~~~~~~~222222~
  ~111111~~~~~~~~~~~~~~~~~~~~~~~~~~222222~
  ~111111~~~~~~~~~~~~~~~~~~~~~~~~~~222222~
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;
const WIDTH = 40;
const at = (x: number, y: number) => y * WIDTH + x;

function world(rules: GameRules = RULES): World {
  return worldFromAscii(MAP, { rules, homeTroops: [20_000, 5_000] });
}

function step(w: World, commands: { playerId: number; command: Command }[] = []): SimEvent[] {
  return [...runTick(w, { tick: w.tick + 1, commands }).events];
}

function run(w: World, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) events.push(...step(w));
  return events;
}

const testFlight = (from: number, to: number): Command => ({ type: "testFlight", from, to });

function rejection(events: SimEvent[]): string | null {
  const rejected = events.find((e) => e.type === "commandRejected");
  return rejected?.type === "commandRejected" ? rejected.reason : null;
}

describe("flight positions are a pure function of the tick", () => {
  const map = world().map;
  const path = { fromTile: at(2, 1), toTile: at(34, 5), launchTick: 10, arriveTick: 26 };

  it("starts at the take-off tile and ends over the target", () => {
    expect(flightProgress(path, 10)).toBe(0);
    expect(flightProgress(path, 5)).toBe(0);
    expect(flightProgress(path, 26)).toBe(1);
    expect(flightProgress(path, 40)).toBe(1);
    expect(flightPoint(map, path, 10)).toEqual({ x: 2, y: 1 });
    expect(flightPoint(map, path, 26)).toEqual({ x: 34, y: 5 });
    expect(flightTile(map, path, 10)).toBe(at(2, 1));
    expect(flightTile(map, path, 26)).toBe(at(34, 5));
  });

  it("moves in a straight line at an even pace (fractional ticks for smooth drawing)", () => {
    expect(flightProgress(path, 18)).toBe(0.5);
    expect(flightPoint(map, path, 18)).toEqual({ x: 18, y: 3 });
    expect(flightPoint(map, path, 14)).toEqual({ x: 10, y: 2 });
    expect(flightPoint(map, path, 14.5).x).toBeCloseTo(11, 10);
    expect(pointAlong(map, at(0, 0), at(4, 2), 0.25)).toEqual({ x: 1, y: 0.5 });
    expect(tileAlong(map, at(0, 0), at(4, 2), 0.25)).toBe(at(1, 1)); // rounds half up
  });

  it("takes distance ÷ speed ticks, rounded up (transports 2 tiles/tick, fighters 3)", () => {
    // 32 across and 4 down: √1040 ≈ 32.2 tiles.
    expect(flightTicks(RULES, map, at(2, 1), at(34, 5), "transport")).toBe(17);
    expect(flightTicks(RULES, map, at(2, 1), at(34, 5), "fighter")).toBe(11);
    expect(flightTicks(RULES, map, at(2, 1), at(3, 1), "missile")).toBe(1);
  });
});

describe("test flights (debug, rules.flights.testFlights)", () => {
  it("launch, fly and arrive with events, then leave the air", () => {
    const w = world();
    const from = at(3, 3);
    const to = at(35, 3); // 32 tiles: 16 ticks
    const launched = step(w, [{ playerId: 1, command: testFlight(from, to) }]);
    expect(rejection(launched)).toBeNull();
    const event = launched.find((e) => e.type === "flightLaunched");
    expect(event).toMatchObject({
      type: "flightLaunched",
      owner: 1,
      kind: "test",
      target: 2,
      fromTile: from,
      toTile: to,
      planes: RULES.flights.testFlightPlanes,
      escorts: 0,
      troops: 0,
      arriveTick: w.tick + 16,
    });
    expect(w.flights).toHaveLength(1);
    const flight = w.flights[0]!;
    expect(flight.launchTick).toBe(w.tick);

    const before = run(w, 15);
    expect(before.some((e) => e.type === "flightArrived")).toBe(false);
    expect(flightTile(w.map, flight, w.tick)).toBe(at(33, 3));
    const arrival = step(w);
    expect(arrival.find((e) => e.type === "flightArrived")).toMatchObject({
      flightId: flight.id,
      owner: 1,
      kind: "test",
      tile: to,
      target: 2,
      planes: 4,
    });
    expect(w.flights).toHaveLength(0);
    // A test flight changes nothing on the ground.
    expect(w.owner[to]).toBe(2);
    expect(w.players[1]!.homeTroops).toBe(5_000);
  });

  it("appear in frames (made once per flight, shared between frames)", () => {
    const w = world();
    const first = runTick(w, {
      tick: 1,
      commands: [{ playerId: 1, command: testFlight(at(3, 3), at(35, 3)) }],
    });
    expect(first.flights).toHaveLength(1);
    expect(first.flights[0]).toMatchObject({ owner: 1, kind: "test", planes: 4 });
    const second = runTick(w, { tick: 2, commands: [] });
    expect(second.flights[0]).toBe(first.flights[0]);
  });

  it("are rejected unless the rule is on, the match runs and they leave from your land", () => {
    const off = world(makeRules({ ...RULES, flights: { testFlights: false } }));
    expect(rejection(step(off, [{ playerId: 1, command: testFlight(at(3, 3), at(35, 3)) }]))).toBe(
      "test flights are off in this game",
    );
    const w = world();
    expect(rejection(step(w, [{ playerId: 1, command: testFlight(at(35, 3), at(3, 3)) }]))).toBe(
      "a flight takes off from your own land",
    );
    expect(rejection(step(w, [{ playerId: 1, command: testFlight(at(3, 3), at(3, 3)) }]))).toBe(
      "the target is where the flight takes off",
    );
    expect(rejection(step(w, [{ playerId: 1, command: testFlight(at(3, 3), -5) }]))).toBe(
      "invalid tile",
    );
    expect(w.flights).toHaveLength(0);
    expect(w.nextFlightId).toBe(1);
  });

  it("fly over the sea and to neutral tiles too (target 0)", () => {
    const w = world();
    const events = step(w, [{ playerId: 1, command: testFlight(at(3, 3), at(20, 3)) }]);
    expect(events.find((e) => e.type === "flightLaunched")).toMatchObject({ target: 0 });
  });
});

describe("losing planes", () => {
  it("shootDown takes planes and their share of the troops; the last plane ends the flight", () => {
    const w = world();
    w.phase = "playing";
    const flight = launchFlight(w, {
      owner: 1,
      kind: "test",
      source: -1,
      fromTile: at(3, 3),
      toTile: at(35, 3),
      plane: "transport",
      planes: 4,
      escorts: 0,
      troops: 8_000,
    });
    w.players[0]!.homeTroops -= 8_000;
    expect(w.players[0]!.fieldTroops).toBe(8_000);
    w.events.length = 0;
    shootDown(w, flight, 1, 2);
    expect(flight.planes).toBe(3);
    expect(flight.troops).toBe(6_000);
    expect(w.players[0]!.fieldTroops).toBe(6_000);
    expect(w.events).toEqual([
      {
        type: "flightIntercepted",
        flightId: flight.id,
        owner: 1,
        by: 2,
        tile: at(3, 3),
        fromTile: -1,
        weapon: "sam",
        planes: 1,
        escorts: 0,
        planesLeft: 3,
        troopsLost: 2_000,
      },
    ]);
    shootDown(w, flight, 5, 2);
    expect(flight.planes).toBe(0);
    expect(w.flights).toHaveLength(0);
    expect(w.players[0]!.fieldTroops).toBe(0);
  });

  it("an eliminated owner's flights are lost; at game over troops in the air go home", () => {
    const w = world();
    step(w, [
      { playerId: 2, command: testFlight(at(35, 3), at(3, 3)) },
      { playerId: 1, command: testFlight(at(3, 3), at(35, 3)) },
    ]);
    expect(w.flights).toHaveLength(2);
    const mine = w.flights[1]!;
    mine.troops = 1_000; // as if it carried troops (airlifts, 2B.1)
    w.players[0]!.homeTroops -= 1_000;
    // Player 2 loses all their land: eliminated, their flight is lost; player 1 is the last
    // one standing, so the game ends and the troops in the air go home.
    for (let t = 0; t < w.owner.length; t++) if (w.owner[t] === 2) setOwner(w, t, 1);
    const events = step(w);
    expect(events.find((e) => e.type === "flightLost")).toMatchObject({ owner: 2 });
    expect(events.some((e) => e.type === "gameOver")).toBe(true);
    expect(w.flights).toHaveLength(0);
    expect(w.players[0]!.homeTroops).toBe(20_000);
    expect(w.players[0]!.fieldTroops).toBe(0);
  });
});

describe("building charges and cooldowns (Phase 2B bookkeeping)", () => {
  const building = (tile = 0): Building => ({
    id: 1,
    type: "housing",
    owner: 1,
    tile,
    level: 1,
    targetLevel: 1,
    startTick: -1,
    readyTick: -1,
    paid: 0,
    reloads: [],
    cooldowns: [],
    disabledUntil: -1,
  });

  it("charges reload one at a time", () => {
    const b = building();
    expect(readyCharges(b, 3, 100)).toBe(3);
    spendCharge(b, 100, 60);
    spendCharge(b, 100, 60);
    expect(b.reloads).toEqual([160, 220]);
    expect(readyCharges(b, 3, 100)).toBe(1);
    expect(readyCharges(b, 3, 160)).toBe(2);
    expect(readyCharges(b, 3, 220)).toBe(3);
    // Spent after the queue emptied: reloads from now.
    spendCharge(b, 300, 60);
    expect(b.reloads).toEqual([360]);
    // A building knocked down a level has fewer charges, never fewer than zero ready.
    spendCharge(b, 300, 60);
    expect(readyCharges(b, 1, 300)).toBe(0);
  });

  it("cooldowns per mission slot", () => {
    const b = building();
    expect(cooldownLeft(b, 1, 50)).toBe(0);
    startCooldown(b, 1, 50, 300);
    expect(b.cooldowns).toEqual([-1, 350]);
    expect(cooldownLeft(b, 0, 50)).toBe(0);
    expect(cooldownLeft(b, 1, 100)).toBe(250);
    expect(cooldownLeft(b, 1, 400)).toBe(0);
  });

  it("finished reloads are forgotten each tick, and charges count in the state hash", () => {
    const w = world();
    const b = building(at(3, 3));
    w.buildings.push(b);
    w.buildingAt[b.tile] = b.id;
    w.nextBuildingId = 2;
    const plain = hashWorld(w);
    spendCharge(b, w.tick, 3);
    expect(hashWorld(w)).not.toBe(plain);
    run(w, 3);
    expect(b.reloads).toEqual([]);
  });
});

describe("determinism", () => {
  const map = generateContinent({ seed: 9, width: 200, height: 140 });
  const rules = makeRules({ flights: { testFlights: true } });

  function game(): World {
    return createWorld({
      seed: 77,
      map,
      rules,
      players: Array.from({ length: 6 }, (_, k) => ({
        name: `Bot ${k + 1}`,
        kind: "bot" as const,
      })),
    });
  }

  /** Every 25 ticks of play, each living player flies a test flight to the next one's spawn. */
  function play(w: World, ticks: number): number[] {
    const hashes: number[] = [];
    for (let k = 0; k < ticks; k++) {
      const commands: { playerId: number; command: Command }[] = [];
      if (w.phase === "playing" && w.tick % 25 === 0) {
        for (const p of w.players) {
          const next = w.players[p.id % w.players.length]!;
          if (p.alive && p.spawnTile >= 0 && next.spawnTile >= 0) {
            commands.push({ playerId: p.id, command: testFlight(p.spawnTile, next.spawnTile) });
          }
        }
      }
      hashes.push(runTick(w, { tick: w.tick + 1, commands }).hash);
    }
    return hashes;
  }

  it("the same seed and the same flights give the same hash, tick after tick", () => {
    const a = game();
    const b = game();
    const hashesA = play(a, 400);
    expect(play(b, 400)).toEqual(hashesA);
    expect(a.nextFlightId).toBeGreaterThan(10);
  });

  it("flights are part of the state: a game with one hashes differently from one without", () => {
    const a = game();
    const b = game();
    play(a, 100);
    for (let k = 0; k < 100; k++) runTick(b, { tick: b.tick + 1, commands: [] });
    expect(a.tick).toBe(b.tick);
    expect(hashWorld(a)).not.toBe(hashWorld(b));
  });
});

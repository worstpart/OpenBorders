/** Airport I and the airlift (GAME_DESIGN.md §3.17.7, milestone 2B.1). */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { createMap, Terrain } from "../../src/sim/map/gameMap.ts";
import { makeRules, type GameRules } from "../../src/sim/rules.ts";
import { placementProblem } from "../../src/sim/systems/buildings.ts";
import { airliftCapacity, airliftSite } from "../../src/sim/systems/flights.ts";
import { runTick } from "../../src/sim/tick.ts";
import { type Building, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  economy: { incomeBase: 0, incomePerSqrtTile: 0 },
});

// 40 × 7: player 1 alone on the left; players 2 and 3 share the right-hand island.
const MAP = `
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  ~111111~~~~~~~~~~~~~~~~~~~~~~~2222333~~~
  ~111111~~~~~~~~~~~~~~~~~~~~~~~2222333~~~
  ~111111~~~~~~~~~~~~~~~~~~~~~~~2222333~~~
  ~111111~~~~~~~~~~~~~~~~~~~~~~~2222333~~~
  ~111111~~~~~~~~~~~~~~~~~~~~~~~2222333~~~
  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;
const WIDTH = 40;
const at = (x: number, y: number) => y * WIDTH + x;
const AIRPORT_TILE = at(3, 3);
const FRIEND_TILE = at(31, 3);
const ENEMY_TILE = at(35, 3);

/** Players 1 and 2 are teammates; 3 is on the other team. Player 1 owns a working Airport. */
function world(rules: GameRules = RULES, homeTroops = [20_000, 1_000, 5_000]): World {
  const w = worldFromAscii(MAP, { rules, homeTroops, teams: [1, 1, 2] });
  const airport: Building = {
    id: 1,
    type: "airport",
    owner: 1,
    tile: AIRPORT_TILE,
    level: 1,
    targetLevel: 1,
    startTick: -1,
    readyTick: -1,
    paid: 0,
    reloads: [],
    cooldowns: [],
  };
  w.buildings.push(airport);
  w.buildingAt[AIRPORT_TILE] = 1;
  w.nextBuildingId = 2;
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

const airlift = (tile: number, percentBp = 10_000, buildingId = 1): Command => ({
  type: "airlift",
  buildingId,
  tile,
  percentBp,
});

function rejection(events: SimEvent[]): string | null {
  const rejected = events.find((e) => e.type === "commandRejected");
  return rejected?.type === "commandRejected" ? rejected.reason : null;
}

describe("airlift", () => {
  it("flies troops to a teammate across the sea: they join the friend's home troops", () => {
    const w = world();
    const [me, friend] = [w.players[0]!, w.players[1]!];
    const lift = airliftCapacity(w.rules, 1, me.capacity);
    expect(lift).toBe(Math.floor(me.capacity * 0.1));
    const launched = step(w, [{ playerId: 1, command: airlift(FRIEND_TILE) }]);
    expect(rejection(launched)).toBeNull();
    expect(me.homeTroops).toBe(20_000 - lift); // capped at 10% of capacity
    expect(w.flights).toHaveLength(1);
    expect(w.flights[0]).toMatchObject({ kind: "airlift", target: 2, troops: lift, planes: 4 });
    // Troops in the air are field troops (they don't grow back at home meanwhile).
    expect(me.fieldTroops).toBe(lift);
    const events = run(w, 30);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "airliftDelivered",
        from: 1,
        to: 2,
        troops: lift,
        returning: 0,
      }),
    );
    expect(friend.homeTroops).toBe(1_000 + lift);
    expect(w.flights).toHaveLength(0);
    expect(me.fieldTroops).toBe(0);
  });

  it("sends what doesn't fit under the friend's capacity back home", () => {
    const w = world();
    const [me, friend] = [w.players[0]!, w.players[1]!];
    friend.homeTroops = friend.capacity - 50;
    const lift = airliftCapacity(w.rules, 1, me.capacity);
    step(w, [{ playerId: 1, command: airlift(FRIEND_TILE) }]);
    const events = run(w, 20);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "airliftDelivered", troops: 50, returning: lift - 50 }),
    );
    expect(friend.homeTroops).toBe(friend.capacity);
    expect(w.flights).toHaveLength(1);
    expect(w.flights[0]).toMatchObject({ kind: "return", toTile: AIRPORT_TILE, troops: lift - 50 });
    run(w, 20);
    expect(w.flights).toHaveLength(0);
    expect(me.homeTroops).toBe(20_000 - 50);
  });

  it("only goes to friends, in range, once per cooldown", () => {
    const w = world();
    expect(rejection(step(w, [{ playerId: 1, command: airlift(ENEMY_TILE) }]))).toBe(
      "airlifts go to an ally's or teammate's land",
    );
    expect(rejection(step(w, [{ playerId: 1, command: airlift(at(10, 3)) }]))).toBe(
      "airlifts go to an ally's or teammate's land", // the sea
    );
    expect(rejection(step(w, [{ playerId: 2, command: airlift(FRIEND_TILE) }]))).toBe(
      "not your Airport",
    );
    expect(rejection(step(w, [{ playerId: 1, command: airlift(FRIEND_TILE) }]))).toBeNull();
    expect(rejection(step(w, [{ playerId: 1, command: airlift(FRIEND_TILE) }]))).toBe(
      "the Airport is still on cooldown",
    );
    run(w, w.rules.buildings.types.airport.levels[0]!.missionCooldownTicks!);
    expect(rejection(step(w, [{ playerId: 1, command: airlift(FRIEND_TILE, 100) }]))).toBeNull();

    const near = makeRules({
      ...RULES,
      buildings: {
        ...RULES.buildings,
        types: {
          ...RULES.buildings.types,
          airport: {
            ...RULES.buildings.types.airport,
            levels: [{ ...RULES.buildings.types.airport.levels[0]!, range: 10 }],
          },
        },
      },
    });
    expect(rejection(step(world(near), [{ playerId: 1, command: airlift(FRIEND_TILE) }]))).toBe(
      "out of the Airport's range",
    );
    const off = makeRules({ ...RULES, flights: { ...RULES.flights, enabled: false } });
    expect(rejection(step(world(off), [{ playerId: 1, command: airlift(FRIEND_TILE) }]))).toBe(
      "there are no flights in this game",
    );
  });

  it("flies everything back when the friend is gone before it lands", () => {
    const w = world();
    const me = w.players[0]!;
    const lift = airliftCapacity(w.rules, 1, me.capacity);
    step(w, [{ playerId: 1, command: airlift(FRIEND_TILE) }]);
    w.players[1]!.alive = false; // eliminated meanwhile
    const events = run(w, 20);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "airliftDelivered", troops: 0, returning: lift }),
    );
    run(w, 20);
    expect(me.homeTroops).toBe(20_000);
  });

  it("needs plains for its runway", () => {
    const w = world();
    const terrain = new Uint8Array(w.map.terrain);
    terrain[at(2, 2)] = Terrain.Highland;
    const map = createMap(w.map.width, w.map.height, terrain);
    const problem = (tile: number) =>
      placementProblem(w.rules, map, w.owner, [], 1, tile, "airport");
    expect(problem(at(2, 2))).toBe("notPlains");
    expect(problem(at(5, 5))).toBeNull();
    expect(placementProblem(w.rules, map, w.owner, [], 1, at(2, 2), "housing")).toBeNull();
  });

  it("lands a nation's airlift on the friend's tile nearest the Airport", () => {
    const w = world();
    expect(airliftSite(w, w.buildings[0]!, w.players[1]!)).toBe(at(30, 3));
  });
});

describe("nations and Airports", () => {
  it("a nation airlifts troops to a teammate losing a war it can't reach by land", () => {
    const w = worldFromAscii(MAP, {
      rules: RULES,
      players: ["bot", "bot", "bot"],
      homeTroops: [15_000, 8_000, 15_000], // capacities here are ~16K
      teams: [1, 1, 2],
    });
    w.buildings.push({
      id: 1,
      type: "airport",
      owner: 1,
      tile: AIRPORT_TILE,
      level: 1,
      targetLevel: 1,
      startTick: -1,
      readyTick: -1,
      paid: 0,
      reloads: [],
      cooldowns: [],
    });
    w.buildingAt[AIRPORT_TILE] = 1;
    w.nextBuildingId = 2;
    // Player 3 throws its army at player 2; player 1 thinks a few ticks later.
    w.players[0]!.brain!.nextThinkTick = w.tick + 3;
    step(w, [
      {
        playerId: 3,
        command: { type: "attack", target: 2, percentBp: 9_000, focusTile: FRIEND_TILE },
      },
    ]);
    const events = run(w, 10);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "flightLaunched", owner: 1, kind: "airlift", target: 2 }),
    );
  });
});

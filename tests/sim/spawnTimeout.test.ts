/** Online spawn timer (3.4): one absent player can't hold the match up; solo games still wait. */
import { describe, expect, it } from "vitest";
import { isLand } from "../../src/sim/map/gameMap.ts";
import { generateMap } from "../../src/sim/map/generate.ts";
import { makeRules, type GameRules } from "../../src/sim/rules.ts";
import { runTick } from "../../src/sim/tick.ts";
import { createWorld, type World } from "../../src/sim/world.ts";
import { ONLINE_RULES } from "../../src/shared/protocol.ts";

const MAP = generateMap({ seed: 4, width: 240, height: 160, style: "continent" });

function game(rules: GameRules): World {
  return createWorld({
    seed: 3,
    map: MAP,
    rules,
    players: [
      { name: "Picks and confirms", kind: "human" },
      { name: "Picks, never confirms", kind: "human" },
      { name: "Never picks", kind: "human" },
      { name: "Nation", kind: "bot" },
    ],
  });
}

function land(world: World, from: number): number {
  for (let t = from; t < world.owner.length; t++) {
    if (isLand(world.map, t) && world.owner[t] === 0) return t;
  }
  throw new Error("no land");
}

function play(world: World, ticks: number): void {
  for (let k = 0; k < ticks; k++) {
    const tick = world.tick + 1;
    const commands =
      tick === 2
        ? [
            { playerId: 1, command: { type: "spawn" as const, tile: land(world, 8_000) } },
            { playerId: 2, command: { type: "spawn" as const, tile: land(world, 20_000) } },
          ]
        : tick === 3
          ? [{ playerId: 1, command: { type: "confirmSpawn" as const } }]
          : [];
    runTick(world, { tick, commands });
  }
}

describe("the online spawn timer", () => {
  it("starts the match at the timeout: picked spots kept, a random one for whoever never picked", () => {
    const world = game(makeRules({ spawn: { timeoutTicks: 40 } }));
    play(world, 39);
    expect(world.phase).toBe("spawn");
    const picked = world.players[1]!.spawnTile;
    play(world, 1);
    expect(world.phase).toBe("playing");
    expect(world.playStartTick).toBe(40);
    expect(world.players[1]!.spawnTile).toBe(picked); // kept where they clicked
    expect(world.players[2]!.spawnTile).toBeGreaterThanOrEqual(0); // placed for them
    expect(world.players[2]!.tiles).toBeGreaterThan(0);
    expect(world.players.every((p) => p.kind !== "human" || p.ready)).toBe(true);
  });

  it("solo games (no timeout) still wait for every human", () => {
    const world = game(makeRules({}));
    play(world, 2_000);
    expect(world.phase).toBe("spawn");
  });

  it("online games use a 60 s spawn phase", () => {
    expect(ONLINE_RULES.spawn.timeoutTicks).toBe(600);
  });
});

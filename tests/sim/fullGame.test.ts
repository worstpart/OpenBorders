/**
 * Milestone 1.4 "done when": a full solo game is reachable end-to-end — spawn, expand,
 * fight, end — through the same commands the browser sends. A simple scripted player
 * plays the human against real bots, so either side may win; the game must finish.
 */
import { describe, expect, it } from "vitest";
import type { StampedCommand } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import { isLand } from "../../src/sim/map/gameMap.ts";
import { generateContinent } from "../../src/sim/map/generate.ts";
import { runTick } from "../../src/sim/tick.ts";
import { createWorld, type Player, type PlayerId, type World } from "../../src/sim/world.ts";

/** A tile of `target` (0 = neutral land) next to the player's border, or -1. */
function frontTile(world: World, me: Player, target: PlayerId): number {
  const { width } = world.map;
  for (const tile of me.border) {
    const x = tile % width;
    const around = [
      tile >= width ? tile - width : -1,
      tile + width < world.owner.length ? tile + width : -1,
      x > 0 ? tile - 1 : -1,
      x < width - 1 ? tile + 1 : -1,
    ];
    for (const n of around) {
      if (n >= 0 && world.owner[n] === target && isLand(world.map, n)) return n;
    }
  }
  return -1;
}

/** Greedy script: expand while there is neutral land, then attack the weakest neighbour it can beat. */
function scriptedHuman(world: World): StampedCommand[] {
  const me = world.players[0]!;
  if (world.phase === "spawn") {
    if (me.spawnTile < 0) {
      const tile = world.owner.findIndex((o, t) => o === 0 && isLand(world.map, t) && t % 7 === 3);
      return [{ playerId: 1, command: { type: "spawn", tile } }];
    }
    return me.ready ? [] : [{ playerId: 1, command: { type: "confirmSpawn" } }];
  }
  if (world.phase !== "playing" || !me.alive || world.tick % 10 !== 0) return [];
  if (world.attacks.some((a) => a.attacker === 1)) return [];

  const neutral = frontTile(world, me, 0);
  if (neutral >= 0) {
    return [
      { playerId: 1, command: { type: "attack", target: 0, focusTile: neutral, percentBp: 6_000 } },
    ];
  }
  const targets = world.players
    .filter((p) => p.alive && p.id !== 1 && frontTile(world, me, p.id) >= 0)
    .sort((a, b) => a.homeTroops - b.homeTroops || a.id - b.id);
  const weakest = targets[0];
  if (!weakest || me.homeTroops < 1.3 * weakest.homeTroops) return [];
  const focusTile = frontTile(world, me, weakest.id);
  return [
    { playerId: 1, command: { type: "attack", target: weakest.id, focusTile, percentBp: 10_000 } },
  ];
}

describe("a full solo game", () => {
  it("goes from spawn to a finished game through commands alone", () => {
    const world = createWorld({
      seed: 11,
      map: generateContinent({ seed: 4, width: 160, height: 100 }),
      players: [
        { name: "You", kind: "human" },
        { name: "Bot A", kind: "bot" },
        { name: "Bot B", kind: "bot" },
        { name: "Bot C", kind: "bot" },
      ],
    });
    const events: SimEvent[] = [];
    while (world.phase !== "ended" && world.tick < 30_000) {
      const frame = runTick(world, { tick: world.tick + 1, commands: scriptedHuman(world) });
      events.push(...frame.events);
    }

    expect(world.phase).toBe("ended");
    expect(world.winner).not.toBeNull();
    const winner = world.players[world.winner! - 1]!;
    expect(winner.alive).toBe(true);
    expect(events.find((e) => e.type === "gameOver")).toMatchObject({ winner: winner.id });
    // The scripted human's commands are always valid when they're sent.
    expect(events.filter((e) => e.type === "commandRejected" && e.playerId === 1)).toEqual([]);
  });
});

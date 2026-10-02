/**
 * Milestone 1.1 "done when": the same seed and the same commands produce the same state
 * hash, tick after tick. This is the foundation for multiplayer, replays and reproducible
 * bugs (D-004).
 */
import { describe, expect, it } from "vitest";
import type { StampedCommand } from "../../src/sim/commands.ts";
import { isLand, tileAt, type GameMap } from "../../src/sim/map/gameMap.ts";
import { generateContinent } from "../../src/sim/map/generate.ts";
import { Rng } from "../../src/sim/math/rng.ts";
import { computeOwnerHash, hashWorld } from "../../src/sim/stateHash.ts";
import { runTick } from "../../src/sim/tick.ts";
import { createWorld, setOwner, touchesOtherOwner, type World } from "../../src/sim/world.ts";

const map = generateContinent({ seed: 5, width: 300, height: 200 });

function newGame(seed: number, gameMap: GameMap = map): World {
  return createWorld({
    seed,
    map: gameMap,
    players: [
      { name: "You", kind: "human" },
      ...Array.from({ length: 7 }, (_, k) => ({ name: `Bot ${k + 1}`, kind: "bot" as const })),
    ],
  });
}

/** First neutral land tile scanning outward along the middle row (a "human click"). */
function humanClick(world: World): number {
  const y = Math.floor(world.map.height / 2);
  for (let x = Math.floor(world.map.width / 2); x < world.map.width; x++) {
    const tile = tileAt(world.map, x, y);
    if (isLand(world.map, tile) && world.owner[tile] === 0) return tile;
  }
  throw new Error("no free land on the middle row");
}

/** A neutral land tile `offset` tiles after `from` in reading order (scanning further if needed). */
function neutralLandAfter(world: World, from: number, offset: number): number {
  for (let tile = from + offset; tile < world.owner.length; tile++) {
    if (isLand(world.map, tile) && world.owner[tile] === 0) return tile;
  }
  throw new Error("no neutral land found");
}

/**
 * The human's script: pick a spot at tick 3, confirm at tick 5, then expand every 40
 * ticks toward a neutral tile, alternating directions.
 */
function scriptedCommands(world: World, tick: number): StampedCommand[] {
  if (tick === 3) return [{ playerId: 1, command: { type: "spawn", tile: humanClick(world) } }];
  if (tick === 5) return [{ playerId: 1, command: { type: "confirmSpawn" } }];
  if (tick >= 20 && tick % 40 === 20) {
    const spawn = world.players[0]!.spawnTile;
    const offset = (tick / 20) % 2 === 1 ? 40 : -40 * world.map.width;
    const focusTile = neutralLandAfter(world, Math.max(0, spawn + offset), 0);
    return [{ playerId: 1, command: { type: "attack", target: 0, focusTile, percentBp: 6_000 } }];
  }
  return [];
}

function playScripted(seed: number, ticks: number): { hashes: number[]; world: World } {
  const world = newGame(seed);
  const hashes: number[] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    hashes.push(runTick(world, { tick, commands: scriptedCommands(world, tick) }).hash);
  }
  return { hashes, world };
}

describe("determinism", () => {
  it("same seed + same commands ⇒ the same hash every tick", () => {
    const first = playScripted(42, 300);
    const second = playScripted(42, 300);
    expect(second.hashes).toEqual(first.hashes);
    expect(new Set(first.hashes).size).toBeGreaterThan(290); // the state really does change
    expect(first.world.players[0]!.tiles).toBeGreaterThan(300); // expansion really ran
  });

  it("border sets always match ownership", () => {
    const { world } = playScripted(42, 300);
    expect(world.players[0]!.tiles).toBeGreaterThan(300);
    for (const player of world.players) {
      const expected: number[] = [];
      for (let tile = 0; tile < world.owner.length; tile++) {
        if (world.owner[tile] === player.id && touchesOtherOwner(world, tile, player.id)) {
          expected.push(tile);
        }
      }
      expect([...player.border].sort((a, b) => a - b)).toEqual(expected);
    }
  });

  it("a different seed ⇒ a different game", () => {
    expect(playScripted(43, 10).hashes.at(-1)).not.toBe(playScripted(42, 10).hashes.at(-1));
  });

  it("the incremental ownership hash always equals a full recomputation", () => {
    const world = newGame(1);
    runTick(world, { tick: 1, commands: [] });
    expect(world.ownerHash).toBe(computeOwnerHash(world.owner));

    const rng = new Rng(9);
    for (let k = 0; k < 5000; k++) {
      setOwner(world, rng.nextInt(world.owner.length), rng.nextInt(world.players.length + 1));
    }
    expect(world.ownerHash).toBe(computeOwnerHash(world.owner));
  });

  it("the state hash notices any change to the game state", () => {
    const world = newGame(1);
    runTick(world, { tick: 1, commands: [] });
    const before = hashWorld(world);
    world.players[3]!.homeTroops += 1;
    expect(hashWorld(world)).not.toBe(before);
    world.players[3]!.homeTroops -= 1;
    expect(hashWorld(world)).toBe(before);
    world.rng.nextUint32();
    expect(hashWorld(world)).not.toBe(before);
  });

  it("refuses to apply a turn out of order", () => {
    const world = newGame(1);
    expect(() => runTick(world, { tick: 2, commands: [] })).toThrow(/tick 2/);
  });
});

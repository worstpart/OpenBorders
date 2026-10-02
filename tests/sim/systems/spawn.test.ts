import { describe, expect, it } from "vitest";
import type { Command } from "../../../src/sim/commands.ts";
import type { TickFrame } from "../../../src/sim/frame.ts";
import { tileAt } from "../../../src/sim/map/gameMap.ts";
import { makeRules } from "../../../src/sim/rules.ts";
import { isSpawnProtected } from "../../../src/sim/systems/spawn.ts";
import { startingTroops } from "../../../src/sim/systems/troops.ts";
import { runTick } from "../../../src/sim/tick.ts";
import type { World } from "../../../src/sim/world.ts";
import { ascii, ownersToAscii, worldFromAscii } from "../../helpers/asciiMap.ts";

/** Runs one tick in which player 1 issues `commands`. */
function step(world: World, ...commands: Command[]): TickFrame {
  return runTick(world, {
    tick: world.tick + 1,
    commands: commands.map((command) => ({ playerId: 1, command })),
  });
}

const OPEN_PLAINS = `
  ...............
  ...............
  ...............
  ...............
  ...............
  ...............
  ...............
  ...............
  ...............
  ...............
  ...............
`;

describe("human spawning", () => {
  it("claims the land within the spawn radius and grants starting troops", () => {
    const world = worldFromAscii(OPEN_PLAINS, { players: ["human"], phase: "spawn" });
    const frame = step(world, { type: "spawn", tile: tileAt(world.map, 7, 5) });

    expect(ownersToAscii(world)).toBe(
      ascii(`
        ...............
        .......1.......
        .....11111.....
        ....1111111....
        ....1111111....
        ...111111111...
        ....1111111....
        ....1111111....
        .....11111.....
        .......1.......
        ...............
      `),
    );
    const player = frame.players[0]!;
    expect(player.tiles).toBe(49);
    expect(player.homeTroops).toBe(startingTroops(world.rules, 49));
    expect(frame.changedTiles.length).toBe(49);
    expect([...frame.changedOwners].every((owner) => owner === 1)).toBe(true);
    expect(frame.events).toContainEqual({
      type: "spawned",
      playerId: 1,
      tile: 82,
      automatic: false,
    });
  });

  it("never jumps across water", () => {
    const world = worldFromAscii(
      `
      .....~.....
      .....~.....
      .....~.....
      .....~.....
      .....~.....
      `,
      { players: ["human"], phase: "spawn", rules: makeRules({ spawn: { radius: 2 } }) },
    );
    step(world, { type: "spawn", tile: tileAt(world.map, 4, 2) });
    expect(ownersToAscii(world)).toBe(
      ascii(`
        ....1~.....
        ...11~.....
        ..111~.....
        ...11~.....
        ....1~.....
      `),
    );
  });

  it("moves the spawn when the player picks again", () => {
    const world = worldFromAscii(OPEN_PLAINS, {
      players: ["human"],
      phase: "spawn",
      rules: makeRules({ spawn: { radius: 1 } }),
    });
    step(world, { type: "spawn", tile: tileAt(world.map, 2, 2) });
    const frame = step(world, { type: "spawn", tile: tileAt(world.map, 10, 8) });
    expect(ownersToAscii(world)).toBe(
      ascii(`
        ...............
        ...............
        ...............
        ...............
        ...............
        ...............
        ...............
        ..........1....
        .........111...
        ..........1....
        ...............
      `),
    );
    expect(frame.players[0]!.tiles).toBe(5);
    // Releasing the old spawn and claiming the new one are both reported.
    expect(frame.changedTiles.length).toBe(10);
  });

  it("rejects invalid spawn commands with a reason", () => {
    const world = worldFromAscii(
      `
      ~~~~~~
      ~....~
      ~....~
      ~~~~~~
      `,
      { players: ["human"], phase: "spawn" },
    );
    const rejected = (frame: TickFrame) =>
      frame.events.filter((e) => e.type === "commandRejected").map((e) => e.reason);

    expect(rejected(step(world, { type: "spawn", tile: 0 }))).toEqual(["can't start on water"]);
    expect(rejected(step(world, { type: "spawn", tile: -1 }))).toEqual(["not a tile on this map"]);
    expect(rejected(step(world, { type: "spawn", tile: 1.5 }))).toEqual(["not a tile on this map"]);
    expect(rejected(step(world, { type: "confirmSpawn" }))).toEqual([
      "choose a starting position first",
    ]);
    expect(rejected(step(world, { type: "spawn", tile: 7 }))).toEqual([]);
    expect(rejected(step(world, { type: "confirmSpawn" }))).toEqual([]);
    // Confirming started the match, so spawning is over.
    expect(rejected(step(world, { type: "spawn", tile: 8 }))).toEqual(["the spawn phase is over"]);
  });

  it("rejects commands from unknown players", () => {
    const world = worldFromAscii(OPEN_PLAINS, { players: ["human"], phase: "spawn" });
    const frame = runTick(world, {
      tick: 1,
      commands: [{ playerId: 5, command: { type: "spawn", tile: 20 } }],
    });
    expect(frame.events).toContainEqual({
      type: "commandRejected",
      playerId: 5,
      command: "spawn",
      reason: "unknown player",
    });
  });

  it("rejects a tile another player already owns, and only claims neutral land", () => {
    const world = worldFromAscii(OPEN_PLAINS, { players: ["human", "human"], phase: "spawn" });
    const spawnOf = (playerId: number, tile: number) =>
      runTick(world, {
        tick: world.tick + 1,
        commands: [{ playerId, command: { type: "spawn", tile } }],
      });

    spawnOf(2, tileAt(world.map, 4, 5));
    const rejected = spawnOf(1, tileAt(world.map, 5, 5));
    expect(rejected.events).toContainEqual(
      expect.objectContaining({
        type: "commandRejected",
        reason: "another player is already there",
      }),
    );

    const overlapping = spawnOf(1, tileAt(world.map, 10, 5));
    expect(overlapping.players[1]!.tiles).toBe(49);
    expect(overlapping.players[0]!.tiles).toBeGreaterThan(0);
    expect(overlapping.players[0]!.tiles).toBeLessThan(49);
  });
});

describe("the spawn phase", () => {
  it("places bots at once, waits for the human to confirm, then starts the match", () => {
    const world = worldFromAscii(OPEN_PLAINS, {
      players: ["human", "bot", "bot"],
      phase: "spawn",
      rules: makeRules({ spawn: { radius: 1 } }),
    });
    const first = step(world);
    expect(first.phase).toBe("spawn");
    expect(first.players.map((p) => p.spawned)).toEqual([false, true, true]);
    expect(first.events.filter((e) => e.type === "spawned")).toHaveLength(2);

    // Troops don't grow while waiting.
    const botTroops = first.players[1]!.homeTroops;
    step(world);
    expect(world.players[1]!.homeTroops).toBe(botTroops);

    const human = world.players[0]!;
    const freeTile = world.owner.findIndex((owner, tile) => owner === 0 && tile > 16);
    step(world, { type: "spawn", tile: freeTile });
    expect(world.phase).toBe("spawn");
    const started = step(world, { type: "confirmSpawn" });
    expect(started.phase).toBe("playing");
    expect(started.playStartTick).toBe(started.tick);
    expect(started.events).toContainEqual({ type: "phaseChanged", phase: "playing" });
    expect(human.ready).toBe(true);
    // Troops grow from the first playing tick.
    expect(world.players[1]!.homeTroops).toBeGreaterThan(botTroops);
  });

  it("starts immediately when there are no humans (bots-only games)", () => {
    const world = worldFromAscii(OPEN_PLAINS, {
      players: ["bot", "bot"],
      phase: "spawn",
      rules: makeRules({ spawn: { radius: 1 } }),
    });
    const frame = step(world);
    expect(frame.phase).toBe("playing");
    // Random spawns need at least 80% of their disc (4 of 5 tiles at radius 1).
    for (const player of frame.players) {
      expect(player.spawned).toBe(true);
      expect(player.tiles).toBeGreaterThanOrEqual(4);
    }
  });

  it("keeps random spawns apart when there is room", () => {
    const rows = Array.from({ length: 60 }, () => ".".repeat(60)).join("\n");
    const world = worldFromAscii(rows, {
      players: ["bot", "bot", "bot", "bot"],
      phase: "spawn",
      rules: makeRules({ spawn: { randomMinDistance: 20 } }),
    });
    step(world);
    const spawns = world.players.map((p) => p.spawnTile);
    for (let a = 0; a < spawns.length; a++) {
      for (let b = a + 1; b < spawns.length; b++) {
        const dx = (spawns[a]! % 60) - (spawns[b]! % 60);
        const dy = Math.floor(spawns[a]! / 60) - Math.floor(spawns[b]! / 60);
        expect(dx * dx + dy * dy).toBeGreaterThanOrEqual(20 * 20);
      }
    }
  });

  it("never overlaps spawns, and eliminates players who find no land at all", () => {
    const world = worldFromAscii(
      `
      ~~~~~
      ~...~
      ~~~~~
      `,
      { players: ["bot", "bot", "bot", "bot"], phase: "spawn" },
    );
    const frame = step(world);
    // The first bot's disc takes all 3 land tiles; the others have nowhere to go —
    // which also makes it the last player standing.
    expect(frame.players.reduce((sum, p) => sum + p.tiles, 0)).toBe(3);
    for (const player of frame.players) expect(player.alive).toBe(player.tiles > 0);
    expect(frame.phase).toBe("ended");
    expect(frame.winner).toBe(frame.players.find((p) => p.tiles > 0)!.id);
  });

  it("protects players from attacks for the first 5 seconds of the match", () => {
    const world = worldFromAscii(OPEN_PLAINS, { players: ["bot"], phase: "spawn" });
    expect(isSpawnProtected(world)).toBe(true);
    step(world); // match starts at tick 1
    for (let tick = 1; tick < 1 + world.rules.spawn.protectionTicks; tick++) {
      expect(isSpawnProtected(world)).toBe(true);
      step(world);
    }
    expect(isSpawnProtected(world)).toBe(false);
  });
});

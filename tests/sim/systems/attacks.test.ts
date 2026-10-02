import { describe, expect, it } from "vitest";
import type { Command } from "../../../src/sim/commands.ts";
import type { TickFrame } from "../../../src/sim/frame.ts";
import { tileAt } from "../../../src/sim/map/gameMap.ts";
import { makeRules, type GameRules } from "../../../src/sim/rules.ts";
import { runTick } from "../../../src/sim/tick.ts";
import type { PlayerId, World } from "../../../src/sim/world.ts";
import { ascii, ownersToAscii, worldFromAscii } from "../../helpers/asciiMap.ts";

/** No randomness and no troop growth, so scenarios have exact, readable numbers. */
const EXACT = makeRules({
  attack: { noiseTicks: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
});

function tick(world: World, commands: { player: PlayerId; command: Command }[] = []): TickFrame {
  return runTick(world, {
    tick: world.tick + 1,
    commands: commands.map(({ player, command }) => ({ playerId: player, command })),
  });
}

function runUntilIdle(world: World, maxTicks = 2_000): TickFrame[] {
  const frames: TickFrame[] = [];
  for (let k = 0; k < maxTicks && (k === 0 || world.attacks.length > 0); k++)
    frames.push(tick(world));
  return frames;
}

const expand = (world: World, player: PlayerId, x: number, y: number, percent: number) =>
  tick(world, [
    {
      player,
      command: {
        type: "attack",
        target: 0,
        focusTile: tileAt(world.map, x, y),
        percentBp: percent * 100,
      },
    },
  ]);

const attack = (
  world: World,
  player: PlayerId,
  target: PlayerId,
  x: number,
  y: number,
  percent: number,
) =>
  tick(world, [
    {
      player,
      command: {
        type: "attack",
        target,
        focusTile: tileAt(world.map, x, y),
        percentBp: percent * 100,
      },
    },
  ]);

const rejections = (frame: TickFrame) =>
  frame.events.flatMap((e) => (e.type === "commandRejected" ? [e.reason] : []));

describe("expanding into neutral land", () => {
  it("takes reachable neutral land, never crosses water, and brings survivors home", () => {
    const world = worldFromAscii(
      `
      ~~~~~~~~~
      ~1....~.~
      ~.....~.~
      ~~~~~~~~~
      `,
      { rules: EXACT, homeTroops: [1_000] },
    );
    expand(world, 1, 5, 2, 50);
    expect(world.players[0]!.homeTroops).toBe(500);
    expect(world.players[0]!.fieldTroops).toBe(500);
    const frames = runUntilIdle(world);

    expect(ownersToAscii(world)).toBe(
      ascii(`
        ~~~~~~~~~
        ~11111~.~
        ~11111~.~
        ~~~~~~~~~
      `),
    );
    // 9 plains tiles at 3 troops each; the rest of the army comes home.
    const ended = frames.flatMap((f) => f.events).find((e) => e.type === "attackEnded");
    expect(ended).toMatchObject({ reason: "complete", survivors: 500 - 27 });
    expect(world.players[0]!.homeTroops).toBe(1_000 - 27);
    expect(world.players[0]!.fieldTroops).toBe(0);
  });

  it("pays more for highland and mountains", () => {
    const world = worldFromAscii(
      `
      ~~~~~
      ~1^M~
      ~~~~~
      `,
      { rules: EXACT, homeTroops: [1_000] },
    );
    expand(world, 1, 3, 1, 100);
    runUntilIdle(world);
    expect(world.players[0]!.tiles).toBe(3);
    expect(world.players[0]!.homeTroops).toBe(1_000 - 4 - 6);
  });

  it("stops when the army is spent", () => {
    const world = worldFromAscii(
      `
      1.........
      `,
      { rules: EXACT, homeTroops: [10] },
    );
    expand(world, 1, 9, 0, 100);
    const ended = runUntilIdle(world)
      .flatMap((f) => f.events)
      .find((e) => e.type === "attackEnded");
    expect(world.players[0]!.tiles).toBe(1 + 3); // 3 tiles × 3 troops = 9; 1 troop left over
    expect(ended).toMatchObject({ reason: "spent", survivors: 1 });
  });

  it("advances one tile per layer delay with a full army, slower with a small one", () => {
    const strip = "1" + ".".repeat(30);
    const ticksToCross = (troops: number) => {
      const world = worldFromAscii(strip, {
        rules: makeRules({
          attack: { noiseTicks: 0, focusPull: 0 },
          troops: { growthFloor: 0, growthScale: 0 },
        }),
        homeTroops: [troops],
      });
      expand(world, 1, 30, 0, 100);
      return runUntilIdle(world).length + 1;
    };
    const fullSpeed = ticksToCross(10_000);
    // 30 tiles × 3 ticks per layer (the first tile is taken 3 ticks after the command).
    expect(fullSpeed).toBeGreaterThanOrEqual(90);
    expect(fullSpeed).toBeLessThanOrEqual(92);
    expect(ticksToCross(500)).toBeGreaterThan(fullSpeed * 2.5); // 500 of 2000 → quarter speed
  });

  it("rejects expansion with nothing to expand into, or before the match starts", () => {
    const boxedIn = worldFromAscii(
      `
      ~~~~~~
      ~1~..~
      ~~~~~~
      `,
      { rules: EXACT, homeTroops: [1_000] },
    );
    expect(rejections(expand(boxedIn, 1, 3, 1, 50))).toEqual(["you don't border that land"]);

    const spawnPhase = worldFromAscii("......", { players: ["human"], phase: "spawn" });
    expect(rejections(expand(spawnPhase, 1, 3, 0, 50))).toEqual(["the match hasn't started"]);
  });

  it("validates the command's numbers", () => {
    const world = worldFromAscii("1....~", { rules: EXACT, homeTroops: [1_000] });
    const send = (target: number, focusTile: number, percentBp: number) =>
      rejections(
        tick(world, [{ player: 1, command: { type: "attack", target, focusTile, percentBp } }]),
      );
    expect(send(0, 2, 0)).toEqual(["invalid percentage"]);
    expect(send(0, 2, 10_001)).toEqual(["invalid percentage"]);
    expect(send(0, 5, 100)).toEqual(["not a land tile"]);
    expect(send(0, 99, 100)).toEqual(["not a land tile"]);
    expect(send(1, 0, 100)).toEqual(["can't attack yourself"]);
    expect(send(1, 2, 100)).toEqual(["that land changed hands"]);
    expect(send(7, 2, 100)).toEqual(["unknown target"]);
  });
});

describe("front shape", () => {
  it("grows round, not diamond-shaped, on open ground", () => {
    const size = 81;
    const center = 40;
    const rows = Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => (x === center && y === center ? "1" : ".")).join(""),
    ).join("\n");
    const rules = makeRules({
      attack: { noiseTicks: 0, focusPull: 0, focusSpread: 0 },
      troops: { growthFloor: 0, growthScale: 0 },
    });
    const world = worldFromAscii(rows, { rules, homeTroops: [1_000_000] });
    expand(world, 1, 0, 0, 100);
    for (let k = 0; k < 120; k++) tick(world);

    const owned = (x: number, y: number) => world.owner[tileAt(world.map, x, y)] === 1;
    let axis = 0;
    while (owned(center + axis + 1, center)) axis++;
    let diagonal = 0;
    while (owned(center + diagonal + 1, center + diagonal + 1)) diagonal++;
    // A diamond reaches only 71% as far along the diagonal; a circle 100%. With whole-tick
    // timing we get an octagon at 82–90% (it measured 67% before the fill rule).
    expect(axis).toBeGreaterThan(15);
    expect((diagonal * Math.SQRT2) / axis).toBeGreaterThan(0.8);
    expect((diagonal * Math.SQRT2) / axis).toBeLessThan(1.1);
  });
});

describe("directed attacks", () => {
  // Player 1 holds the whole left column; neutral land to the right.
  const COLUMN = Array.from({ length: 21 }, () => "1" + ".".repeat(8)).join("\n");

  function firstCaptures(rules: GameRules, focusY: number): number[] {
    const world = worldFromAscii(COLUMN, { rules, homeTroops: [100_000] });
    expand(world, 1, 8, focusY, 50);
    const rows: number[] = [];
    for (let k = 0; k < 60 && rows.length < 5; k++) {
      for (const tile of tick(world).changedTiles) rows.push(Math.floor(tile / world.map.width));
    }
    return rows.slice(0, 5);
  }

  it("opens near the click point, then widens along the border", () => {
    const rows = firstCaptures(EXACT, 3);
    for (const row of rows) expect(Math.abs(row - 3)).toBeLessThanOrEqual(2);
  });

  it("with focusing turned off, the whole border starts at once", () => {
    const flat = makeRules({
      attack: { noiseTicks: 0, focusSpread: 0, focusPull: 0 },
      troops: { growthFloor: 0, growthScale: 0 },
    });
    const world = worldFromAscii(COLUMN, { rules: flat, homeTroops: [100_000] });
    expand(world, 1, 8, 3, 50);
    let firstWave: Int32Array = new Int32Array(0);
    for (let k = 0; k < 20 && firstWave.length === 0; k++) firstWave = tick(world).changedTiles;
    expect(firstWave.length).toBe(21);
  });
});

describe("attacking a player", () => {
  const DUEL = `
    11111.22222
    11111.22222
    11111.22222
  `;
  // Players 1 and 2 face each other across a neutral column; give 1 a bridge.
  const BRIDGED = DUEL.replace(/1\.2/g, "112");

  it("costs the attacker the formula and the defender their density per tile", () => {
    // A one-tile-wide front, so exactly one tile falls at a time.
    const world = worldFromAscii("111111" + "2".repeat(15), {
      rules: EXACT,
      homeTroops: [10_000, 1_800],
    });
    const defender = world.players[1]!;
    attack(world, 1, 2, 12, 0, 50); // 5,000 troops vs a home pool of 1,800 (density 120)

    let frame = tick(world);
    for (let k = 0; k < 20 && frame.changedTiles.length === 0; k++) frame = tick(world);
    expect(frame.changedTiles.length).toBe(1);
    // r = 1800 / 5000 = 0.36 → clamped to 0.5; d = 120: loss = 1 × 0.5 × (3 + 0.8 × 120) = 49.5.
    expect(world.attacks[0]!.troops).toBe(5_000 - 49.5);
    expect(defender.homeTroops).toBe(1_800 - 120);
    expect(defender.tiles).toBe(14);
  });

  it("is cheaper per tile and faster when you commit more", () => {
    const outcome = (percent: number) => {
      const world = worldFromAscii(BRIDGED, { rules: EXACT, homeTroops: [20_000, 3_000] });
      attack(world, 1, 2, 9, 1, percent);
      const sent = world.attacks[0]!.troops;
      let ticks = 0;
      while (world.players[1]!.tiles > 10 && ticks < 2_000) {
        tick(world);
        ticks++;
      }
      return { lossPerTile: (sent - (world.attacks[0]?.troops ?? 0)) / 5, ticks };
    };
    const small = outcome(10);
    const big = outcome(50);
    expect(big.lossPerTile).toBeLessThan(small.lossPerTile);
    expect(big.ticks).toBeLessThan(small.ticks);
  });

  it("is blocked by spawn protection at the start of the match", () => {
    const world = worldFromAscii(BRIDGED, { rules: EXACT, homeTroops: [10_000, 1_000] });
    world.playStartTick = world.tick; // the match just started
    expect(rejections(attack(world, 1, 2, 9, 1, 50))).toEqual(["spawn protection is still on"]);
  });

  it("merges a second click on the same target into the same attack", () => {
    const world = worldFromAscii(BRIDGED, { rules: EXACT, homeTroops: [10_000, 1_000] });
    attack(world, 1, 2, 9, 1, 50);
    attack(world, 1, 2, 10, 2, 50);
    expect(world.attacks).toHaveLength(1);
    expect(world.attacks[0]!.troops).toBeGreaterThanOrEqual(7_500 - 200); // 5000 + 2500, minus a few tiles
    expect(world.attacks[0]!.focusTile).toBe(tileAt(world.map, 10, 2));
    expect(world.players[0]!.homeTroops).toBe(2_500);
  });

  it("opposing attacks cancel out first; the bigger army continues with the difference", () => {
    const world = worldFromAscii(BRIDGED.replace(/1122/g, "1122"), {
      rules: EXACT,
      homeTroops: [2_000, 1_200],
    });
    const frame = tick(world, [
      {
        player: 1,
        command: {
          type: "attack",
          target: 2,
          focusTile: tileAt(world.map, 9, 1),
          percentBp: 5_000,
        },
      },
      {
        player: 2,
        command: {
          type: "attack",
          target: 1,
          focusTile: tileAt(world.map, 1, 1),
          percentBp: 5_000,
        },
      },
    ]);
    // 1,000 vs 600: player 2's army is destroyed, player 1's continues with 400.
    expect(frame.attacks).toHaveLength(1);
    expect(frame.attacks[0]).toMatchObject({ attacker: 1, target: 2, troops: 400 });
    expect(frame.events).toContainEqual(
      expect.objectContaining({
        type: "attackEnded",
        attacker: 2,
        reason: "cancelled",
        survivors: 0,
      }),
    );
    expect(world.players[1]!.fieldTroops).toBe(0);
  });

  it("retreat: stops at once, troops come home 2 s later minus 20%", () => {
    const world = worldFromAscii(BRIDGED, { rules: EXACT, homeTroops: [10_000, 100_000] });
    attack(world, 1, 2, 9, 1, 50); // hopeless: the front barely moves
    const id = world.attacks[0]!.id;
    const troops = world.attacks[0]!.troops;
    tick(world, [{ player: 1, command: { type: "retreat", attackId: id } }]);
    const tilesAtRetreat = world.players[0]!.tiles;
    for (let k = 0; k < 19; k++) tick(world);
    expect(world.players[0]!.homeTroops).toBe(5_000); // not back yet
    expect(world.players[0]!.fieldTroops).toBe(troops); // still counts toward the cap
    tick(world);
    expect(world.players[0]!.homeTroops).toBe(5_000 + troops * 0.8);
    expect(world.players[0]!.tiles).toBe(tilesAtRetreat);
    expect(world.attacks).toHaveLength(0);
  });

  it("retreating from neutral land costs nothing", () => {
    const world = worldFromAscii("1" + ".".repeat(40), { rules: EXACT, homeTroops: [1_000] });
    expand(world, 1, 40, 0, 100);
    tick(world, [{ player: 1, command: { type: "retreat", attackId: world.attacks[0]!.id } }]);
    const army = world.players[0]!.fieldTroops;
    for (let k = 0; k < 20; k++) tick(world);
    expect(world.players[0]!.homeTroops).toBe(army);
  });

  it("only lets players retreat their own attacks", () => {
    const world = worldFromAscii(BRIDGED, { rules: EXACT, homeTroops: [10_000, 1_000] });
    attack(world, 1, 2, 9, 1, 50);
    const frame = tick(world, [
      { player: 2, command: { type: "retreat", attackId: world.attacks[0]!.id } },
    ]);
    expect(rejections(frame)).toEqual(["no such attack"]);
  });
});

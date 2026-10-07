/** Walls — Border Defense drawn point by point (GAME_DESIGN.md §3.17.6, D-024). */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import type { SimEvent } from "../../src/sim/events.ts";
import type { TickFrame } from "../../src/sim/frame.ts";
import { makeRules, type GameRules } from "../../src/sim/rules.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import { tileCost } from "../../src/sim/systems/attacks.ts";
import { wallBuildTicks, wallPrice, wallTiles } from "../../src/sim/systems/walls.ts";
import { runTick } from "../../src/sim/tick.ts";
import { setOwner, type Attack, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

const RULES = makeRules({
  attack: { noiseShare: 0 },
  troops: { growthFloor: 0, growthScale: 0 },
  victory: { landShare: 2 },
  economy: { incomeBase: 0, incomePerSqrtTile: 0 },
});
const LEVELS = RULES.walls.levels;

// 40 × 9: player 1 on the left, player 2 on the right, a lake in player 2's land.
const MAP = `
  1111111111111111111122222222222222222222
  1111111111111111111122222222222222222222
  1111111111111111111122222222222222222222
  1111111111111111111122222222222~~2222222
  1111111111111111111122222222222~~2222222
  1111111111111111111122222222222222222222
  1111111111111111111122222222222222222222
  1111111111111111111122222222222222222222
  1111111111111111111122222222222222222222
`;
const WIDTH = 40;
const at = (x: number, y: number) => y * WIDTH + x;

function world(rules: GameRules = RULES, homeTroops = [20_000, 20_000]): World {
  const w = worldFromAscii(MAP, { rules, homeTroops });
  for (const p of w.players) p.gold = 10_000_000;
  return w;
}

function step(w: World, commands: { playerId: number; command: Command }[] = []): TickFrame {
  return runTick(w, { tick: w.tick + 1, commands });
}

function run(w: World, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < ticks; k++) events.push(...step(w).events);
  return events;
}

function order(w: World, playerId: number, command: Command): SimEvent[] {
  return [...step(w, [{ playerId, command }]).events];
}

function rejection(events: SimEvent[]): string | null {
  const rejected = events.find((e) => e.type === "commandRejected");
  return rejected?.type === "commandRejected" ? rejected.reason : null;
}

/** Player 2's wall from (x, 0) to (x, 8) — across its whole land — finished, at `level`. */
function fullWall(w: World, x: number, level = 1): number {
  order(w, 2, { type: "buildWall", points: [at(x, 0), at(x, 8)] });
  const wall = w.walls.at(-1)!;
  run(w, wallBuildTicks(RULES, 1, 9));
  for (let l = 2; l <= level; l++) {
    order(w, 2, { type: "upgradeWall", wallId: wall.id });
    run(w, wallBuildTicks(RULES, l, wall.intact));
  }
  expect(wall.level).toBe(level);
  return wall.id;
}

const fakeAttack = (attacker: number, target: number, troops: number) =>
  ({ attacker, target, troops, landingTile: -1, lossFactor: 1 }) as unknown as Attack;

describe("drawing a wall", () => {
  const map = world().map;

  it("joins the points with straight 8-connected lines, without repeats", () => {
    expect(wallTiles(map, [at(0, 0), at(3, 0)])).toEqual([at(0, 0), at(1, 0), at(2, 0), at(3, 0)]);
    expect(wallTiles(map, [at(0, 0), at(2, 2)])).toEqual([at(0, 0), at(1, 1), at(2, 2)]);
    // A → B → C: the corner is not repeated.
    expect(wallTiles(map, [at(0, 0), at(2, 0), at(2, 2)])).toEqual([
      at(0, 0),
      at(1, 0),
      at(2, 0),
      at(2, 1),
      at(2, 2),
    ]);
    // Every step moves to one of the 8 neighbours: no gaps a front could slip through.
    const tiles = wallTiles(map, [at(1, 0), at(9, 3), at(4, 8)]);
    for (let k = 1; k < tiles.length; k++) {
      const dx = Math.abs((tiles[k]! % WIDTH) - (tiles[k - 1]! % WIDTH));
      const dy = Math.abs(Math.floor(tiles[k]! / WIDTH) - Math.floor(tiles[k - 1]! / WIDTH));
      expect(Math.max(dx, dy)).toBe(1);
    }
  });

  it("costs gold per tile up front and works once built", () => {
    const w = world();
    const me = w.players[1]!;
    const events = order(w, 2, { type: "buildWall", points: [at(25, 0), at(25, 8)] });
    const price = wallPrice(RULES, 1, 9, 0);
    expect(price).toBe(Math.round((LEVELS[0].costPerTile * 9) / 1_000) * 1_000);
    expect(me.gold).toBe(10_000_000 - price);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "wallStarted", level: 1, tiles: 9, gold: price }),
    );
    const wall = w.walls[0]!;
    expect(w.wallAt[at(25, 4)]).toBe(wall.id);
    expect(w.fortLevel[at(25, 4)]).toBe(0); // being built: no effect yet
    const done = run(w, wallBuildTicks(RULES, 1, 9));
    expect(done).toContainEqual(expect.objectContaining({ type: "wallCompleted", level: 1 }));
    expect(w.fortLevel[at(25, 4)]).toBe(1);
    expect(w.fortLevel[at(26, 4)]).toBe(0);
  });

  it("is rejected off your land, across water, through a building, too long, or without gold", () => {
    const w = world();
    const build = (points: number[], playerId = 2) =>
      rejection(order(w, playerId, { type: "buildWall", points }));
    expect(build([at(15, 0), at(25, 0)])).toBe("walls go on your own land");
    expect(build([at(29, 3), at(34, 3)])).toBe("walls can't cross water");
    expect(build([at(25, 3)])).toBe("a wall needs at least two points");
    order(w, 2, { type: "build", buildingType: "housing", tile: at(36, 6) });
    expect(build([at(36, 2), at(36, 8)])).toBe("a building is in the way");
    const long = makeRules({ ...RULES, walls: { ...RULES.walls, maxTiles: 5 } });
    const w2 = world(long);
    expect(rejection(order(w2, 2, { type: "buildWall", points: [at(25, 0), at(25, 8)] }))).toBe(
      "too long",
    );
    w.players[1]!.gold = 0;
    expect(build([at(22, 0), at(22, 8)])).toBe("not enough gold");
  });

  it("joins an existing wall instead of building over it, and keeps buildings off walls", () => {
    const w = world();
    fullWall(w, 25);
    order(w, 2, { type: "buildWall", points: [at(23, 4), at(28, 4)] });
    expect(w.walls[1]!.tiles).toEqual([at(23, 4), at(24, 4), at(26, 4), at(27, 4), at(28, 4)]);
    expect(rejection(order(w, 2, { type: "buildWall", points: [at(25, 0), at(25, 3)] }))).toBe(
      "there is already a wall there",
    );
    expect(
      rejection(order(w, 2, { type: "build", buildingType: "housing", tile: at(25, 6) })),
    ).toBe("there is a wall there");
  });
});

describe("a wall in a fight", () => {
  it("makes its tiles cost several times the troops, plus the troops to break it", () => {
    const w = world();
    fullWall(w, 25, 3);
    const attack = fakeAttack(1, 2, 10_000);
    const open = tileCost(w, attack, at(24, 4));
    const walled = tileCost(w, attack, at(25, 4));
    expect(walled).toBeCloseTo(open * LEVELS[2].loss + LEVELS[2].breakTroops, 8);
  });

  it("holds the front: a closed wall stops even a bigger army for a while", () => {
    const crossed = (level: number) => {
      const w = world(RULES, [60_000, 20_000]);
      if (level > 0) fullWall(w, 22, level);
      order(w, 1, { type: "attack", target: 2, focusTile: at(30, 4), percentBp: 6_000 });
      for (let tick = 1; tick <= 400; tick++) {
        step(w);
        for (let y = 0; y < 9; y++) if (w.owner[at(23, y)] === 1) return tick;
      }
      return 400;
    };
    const open = crossed(0);
    const palisade = crossed(1);
    const fortress = crossed(3);
    expect(palisade - open).toBeGreaterThan(LEVELS[0].holdTicks * 0.4);
    console.info(`crossed after ${open} / ${palisade} / ${fortress} ticks (open / I / III)`);
    expect(fortress).toBeGreaterThan(palisade);
  });

  it("breaks where it is taken: a gap opens, the rest stands", () => {
    const w = world();
    const id = fullWall(w, 25);
    setOwner(w, at(25, 4), 1);
    expect(w.wallAt[at(25, 4)]).toBe(-1);
    expect(w.fortLevel[at(25, 4)]).toBe(0);
    expect(w.fortLevel[at(25, 3)]).toBe(1);
    const wall = w.walls.find((x) => x.id === id)!;
    expect(wall.intact).toBe(8);
    // Retaking the tile doesn't rebuild the wall.
    setOwner(w, at(25, 4), 2);
    expect(w.wallAt[at(25, 4)]).toBe(-1);
    // Breaking the last tile destroys the wall.
    for (let y = 0; y < 9; y++) setOwner(w, at(25, y), 1);
    expect(w.walls.some((x) => x.id === id)).toBe(false);
  });

  it("an upgrade keeps the old level working, then raises every standing tile", () => {
    const w = world();
    const id = fullWall(w, 25);
    setOwner(w, at(25, 0), 1); // one tile already broken
    const before = w.players[1]!.gold;
    order(w, 2, { type: "upgradeWall", wallId: id });
    expect(before - w.players[1]!.gold).toBe(wallPrice(RULES, 2, 8, 8));
    expect(w.fortLevel[at(25, 4)]).toBe(1);
    run(w, wallBuildTicks(RULES, 2, 8));
    expect(w.fortLevel[at(25, 4)]).toBe(2);
    expect(w.fortLevel[at(25, 0)]).toBe(0);
  });

  it("cancelling refunds half: a new wall disappears, an upgrade falls back", () => {
    const w = world();
    order(w, 2, { type: "buildWall", points: [at(25, 0), at(25, 8)] });
    const wall = w.walls[0]!;
    const gold = w.players[1]!.gold;
    order(w, 2, { type: "cancelWall", wallId: wall.id });
    expect(w.players[1]!.gold).toBe(gold + Math.floor(wall.paid / 2) + 0);
    expect(w.walls).toHaveLength(0);
    expect(w.wallAt[at(25, 4)]).toBe(-1);

    const id = fullWall(w, 25);
    order(w, 2, { type: "upgradeWall", wallId: id });
    order(w, 2, { type: "cancelWall", wallId: id });
    expect(w.walls[0]).toMatchObject({ level: 1, targetLevel: 1, readyTick: -1 });
  });
});

describe("walls in the game state", () => {
  it("are part of the hash and of every frame", () => {
    const a = world();
    const b = world();
    expect(hashWorld(a)).toBe(hashWorld(b));
    order(a, 2, { type: "buildWall", points: [at(25, 0), at(25, 8)] });
    step(b);
    expect(hashWorld(a)).not.toBe(hashWorld(b));

    const w = world();
    order(w, 2, { type: "buildWall", points: [at(25, 0), at(25, 8)] });
    let frame = step(w);
    expect(frame.walls).toHaveLength(1);
    expect(frame.walls[0]!.tiles).toHaveLength(9);
    for (let k = 0; k < 100 && frame.fortTiles.length === 0; k++) frame = step(w);
    expect([...frame.fortTiles].sort((x, y) => x - y)).toEqual(
      wallTiles(w.map, [at(25, 0), at(25, 8)]).sort((x, y) => x - y),
    );
    expect([...frame.fortLevels].every((l) => l === 1)).toBe(true);
  });

  it("are refused when buildings are off", () => {
    const w = world(makeRules({ ...RULES, buildings: { ...RULES.buildings, enabled: false } }));
    expect(rejection(order(w, 2, { type: "buildWall", points: [at(25, 0), at(25, 8)] }))).toBe(
      "there are no walls in this game",
    );
  });
});

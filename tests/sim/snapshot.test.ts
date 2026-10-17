/**
 * Milestone 3.0 (D-006): a world saved mid-game and rebuilt — on a freshly generated map, as
 * a joining client would — plays on exactly like the original: the same hash every tick and,
 * at the end, the same full state (including what the hash leaves out, such as the order of
 * border sets and attack fronts). Command logs replay a game from its start or from a
 * snapshot (the reconnect path).
 */
import { describe, expect, it } from "vitest";
import type { Command, StampedCommand } from "../../src/sim/commands.ts";
import { createMap, isLand, tileAt, type GameMap } from "../../src/sim/map/gameMap.ts";
import { generateMap, type MapSpec } from "../../src/sim/map/generate.ts";
import { CommandRecorder, replayLog } from "../../src/sim/replay.ts";
import { DEFAULT_RULES, makeRules } from "../../src/sim/rules.ts";
import {
  deserializeWorld,
  serializeWorld,
  SKIPPED_WORLD_FIELDS,
  type WorldSnapshot,
} from "../../src/sim/snapshot.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import { runTick } from "../../src/sim/tick.ts";
import { createWorld, type Building, type PlayerSetup, type World } from "../../src/sim/world.ts";
import { worldFromAscii } from "../helpers/asciiMap.ts";

/** A fresh map object with the same terrain: no per-map caches carried over. */
function copyMap(map: GameMap): GameMap {
  return createMap(map.width, map.height, map.terrain.slice(), map.relief.slice());
}

/** Snapshot → JSON text → snapshot → world, the way it will travel. */
function viaText(world: World, map: GameMap = copyMap(world.map)): World {
  const text = JSON.stringify(serializeWorld(world));
  return deserializeWorld(JSON.parse(text) as WorldSnapshot, map, world.rules);
}

/** The full saved state as text (equal text = equal games, hashed or not). */
const fullState = (world: World): string => JSON.stringify(serializeWorld(world).state);

// --- A generated Islands game with nations, tribes and a scripted human -----------------

const SPEC: MapSpec = { seed: 3, width: 520, height: 340, style: "archipelago" };
const MAP = generateMap(SPEC);
const PLAYERS: PlayerSetup[] = [
  { name: "You", kind: "human" },
  ...Array.from({ length: 6 }, (_, k) => ({
    name: `Nation ${k + 1}`,
    kind: "bot" as const,
    difficulty: "hard" as const,
  })),
  ...Array.from({ length: 8 }, (_, k) => ({
    name: `Tribe ${k + 1}`,
    kind: "bot" as const,
    tier: "tribe" as const,
  })),
];

/**
 * The human: spawns on the first free land it finds, keeps expanding into neutral land, then
 * attacks whoever it borders.
 */
function human(world: World): StampedCommand[] {
  const me = world.players[0]!;
  if (world.tick === 3) {
    const y = Math.floor(world.map.height / 2);
    for (let x = 0; x < world.map.width; x++) {
      const tile = tileAt(world.map, x, y);
      if (isLand(world.map, tile) && world.owner[tile] === 0) {
        return [{ playerId: 1, command: { type: "spawn", tile } }];
      }
    }
  }
  if (world.tick === 5) return [{ playerId: 1, command: { type: "confirmSpawn" } }];
  if (!me.alive || world.tick % 50 !== 0) return [];
  let enemy: Command | null = null;
  for (const tile of me.border) {
    for (const n of [tile - 1, tile + 1, tile - world.map.width, tile + world.map.width]) {
      if (n < 0 || n >= world.owner.length || !isLand(world.map, n)) continue;
      const owner = world.owner[n]!;
      if (owner === 0) {
        const command: Command = { type: "attack", target: 0, focusTile: n, percentBp: 5_000 };
        return [{ playerId: 1, command }];
      }
      if (owner !== 1) enemy ??= { type: "attack", target: owner, focusTile: n, percentBp: 3_000 };
    }
  }
  if (enemy) return [{ playerId: 1, command: enemy }];
  // Alone on its island: sail for another stretch of the map each time (the sim refuses the
  // landings no boat can reach).
  const start = ((world.tick / 50) * 7919) % world.owner.length;
  for (let k = 0; k < world.owner.length; k += 37) {
    const tile = (start + k) % world.owner.length;
    const owner = world.owner[tile]!;
    if (owner > 1) {
      return [{ playerId: 1, command: { type: "boat", target: owner, tile, percentBp: 2_000 } }];
    }
  }
  return [];
}

const GAME_TICKS = 4_000;

/** Plays the Islands game, recording its log, every hash and snapshots every 400 ticks. */
function playIslands() {
  const world = createWorld({ seed: 11, map: MAP, players: PLAYERS });
  const recorder = new CommandRecorder(11, PLAYERS, 50);
  const hashes: number[] = [0];
  const snapshots: string[] = [];
  let boatsLaunched = 0;
  while (world.tick < GAME_TICKS && world.phase !== "ended") {
    const turn = { tick: world.tick + 1, commands: human(world) };
    const frame = runTick(world, turn);
    recorder.record(turn, frame.hash);
    hashes.push(frame.hash);
    for (const e of frame.events) if (e.type === "boatLaunched" && e.owner === 1) boatsLaunched++;
    if (world.tick % 400 === 0) snapshots.push(JSON.stringify(serializeWorld(world)));
  }
  return { world, log: recorder.log(), hashes, snapshots, boatsLaunched };
}

const ISLANDS = playIslands();

describe("world snapshots: a generated game", () => {
  it("the game is a real one (the human, nations and tribes all play)", () => {
    expect(ISLANDS.snapshots.length).toBeGreaterThanOrEqual(8);
    expect(ISLANDS.log.turns.length).toBeGreaterThan(20);
    expect(ISLANDS.boatsLaunched).toBeGreaterThan(3);
    expect(ISLANDS.world.players[0]!.tiles).toBeGreaterThan(100);
    expect(ISLANDS.world.buildings.length).toBeGreaterThan(5);
  });

  it("every snapshot, rebuilt on a fresh map, plays on with the same hash every tick", () => {
    const freshMap = copyMap(MAP);
    for (const text of ISLANDS.snapshots) {
      const snapshot = JSON.parse(text) as WorldSnapshot;
      const copy = deserializeWorld(snapshot, freshMap);
      expect(copy.tick).toBe(snapshot.tick);
      const { world, divergedAt } = replayLog(ISLANDS.log, freshMap, DEFAULT_RULES, {
        from: copy,
        until: snapshot.tick + 250,
      });
      expect(divergedAt).toBeNull();
      expect(hashWorld(world)).toBe(ISLANDS.hashes[world.tick]);
    }
  });

  it("the command log replays the whole game from the start, ending in the same full state", () => {
    const { world, divergedAt } = replayLog(ISLANDS.log, copyMap(MAP));
    expect(divergedAt).toBeNull();
    expect(world.tick).toBe(ISLANDS.world.tick);
    expect(fullState(world)).toBe(fullState(ISLANDS.world));
  });

  it("a snapshot of a rebuilt world is the same snapshot", () => {
    const text = ISLANDS.snapshots[4]!;
    const copy = deserializeWorld(JSON.parse(text) as WorldSnapshot, copyMap(MAP));
    expect(JSON.stringify(serializeWorld(copy))).toBe(text);
  });
});

// --- A staged war: every Phase 2B system in the air or at sea at once ------------------

const WAR_RULES = makeRules({ victory: { landShare: 2 } });
const WAR_WIDTH = 200;
const WAR_HEIGHT = 44;
// Player 1 on the west island; across the sea, enemy 2 (north) and 1's teammate 3 (south).
const WAR_MAP = Array.from({ length: WAR_HEIGHT }, (_, y) =>
  Array.from({ length: WAR_WIDTH }, (_, x) => {
    if (y === 0 || y === WAR_HEIGHT - 1) return "~";
    if (x >= 1 && x <= 40) return "1";
    if (x >= 150 && x <= 198) return y < 26 ? "2" : "3";
    return "~";
  }).join(""),
).join("\n");
const at = (x: number, y: number) => y * WAR_WIDTH + x;

function place(w: World, type: Building["type"], owner: number, tile: number, level: number) {
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

function warWorld(): World {
  const w = worldFromAscii(WAR_MAP, {
    rules: WAR_RULES,
    homeTroops: [200_000, 150_000, 20_000],
    teams: [1, 2, 1],
  });
  for (const p of w.players) p.gold = 50_000_000;
  w.nextBuildingId = 1;
  place(w, "airport", 1, at(30, 12), 3); // 1
  place(w, "silo", 1, at(20, 30), 3); // 2
  place(w, "port", 1, at(40, 20), 3); // 3: a Naval Base
  place(w, "sam", 1, at(25, 20), 3); // 4
  place(w, "port", 2, at(150, 10), 3); // 5: the enemy's Naval Base
  place(w, "sam", 2, at(190, 20), 1); // 6: covers the east end only
  place(w, "silo", 2, at(185, 8), 2); // 7
  place(w, "housing", 2, at(175, 20), 2); // 8
  place(w, "port", 3, at(150, 34), 1); // 9: the teammate's Port (trade)
  return w;
}

/**
 * A tile player 2 still holds (missiles burn some of its land neutral), with no building,
 * west of its SAM's reach.
 */
function enemyLand(world: World): number {
  for (let x = 150; x <= 162; x++) {
    for (let y = 2; y < 24; y++) {
      const tile = at(x, y);
      if (world.owner[tile] === 2 && world.buildingAt[tile]! < 0) return tile;
    }
  }
  return -1;
}

/** The war's script, by tick: each side uses everything it has. */
function warCommands(world: World, tick: number): StampedCommand[] {
  const c = (playerId: number, command: Command): StampedCommand => ({ playerId, command });
  switch (tick) {
    case 2:
      return [
        c(1, { type: "airStrike", buildingId: 1, tile: at(190, 20) }),
        c(1, { type: "launchMissile", buildingId: 2, tile: at(175, 20), missile: "missile" }),
        c(2, { type: "launchMissile", buildingId: 7, tile: at(30, 12), missile: "missile" }),
      ];
    case 4:
      return [
        c(1, { type: "boat", target: 2, tile: at(150, 15), percentBp: 1_500 }),
        c(1, { type: "airlift", buildingId: 1, tile: at(170, 35), percentBp: 1_000 }),
        c(2, { type: "boat", target: 1, tile: at(40, 5), percentBp: 1_500 }),
      ];
    case 6:
      return [
        c(1, { type: "launchMissile", buildingId: 2, tile: at(175, 20), missile: "buster" }),
        c(1, { type: "ping", tile: at(160, 15), kind: "attack" }),
        c(3, { type: "emote", to: 1, emoji: 0 }),
      ];
    case 12:
      return [c(1, { type: "moveWarship", warshipId: 1, tile: at(140, 15) })];
    case 30: // outside the Silo III strike missile's 13 km crater, which is neutral land now
      return [c(1, { type: "launchMissile", buildingId: 2, tile: at(190, 6), missile: "warhead" })];
    case 80:
      return [c(1, { type: "attack", target: 2, focusTile: at(150, 20), percentBp: 2_000 })];
    case 260: // after the airlift's mission cooldown
      return [c(1, { type: "assault", buildingId: 1, tile: enemyLand(world), percentBp: 1_000 })];
    case 320: // after the first strike's cooldown: a strike on a point (suppression)
      return [c(1, { type: "airStrike", buildingId: 1, tile: enemyLand(world) })];
    default:
      return [];
  }
}

const WAR_TICKS = 700;

function playWar() {
  const world = warWorld();
  const hashes: number[] = [0];
  const snapshots: string[] = [];
  const seen = new Set<string>();
  const rejected: string[] = [];
  while (world.tick < WAR_TICKS) {
    const frame = runTick(world, {
      tick: world.tick + 1,
      commands: warCommands(world, world.tick + 1),
    });
    hashes.push(frame.hash);
    for (const e of frame.events) {
      if (e.type === "commandRejected") rejected.push(e.reason);
      if (e.type === "flightIntercepted" || e.type === "warshipFired") seen.add(e.type);
    }
    for (const f of world.flights) seen.add(`flight:${f.kind}`);
    if (world.warships.some((s) => s.readyTick < 0)) seen.add("warships");
    if (world.boats.length > 0) seen.add("boats");
    if (world.tradeShips.length > 0) seen.add("tradeShips");
    if (world.suppressions.length > 0) seen.add("suppressions");
    if (world.scorched.length > 0) seen.add("scorched");
    if (world.pings.length > 0) seen.add("pings");
    if (world.attacks.some((a) => a.landingTile >= 0)) seen.add("beachhead");
    if (world.tick % 7 === 0) snapshots.push(JSON.stringify(serializeWorld(world)));
  }
  return { world, hashes, snapshots, seen, rejected };
}

const WAR = playWar();

describe("world snapshots: a staged war", () => {
  it("has every Phase 2B system in play at some point", () => {
    expect(WAR.rejected).toEqual([]);
    expect([...WAR.seen].sort()).toEqual(
      expect.arrayContaining([
        "beachhead",
        "boats",
        "flight:airlift",
        "flight:assault",
        "flight:buster",
        "flight:missile",
        "flight:strike",
        "flight:warhead",
        "flightIntercepted",
        "pings",
        "scorched",
        "suppressions",
        "tradeShips",
        "warshipFired",
        "warships",
      ]),
    );
  });

  it("every snapshot plays on to the end in exactly the same way", () => {
    for (const text of WAR.snapshots) {
      const snapshot = JSON.parse(text) as WorldSnapshot;
      const copy = deserializeWorld(snapshot, copyMap(WAR.world.map), WAR_RULES);
      while (copy.tick < WAR_TICKS) {
        const hash = runTick(copy, {
          tick: copy.tick + 1,
          commands: warCommands(copy, copy.tick + 1),
        }).hash;
        if (hash !== WAR.hashes[copy.tick]) {
          throw new Error(`the copy from tick ${snapshot.tick} diverged at tick ${copy.tick}`);
        }
      }
      expect(fullState(copy)).toBe(fullState(WAR.world));
    }
  });
});

// --- The encoding itself ----------------------------------------------------------------

describe("the snapshot encoding", () => {
  it("is plain JSON: text round trip changes nothing", () => {
    const snapshot = serializeWorld(WAR.world);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("keeps -0, NaN, ±Infinity, undefined fields and Map/Set order exactly", () => {
    const w = warWorld();
    w.players[0]!.lastGrowth = -0;
    w.players[1]!.lastGrowth = Infinity;
    w.players[2]!.lastGrowth = NaN;
    w.players[0]!.lastIncome = -Infinity;
    w.lastDonationTick.set(99, 5).set(3, 7).set(50, 1);
    w.players[0]!.border.delete(at(1, 1));
    w.players[0]!.border.add(at(1, 1)); // moved to the end of the iteration order
    const copy = viaText(w);
    expect(Object.is(copy.players[0]!.lastGrowth, -0)).toBe(true);
    expect(copy.players[1]!.lastGrowth).toBe(Infinity);
    expect(copy.players[2]!.lastGrowth).toBeNaN();
    expect(copy.players[0]!.lastIncome).toBe(-Infinity);
    expect([...copy.lastDonationTick.keys()]).toEqual([...w.lastDonationTick.keys()]);
    expect([...copy.players[0]!.border]).toEqual([...w.players[0]!.border]);
    expect(copy.owner).toBeInstanceOf(Uint16Array);
    expect(copy.buildingAt).toBeInstanceOf(Int32Array);
  });

  it("saves every world field except the map, the rules and per-tick scratch", () => {
    const state = serializeWorld(WAR.world).state;
    const expected = Object.keys(WAR.world).filter((k) => !SKIPPED_WORLD_FIELDS.has(k));
    expect(Object.keys(state).sort()).toEqual(expected.sort());
  });

  it("refuses another map, other rules, a tampered state or a newer version", () => {
    const snapshot = serializeWorld(WAR.world);
    const map = copyMap(WAR.world.map);
    const otherTerrain = map.terrain.slice();
    otherTerrain[at(100, 20)] = 1;
    const otherMap = createMap(map.width, map.height, otherTerrain);
    expect(() => deserializeWorld(snapshot, otherMap, WAR_RULES)).toThrow(/another map/);
    expect(() => deserializeWorld(snapshot, map, DEFAULT_RULES)).toThrow(/other rules/);
    const tampered = JSON.parse(JSON.stringify(snapshot)) as WorldSnapshot;
    const players = tampered.state["players"] as { gold: number }[];
    players[0]!.gold += 1;
    expect(() => deserializeWorld(tampered, map, WAR_RULES)).toThrow(/hash/);
    expect(() => deserializeWorld({ ...snapshot, version: 99 }, map, WAR_RULES)).toThrow(/version/);
  });

  it("refuses to save a value it doesn't know how to (instead of dropping it)", () => {
    const w = warWorld();
    (w.players[0] as unknown as { extra: unknown }).extra = new Date(0);
    expect(() => serializeWorld(w)).toThrow(/can't encode a Date at players\[0\]\.extra/);
  });
});

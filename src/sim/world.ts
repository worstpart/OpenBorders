/**
 * The complete simulation state (ARCHITECTURE.md §5.2) and the one function allowed to
 * change tile ownership.
 */
import type { SimEvent } from "./events.ts";
import type { GameMap } from "./map/gameMap.ts";
import { Rng } from "./math/rng.ts";
import { DEFAULT_RULES, type GameRules } from "./rules.ts";
import { ownerTileHash } from "./stateHash.ts";

/** 1..n for players; 0 means neutral (unowned). */
export type PlayerId = number;
export const NEUTRAL: PlayerId = 0;

export type Phase = "spawn" | "playing" | "ended";
export type PlayerKind = "human" | "bot";

export interface Player {
  readonly id: PlayerId;
  readonly name: string;
  readonly kind: PlayerKind;
  alive: boolean;
  /** The tile the player spawned on, or -1 before spawning. */
  spawnTile: number;
  /** A human has confirmed their spawn (the match starts when all humans have). */
  ready: boolean;
  /** Troops at home, defending (T). Integer. */
  homeTroops: number;
  /** Troops away inside attacks (F). Integer. Counts toward capacity. */
  fieldTroops: number;
  /** Tiles owned (L). Kept in sync by setOwner. */
  tiles: number;
  /** Troop capacity (M) as of the last tick. */
  capacity: number;
  /** Troops gained in the last tick (shown on the HUD). */
  lastGrowth: number;
}

export interface PlayerSetup {
  readonly name: string;
  readonly kind: PlayerKind;
}

export interface GameSetup {
  /** Seeds all in-game randomness (bot spawns, later AI decisions). */
  readonly seed: number;
  readonly map: GameMap;
  readonly players: readonly PlayerSetup[];
  readonly rules?: GameRules;
}

export interface World {
  tick: number;
  phase: Phase;
  /** Tick at which the playing phase began, or -1. */
  playStartTick: number;
  readonly rules: GameRules;
  readonly map: GameMap;
  /** Owner per tile. Change only via setOwner. */
  readonly owner: Uint16Array;
  /** players[k].id === k + 1. */
  readonly players: Player[];
  readonly rng: Rng;
  winner: PlayerId | null;
  /** XOR of ownerTileHash over all tiles, maintained incrementally by setOwner. */
  ownerHash: number;

  // Per-tick output, cleared at the start of every tick (not part of the game state).
  readonly changes: TileChangeLog;
  readonly events: SimEvent[];
}

export const MAX_PLAYERS = 0xffff; // owner ids are stored in a Uint16Array

export function createWorld(setup: GameSetup): World {
  if (setup.players.length < 1 || setup.players.length > MAX_PLAYERS) {
    throw new RangeError(`A game needs 1..${MAX_PLAYERS} players, got ${setup.players.length}`);
  }
  const players = setup.players.map((p, index): Player => ({
    id: index + 1,
    name: p.name,
    kind: p.kind,
    alive: true,
    spawnTile: -1,
    ready: false,
    homeTroops: 0,
    fieldTroops: 0,
    tiles: 0,
    capacity: 0,
    lastGrowth: 0,
  }));
  return {
    tick: 0,
    phase: "spawn",
    playStartTick: -1,
    rules: setup.rules ?? DEFAULT_RULES,
    map: setup.map,
    owner: new Uint16Array(setup.map.width * setup.map.height),
    players,
    rng: new Rng(setup.seed),
    winner: null,
    ownerHash: 0,
    changes: new TileChangeLog(),
    events: [],
  };
}

/** The player with this id, or undefined for neutral/unknown ids. */
export function getPlayer(world: World, id: PlayerId): Player | undefined {
  return world.players[id - 1];
}

/** Sets a tile's owner, keeping tile counts, the ownership hash and the change log in sync. */
export function setOwner(world: World, tile: number, newOwner: PlayerId): void {
  const oldOwner = world.owner[tile]!;
  if (oldOwner === newOwner) return;
  world.owner[tile] = newOwner;
  if (oldOwner !== NEUTRAL) world.players[oldOwner - 1]!.tiles--;
  if (newOwner !== NEUTRAL) world.players[newOwner - 1]!.tiles++;
  world.ownerHash =
    (world.ownerHash ^ ownerTileHash(tile, oldOwner) ^ ownerTileHash(tile, newOwner)) >>> 0;
  world.changes.push(tile);
}

/** Tiles whose owner changed during the current tick (a tile may appear more than once). */
export class TileChangeLog {
  private buffer = new Int32Array(1024);
  private count = 0;

  push(tile: number): void {
    if (this.count === this.buffer.length) {
      const bigger = new Int32Array(this.buffer.length * 2);
      bigger.set(this.buffer);
      this.buffer = bigger;
    }
    this.buffer[this.count++] = tile;
  }

  get length(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
  }

  /** A copy of this tick's changed tiles. */
  toArray(): Int32Array {
    return this.buffer.slice(0, this.count);
  }
}

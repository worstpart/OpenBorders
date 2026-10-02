/**
 * The complete simulation state (ARCHITECTURE.md §5.2) and the one function allowed to
 * change tile ownership.
 */
import type { SimEvent } from "./events.ts";
import type { GameMap } from "./map/gameMap.ts";
import { Rng } from "./math/rng.ts";
import type { StampedCommand } from "./commands.ts";
import { DEFAULT_RULES, PERSONALITIES, type GameRules, type Personality } from "./rules.ts";
import { ownerTileHash } from "./stateHash.ts";
import type { TileQueue } from "./systems/tileQueue.ts";

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
  /**
   * Troops at home, defending (T). Troop amounts are plain numbers computed only with
   * + − × ÷ (deterministic on every engine); the HUD rounds them for display.
   */
  homeTroops: number;
  /** Troops away inside attacks (F): the sum of this player's armies. Counts toward capacity. */
  fieldTroops: number;
  /** Tiles owned (L). Kept in sync by setOwner. */
  tiles: number;
  /**
   * Owned tiles that touch a tile with a different owner (another player, neutral land,
   * water or the map edge). Kept in sync by setOwner; derived from ownership, so not hashed.
   */
  readonly border: Set<number>;
  /** Troop capacity (M) as of the last tick. */
  capacity: number;
  /** Troops gained in the last tick (shown on the HUD). */
  lastGrowth: number;
  /** Most tiles ever held (elimination rule, end-of-game stats). */
  peakTiles: number;
  /** Tick the player was eliminated, or -1. */
  eliminatedTick: number;
  /** The last player who took land from this one (0 = nobody yet). */
  lastLostTo: PlayerId;
  /** Bots only. */
  readonly brain: BotBrain | null;
  /**
   * Ownership changed next to this player's land since the last encirclement check.
   * Only skips work that would find nothing new, so it's not part of the game state.
   */
  encircleDirty: boolean;
}

export interface PlayerSetup {
  readonly name: string;
  readonly kind: PlayerKind;
  /** Bots only; chosen at random (from the game seed) when left out. */
  readonly personality?: Personality;
}

/** A bot's own state (GAME_DESIGN.md §3.11). */
export interface BotBrain {
  readonly personality: Personality;
  /** Next tick the bot thinks, or -1 until the match starts. */
  nextThinkTick: number;
  /** Consecutive thinks spent at the troop cap without acting (see AiRules.boredomThinks). */
  idleThinks: number;
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
  /** Active attacks, in launch order (the order they are processed in). */
  attacks: Attack[];
  /** Commands bots decided on this tick; applied first thing next tick, like any command. */
  pendingCommands: StampedCommand[];
  nextAttackId: number;
  /** Scratch marks for de-duplicating tiles inside one operation (not game state). */
  readonly scratchMarks: Int32Array;
  scratchStamp: number;
  /** Scratch queue for flood fills (not game state). */
  readonly scratchQueue: Int32Array;

  // Per-tick output, cleared at the start of every tick (not part of the game state).
  readonly changes: TileChangeLog;
  readonly events: SimEvent[];
}

/** An army advancing into one target's land (a player, or neutral land when target = 0). */
export interface Attack {
  readonly id: number;
  readonly attacker: PlayerId;
  readonly target: PlayerId;
  /** Troops still in this army. */
  troops: number;
  /** The tile the attack is aimed at (directed attacks); the latest click when merged. */
  focusTile: number;
  readonly startTick: number;
  tilesTaken: number;
  /** Tick at which a retreating army gets home, or -1 while advancing. */
  retreatTick: number;
  /** Finished this tick; removed from world.attacks before the tick ends. */
  ended: boolean;
  /** Tiles on the front, by the tick they can be taken (may hold superseded entries). */
  readonly front: TileQueue;
  /** The current ready time of each tile on the front (the entry that counts). */
  readonly scheduled: Map<number, number>;
  /** Seeds this attack's own vein pattern (organic spread). */
  readonly growthSeed: number;
}

export const MAX_PLAYERS = 0xffff; // owner ids are stored in a Uint16Array

export function createWorld(setup: GameSetup): World {
  if (setup.players.length < 1 || setup.players.length > MAX_PLAYERS) {
    throw new RangeError(`A game needs 1..${MAX_PLAYERS} players, got ${setup.players.length}`);
  }
  const rng = new Rng(setup.seed);
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
    border: new Set<number>(),
    capacity: 0,
    lastGrowth: 0,
    peakTiles: 0,
    eliminatedTick: -1,
    lastLostTo: 0,
    encircleDirty: true,
    brain:
      p.kind === "bot"
        ? {
            personality: p.personality ?? PERSONALITIES[rng.nextInt(PERSONALITIES.length)]!,
            nextThinkTick: -1,
            idleThinks: 0,
          }
        : null,
  }));
  return {
    tick: 0,
    phase: "spawn",
    playStartTick: -1,
    rules: setup.rules ?? DEFAULT_RULES,
    map: setup.map,
    owner: new Uint16Array(setup.map.width * setup.map.height),
    players,
    rng,
    winner: null,
    ownerHash: 0,
    attacks: [],
    pendingCommands: [],
    nextAttackId: 1,
    scratchMarks: new Int32Array(setup.map.width * setup.map.height),
    scratchStamp: 0,
    scratchQueue: new Int32Array(setup.map.width * setup.map.height),
    changes: new TileChangeLog(),
    events: [],
  };
}

/** The player with this id, or undefined for neutral/unknown ids. */
export function getPlayer(world: World, id: PlayerId): Player | undefined {
  return world.players[id - 1];
}

/**
 * Sets a tile's owner, keeping tile counts, border sets, the ownership hash and the
 * change log in sync.
 */
export function setOwner(world: World, tile: number, newOwner: PlayerId): void {
  const oldOwner = world.owner[tile]!;
  if (oldOwner === newOwner) return;
  world.owner[tile] = newOwner;
  if (oldOwner !== NEUTRAL) {
    const previous = world.players[oldOwner - 1]!;
    previous.tiles--;
    previous.border.delete(tile);
    if (newOwner !== NEUTRAL) previous.lastLostTo = newOwner;
  }
  if (newOwner !== NEUTRAL) world.players[newOwner - 1]!.tiles++;
  world.ownerHash =
    (world.ownerHash ^ ownerTileHash(tile, oldOwner) ^ ownerTileHash(tile, newOwner)) >>> 0;
  world.changes.push(tile);

  const { width } = world.map;
  const x = tile % width;
  refreshBorder(world, tile);
  if (tile >= width) refreshBorder(world, tile - width);
  if (tile + width < world.owner.length) refreshBorder(world, tile + width);
  if (x > 0) refreshBorder(world, tile - 1);
  if (x < width - 1) refreshBorder(world, tile + 1);
}

/** True if any 4-neighbor of `tile` has a different owner than `owner` (or is off the map). */
export function touchesOtherOwner(world: World, tile: number, owner: PlayerId): boolean {
  const { width } = world.map;
  const x = tile % width;
  const o = world.owner;
  return (
    tile < width ||
    tile + width >= o.length ||
    x === 0 ||
    x === width - 1 ||
    o[tile - width] !== owner ||
    o[tile + width] !== owner ||
    o[tile - 1] !== owner ||
    o[tile + 1] !== owner
  );
}

/** True if any 4-neighbor of `tile` is owned by `owner`. */
export function touchesOwner(world: World, tile: number, owner: PlayerId): boolean {
  const { width } = world.map;
  const x = tile % width;
  const o = world.owner;
  return (
    (tile >= width && o[tile - width] === owner) ||
    (tile + width < o.length && o[tile + width] === owner) ||
    (x > 0 && o[tile - 1] === owner) ||
    (x < width - 1 && o[tile + 1] === owner)
  );
}

function refreshBorder(world: World, tile: number): void {
  const owner = world.owner[tile]!;
  if (owner === NEUTRAL) return;
  const player = world.players[owner - 1]!;
  // Something changed at or next to this player's tile: their land may now be enclosed.
  player.encircleDirty = true;
  if (touchesOtherOwner(world, tile, owner)) player.border.add(tile);
  else player.border.delete(tile);
}

/** A fresh stamp for world.scratchMarks: tiles marked with it count as "seen" in one operation. */
export function nextScratchStamp(world: World): number {
  world.scratchStamp++;
  if (world.scratchStamp === 0x7fffffff) {
    world.scratchMarks.fill(0);
    world.scratchStamp = 1;
  }
  return world.scratchStamp;
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

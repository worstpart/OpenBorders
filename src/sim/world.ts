/**
 * The complete simulation state (ARCHITECTURE.md §5.2) and the one function allowed to
 * change tile ownership.
 */
import type { SimEvent } from "./events.ts";
import type { GameMap } from "./map/gameMap.ts";
import { Rng } from "./math/rng.ts";
import type { StampedCommand } from "./commands.ts";
import {
  DEFAULT_RULES,
  PERSONALITIES,
  type Difficulty,
  type GameRules,
  type Personality,
} from "./rules.ts";
import { ownerTileHash } from "./stateHash.ts";
import type { TileQueue } from "./systems/tileQueue.ts";

/** 1..n for players; 0 means neutral (unowned). */
export type PlayerId = number;
export const NEUTRAL: PlayerId = 0;

export type Phase = "spawn" | "playing" | "ended";
export type PlayerKind = "human" | "bot";
/** What kind of bot (GAME_DESIGN.md §3.13): a smart, fair nation or a weak filler tribe. */
export type BotTier = "nation" | "tribe";

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
  /** Marked a traitor (broke an alliance) until this tick; -1 = never (GAME_DESIGN.md §3.14). */
  traitorUntilTick: number;
  /** Alliances this player has broken. */
  betrayals: number;
  /** Gold in the treasury (an integer; GAME_DESIGN.md §3.16). */
  gold: number;
  /** Gold earned in the last tick (shown on the HUD). */
  lastIncome: number;
  /** Team number (1..), or 0 = no team (free-for-all, and tribes in team games; §3.15). */
  readonly team: number;
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
  /** Bots only: nation (default) or tribe. */
  readonly tier?: BotTier;
  /** Nations only; chosen at random (from the game seed) when left out. */
  readonly personality?: Personality;
  /** Nations only; "hard" (Phase 1's bots) when left out. */
  readonly difficulty?: Difficulty;
  /** Team games (GAME_DESIGN.md §3.15): 1..teams; 0 or left out = no team. */
  readonly team?: number;
}

/** A bot's own state (GAME_DESIGN.md §3.11). */
export interface BotBrain {
  readonly tier: BotTier;
  /** Nations play their personality; tribes ignore it (always "expander", never drawn). */
  readonly personality: Personality;
  /** Nations' reaction time and decision quality (tribes: unused). */
  readonly difficulty: Difficulty;
  /** Next tick the bot thinks, or -1 until the match starts. */
  nextThinkTick: number;
  /** Consecutive thinks spent at the troop cap without acting (see AiRules.boredomThinks). */
  idleThinks: number;
  /** Who betrayed this bot, and until which tick it holds the grudge (GAME_DESIGN.md §3.14). */
  readonly grudges: Map<PlayerId, number>;
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
  /** Team games: the team that won (0 = none, or a free-for-all game). */
  winningTeam: number;
  /** Highest team number in the game; 0 = free-for-all (GAME_DESIGN.md §3.15). */
  readonly teamCount: number;
  /** XOR of ownerTileHash over all tiles, maintained incrementally by setOwner. */
  ownerHash: number;
  /** Active attacks, in launch order (the order they are processed in). */
  attacks: Attack[];
  /** Alliances by pairKey(a, b), in the order they were formed (GAME_DESIGN.md §3.14). */
  readonly alliances: Map<number, Alliance>;
  /** Open alliance requests, oldest first. */
  allianceRequests: AllianceRequest[];
  /** Tick of each player's last request to another player, by requestKey(from, to). */
  readonly lastRequestTick: Map<number, number>;
  /** Tick of each player's last donation, by donationKey(from, to, resource) (§3.16). */
  readonly lastDonationTick: Map<number, number>;
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
  /** Retreating without the usual loss (the two sides just became allies). */
  freeRetreat: boolean;
}

/** Two players who can't attack each other until the alliance ends or one breaks it. */
export interface Alliance {
  /** The lower player id… */
  readonly a: PlayerId;
  /** …and the higher one. */
  readonly b: PlayerId;
  readonly formedTick: number;
  /** The alliance ends at this tick unless both renew it during the renewal window. */
  expiresTick: number;
  /** a / b asked to renew during the current renewal window. */
  renewA: boolean;
  renewB: boolean;
}

export interface AllianceRequest {
  readonly from: PlayerId;
  readonly to: PlayerId;
  readonly expiresTick: number;
}

/** Key of an unordered pair of players. */
export function pairKey(a: PlayerId, b: PlayerId): number {
  return a < b ? a * 0x10000 + b : b * 0x10000 + a;
}

/** Key of an ordered pair (from → to). */
export function requestKey(from: PlayerId, to: PlayerId): number {
  return from * 0x10000 + to;
}

/** What a donation gives (GAME_DESIGN.md §3.16). */
export type DonationResource = "troops" | "gold";

/** Key of a donation cooldown: from → to, per resource. */
export function donationKey(from: PlayerId, to: PlayerId, resource: DonationResource): number {
  return requestKey(from, to) * 2 + (resource === "gold" ? 1 : 0);
}

export const MAX_PLAYERS = 0xffff; // owner ids are stored in a Uint16Array

export function createWorld(setup: GameSetup): World {
  if (setup.players.length < 1 || setup.players.length > MAX_PLAYERS) {
    throw new RangeError(`A game needs 1..${MAX_PLAYERS} players, got ${setup.players.length}`);
  }
  for (const p of setup.players) {
    if (p.team !== undefined && !(Number.isInteger(p.team) && p.team >= 0)) {
      throw new RangeError(`Invalid team ${p.team} for ${p.name}`);
    }
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
    traitorUntilTick: -1,
    betrayals: 0,
    gold: 0,
    lastIncome: 0,
    team: p.team ?? 0,
    encircleDirty: true,
    brain: p.kind === "bot" ? createBrain(p, rng) : null,
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
    winningTeam: 0,
    teamCount: Math.max(0, ...setup.players.map((p) => p.team ?? 0)),
    ownerHash: 0,
    attacks: [],
    alliances: new Map(),
    allianceRequests: [],
    lastRequestTick: new Map(),
    lastDonationTick: new Map(),
    pendingCommands: [],
    nextAttackId: 1,
    scratchMarks: new Int32Array(setup.map.width * setup.map.height),
    scratchStamp: 0,
    scratchQueue: new Int32Array(setup.map.width * setup.map.height),
    changes: new TileChangeLog(),
    events: [],
  };
}

function createBrain(setup: PlayerSetup, rng: Rng): BotBrain {
  const tier = setup.tier ?? "nation";
  return {
    tier,
    // Tribes don't draw a personality, so adding tribes never shifts the nations' draws.
    personality:
      tier === "tribe"
        ? "expander"
        : (setup.personality ?? PERSONALITIES[rng.nextInt(PERSONALITIES.length)]!),
    difficulty: setup.difficulty ?? "hard",
    nextThinkTick: -1,
    idleThinks: 0,
    grudges: new Map(),
  };
}

/** Tribes are the weak filler bots (D-017). */
export function isTribe(player: Player | undefined): boolean {
  return player?.brain?.tier === "tribe";
}

/** Two different players on the same team (GAME_DESIGN.md §3.15). */
export function sameTeam(world: World, a: PlayerId, b: PlayerId): boolean {
  if (a === b || world.teamCount === 0) return false;
  const team = world.players[a - 1]?.team ?? 0;
  return team !== 0 && world.players[b - 1]?.team === team;
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

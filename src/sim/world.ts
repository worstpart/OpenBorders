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
  type BuildingType,
  type Difficulty,
  type GameRules,
  type Personality,
  type PingKind,
} from "./rules.ts";
import { ownerTileHash } from "./stateHash.ts";
import { breakWallTile } from "./systems/walls.ts";
import { shoreDistance } from "./systems/warships.ts";
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
  /** Gold earned from trade ships so far (GAME_DESIGN.md §3.19). */
  tradeGold: number;
  /** Tick of this player's last emoji and last map ping, -1 = none yet (GAME_DESIGN.md §3.20). */
  lastEmoteTick: number;
  lastPingTick: number;
  /**
   * What this player's finished buildings add (GAME_DESIGN.md §3.17), recomputed every tick
   * from world.buildings — derived, so not hashed.
   */
  readonly bonus: BuildingBonus;
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

/** The sum of a player's building effects (GAME_DESIGN.md §3.17). */
export interface BuildingBonus {
  /** Extra troop capacity. */
  capacity: number;
  /** Extra troop growth, as a share (capped by rules.buildings.maxGrowthBonus). */
  growth: number;
  /** Extra gold per tick. */
  income: number;
}

/**
 * A building (GAME_DESIGN.md §3.17, ARCHITECTURE.md §5.7). There is no health: the level is
 * the health (a hit or a capture costs a level; level 0 means destroyed).
 */
export interface Building {
  readonly id: number;
  readonly type: BuildingType;
  owner: PlayerId;
  readonly tile: number;
  /** The level that works now: 0 while first being built, else 1..3. */
  level: number;
  /** The level being built or upgraded to; equal to `level` when idle. */
  targetLevel: number;
  /** When the current construction or upgrade started and finishes (-1 when idle). */
  startTick: number;
  readyTick: number;
  /** Gold paid for the current construction or upgrade (cancelling refunds part of it). */
  paid: number;
  /**
   * Charges (Phase 2B: SAM interceptors, silo slots): the ticks at which spent charges are
   * back, ascending — they reload one at a time. Empty = every charge ready. See
   * systems/buildings.ts `readyCharges` / `spendCharge`.
   */
  reloads: number[];
  /**
   * Mission cooldowns (Phase 2B: an Airport's lift, its strike; a silo's warhead): the tick
   * each one ends, by mission slot. Missing or past = ready.
   */
  cooldowns: number[];
  /**
   * Struck by an air strike (2B.4): the building does nothing until this tick (no bonuses,
   * no shots, no missions). -1 = never struck.
   */
  disabledUntil: number;
}

/**
 * A suppression zone (GAME_DESIGN.md §3.17.7, 2B.4): an air strike on a point. Until
 * `untilTick`, `victim`'s land within `radius` tiles of `tile` has no working fortification
 * (walls hold nothing, flak is silent) and attacks taking it pay `attackLoss`× the losses.
 */
export interface Suppression {
  readonly tile: number;
  readonly radius: number;
  readonly victim: PlayerId;
  /** Who struck. */
  readonly by: PlayerId;
  readonly untilTick: number;
}

/**
 * A wall (GAME_DESIGN.md §3.17.6, D-024): tiles drawn through corner points, built and
 * upgraded as a whole. Tiles that change hands break (world.wallAt forgets them).
 */
export interface Wall {
  readonly id: number;
  readonly owner: PlayerId;
  /** The corner points it was drawn through (A, B, C …). */
  readonly points: readonly number[];
  /** Every tile it was built on, in order; those still standing have wallAt = id. */
  readonly tiles: readonly number[];
  /** Tiles still standing. */
  intact: number;
  /** Working level: 0 while first being built, else 1..3. */
  level: number;
  /** Level being built or upgraded to (= level when idle). */
  targetLevel: number;
  /** Current construction or upgrade: start and finish ticks (-1 when idle). */
  startTick: number;
  readyTick: number;
  /** Gold paid for it (cancelling refunds part). */
  paid: number;
}

/**
 * A boat at sea (GAME_DESIGN.md §3.18): troops sailing from the owner's coast to a landing
 * tile across the water. Its position is a pure function of the tick (see naval.ts), so
 * nothing moves it tick by tick.
 */
export interface Boat {
  readonly id: number;
  readonly owner: PlayerId;
  /** Who owned the landing tile at launch (0 = neutral land). */
  readonly target: PlayerId;
  /** Troops aboard (they count toward the owner's capacity, like an army in the field). */
  readonly troops: number;
  /** The owner's coast tile it left from, and the coast tile it lands on. */
  readonly launchTile: number;
  readonly landingTile: number;
  /** The tile clicked: where the beachhead attack aims. */
  readonly focusTile: number;
  /** Sea tiles from the launch coast to the landing coast, in order. Never changed. */
  readonly route: Int32Array;
  readonly launchTick: number;
  /** Route tiles sailed per tick (faster from a Port). */
  readonly tilesPerTick: number;
  /** Losses per tile of its beachhead attack, as a share (Marines < 1). */
  readonly lossFactor: number;
  /** When it lands — or, recalled, when it is back home. */
  arriveTick: number;
  /** Tick it was recalled and turned back, or -1. */
  recallTick: number;
}

/**
 * A trade ship (GAME_DESIGN.md §3.19): sails from one player's Port to another player's
 * Port; when it docks, both owners earn `gold`. Like a boat, its position is a pure
 * function of the tick. Owner and destination are mutable so warships (2B.6) can capture it.
 */
export interface TradeShip {
  readonly id: number;
  owner: PlayerId;
  /** The Port it left from (building id) and the one it sails for. */
  readonly fromPort: number;
  toPort: number;
  /** Coast tiles of the two Ports. */
  readonly launchTile: number;
  readonly landingTile: number;
  /** Sea tiles from Port to Port, in order. */
  readonly route: Int32Array;
  readonly launchTick: number;
  readonly tilesPerTick: number;
  readonly arriveTick: number;
  /** Gold each side earns when it docks. */
  readonly gold: number;
  /**
   * Taken by a warship (2B.6): it sails for the captor's Port, and whoever owns that Port when
   * it docks gets the cargo (`gold`) — no one else. A captured ship can't be taken again.
   */
  readonly captured?: boolean;
}

/**
 * A warship (GAME_DESIGN.md §3.18.1, 2B.6, D-031): one of a Naval Base's patrol. It sails in
 * legs — from `fromTile` over `route` to `toTile`, leaving at `legTick` at
 * rules.warships.tilesPerTick — so, like a boat, its position follows from the tick. A sunk
 * warship stays on the list, "in the shipyard", until `readyTick`.
 */
export interface Warship {
  readonly id: number;
  owner: PlayerId;
  /** The Naval Base (building id) it belongs to. */
  readonly base: number;
  hp: number;
  /** The current leg (`fromTile` = `toTile` and an empty route: lying still). */
  fromTile: number;
  route: Int32Array;
  toTile: number;
  legTick: number;
  /** Sunk (or scuttled): back at its Base at this tick; -1 = at sea. */
  readyTick: number;
  /** It may fire again from this tick on. */
  reloadTick: number;
  /** What it is after: a boat, a warship or a trade ship (by id); "" = patrolling. */
  targetKind: "" | "boat" | "warship" | "trade";
  targetId: number;
  /** Where its owner sent it (a sea tile) — it patrols around there; -1 = around its Base. */
  patrolTile: number;
}

/**
 * What a flight is (GAME_DESIGN.md §3.17.7): "test" (a debug flight of empty transports,
 * 2B.0), "airlift" (troops to a friend, 2B.1), "return" (an airlift's troops that didn't
 * fit, flying home), "assault" (an airborne assault onto an enemy's land, 2B.3) and "strike"
 * (a fighter wing hitting a building or suppressing a point, 2B.4); missiles from a Silo
 * (2B.5): "missile" (the strike missile), "buster" (bunker buster) and "warhead" (strategic).
 */
export type FlightKind =
  "test" | "airlift" | "return" | "assault" | "strike" | "missile" | "buster" | "warhead";

/** The missile kinds (GAME_DESIGN.md §3.17.8): a Silo fires these. */
export type MissileKind = "missile" | "buster" | "warhead";

/**
 * Scorched land (GAME_DESIGN.md §3.17.8, 2B.5): where a strategic warhead struck. Until
 * `untilTick`, neutral land within `radius` tiles of `tile` costs rules.flights.scorchedCost×
 * the troops to expand into.
 */
export interface Scorched {
  readonly tile: number;
  readonly radius: number;
  /** Who launched the warhead. */
  readonly by: PlayerId;
  readonly untilTick: number;
}

/**
 * A flight (GAME_DESIGN.md §3.17.7, ARCHITECTURE.md §5.7): a group of planes flying in a
 * straight line from `fromTile` to `toTile`. Its position is a pure function of the tick
 * (geometry.ts `pointAlong`), so nothing moves it tick by tick.
 */
export interface Flight {
  readonly id: number;
  readonly owner: PlayerId;
  readonly kind: FlightKind;
  /** The building it took off from, or -1 (test flights). */
  readonly source: number;
  /** That building's level at take-off (0: none) — a missile's blast grows with its Silo's. */
  readonly sourceLevel: number;
  readonly fromTile: number;
  readonly toTile: number;
  /** Who owned the target tile at launch (0 = neutral land or sea). */
  readonly target: PlayerId;
  /** Planes still flying (interceptions shoot them down one by one). */
  planes: number;
  /**
   * Escort fighters flying with it (an Air Base's lifts, 2B.4): interceptors and flak take
   * them first, so they shield the planes — they carry nothing and do nothing on arrival.
   */
  escorts: number;
  /** Troops aboard, all planes together (airlifts and assaults; 0 otherwise). */
  troops: number;
  readonly launchTick: number;
  /** It arrives over its target at this tick. */
  readonly arriveTick: number;
}

/**
 * A map ping (GAME_DESIGN.md §3.20): a marker a player drops for their allies and teammates
 * ("attack here", "defend here", "watch out"). Nations act on their friends' pings.
 */
export interface Ping {
  readonly id: number;
  readonly from: PlayerId;
  readonly tile: number;
  readonly kind: PingKind;
  /** Who owned the tile when it was pinged (0 = neutral land or sea). */
  readonly target: PlayerId;
  readonly tick: number;
  readonly expiresTick: number;
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
  /** Boats at sea, by ascending id (GAME_DESIGN.md §3.18). */
  boats: Boat[];
  nextBoatId: number;
  /** Trade ships at sea, by ascending id (GAME_DESIGN.md §3.19). */
  tradeShips: TradeShip[];
  nextTradeShipId: number;
  /** Warships (2B.6), by ascending id — sunk ones included, waiting in their shipyard. */
  warships: Warship[];
  nextWarshipId: number;
  /** Flights in the air, by ascending id (GAME_DESIGN.md §3.17.7). */
  flights: Flight[];
  nextFlightId: number;
  /** Suppression zones still in force, oldest first (air strikes on a point, 2B.4). */
  suppressions: Suppression[];
  /** Scorched land still in force, oldest first (strategic warheads, 2B.5). */
  scorched: Scorched[];
  /** Map pings still showing, oldest first (GAME_DESIGN.md §3.20). */
  pings: Ping[];
  nextPingId: number;
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
  /** Buildings, by ascending id (GAME_DESIGN.md §3.17). */
  buildings: Building[];
  nextBuildingId: number;
  /** Building id standing on each tile, or -1. Kept in sync by systems/buildings.ts. */
  readonly buildingAt: Int32Array;
  /**
   * Tiles with a building whose owner changed this tick (filled by setOwner); the buildings
   * system settles them once the tick's fighting is over. Not game state.
   */
  buildingTileChanges: number[];
  /** Walls (GAME_DESIGN.md §3.17.6, D-024), by ascending id. Changed only by systems/walls.ts. */
  walls: Wall[];
  nextWallId: number;
  /** Wall id standing on each tile (being built or working), or -1. */
  readonly wallAt: Int32Array;
  /** XOR of ownerTileHash(tile, wall id) over every wall tile (the walls' tiles in the hash). */
  wallHash: number;
  /** Bumped whenever a wall changes (frames reuse the last wall snapshots otherwise). */
  wallsVersion: number;
  /** Working wall level on each tile (0 = none or still being built): what attacks read. */
  readonly fortLevel: Uint8Array;
  /** Tiles whose wall level changed this tick (for the frame; may repeat). Not state. */
  readonly fortChanges: TileChangeLog;
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
  /**
   * Beachhead attacks (boats and airborne assaults): the tile the army lands on, -1 for
   * a land attack. A beachhead never merges with the land army against the same target,
   * and its front starts from that tile only.
   */
  readonly landingTile: number;
  /** Losses per tile as a share of normal (Marines 0.8; airborne 1.25; 1 for ordinary armies). */
  readonly lossFactor: number;
  /** A beachhead that came by air (an airborne assault, 2B.3) rather than by boat. */
  readonly airborne: boolean;
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
  const rules = setup.rules ?? DEFAULT_RULES;
  // Warships (2B.6) need each water tile's distance to land; it is derived from the map once
  // (~17 ms on the reference map) — here, while the game loads, not in the middle of a tick.
  if (rules.warships.enabled && rules.naval.enabled) shoreDistance(setup.map);
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
    tradeGold: 0,
    lastEmoteTick: -1,
    lastPingTick: -1,
    bonus: { capacity: 0, growth: 0, income: 0 },
    team: p.team ?? 0,
    encircleDirty: true,
    brain: p.kind === "bot" ? createBrain(p, rng) : null,
  }));
  return {
    tick: 0,
    phase: "spawn",
    playStartTick: -1,
    rules,
    map: setup.map,
    owner: new Uint16Array(setup.map.width * setup.map.height),
    players,
    rng,
    winner: null,
    winningTeam: 0,
    teamCount: Math.max(0, ...setup.players.map((p) => p.team ?? 0)),
    ownerHash: 0,
    attacks: [],
    boats: [],
    nextBoatId: 1,
    tradeShips: [],
    nextTradeShipId: 1,
    warships: [],
    nextWarshipId: 1,
    flights: [],
    nextFlightId: 1,
    suppressions: [],
    scorched: [],
    pings: [],
    nextPingId: 1,
    alliances: new Map(),
    allianceRequests: [],
    lastRequestTick: new Map(),
    lastDonationTick: new Map(),
    pendingCommands: [],
    nextAttackId: 1,
    buildings: [],
    nextBuildingId: 1,
    buildingAt: new Int32Array(setup.map.width * setup.map.height).fill(-1),
    buildingTileChanges: [],
    walls: [],
    nextWallId: 1,
    wallAt: new Int32Array(setup.map.width * setup.map.height).fill(-1),
    wallHash: 0,
    wallsVersion: 0,
    fortLevel: new Uint8Array(setup.map.width * setup.map.height),
    fortChanges: new TileChangeLog(),
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
  if (world.buildingAt[tile]! >= 0) world.buildingTileChanges.push(tile);
  if (world.wallAt[tile]! >= 0) breakWallTile(world, tile, newOwner);

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

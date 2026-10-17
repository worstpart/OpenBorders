/**
 * What one tick reports to the outside world (renderer, UI, tests, later the network).
 * Frames are self-contained copies: they never share memory with the live World, so a
 * host can post them across threads and a consumer can't corrupt the simulation.
 */
import type { SimEvent } from "./events.ts";
import { hashWorld } from "./stateHash.ts";
import { landNeighbors } from "./systems/attacks.ts";
import type { BuildingType, Difficulty } from "./rules.ts";
import type {
  Boat,
  BotTier,
  Flight,
  FlightKind,
  Phase,
  Ping,
  PlayerId,
  PlayerKind,
  Scorched,
  Suppression,
  TradeShip,
  Warship,
  World,
} from "./world.ts";

export interface PlayerSnapshot {
  readonly id: PlayerId;
  readonly name: string;
  readonly kind: PlayerKind;
  readonly alive: boolean;
  readonly spawned: boolean;
  readonly ready: boolean;
  readonly tiles: number;
  readonly homeTroops: number;
  readonly fieldTroops: number;
  readonly capacity: number;
  readonly growthPerTick: number;
  /** Gold, and gold earned in the last tick (GAME_DESIGN.md §3.16). */
  readonly gold: number;
  readonly goldPerTick: number;
  /** Gold earned from trade ships so far (GAME_DESIGN.md §3.19). */
  readonly tradeGold: number;
  /** Troop capacity from Housing (included in capacity; D-033 shows it apart). */
  readonly capacityBonus: number;
  /** Troop growth bonus from Housing, a share. */
  readonly growthBonus: number;
  readonly peakTiles: number;
  /** Bots only: nation or tribe (GAME_DESIGN.md §3.13). */
  readonly tier: BotTier | null;
  /** Nations only. */
  readonly personality: string | null;
  /** Nations only. */
  readonly difficulty: Difficulty | null;
  /** Tick the player was eliminated, or -1. */
  readonly eliminatedTick: number;
  /** A traitor until this tick (compare with the frame's tick); -1 = never. */
  readonly traitorUntilTick: number;
  /** Alliances this player has broken. */
  readonly betrayals: number;
  /** Team number, or 0 = no team (GAME_DESIGN.md §3.15). */
  readonly team: number;
  /**
   * Whose land touches this player's (0 = neutral), ascending — what a click can reach.
   * Humans only (the HUD needs it); null for bots, to save the work every tick.
   */
  readonly neighbors: readonly PlayerId[] | null;
}

export interface AttackSnapshot {
  readonly id: number;
  readonly attacker: PlayerId;
  /** 0 = expanding into neutral land. */
  readonly target: PlayerId;
  readonly troops: number;
  readonly tilesTaken: number;
  readonly focusTile: number;
  readonly retreating: boolean;
  /** A beachhead (boat landing): the tile it landed on; -1 for a land attack. */
  readonly landingTile: number;
  /** The beachhead came by air (an airborne assault, 2B.3). */
  readonly airborne: boolean;
}

/**
 * A boat at sea (GAME_DESIGN.md §3.18). Its route never changes, so the snapshot (and its
 * copy of the route) is made once per boat and shared between frames until it is recalled.
 */
export interface BoatSnapshot {
  readonly id: number;
  readonly owner: PlayerId;
  /** Whose coast it sails for (0 = neutral land). */
  readonly target: PlayerId;
  readonly troops: number;
  readonly launchTile: number;
  readonly landingTile: number;
  readonly focusTile: number;
  /** Sea tiles from the launch coast to the landing coast. */
  readonly route: Int32Array;
  readonly launchTick: number;
  readonly tilesPerTick: number;
  /** Lands (or, recalled, is back home) at this tick. */
  readonly arriveTick: number;
  /** Tick it turned back, or -1. */
  readonly recallTick: number;
}

/**
 * A trade ship at sea (GAME_DESIGN.md §3.19). Made once per ship (and again if its owner or
 * destination changes) and shared between frames.
 */
export interface TradeShipSnapshot {
  readonly id: number;
  readonly owner: PlayerId;
  readonly fromPort: number;
  readonly toPort: number;
  readonly launchTile: number;
  readonly landingTile: number;
  readonly route: Int32Array;
  readonly launchTick: number;
  readonly tilesPerTick: number;
  readonly arriveTick: number;
  readonly gold: number;
  /** Taken by a warship (2B.6): sailing for the captor's Port. */
  readonly captured: boolean;
}

/**
 * A warship (GAME_DESIGN.md §3.18.1, 2B.6). Its position follows from its leg and the tick
 * (systems/warships.ts warshipTile), like a boat's. Made again when its leg, health, owner or
 * shipyard state changes; shared between frames otherwise.
 */
export interface WarshipSnapshot {
  readonly id: number;
  readonly owner: PlayerId;
  /** Its Naval Base (building id). */
  readonly base: number;
  readonly hp: number;
  readonly fromTile: number;
  readonly route: Int32Array;
  readonly toTile: number;
  readonly legTick: number;
  readonly tilesPerTick: number;
  /** In the shipyard (sunk) until this tick; -1 = at sea. */
  readonly readyTick: number;
  /** What it is after ("" = patrolling). */
  readonly targetKind: "" | "boat" | "warship" | "trade";
  /** Where its owner sent it (it patrols there); -1 = around its Base. */
  readonly patrolTile: number;
}

/** A building (GAME_DESIGN.md §3.17). */
export interface BuildingSnapshot {
  readonly id: number;
  readonly type: BuildingType;
  readonly owner: PlayerId;
  readonly tile: number;
  /** Working level (0 while first being built). */
  readonly level: number;
  /** Level being built or upgraded to (= level when idle). */
  readonly targetLevel: number;
  /** Current construction/upgrade: start and finish ticks (-1 when idle). */
  readonly startTick: number;
  readonly readyTick: number;
  /** Phase 2B: when spent charges are back (ascending), and each mission's cooldown end. */
  readonly reloads: readonly number[];
  readonly cooldowns: readonly number[];
  /** Struck by an air strike: it does nothing until this tick (2B.4; -1 = never struck). */
  readonly disabledUntil: number;
}

/**
 * A flight in the air (GAME_DESIGN.md §3.17.7). Its position follows from the tick
 * (systems/flights.ts flightPoint). Made once per flight and shared between frames until
 * planes are shot down.
 */
export interface FlightSnapshot {
  readonly id: number;
  readonly owner: PlayerId;
  readonly kind: FlightKind;
  /** The building it took off from, or -1 (test flights). */
  readonly source: number;
  /** That building's level at take-off (0: none). */
  readonly sourceLevel: number;
  /** Who owned the target tile at launch (0 = neutral land or sea). */
  readonly target: PlayerId;
  readonly fromTile: number;
  readonly toTile: number;
  readonly planes: number;
  /** Escort fighters flying with it (an Air Base's lifts, 2B.4). */
  readonly escorts: number;
  readonly troops: number;
  readonly launchTick: number;
  readonly arriveTick: number;
}

/** A wall (GAME_DESIGN.md §3.17.6). Snapshots are shared between frames until it changes. */
export interface WallSnapshot {
  readonly id: number;
  readonly owner: PlayerId;
  /** Corner points (tiles) it was drawn through. */
  readonly points: readonly number[];
  /** Tiles still standing. */
  readonly tiles: readonly number[];
  readonly level: number;
  readonly targetLevel: number;
  readonly startTick: number;
  readonly readyTick: number;
}

/** A map ping still showing (GAME_DESIGN.md §3.20). Clients show only their friends' pings. */
export type PingSnapshot = Ping;

export interface AllianceSnapshot {
  /** The lower player id and the higher one. */
  readonly a: PlayerId;
  readonly b: PlayerId;
  readonly expiresTick: number;
  /** Who has agreed to renew during the renewal window. */
  readonly renewA: boolean;
  readonly renewB: boolean;
}

export interface AllianceRequestSnapshot {
  readonly from: PlayerId;
  readonly to: PlayerId;
  readonly expiresTick: number;
}

export interface TickFrame {
  readonly tick: number;
  readonly phase: Phase;
  readonly playStartTick: number;
  /** Tiles whose owner changed this tick, and each one's owner after the tick. */
  readonly changedTiles: Int32Array;
  readonly changedOwners: Uint16Array;
  /**
   * Tiles whose working wall level changed this tick, and each one's level after the tick
   * (0–3, GAME_DESIGN.md §3.17.6).
   */
  readonly fortTiles: Int32Array;
  readonly fortLevels: Uint8Array;
  readonly players: readonly PlayerSnapshot[];
  readonly attacks: readonly AttackSnapshot[];
  readonly alliances: readonly AllianceSnapshot[];
  readonly allianceRequests: readonly AllianceRequestSnapshot[];
  /** Every building, by ascending id. */
  readonly buildings: readonly BuildingSnapshot[];
  /** Every wall, by ascending id. */
  readonly walls: readonly WallSnapshot[];
  /** Every boat at sea, by ascending id. */
  readonly boats: readonly BoatSnapshot[];
  /** Every trade ship at sea, by ascending id. */
  readonly tradeShips: readonly TradeShipSnapshot[];
  /** Every flight in the air, by ascending id. */
  readonly flights: readonly FlightSnapshot[];
  /** Every warship (sunk ones in their shipyard too), by ascending id (2B.6). */
  readonly warships: readonly WarshipSnapshot[];
  /** Suppression zones in force (air strikes on a point, 2B.4), oldest first. */
  readonly suppressions: readonly Suppression[];
  /** Scorched land in force (strategic warheads, 2B.5), oldest first. */
  readonly scorched: readonly Scorched[];
  /** Map pings still showing, oldest first. */
  readonly pings: readonly PingSnapshot[];
  readonly events: readonly SimEvent[];
  readonly winner: PlayerId | null;
  /** Team games: the team that won (0 = none). */
  readonly winningTeam: number;
  /** Hash of the full game state after this tick. */
  readonly hash: number;
}

export function snapshotPlayers(world: World): PlayerSnapshot[] {
  return world.players.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    alive: p.alive,
    spawned: p.spawnTile >= 0,
    ready: p.ready,
    tiles: p.tiles,
    homeTroops: p.homeTroops,
    fieldTroops: p.fieldTroops,
    capacity: p.capacity,
    growthPerTick: p.lastGrowth,
    gold: p.gold,
    goldPerTick: p.lastIncome,
    tradeGold: p.tradeGold,
    capacityBonus: p.bonus.capacity,
    growthBonus: p.bonus.growth,
    peakTiles: p.peakTiles,
    tier: p.brain?.tier ?? null,
    personality: p.brain?.tier === "nation" ? p.brain.personality : null,
    difficulty: p.brain?.tier === "nation" ? p.brain.difficulty : null,
    eliminatedTick: p.eliminatedTick,
    traitorUntilTick: p.traitorUntilTick,
    betrayals: p.betrayals,
    team: p.team,
    neighbors: p.kind === "human" && p.alive ? landNeighbors(world, p) : null,
  }));
}

const wallCache = new WeakMap<World, { version: number; walls: readonly WallSnapshot[] }>();

/** Wall snapshots, rebuilt only when a wall changed (they are immutable, so frames share them). */
function snapshotWalls(world: World): readonly WallSnapshot[] {
  const cached = wallCache.get(world);
  if (cached && cached.version === world.wallsVersion) return cached.walls;
  const walls = world.walls.map((w) => ({
    id: w.id,
    owner: w.owner,
    points: w.points.slice(),
    tiles: w.tiles.filter((t) => world.wallAt[t] === w.id),
    level: w.level,
    targetLevel: w.targetLevel,
    startTick: w.startTick,
    readyTick: w.readyTick,
  }));
  wallCache.set(world, { version: world.wallsVersion, walls });
  return walls;
}

const boatCache = new WeakMap<Boat, { recallTick: number; snapshot: BoatSnapshot }>();

function snapshotBoat(boat: Boat): BoatSnapshot {
  const cached = boatCache.get(boat);
  if (cached && cached.recallTick === boat.recallTick) return cached.snapshot;
  const snapshot: BoatSnapshot = {
    id: boat.id,
    owner: boat.owner,
    target: boat.target,
    troops: boat.troops,
    launchTile: boat.launchTile,
    landingTile: boat.landingTile,
    focusTile: boat.focusTile,
    route: cached?.snapshot.route ?? boat.route.slice(),
    launchTick: boat.launchTick,
    tilesPerTick: boat.tilesPerTick,
    arriveTick: boat.arriveTick,
    recallTick: boat.recallTick,
  };
  boatCache.set(boat, { recallTick: boat.recallTick, snapshot });
  return snapshot;
}

const tradeCache = new WeakMap<TradeShip, TradeShipSnapshot>();

function snapshotTradeShip(ship: TradeShip): TradeShipSnapshot {
  const cached = tradeCache.get(ship);
  if (cached && cached.owner === ship.owner && cached.toPort === ship.toPort) return cached;
  const snapshot: TradeShipSnapshot = {
    id: ship.id,
    owner: ship.owner,
    fromPort: ship.fromPort,
    toPort: ship.toPort,
    launchTile: ship.launchTile,
    landingTile: ship.landingTile,
    route: cached?.route ?? ship.route.slice(),
    launchTick: ship.launchTick,
    tilesPerTick: ship.tilesPerTick,
    arriveTick: ship.arriveTick,
    gold: ship.gold,
    captured: ship.captured === true,
  };
  tradeCache.set(ship, snapshot);
  return snapshot;
}

const warshipCache = new WeakMap<Warship, WarshipSnapshot>();

function snapshotWarship(ship: Warship, tilesPerTick: number): WarshipSnapshot {
  const cached = warshipCache.get(ship);
  if (
    cached &&
    cached.legTick === ship.legTick &&
    cached.fromTile === ship.fromTile &&
    cached.toTile === ship.toTile &&
    cached.route.length === ship.route.length &&
    cached.hp === ship.hp &&
    cached.owner === ship.owner &&
    cached.readyTick === ship.readyTick &&
    cached.targetKind === ship.targetKind &&
    cached.patrolTile === ship.patrolTile
  )
    return cached;
  const snapshot: WarshipSnapshot = {
    id: ship.id,
    owner: ship.owner,
    base: ship.base,
    hp: ship.hp,
    fromTile: ship.fromTile,
    route: ship.route.slice(),
    toTile: ship.toTile,
    legTick: ship.legTick,
    tilesPerTick,
    readyTick: ship.readyTick,
    targetKind: ship.targetKind,
    patrolTile: ship.patrolTile,
  };
  warshipCache.set(ship, snapshot);
  return snapshot;
}

const NO_WARSHIPS: readonly WarshipSnapshot[] = Object.freeze([]);

const flightCache = new WeakMap<Flight, FlightSnapshot>();

function snapshotFlight(flight: Flight): FlightSnapshot {
  const cached = flightCache.get(flight);
  if (cached && cached.planes === flight.planes && cached.escorts === flight.escorts) return cached;
  const snapshot: FlightSnapshot = {
    id: flight.id,
    owner: flight.owner,
    kind: flight.kind,
    source: flight.source,
    sourceLevel: flight.sourceLevel,
    target: flight.target,
    fromTile: flight.fromTile,
    toTile: flight.toTile,
    planes: flight.planes,
    escorts: flight.escorts,
    troops: flight.troops,
    launchTick: flight.launchTick,
    arriveTick: flight.arriveTick,
  };
  flightCache.set(flight, snapshot);
  return snapshot;
}

const NONE: readonly number[] = Object.freeze([]);
const NO_ZONES: readonly Suppression[] = Object.freeze([]);
const NO_SCORCHED: readonly Scorched[] = Object.freeze([]);

export function buildFrame(world: World): TickFrame {
  const changedTiles = world.changes.toArray();
  const changedOwners = new Uint16Array(changedTiles.length);
  for (let k = 0; k < changedTiles.length; k++) changedOwners[k] = world.owner[changedTiles[k]!]!;
  const fortTiles = world.fortChanges.toArray();
  const fortLevels = new Uint8Array(fortTiles.length);
  for (let k = 0; k < fortTiles.length; k++) fortLevels[k] = world.fortLevel[fortTiles[k]!]!;
  return {
    tick: world.tick,
    phase: world.phase,
    playStartTick: world.playStartTick,
    changedTiles,
    changedOwners,
    fortTiles,
    fortLevels,
    players: snapshotPlayers(world),
    attacks: world.attacks.map((a) => ({
      id: a.id,
      attacker: a.attacker,
      target: a.target,
      troops: a.troops,
      tilesTaken: a.tilesTaken,
      focusTile: a.focusTile,
      retreating: a.retreatTick >= 0,
      landingTile: a.landingTile,
      airborne: a.airborne,
    })),
    alliances: [...world.alliances.values()].map((a) => ({
      a: a.a,
      b: a.b,
      expiresTick: a.expiresTick,
      renewA: a.renewA,
      renewB: a.renewB,
    })),
    allianceRequests: world.allianceRequests.map((r) => ({ ...r })),
    buildings: world.buildings.map((b) => ({
      id: b.id,
      type: b.type,
      owner: b.owner,
      tile: b.tile,
      level: b.level,
      targetLevel: b.targetLevel,
      startTick: b.startTick,
      readyTick: b.readyTick,
      reloads: b.reloads.length > 0 ? b.reloads.slice() : NONE,
      cooldowns: b.cooldowns.length > 0 ? b.cooldowns.slice() : NONE,
      disabledUntil: b.disabledUntil,
    })),
    walls: snapshotWalls(world),
    boats: world.boats.map(snapshotBoat),
    tradeShips: world.tradeShips.map(snapshotTradeShip),
    flights: world.flights.map(snapshotFlight),
    warships:
      world.warships.length > 0
        ? world.warships.map((w) => snapshotWarship(w, world.rules.warships.tilesPerTick))
        : NO_WARSHIPS,
    suppressions:
      world.suppressions.length > 0 ? world.suppressions.map((z) => ({ ...z })) : NO_ZONES,
    scorched: world.scorched.length > 0 ? world.scorched.map((z) => ({ ...z })) : NO_SCORCHED,
    pings: world.pings.map((p) => ({ ...p })),
    events: world.events.slice(),
    winner: world.winner,
    winningTeam: world.winningTeam,
    hash: hashWorld(world),
  };
}

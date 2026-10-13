/**
 * Flights (GAME_DESIGN.md §3.17.7, ARCHITECTURE.md §5.7, milestone 2B.0).
 *
 *  - Every air action is a flight: planes flying in a straight line from where they took
 *    off to their target at a fixed speed (by kind of plane), visible to everyone, with an
 *    ETA. Nothing is instant.
 *  - A flight's position is a pure function of the tick (`flightPoint`), so it stores no
 *    movement state: the client animates it from the snapshot alone, and SAMs (2B.2) ask
 *    where it is with `flightTile`.
 *  - `shootDown` is the one place planes are lost (SAMs 2B.2, Fortress Wall flak 2B.3): a
 *    plane shot down takes its share of the troops aboard with it.
 *  - Flak (Fortress Wall, 2B.3): after the SAMs, each flight (id order) that has just flown
 *    into the reach (`flakRadius`) of a hostile Fortress Wall — inside it now, not a tick ago —
 *    loses one plane to each such wall (id order). Stateless: a flight is shot at again only
 *    if it leaves the reach and comes back.
 *  - SAMs (2B.2, the one rule of §3.17.7): every tick, before arrivals, each flight (in id
 *    order) is checked against the SAMs (in id order) of every player who isn't a friend of
 *    its owner — the target's and any third player's alike (airspace matters). A working SAM
 *    whose radius holds the tile the flight is over, with an interceptor ready, fires one:
 *    it always destroys one plane (no dice). Each SAM fires at most once a tick and each
 *    interceptor kills exactly one plane, so overlapping SAMs add interceptors, never
 *    multipliers; more planes than interceptors get through.
 *  - Arrivals act by kind: airlift → the friend's home troops, what doesn't fit under their
 *    capacity flies back ("return" → the owner's home troops) — 2B.1; assault → a beachhead
 *    attack (2B.3); strike → a building loses a level and stops working for a while, or a
 *    point is suppressed (2B.4); a missile hits buildings or scorches land (missiles.ts,
 *    2B.5). Test flights (debug, rules.flights.testFlights) do nothing when they arrive.
 *  - Missiles (2B.5) are flights of one "plane": only SAMs that can stop that kind of missile
 *    shoot at them (II+: conventional, III: the warhead), and flak ignores them.
 *  - Air strike (Air Base, Airport III, 2B.4): a wing of fighters from the Air Base to an
 *    enemy's tile in range, on its own cooldown (slot 1). Over the target: if an enemy
 *    building stands on the tile, it loses a level when at least `strikeDamagePlanes`
 *    fighters arrive (a level-I building is destroyed) and is disabled for
 *    `strikeDisableTicks` either way; otherwise the enemy's land around the tile is suppressed
 *    (suppression.ts). An Air Base's lifts and assaults also fly with escort fighters, which
 *    the SAMs and flak shoot down first.
 *  - A disabled building (buildings.ts `working`) does nothing: a struck SAM doesn't fire, a
 *    struck Airport flies no mission.
 *  - Airlift (Airport I, D-023): the only way to send troops to a friend you don't border —
 *    the send share of your home troops, capped by the Airport's lift capacity (a share of
 *    your troop capacity), to any land of an ally or teammate within its range; then the
 *    Airport's mission cooldown (slot 0) runs.
 *  - Airborne assault (Airport II, 2B.3): the same lift, but onto an enemy's land. On arrival
 *    the troops land as a beachhead attack (the boats' landing, 2.7) from the tile they were
 *    sent to, paying `airborneLoss`× the normal losses per tile; its pocket can't be encircled
 *    while it advances. If that tile became the owner's own meanwhile, the troops just join
 *    the home troops; a friend's, they fly back. Assaults and airlifts share the cooldown.
 *
 * Troops aboard count as field troops, like an army or a boat (updateFieldTroops).
 */
import {
  distance,
  distanceSq,
  pointAlong,
  tileAlong,
  travelTicks,
  withinRange,
} from "../geometry.ts";
import type { GameMap } from "../map/gameMap.ts";
import type { GameRules } from "../rules.ts";
import {
  getPlayer,
  NEUTRAL,
  type Building,
  type Flight,
  type FlightKind,
  type MissileKind,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";
import { launchBeachhead, updateFieldTroops } from "./attacks.ts";
import {
  buildingsEnabled,
  findBuilding,
  levelRules,
  producedTicks,
  readyCharges,
  spendCharge,
  startCooldown,
  strikeBuilding,
  working,
} from "./buildings.ts";
import { areFriendly } from "./diplomacy.ts";
import { troopRoom } from "./economy.ts";
import { hostileTarget } from "./naval.ts";
import { isMissile, landMissile, samStops } from "./missiles.ts";
import { isSuppressed, suppress } from "./suppression.ts";

/** The kinds of plane, which set a flight's speed (GAME_DESIGN.md §3.17.7). */
export type PlaneType = "transport" | "fighter" | "missile";

/** Tiles per tick of a kind of plane. */
export function planeSpeed(rules: GameRules, plane: PlaneType): number {
  const f = rules.flights;
  return plane === "transport"
    ? f.transportTilesPerTick
    : plane === "fighter"
      ? f.fighterTilesPerTick
      : f.missileTilesPerTick;
}

/** Ticks a flight of `plane`s takes from tile `from` to tile `to` (straight line). */
export function flightTicks(
  rules: GameRules,
  map: GameMap,
  from: number,
  to: number,
  plane: PlaneType,
): number {
  return travelTicks(distance(map, from, to), planeSpeed(rules, plane));
}

/** What a flight's position depends on (flights and their frame snapshots both have it). */
export interface FlightPath {
  readonly fromTile: number;
  readonly toTile: number;
  readonly launchTick: number;
  readonly arriveTick: number;
}

/**
 * How far along its line a flight is at `tick`, 0 (just took off) to 1 (over its target).
 * The client passes fractional ticks to animate between them.
 */
export function flightProgress(flight: FlightPath, tick: number): number {
  const total = flight.arriveTick - flight.launchTick;
  if (total <= 0 || tick >= flight.arriveTick) return 1;
  if (tick <= flight.launchTick) return 0;
  return (tick - flight.launchTick) / total;
}

/** Where a flight is at `tick`, in tile coordinates (see geometry.ts pointAlong). */
export function flightPoint(
  map: GameMap,
  flight: FlightPath,
  tick: number,
): { readonly x: number; readonly y: number } {
  return pointAlong(map, flight.fromTile, flight.toTile, flightProgress(flight, tick));
}

/** The tile a flight is over at `tick` (what SAM coverage checks, 2B.2). */
export function flightTile(map: GameMap, flight: FlightPath, tick: number): number {
  return tileAlong(map, flight.fromTile, flight.toTile, flightProgress(flight, tick));
}

export interface FlightLaunch {
  readonly owner: PlayerId;
  readonly kind: FlightKind;
  /** The building it takes off from (-1: none). */
  readonly source: number;
  readonly fromTile: number;
  readonly toTile: number;
  readonly plane: PlaneType;
  readonly planes: number;
  /** Escort fighters flying with it (an Air Base's lifts, 2B.4); none if left out. */
  readonly escorts?: number;
  /** Troops aboard (taken from the owner's home troops by the caller). */
  readonly troops: number;
}

/** Puts a flight in the air now. Callers validate the mission first. */
export function launchFlight(world: World, launch: FlightLaunch): Flight {
  const flight: Flight = {
    id: world.nextFlightId++,
    owner: launch.owner,
    kind: launch.kind,
    source: launch.source,
    fromTile: launch.fromTile,
    toTile: launch.toTile,
    target: world.owner[launch.toTile]!,
    planes: launch.planes,
    escorts: launch.escorts ?? 0,
    troops: launch.troops,
    launchTick: world.tick,
    arriveTick:
      world.tick +
      flightTicks(world.rules, world.map, launch.fromTile, launch.toTile, launch.plane),
  };
  world.flights.push(flight);
  if (flight.troops > 0) updateFieldTroops(world);
  world.events.push({
    type: "flightLaunched",
    flightId: flight.id,
    owner: flight.owner,
    kind: flight.kind,
    target: flight.target,
    fromTile: flight.fromTile,
    toTile: flight.toTile,
    planes: flight.planes,
    escorts: flight.escorts,
    troops: flight.troops,
    arriveTick: flight.arriveTick,
  });
  return flight;
}

/**
 * Handles `testFlight` (DEBUG, rules.flights.testFlights): empty transports from a tile of
 * yours to any tile. They do nothing when they arrive.
 */
export function applyTestFlight(
  world: World,
  player: Player,
  fromTile: number,
  toTile: number,
): string | null {
  const rules = world.rules;
  if (!rules.flights.testFlights) return "test flights are off in this game";
  if (world.phase !== "playing") return "the match hasn't started";
  const size = world.owner.length;
  if (!Number.isInteger(fromTile) || fromTile < 0 || fromTile >= size) return "invalid tile";
  if (!Number.isInteger(toTile) || toTile < 0 || toTile >= size) return "invalid tile";
  if (world.owner[fromTile] !== player.id) return "a flight takes off from your own land";
  if (fromTile === toTile) return "the target is where the flight takes off";
  launchFlight(world, {
    owner: player.id,
    kind: "test",
    source: -1,
    fromTile,
    toTile,
    plane: "transport",
    planes: rules.flights.testFlightPlanes,
    troops: 0,
  });
  return null;
}

/** An Airport as the airlift rules see it (a building or its frame snapshot). */
export interface AirportLike {
  readonly type: string;
  readonly level: number;
  readonly tile: number;
  readonly cooldowns: readonly number[];
  /** Struck by an air strike: no missions until this tick (2B.4). */
  readonly disabledUntil: number;
}

/** The airlift mission's cooldown slot on an Airport (airborne assaults share it). */
export const AIRLIFT_SLOT = 0;

/** Why an airlift can't go to `tile` now, or null. Shared with the HUD and the nations. */
export type AirliftProblem = "notReady" | "disabled" | "cooldown" | "notFriend" | "outOfRange";

export const AIRLIFT_PROBLEM_TEXT: Record<AirliftProblem, string> = {
  notReady: "the Airport isn't ready yet",
  disabled: "the Airport was hit by an air strike",
  cooldown: "the Airport is still on cooldown",
  notFriend: "airlifts go to an ally's or teammate's land",
  outOfRange: "out of the Airport's range",
};

/** Ticks until an Airport can airlift again (0 = ready). */
export function airliftCooldownLeft(airport: AirportLike, tick: number): number {
  return Math.max(0, (airport.cooldowns[AIRLIFT_SLOT] ?? -1) - tick);
}

/** An Airport's range in tiles at its working level (0 while first being built). */
export function airportRange(rules: GameRules, airport: AirportLike): number {
  return airport.level >= 1 ? (levelRules(rules, "airport", airport.level).range ?? 0) : 0;
}

/**
 * Whether an airlift may fly from `airport` to `tile` at `tick`; `friendly` says whether
 * the tile's owner is a living ally or teammate of the Airport's owner.
 */
export function airliftProblem(
  rules: GameRules,
  map: GameMap,
  airport: AirportLike,
  tick: number,
  tile: number,
  friendly: boolean,
): AirliftProblem | null {
  if (airport.type !== "airport" || airport.level < 1) return "notReady";
  if (!working(airport, tick)) return "disabled";
  if (airliftCooldownLeft(airport, tick) > 0) return "cooldown";
  if (!friendly) return "notFriend";
  if (!withinRange(map, airport.tile, tile, airportRange(rules, airport))) return "outOfRange";
  return null;
}

/** The most troops an Airport lifts at once: its share of the owner's troop capacity. */
export function airliftCapacity(rules: GameRules, level: number, capacity: number): number {
  if (level < 1) return 0;
  return Math.floor(capacity * (levelRules(rules, "airport", level).liftShare ?? 0));
}

/** Troops an airlift of `percentBp` of your home troops carries (capped by the Airport). */
export function airliftTroops(
  rules: GameRules,
  level: number,
  player: { readonly homeTroops: number; readonly capacity: number },
  percentBp: number,
): number {
  const wanted = Math.floor((player.homeTroops * percentBp) / 10_000);
  return Math.max(0, Math.min(wanted, airliftCapacity(rules, level, player.capacity)));
}

/**
 * Handles `airlift` (GAME_DESIGN.md §3.17.7): `percentBp` of your home troops (capped by the
 * Airport's capacity) fly from your Airport to a friend's land at `tile`.
 */
export function applyAirlift(
  world: World,
  player: Player,
  buildingId: number,
  tile: number,
  percentBp: number,
): string | null {
  const rules = world.rules;
  if (!rules.flights.enabled || !buildingsEnabled(rules)) {
    return "there are no flights in this game";
  }
  if (world.phase !== "playing") return "the match hasn't started";
  if (!Number.isInteger(percentBp) || percentBp < 1 || percentBp > 10_000) {
    return "invalid percentage";
  }
  const airport = findBuilding(world, buildingId);
  if (!airport || airport.owner !== player.id || airport.type !== "airport") {
    return "not your Airport";
  }
  if (!Number.isInteger(tile) || tile < 0 || tile >= world.owner.length) return "invalid tile";
  const problem = airliftProblem(
    rules,
    world.map,
    airport,
    world.tick,
    tile,
    isFriendOf(world, player.id, world.owner[tile]!),
  );
  if (problem) return AIRLIFT_PROBLEM_TEXT[problem];
  const troops = airliftTroops(rules, airport.level, player, percentBp);
  if (troops < 1) return "no troops to send";
  player.homeTroops -= troops;
  launchFlight(world, {
    owner: player.id,
    kind: "airlift",
    source: airport.id,
    fromTile: airport.tile,
    toTile: tile,
    plane: "transport",
    planes: rules.flights.airliftPlanes,
    escorts: escortsOf(rules, airport.level),
    troops,
  });
  startCooldown(
    airport,
    AIRLIFT_SLOT,
    world.tick,
    producedTicks(
      world,
      airport,
      levelRules(rules, "airport", airport.level).missionCooldownTicks ?? 0,
    ),
  );
  return null;
}

/** The Airport level that flies airborne assaults (Military Airport). */
export const ASSAULT_LEVEL = 2;

/** Why an assault can't go to `tile` now, or null. Shared with the HUD and the nations. */
export type AssaultProblem = "notReady" | "disabled" | "cooldown" | "notHostile" | "outOfRange";

export const ASSAULT_PROBLEM_TEXT: Record<AssaultProblem, string> = {
  notReady: "an airborne assault needs a Military Airport (level II)",
  disabled: "the Airport was hit by an air strike",
  cooldown: "the Airport is still on cooldown",
  notHostile: "assaults land on an enemy's land",
  outOfRange: "out of the Airport's range",
};

/**
 * Whether an airborne assault may fly from `airport` to `tile` at `tick`; `hostile` says
 * whether the tile belongs to a living player who isn't the owner or a friend of theirs.
 */
export function assaultProblem(
  rules: GameRules,
  map: GameMap,
  airport: AirportLike,
  tick: number,
  tile: number,
  hostile: boolean,
): AssaultProblem | null {
  if (airport.type !== "airport" || airport.level < ASSAULT_LEVEL) return "notReady";
  if (!working(airport, tick)) return "disabled";
  if (airliftCooldownLeft(airport, tick) > 0) return "cooldown";
  if (!hostile) return "notHostile";
  if (!withinRange(map, airport.tile, tile, airportRange(rules, airport))) return "outOfRange";
  return null;
}

/**
 * Handles `assault` (GAME_DESIGN.md §3.17.7, 2B.3): `percentBp` of your home troops (capped by
 * the Airport's lift capacity) fly from your Military Airport to an enemy's land at `tile`,
 * where they land as a beachhead attack.
 */
export function applyAssault(
  world: World,
  player: Player,
  buildingId: number,
  tile: number,
  percentBp: number,
): string | null {
  const rules = world.rules;
  if (!rules.flights.enabled || !buildingsEnabled(rules)) {
    return "there are no flights in this game";
  }
  if (world.phase !== "playing") return "the match hasn't started";
  if (!Number.isInteger(percentBp) || percentBp < 1 || percentBp > 10_000) {
    return "invalid percentage";
  }
  const airport = findBuilding(world, buildingId);
  if (!airport || airport.owner !== player.id || airport.type !== "airport") {
    return "not your Airport";
  }
  if (!Number.isInteger(tile) || tile < 0 || tile >= world.owner.length) return "invalid tile";
  const holder = world.owner[tile]!;
  // Own land, a friend's, a dead player's, or spawn protection: say exactly why.
  const why = holder === NEUTRAL ? null : hostileTarget(world, player, holder);
  if (why) return why;
  const problem = assaultProblem(rules, world.map, airport, world.tick, tile, holder !== NEUTRAL);
  if (problem) return ASSAULT_PROBLEM_TEXT[problem];
  const troops = airliftTroops(rules, airport.level, player, percentBp);
  if (troops < 1) return "no troops to send";
  player.homeTroops -= troops;
  launchFlight(world, {
    owner: player.id,
    kind: "assault",
    source: airport.id,
    fromTile: airport.tile,
    toTile: tile,
    plane: "transport",
    planes: rules.flights.assaultPlanes,
    escorts: escortsOf(rules, airport.level),
    troops,
  });
  startCooldown(
    airport,
    AIRLIFT_SLOT,
    world.tick,
    producedTicks(
      world,
      airport,
      levelRules(rules, "airport", airport.level).missionCooldownTicks ?? 0,
    ),
  );
  return null;
}

/**
 * An assault over its target: the troops land as a beachhead attack on the tile — unless it
 * is the owner's own now (they join the home troops) or a friend's (they fly back).
 */
function landAssault(world: World, flight: Flight): void {
  const player = getPlayer(world, flight.owner)!;
  const tile = flight.toTile;
  const holder = world.owner[tile]!;
  let attackId = -1;
  if (holder === player.id) {
    player.homeTroops += flight.troops;
  } else if (hostileTarget(world, player, holder) === null) {
    attackId = launchBeachhead(
      world,
      player,
      holder,
      tile,
      tile,
      flight.troops,
      world.rules.flights.airborneLoss,
      true,
    ).id;
  } else {
    launchFlight(world, {
      owner: flight.owner,
      kind: "return",
      source: flight.source,
      fromTile: flight.toTile,
      toTile: flight.fromTile,
      plane: "transport",
      planes: flight.planes,
      escorts: flight.escorts,
      troops: flight.troops,
    });
  }
  world.events.push({
    type: "assaultLanded",
    flightId: flight.id,
    owner: flight.owner,
    target: holder,
    tile,
    troops: flight.troops,
    attackId,
  });
}

/** Escort fighters an Airport of `level` sends with every lift and assault (Air Base: 2). */
export function escortsOf(rules: GameRules, level: number): number {
  return level >= 1 ? (levelRules(rules, "airport", level).escorts ?? 0) : 0;
}

/** The Airport level that flies air strikes (Air Base). */
export const STRIKE_LEVEL = 3;

/** The air strike's own cooldown slot on an Airport (2B.4). */
export const STRIKE_SLOT = 1;

/** Ticks until an Air Base can strike again (0 = ready). */
export function strikeCooldownLeft(airport: AirportLike, tick: number): number {
  return Math.max(0, (airport.cooldowns[STRIKE_SLOT] ?? -1) - tick);
}

/** Why an air strike can't go to `tile` now, or null. Shared with the HUD and the nations. */
export type StrikeProblem = "notReady" | "disabled" | "cooldown" | "notHostile" | "outOfRange";

export const STRIKE_PROBLEM_TEXT: Record<StrikeProblem, string> = {
  notReady: "an air strike needs an Air Base (level III)",
  disabled: "the Airport was hit by an air strike",
  cooldown: "the fighters are still on cooldown",
  notHostile: "air strikes hit an enemy's land or buildings",
  outOfRange: "out of the Air Base's range",
};

/**
 * Whether an air strike may fly from `airport` to `tile` at `tick`; `hostile` says whether
 * the tile belongs to a living player who isn't the owner or a friend of theirs.
 */
export function strikeProblem(
  rules: GameRules,
  map: GameMap,
  airport: AirportLike,
  tick: number,
  tile: number,
  hostile: boolean,
): StrikeProblem | null {
  if (airport.type !== "airport" || airport.level < STRIKE_LEVEL) return "notReady";
  if (!working(airport, tick)) return "disabled";
  if (strikeCooldownLeft(airport, tick) > 0) return "cooldown";
  if (!hostile) return "notHostile";
  if (!withinRange(map, airport.tile, tile, airportRange(rules, airport))) return "outOfRange";
  return null;
}

/**
 * Handles `airStrike` (GAME_DESIGN.md §3.17.7, 2B.4): the Air Base's fighter wing flies to an
 * enemy's tile — the building standing there, or the point (see the header).
 */
export function applyAirStrike(
  world: World,
  player: Player,
  buildingId: number,
  tile: number,
): string | null {
  const rules = world.rules;
  if (!rules.flights.enabled || !buildingsEnabled(rules)) {
    return "there are no flights in this game";
  }
  if (world.phase !== "playing") return "the match hasn't started";
  const airport = findBuilding(world, buildingId);
  if (!airport || airport.owner !== player.id || airport.type !== "airport") {
    return "not your Airport";
  }
  if (!Number.isInteger(tile) || tile < 0 || tile >= world.owner.length) return "invalid tile";
  const holder = world.owner[tile]!;
  const why = holder === NEUTRAL ? null : hostileTarget(world, player, holder);
  if (why) return why;
  const problem = strikeProblem(rules, world.map, airport, world.tick, tile, holder !== NEUTRAL);
  if (problem) return STRIKE_PROBLEM_TEXT[problem];
  launchFlight(world, {
    owner: player.id,
    kind: "strike",
    source: airport.id,
    fromTile: airport.tile,
    toTile: tile,
    plane: "fighter",
    planes: rules.flights.strikePlanes,
    troops: 0,
  });
  startCooldown(
    airport,
    STRIKE_SLOT,
    world.tick,
    producedTicks(
      world,
      airport,
      levelRules(rules, "airport", airport.level).strikeCooldownTicks ?? 0,
    ),
  );
  return null;
}

/**
 * A strike over its target: an enemy building on the tile is hit (−1 level with enough
 * fighters, disabled either way); otherwise the enemy land around it is suppressed. Land or a
 * building that became the striker's own or a friend's meanwhile is spared.
 */
function landStrike(world: World, flight: Flight): void {
  const f = world.rules.flights;
  const enemy = (id: PlayerId) =>
    id !== NEUTRAL &&
    id !== flight.owner &&
    getPlayer(world, id)?.alive === true &&
    !areFriendly(world, flight.owner, id);
  const building = findBuilding(world, world.buildingAt[flight.toTile]!);
  if (building && enemy(building.owner)) {
    const levels = flight.planes >= f.strikeDamagePlanes ? 1 : 0;
    strikeBuilding(world, building, levels, f.strikeDisableTicks, flight.owner);
    return;
  }
  const holder = world.owner[flight.toTile]!;
  if (enemy(holder)) suppress(world, flight.id, flight.owner, holder, flight.toTile);
}

/** True when `other` is a living ally or teammate of `id`. */
function isFriendOf(world: World, id: PlayerId, other: PlayerId): boolean {
  if (other === NEUTRAL || other === id) return false;
  return getPlayer(world, other)?.alive === true && areFriendly(world, id, other);
}

/** Candidate landing tiles a nation checks against hostile SAMs, at most. */
const SITE_CANDIDATES = 24;

/**
 * Where a nation lands an airlift for `friend` (-1: nowhere worth it): the friend's border
 * tile nearest the Airport within its range. Ties go to the lower tile, so the order the
 * border is kept in doesn't matter. When hostile SAMs stand somewhere (2B.2), it flies
 * around them: of up to SITE_CANDIDATES border tiles spread from the nearest to the farthest
 * in range, the one whose route meets the fewest ready interceptors (nearest first among
 * equals) — and none at all if every route would lose every plane.
 */
export function airliftSite(
  world: World,
  airport: AirportLike & { readonly owner: PlayerId },
  friend: Player,
): number {
  return quietSite(world, airport, friend.border, -1, world.rules.flights.airliftPlanes).tile;
}

/**
 * Where a nation lands an airborne assault on `target` (2B.3), and how many of its planes the
 * hostile SAMs on that route would shoot down (tile -1: nowhere worth it). The heart of their
 * land (their start, while they hold it) if it is in range and no route elsewhere loses fewer
 * planes — behind any wall, it splits them — else, only when `anywhere`, the quietest of
 * their border tiles in range (as for an airlift).
 */
export function assaultSite(
  world: World,
  airport: AirportLike & { readonly owner: PlayerId },
  target: Player,
  anywhere: boolean,
): { readonly tile: number; readonly lost: number } {
  const heart =
    target.spawnTile >= 0 &&
    world.owner[target.spawnTile] === target.id &&
    withinRange(world.map, airport.tile, target.spawnTile, airportRange(world.rules, airport))
      ? target.spawnTile
      : -1;
  if (heart < 0 && !anywhere) return { tile: -1, lost: 0 };
  return quietSite(
    world,
    airport,
    anywhere ? target.border : [],
    heart,
    world.rules.flights.assaultPlanes,
  );
}

/**
 * The landing tile whose route meets the fewest ready hostile interceptors, of `preferred`
 * (tried first; -1 = none) and up to SITE_CANDIDATES of `tiles` within the Airport's range,
 * spread from the nearest to the farthest — nearest first among equals; with no hostile SAM
 * anywhere, `preferred` or the nearest. Tile -1 when every route would lose every plane.
 * An Air Base's escorts (2B.4) take the first interceptors, so `lost` counts only the planes.
 */
function quietSite(
  world: World,
  airport: AirportLike & { readonly owner: PlayerId },
  tiles: Iterable<number>,
  preferred: number,
  planes: number,
): { tile: number; lost: number } {
  const rules = world.rules;
  const range = airportRange(rules, airport);
  const owner = airport.owner;
  const hostile = (samOwner: PlayerId) =>
    samOwner !== owner && !areFriendly(world, owner, samOwner);
  const sams = world.buildings.filter((b) => b.type === "sam" && b.level >= 1 && hostile(b.owner));
  if (sams.length === 0) {
    if (preferred >= 0) return { tile: preferred, lost: 0 };
    let best = -1;
    let bestDistance = range * range;
    for (const tile of tiles) {
      const d = distanceSq(world.map, airport.tile, tile);
      if (d < bestDistance || (d === bestDistance && (best < 0 || tile < best))) {
        best = tile;
        bestDistance = d;
      }
    }
    return { tile: best, lost: 0 };
  }
  const escorts = escortsOf(rules, airport.level);
  const met = (tile: number) =>
    Math.max(
      0,
      interceptorsOnRoute(
        rules,
        world.map,
        sams,
        hostile,
        airport.tile,
        tile,
        "transport",
        world.tick,
      ).interceptors - escorts,
    );
  let best = -1;
  let fewest = planes; // as many as the planes: all of them lost
  if (preferred >= 0) {
    const lost = met(preferred);
    if (lost === 0) return { tile: preferred, lost };
    if (lost < fewest) {
      best = preferred;
      fewest = lost;
    }
  }
  const inRange: { tile: number; d: number }[] = [];
  for (const tile of tiles) {
    const d = distanceSq(world.map, airport.tile, tile);
    if (d <= range * range) inRange.push({ tile, d });
  }
  inRange.sort((a, b) => a.d - b.d || a.tile - b.tile);
  const stride = Math.max(1, Math.ceil(inRange.length / SITE_CANDIDATES));
  for (let k = 0; k < inRange.length; k += stride) {
    const tile = inRange[k]!.tile;
    const lost = met(tile);
    if (lost < fewest) {
      best = tile;
      fewest = lost;
      if (lost === 0) break;
    }
  }
  return { tile: best, lost: best < 0 ? 0 : fewest };
}

/** An airlift over its target: the friend takes what fits, the rest flies back. */
function deliverAirlift(world: World, flight: Flight): void {
  const friend = getPlayer(world, flight.target);
  const welcome = friend !== undefined && isFriendOf(world, flight.owner, flight.target);
  const troops = welcome ? Math.min(flight.troops, troopRoom(friend)) : 0;
  if (troops > 0) friend!.homeTroops += troops;
  const returning = flight.troops - troops;
  world.events.push({
    type: "airliftDelivered",
    flightId: flight.id,
    from: flight.owner,
    to: flight.target,
    troops,
    returning,
  });
  if (returning > 0) {
    launchFlight(world, {
      owner: flight.owner,
      kind: "return",
      source: flight.source,
      fromTile: flight.toTile,
      toTile: flight.fromTile,
      plane: "transport",
      planes: flight.planes,
      escorts: flight.escorts,
      troops: returning,
    });
  }
}

/** A SAM as interception sees it (a building or its frame snapshot). */
export interface SamLike {
  readonly id: number;
  readonly type: string;
  readonly owner: PlayerId;
  readonly level: number;
  readonly tile: number;
  readonly reloads: readonly number[];
  /** Struck by an air strike: it doesn't fire until this tick (2B.4). */
  readonly disabledUntil: number;
}

/** A SAM's radius in tiles at its working level (0 while first being built). */
export function samRadius(rules: GameRules, sam: SamLike): number {
  return sam.type === "sam" && sam.level >= 1
    ? (levelRules(rules, "sam", sam.level).range ?? 0)
    : 0;
}

/** How many interceptors a SAM of `level` holds (0 while first being built). */
export function samInterceptors(rules: GameRules, level: number): number {
  return level >= 1 ? (levelRules(rules, "sam", level).interceptors ?? 0) : 0;
}

/** Interceptors a SAM has ready at `tick` (none while an air strike has disabled it). */
export function samReady(rules: GameRules, sam: SamLike, tick: number): number {
  if (!working(sam, tick)) return 0;
  return readyCharges(sam, samInterceptors(rules, sam.level), tick);
}

/**
 * The SAMs that would shoot at a flight from `from` to `to` owned by `owner` (`hostile`
 * says whose SAMs shoot at that owner's planes), and how many interceptors they have ready
 * now: the flight is followed tick by tick over the same tiles the simulation checks
 * (flightTile), so the HUD and the nations see exactly what a launch would meet — except
 * for interceptors that reload while it flies. A missile (2B.5) meets only the SAMs that can
 * stop its kind.
 */
export function interceptorsOnRoute(
  rules: GameRules,
  map: GameMap,
  sams: readonly SamLike[],
  hostile: (samOwner: PlayerId) => boolean,
  from: number,
  to: number,
  plane: PlaneType,
  tick: number,
  missile?: MissileKind,
): { readonly sams: readonly SamLike[]; readonly interceptors: number } {
  const threats = sams.filter(
    (s) =>
      s.level >= 1 &&
      s.type === "sam" &&
      hostile(s.owner) &&
      (missile === undefined || samStops(rules, s.level, missile)),
  );
  if (threats.length === 0) return { sams: [], interceptors: 0 };
  const path: FlightPath = {
    fromTile: from,
    toTile: to,
    launchTick: 0,
    arriveTick: flightTicks(rules, map, from, to, plane),
  };
  const met: SamLike[] = [];
  for (let t = 0; t <= path.arriveTick && met.length < threats.length; t++) {
    const tile = flightTile(map, path, t);
    for (const sam of threats) {
      if (!met.includes(sam) && withinRange(map, sam.tile, tile, samRadius(rules, sam))) {
        met.push(sam);
      }
    }
  }
  met.sort((a, b) => a.id - b.id);
  let interceptors = 0;
  for (const sam of met) interceptors += samReady(rules, sam, tick);
  return { sams: met, interceptors };
}

/**
 * Tick system part (GAME_DESIGN.md §3.17.7): hostile SAMs fire at the flights inside their
 * radius (see the header for the order). One interceptor, one plane.
 */
function interceptFlights(world: World): void {
  const rules = world.rules;
  const sams: Building[] = [];
  for (const b of world.buildings) if (b.type === "sam" && b.level >= 1) sams.push(b);
  if (sams.length === 0) return;
  const fired = new Set<number>();
  // shootDown drops flights with no planes left from world.flights, so walk a copy.
  for (const flight of world.flights.slice()) {
    const tile = flightTile(world.map, flight, world.tick);
    const missile = isMissile(flight.kind) ? flight.kind : null;
    for (const sam of sams) {
      if (flight.planes === 0) break;
      if (fired.has(sam.id) || sam.owner === flight.owner) continue;
      if (missile && !samStops(rules, sam.level, missile)) continue;
      if (!working(sam, world.tick) || areFriendly(world, sam.owner, flight.owner)) continue;
      const level = levelRules(rules, "sam", sam.level);
      if (readyCharges(sam, level.interceptors ?? 0, world.tick) < 1) continue;
      if (!withinRange(world.map, sam.tile, tile, level.range ?? 0)) continue;
      spendCharge(sam, world.tick, level.reloadTicks ?? 0);
      fired.add(sam.id);
      shootDown(world, flight, 1, sam.owner, sam.tile);
    }
  }
}

/** The lowest wall level with flak, and its reach (null: no wall level has flak). */
function flakLevel(rules: GameRules): { level: number; radius: number } | null {
  const levels = rules.walls.levels;
  for (let k = 0; k < levels.length; k++) {
    const radius = levels[k]!.flakRadius ?? 0;
    if (radius > 0) return { level: k + 1, radius };
  }
  return null;
}

/**
 * The walls with flak whose reach holds `tile` and whose owner isn't `owner` or a friend of
 * theirs: wall id → the wall's standing tile nearest `tile` (where the shot comes from).
 */
function flakWallsNear(
  world: World,
  tile: number,
  flak: { level: number; radius: number },
  owner: PlayerId,
): Map<number, number> {
  const { map } = world;
  const found = new Map<number, number>();
  const nearest = new Map<number, number>();
  const x0 = tile % map.width;
  const y0 = (tile - x0) / map.width;
  const r = flak.radius;
  for (let dy = -r; dy <= r; dy++) {
    const y = y0 + dy;
    if (y < 0 || y >= map.height) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = x0 + dx;
      const d = dx * dx + dy * dy;
      if (x < 0 || x >= map.width || d > r * r) continue;
      const t = y * map.width + x;
      if (world.fortLevel[t]! < flak.level) continue;
      const holder = world.owner[t]!;
      if (holder === owner || areFriendly(world, holder, owner)) continue;
      // A suppressed wall (2B.4) is silent.
      if (isSuppressed(world, t)) continue;
      const id = world.wallAt[t]!;
      const best = nearest.get(id);
      if (best === undefined || d < best || (d === best && t < found.get(id)!)) {
        nearest.set(id, d);
        found.set(id, t);
      }
    }
  }
  return found;
}

/**
 * Tick system part (GAME_DESIGN.md §3.17.6–3.17.7): Fortress Walls' flak — a flight that has
 * just flown into a hostile wall's reach loses one plane to it (see the header).
 */
function flakFlights(world: World): void {
  const flak = flakLevel(world.rules);
  if (!flak || !world.walls.some((w) => w.level >= flak.level)) return;
  const { map, tick } = world;
  for (const flight of world.flights.slice()) {
    if (tick <= flight.launchTick || isMissile(flight.kind)) continue;
    const now = flakWallsNear(world, flightTile(map, flight, tick), flak, flight.owner);
    if (now.size === 0) continue;
    const before = flakWallsNear(world, flightTile(map, flight, tick - 1), flak, flight.owner);
    const ids = [...now.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      if (flight.planes === 0) break;
      if (before.has(id)) continue;
      const from = now.get(id)!;
      shootDown(world, flight, 1, world.owner[from]!, from, "flak");
    }
  }
}

/**
 * Tick system (step 2c, right after the boats): hostile SAMs fire, then Fortress Walls' flak,
 * then flights that reach their target arrive.
 */
export function advanceFlights(world: World): void {
  if (world.flights.length === 0) return;
  interceptFlights(world);
  flakFlights(world);
  let arrived = false;
  let troops = false;
  for (const flight of world.flights) {
    if (world.tick < flight.arriveTick) continue;
    arrived = true;
    if (flight.troops > 0) troops = true;
    world.events.push({
      type: "flightArrived",
      flightId: flight.id,
      owner: flight.owner,
      kind: flight.kind,
      tile: flight.toTile,
      target: world.owner[flight.toTile]!,
      planes: flight.planes,
      troops: flight.troops,
    });
    // Test flights do nothing on arrival.
    if (flight.kind === "airlift") deliverAirlift(world, flight);
    else if (isMissile(flight.kind)) landMissile(world, flight);
    else if (flight.kind === "assault") landAssault(world, flight);
    else if (flight.kind === "strike") landStrike(world, flight);
    else if (flight.kind === "return") getPlayer(world, flight.owner)!.homeTroops += flight.troops;
  }
  if (!arrived) return;
  world.flights = world.flights.filter((f) => world.tick < f.arriveTick);
  if (troops) updateFieldTroops(world);
}

/**
 * Shoots down `planes` of a flight (SAMs 2B.2, flak 2B.3): its escort fighters first (2B.4),
 * then its planes, each taking its share of the troops aboard. A flight with no planes left is
 * gone (its escorts turn back with it). The one place planes are lost.
 */
export function shootDown(
  world: World,
  flight: Flight,
  planes: number,
  by: PlayerId,
  fromTile = -1,
  weapon: "sam" | "flak" = "sam",
): void {
  const escorts = Math.min(planes, flight.escorts);
  const downed = Math.min(planes - escorts, flight.planes);
  if (downed + escorts <= 0) return;
  const troopsLost = downed > 0 ? (flight.troops * downed) / flight.planes : 0;
  const tile = flightTile(world.map, flight, world.tick);
  flight.escorts -= escorts;
  flight.planes -= downed;
  flight.troops = flight.planes === 0 ? 0 : flight.troops - troopsLost;
  world.events.push({
    type: "flightIntercepted",
    flightId: flight.id,
    owner: flight.owner,
    kind: flight.kind,
    by,
    tile,
    fromTile,
    weapon,
    planes: downed,
    escorts,
    planesLeft: flight.planes,
    troopsLost,
  });
  if (flight.planes === 0) world.flights = world.flights.filter((f) => f !== flight);
  if (troopsLost > 0) updateFieldTroops(world);
}

/** An eliminated player's flights are lost with everything aboard. */
export function loseFlightsOf(world: World, playerId: PlayerId): void {
  if (!world.flights.some((f) => f.owner === playerId)) return;
  for (const flight of world.flights) {
    if (flight.owner === playerId) {
      world.events.push({ type: "flightLost", flightId: flight.id, owner: playerId });
    }
  }
  world.flights = world.flights.filter((f) => f.owner !== playerId);
  updateFieldTroops(world);
}

/** The match is over: troops still in the air go home. */
export function landAllFlights(world: World): void {
  if (world.flights.length === 0) return;
  for (const flight of world.flights) getPlayer(world, flight.owner)!.homeTroops += flight.troops;
  world.flights = [];
  updateFieldTroops(world);
}

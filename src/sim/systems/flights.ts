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
 *  - Arrivals act by kind: airlift → the friend's home troops, what doesn't fit under their
 *    capacity flies back ("return" → the owner's home troops) — 2B.1; assault → a beachhead
 *    attack (2B.3), strike/missile → buildings lose levels (2B.4–2B.5). Test flights (debug,
 *    rules.flights.testFlights) do nothing when they arrive.
 *  - Airlift (Airport I, D-023): the only way to send troops to a friend you don't border —
 *    the send share of your home troops, capped by the Airport's lift capacity (a share of
 *    your troop capacity), to any land of an ally or teammate within its range; then the
 *    Airport's mission cooldown (slot 0) runs.
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
  type Flight,
  type FlightKind,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";
import { updateFieldTroops } from "./attacks.ts";
import { buildingsEnabled, findBuilding, levelRules, startCooldown } from "./buildings.ts";
import { areFriendly } from "./diplomacy.ts";
import { troopRoom } from "./economy.ts";

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
}

/** The airlift mission's cooldown slot on an Airport. */
export const AIRLIFT_SLOT = 0;

/** Why an airlift can't go to `tile` now, or null. Shared with the HUD and the nations. */
export type AirliftProblem = "notReady" | "cooldown" | "notFriend" | "outOfRange";

export const AIRLIFT_PROBLEM_TEXT: Record<AirliftProblem, string> = {
  notReady: "the Airport isn't ready yet",
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
    troops,
  });
  startCooldown(
    airport,
    AIRLIFT_SLOT,
    world.tick,
    levelRules(rules, "airport", airport.level).missionCooldownTicks ?? 0,
  );
  return null;
}

/** True when `other` is a living ally or teammate of `id`. */
function isFriendOf(world: World, id: PlayerId, other: PlayerId): boolean {
  if (other === NEUTRAL || other === id) return false;
  return getPlayer(world, other)?.alive === true && areFriendly(world, id, other);
}

/**
 * Where a nation lands an airlift for `friend`: the friend's border tile nearest the
 * Airport within its range (-1: none). Ties go to the lower tile, so the order the border is
 * kept in doesn't matter.
 */
export function airliftSite(world: World, airport: AirportLike, friend: Player): number {
  const range = airportRange(world.rules, airport);
  let best = -1;
  let bestDistance = range * range;
  for (const tile of friend.border) {
    const d = distanceSq(world.map, airport.tile, tile);
    if (d < bestDistance || (d === bestDistance && (best < 0 || tile < best))) {
      best = tile;
      bestDistance = d;
    }
  }
  return best;
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
      troops: returning,
    });
  }
}

/** Tick system (step 2c, right after the boats): flights that reach their target arrive. */
export function advanceFlights(world: World): void {
  if (world.flights.length === 0) return;
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
    // Test flights do nothing on arrival; assaults, strikes and missiles will act here
    // (2B.3–2B.5).
    if (flight.kind === "airlift") deliverAirlift(world, flight);
    else if (flight.kind === "return") getPlayer(world, flight.owner)!.homeTroops += flight.troops;
  }
  if (!arrived) return;
  world.flights = world.flights.filter((f) => world.tick < f.arriveTick);
  if (troops) updateFieldTroops(world);
}

/**
 * Shoots down `planes` of a flight (SAMs 2B.2, flak 2B.3): each takes its share of the troops
 * aboard. A flight with no planes left is gone. The one place planes are lost.
 */
export function shootDown(world: World, flight: Flight, planes: number, by: PlayerId): void {
  const downed = Math.min(planes, flight.planes);
  if (downed <= 0) return;
  const troopsLost = (flight.troops * downed) / flight.planes;
  const tile = flightTile(world.map, flight, world.tick);
  flight.planes -= downed;
  flight.troops = flight.planes === 0 ? 0 : flight.troops - troopsLost;
  world.events.push({
    type: "flightIntercepted",
    flightId: flight.id,
    owner: flight.owner,
    by,
    tile,
    planes: downed,
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

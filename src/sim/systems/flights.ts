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
 *  - Arrivals act by kind: airlift → a friend's home troops (2B.1), assault → a beachhead
 *    attack (2B.3), strike/missile → buildings lose levels (2B.4–2B.5). 2B.0 has only test
 *    flights (debug, rules.flights.testFlights), which do nothing when they arrive.
 *
 * Troops aboard count as field troops, like an army or a boat (updateFieldTroops).
 */
import { distance, pointAlong, tileAlong, travelTicks } from "../geometry.ts";
import type { GameMap } from "../map/gameMap.ts";
import type { GameRules } from "../rules.ts";
import {
  getPlayer,
  type Flight,
  type FlightKind,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";
import { updateFieldTroops } from "./attacks.ts";

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
    // Test flights do nothing on arrival; airlifts, assaults, strikes and missiles act here
    // (2B.1–2B.5).
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

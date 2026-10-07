/**
 * What the HUD shows about flights (GAME_DESIGN.md §3.17.7, milestone 2B.0): where each
 * flight is now, what it is called, and whether it comes to hurt you. Positions come from
 * the simulation's own flightPoint, so the map shows exactly where the sim says it is.
 */
import type { FlightSnapshot } from "../../sim/frame.ts";
import type { GameMap } from "../../sim/map/gameMap.ts";
import { flightPoint } from "../../sim/systems/flights.ts";
import type { FlightKind } from "../../sim/world.ts";

export interface FlightInfo {
  /** Map and chip icon. */
  readonly icon: string;
  /** "test flight", later "airlift", "airborne assault" … */
  readonly name: string;
  /**
   * Whether it comes to hurt whoever it flies at (an airlift to a friend doesn't). Test
   * flights count, so the incoming warning can be checked before Airports exist.
   */
  readonly hostile: boolean;
}

export const FLIGHT_INFO: Readonly<Record<FlightKind, FlightInfo>> = {
  test: { icon: "✈", name: "test flight", hostile: true },
};

/** A flight's position (tile coordinates, tile centres at .5) and heading at `tick`. */
export function flightPosition(
  map: GameMap,
  flight: FlightSnapshot,
  tick: number,
): { x: number; y: number; dx: number; dy: number } {
  const p = flightPoint(map, flight, tick);
  const dx = (flight.toTile % map.width) - (flight.fromTile % map.width);
  const dy = Math.floor(flight.toTile / map.width) - Math.floor(flight.fromTile / map.width);
  return { x: p.x + 0.5, y: p.y + 0.5, dx, dy };
}

/** Seconds until a flight is over its target (fractional ticks allowed). */
export function flightSecondsLeft(flight: FlightSnapshot, tick: number, tickMs: number): number {
  return Math.max(0, ((flight.arriveTick - tick) * tickMs) / 1000);
}

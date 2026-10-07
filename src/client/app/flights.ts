/**
 * What the HUD shows about flights (GAME_DESIGN.md §3.17.7, milestone 2B.0): where each
 * flight is now, what it is called, and whether it comes to hurt you. Positions come from
 * the simulation's own flightPoint, so the map shows exactly where the sim says it is.
 */
import type { BuildingSnapshot, FlightSnapshot, PlayerSnapshot } from "../../sim/frame.ts";
import type { GameMap } from "../../sim/map/gameMap.ts";
import type { GameRules } from "../../sim/rules.ts";
import {
  AIRLIFT_PROBLEM_TEXT,
  airliftProblem,
  airliftTroops,
  airportRange,
  flightPoint,
  flightTicks,
  type AirliftProblem,
} from "../../sim/systems/flights.ts";
import type { FlightKind, PlayerId } from "../../sim/world.ts";

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
  airlift: { icon: "✈", name: "airlift", hostile: false },
  return: { icon: "✈", name: "return flight", hostile: false },
};

/**
 * The airlift a click would send (GAME_DESIGN.md §3.17.7): from the chosen Airport to the
 * tile under the mouse, with the troops it would carry and its flight time — or why it
 * can't go there. The rules are the simulation's own (airliftProblem / airliftTroops).
 */
export interface AirliftPreview {
  readonly airport: BuildingSnapshot;
  /** The Airport's range in tiles (the ring drawn around it). */
  readonly range: number;
  /** The tile under the mouse (null: none). */
  readonly tile: number | null;
  readonly troops: number;
  readonly seconds: number;
  readonly problem: AirliftProblem | "noTroops" | null;
}

export const AIRLIFT_PREVIEW_TEXT: Record<AirliftProblem | "noTroops", string> = {
  ...AIRLIFT_PROBLEM_TEXT,
  noTroops: "no troops to send",
};

export function airliftPreview(
  rules: GameRules,
  map: GameMap,
  airport: BuildingSnapshot,
  me: PlayerSnapshot,
  owner: Uint16Array,
  friends: ReadonlySet<PlayerId>,
  tick: number,
  tile: number | null,
  percent: number,
): AirliftPreview {
  const range = airportRange(rules, airport);
  const troops = airliftTroops(rules, airport.level, me, Math.round(percent * 100));
  if (tile === null) return { airport, range, tile, troops, seconds: 0, problem: null };
  const friendly = owner[tile] !== me.id && friends.has(owner[tile]!);
  const problem =
    airliftProblem(rules, map, airport, tick, tile, friendly) ?? (troops < 1 ? "noTroops" : null);
  const seconds = (flightTicks(rules, map, airport.tile, tile, "transport") * rules.tickMs) / 1000;
  return { airport, range, tile, troops, seconds, problem };
}

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

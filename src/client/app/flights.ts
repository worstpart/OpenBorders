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
  ASSAULT_PROBLEM_TEXT,
  airliftProblem,
  assaultProblem,
  airliftTroops,
  airportRange,
  flightPoint,
  flightTicks,
  interceptorsOnRoute,
  type AirliftProblem,
  type AssaultProblem,
} from "../../sim/systems/flights.ts";
import { NEUTRAL, type FlightKind, type PlayerId } from "../../sim/world.ts";

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
  assault: { icon: "🪂", name: "airborne assault", hostile: true },
};

/** An Airport's two lift missions (GAME_DESIGN.md §3.17.7): to a friend, or onto an enemy. */
export type LiftMode = "airlift" | "assault";

/** The map sprite of a flight: helicopters carry airborne assaults (D-028). */
export function flightSprite(kind: FlightKind): "plane" | "helicopter" {
  return kind === "assault" ? "helicopter" : "plane";
}

/**
 * The airlift (or airborne assault, 2B.3) a click would send (GAME_DESIGN.md §3.17.7): from
 * the chosen Airport to the tile under the mouse, with the troops it would carry and its
 * flight time — or why it can't go there. The rules are the simulation's own
 * (airliftProblem / assaultProblem / airliftTroops).
 */
export interface AirliftPreview {
  readonly mode: LiftMode;
  readonly airport: BuildingSnapshot;
  /** The Airport's range in tiles (the ring drawn around it). */
  readonly range: number;
  /** The tile under the mouse (null: none). */
  readonly tile: number | null;
  readonly troops: number;
  readonly seconds: number;
  readonly problem: AirliftProblem | AssaultProblem | "noTroops" | null;
  /**
   * Planes the hostile SAMs on the route would shoot down with the interceptors they have
   * ready now (GAME_DESIGN.md §3.17.7), at most all of them, and how many planes fly.
   */
  readonly planesLost: number;
  readonly planes: number;
}

/** Why a lift can't go there, in words (the two modes share some problems, not the words). */
export function liftProblemText(
  mode: LiftMode,
  problem: AirliftProblem | AssaultProblem | "noTroops",
): string {
  if (problem === "noTroops") return "no troops to send";
  return mode === "assault"
    ? ASSAULT_PROBLEM_TEXT[problem as AssaultProblem]
    : AIRLIFT_PROBLEM_TEXT[problem as AirliftProblem];
}

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
  buildings: readonly BuildingSnapshot[] = [],
  mode: LiftMode = "airlift",
): AirliftPreview {
  const range = airportRange(rules, airport);
  const troops = airliftTroops(rules, airport.level, me, Math.round(percent * 100));
  const planes = mode === "assault" ? rules.flights.assaultPlanes : rules.flights.airliftPlanes;
  if (tile === null) {
    return { mode, airport, range, tile, troops, seconds: 0, problem: null, planesLost: 0, planes };
  }
  const holder = owner[tile]!;
  const problem =
    (mode === "assault"
      ? assaultProblem(
          rules,
          map,
          airport,
          tick,
          tile,
          holder !== NEUTRAL && isHostile(holder, me.id, friends),
        )
      : airliftProblem(rules, map, airport, tick, tile, holder !== me.id && friends.has(holder))) ??
    (troops < 1 ? "noTroops" : null);
  const seconds = (flightTicks(rules, map, airport.tile, tile, "transport") * rules.tickMs) / 1000;
  const shots = problem
    ? 0
    : interceptorsOnRoute(
        rules,
        map,
        buildings,
        (samOwner) => isHostile(samOwner, me.id, friends),
        airport.tile,
        tile,
        "transport",
        tick,
      ).interceptors;
  return {
    mode,
    airport,
    range,
    tile,
    troops,
    seconds,
    problem,
    planesLost: Math.min(planes, shots),
    planes,
  };
}

/** Whose SAMs shoot at our planes: everyone but us and our friends (GAME_DESIGN.md §3.17.7). */
export function isHostile(owner: PlayerId, me: PlayerId, friends: ReadonlySet<PlayerId>): boolean {
  return owner !== me && !friends.has(owner);
}

/** An interception being drawn: a SAM's shot streaking to a plane, then a puff. */
export interface ShotEffect {
  /** Where the SAM stands and where the plane was hit (tiles). */
  readonly fromTile: number;
  readonly tile: number;
  /** performance.now() when it was fired. */
  readonly start: number;
}

/** How long a shot streaks, and how long the puff after it lasts (ms). */
export const SHOT_MS = 280;
export const PUFF_MS = 900;

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

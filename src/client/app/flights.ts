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
  escortsOf,
  flightPoint,
  flightTicks,
  interceptorsOnRoute,
  STRIKE_PROBLEM_TEXT,
  strikeProblem,
  type AirliftProblem,
  type AssaultProblem,
  type StrikeProblem,
} from "../../sim/systems/flights.ts";
import { levelRules } from "../../sim/systems/buildings.ts";
import type { BuildingType } from "../../sim/rules.ts";
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
  strike: { icon: "💥", name: "air strike", hostile: true },
};

/**
 * An Airport's missions (GAME_DESIGN.md §3.17.7): lifts to a friend or onto an enemy, and an
 * Air Base's air strike (2B.4) — all aimed the same way.
 */
export type LiftMode = "airlift" | "assault" | "strike";

/**
 * The map sprite of a flight: helicopters carry airborne assaults (D-028). The pack's "plane"
 * art is a fighter of each era (biplane, WW2 fighter, jet), so transports and strikes share it.
 */
export function flightSprite(kind: FlightKind): "plane" | "helicopter" {
  return kind === "assault" ? "helicopter" : "plane";
}

/**
 * What an air strike aimed at a tile would do (2B.4): hit the enemy building standing there
 * (−1 level when enough fighters get through — a level-I building is destroyed — and out of
 * action either way), or suppress the enemy's land around the point.
 */
export type StrikeEffect =
  | {
      readonly kind: "building";
      readonly buildingType: BuildingType;
      readonly level: number;
      /** Its level afterwards (0 = destroyed), and how long it is out of action (s). */
      readonly levelAfter: number;
      readonly disabledSeconds: number;
    }
  | { readonly kind: "point"; readonly radius: number; readonly seconds: number };

/**
 * The airlift (or airborne assault, 2B.3, or air strike, 2B.4) a click would send
 * (GAME_DESIGN.md §3.17.7): from the chosen Airport to the tile under the mouse, with the
 * troops it would carry and its flight time — or why it can't go there. The rules are the
 * simulation's own (airliftProblem / assaultProblem / strikeProblem / airliftTroops).
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
  readonly problem: AirliftProblem | AssaultProblem | StrikeProblem | "noTroops" | null;
  /**
   * Planes the hostile SAMs on the route would shoot down with the interceptors they have
   * ready now (GAME_DESIGN.md §3.17.7), at most all of them, and how many planes fly — the
   * escort fighters (an Air Base's, 2B.4) are shot first and count apart.
   */
  readonly planesLost: number;
  readonly planes: number;
  readonly escorts: number;
  /** A strike: what it would do there (null: no target yet, or it can't go there). */
  readonly strike: StrikeEffect | null;
}

/** Why a lift can't go there, in words (the two modes share some problems, not the words). */
export function liftProblemText(
  mode: LiftMode,
  problem: AirliftProblem | AssaultProblem | StrikeProblem | "noTroops",
): string {
  if (problem === "noTroops") return "no troops to send";
  return mode === "assault"
    ? ASSAULT_PROBLEM_TEXT[problem as AssaultProblem]
    : mode === "strike"
      ? STRIKE_PROBLEM_TEXT[problem as StrikeProblem]
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
  const striking = mode === "strike";
  const troops = striking ? 0 : airliftTroops(rules, airport.level, me, Math.round(percent * 100));
  const f = rules.flights;
  const planes = striking ? f.strikePlanes : mode === "assault" ? f.assaultPlanes : f.airliftPlanes;
  const escorts = striking ? 0 : escortsOf(rules, airport.level);
  const none = { mode, airport, range, tile, troops, planes, escorts, strike: null };
  if (tile === null) return { ...none, seconds: 0, problem: null, planesLost: 0 };
  const holder = owner[tile]!;
  const hostile = holder !== NEUTRAL && isHostile(holder, me.id, friends);
  const problem = striking
    ? strikeProblem(rules, map, airport, tick, tile, hostile)
    : ((mode === "assault"
        ? assaultProblem(rules, map, airport, tick, tile, hostile)
        : airliftProblem(
            rules,
            map,
            airport,
            tick,
            tile,
            holder !== me.id && friends.has(holder),
          )) ?? (troops < 1 ? "noTroops" : null));
  const plane = striking ? "fighter" : "transport";
  const seconds = (flightTicks(rules, map, airport.tile, tile, plane) * rules.tickMs) / 1000;
  const shots = problem
    ? 0
    : interceptorsOnRoute(
        rules,
        map,
        buildings,
        (samOwner) => isHostile(samOwner, me.id, friends),
        airport.tile,
        tile,
        plane,
        tick,
      ).interceptors;
  const planesLost = Math.min(planes, Math.max(0, shots - escorts));
  return {
    ...none,
    seconds,
    problem,
    planesLost,
    strike:
      striking && !problem
        ? strikeEffect(rules, buildings, tile, holder, planes - planesLost)
        : null,
  };
}

/** What a strike with `through` fighters arriving over `tile` would do (see StrikeEffect). */
function strikeEffect(
  rules: GameRules,
  buildings: readonly BuildingSnapshot[],
  tile: number,
  holder: PlayerId,
  through: number,
): StrikeEffect {
  const f = rules.flights;
  const target = buildings.find((b) => b.tile === tile && b.owner === holder);
  if (!target) {
    return {
      kind: "point",
      radius: f.suppressionRadius,
      seconds: (f.suppressionTicks * rules.tickMs) / 1000,
    };
  }
  const hit = through >= f.strikeDamagePlanes ? 1 : 0;
  return {
    kind: "building",
    buildingType: target.type,
    level: target.level,
    levelAfter: Math.max(0, target.level - hit),
    disabledSeconds: (f.strikeDisableTicks * rules.tickMs) / 1000,
  };
}

const ROMAN = ["", "I", "II", "III"];

/** A strike's effect in a few words, for the aiming label ("Factory → level II"). */
export function strikeEffectText(rules: GameRules, effect: StrikeEffect): string {
  if (effect.kind === "point") return `suppress ${effect.radius} km for ${effect.seconds} s`;
  const name = levelRules(rules, effect.buildingType, Math.max(1, effect.level)).name;
  if (effect.levelAfter === 0) return `destroy ${name}`;
  if (effect.levelAfter < effect.level) return `${name} → level ${ROMAN[effect.levelAfter]}`;
  return `${name} out of action ${effect.disabledSeconds} s`;
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

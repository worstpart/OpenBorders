/**
 * The incoming-threat warning (GAME_DESIGN.md §3.20, milestone 2.9): everything on its way
 * to hit the local player — boats sailing for their coast and hostile flights (2B.0; missiles
 * join in 2B.5). The chips, the map markers, the edge arrows and the horn all work from this
 * one list.
 */
import type { BoatSnapshot, FlightSnapshot } from "../../sim/frame.ts";
import type { GameRules } from "../../sim/rules.ts";
import type { PlayerId } from "../../sim/world.ts";
import { FLIGHT_INFO, flightSecondsLeft } from "./flights.ts";

/** What is coming. 2B.5 adds "missile". */
export type ThreatKind = "boat" | "flight";

export interface Threat {
  /** Stable while the threat lasts (e.g. "boat:12"): new keys sound the alarm. */
  readonly key: string;
  readonly kind: ThreatKind;
  /** Who sent it. */
  readonly from: PlayerId;
  /** What the chip calls it: "boat", "test flight" … */
  readonly name: string;
  /** Troops it carries (0 for a missile or a strike). */
  readonly troops: number;
  /** Flights: planes in it (0 for boats). */
  readonly planes: number;
  /** Where it hits. */
  readonly tile: number;
  readonly secondsLeft: number;
}

export interface ThreatContext {
  readonly rules: GameRules;
  readonly owner: Uint16Array;
  readonly boats: readonly BoatSnapshot[];
  readonly flights: readonly FlightSnapshot[];
  /** Allies and teammates (their flights never threaten us). */
  readonly friends: ReadonlySet<PlayerId>;
  readonly me: PlayerId;
  readonly tick: number;
}

export const THREAT_ICON: Readonly<Record<ThreatKind, string>> = { boat: "⛵", flight: "✈" };
/** The chip's verb: "Grenholm's boat lands in 9 s". */
export const THREAT_VERB: Readonly<Record<ThreatKind, string>> = {
  boat: "lands",
  flight: "arrives",
};

/** Everything heading for the local player's land, soonest first. */
export function incomingThreats(ctx: ThreatContext): Threat[] {
  const threats: Threat[] = [];
  if (ctx.me === 0) return threats;
  for (const boat of ctx.boats) {
    // A boat lands wherever its landing tile is when it arrives: ours now = coming for us.
    if (boat.owner === ctx.me || boat.recallTick >= 0) continue;
    if (ctx.owner[boat.landingTile] !== ctx.me) continue;
    threats.push({
      key: `boat:${boat.id}`,
      kind: "boat",
      name: "boat",
      from: boat.owner,
      troops: boat.troops,
      planes: 0,
      tile: boat.landingTile,
      secondsLeft: Math.max(0, ((boat.arriveTick - ctx.tick) * ctx.rules.tickMs) / 1000),
    });
  }
  for (const flight of ctx.flights) {
    // Like a boat, a flight hits whatever its target tile is when it arrives.
    if (flight.owner === ctx.me || ctx.friends.has(flight.owner)) continue;
    if (!FLIGHT_INFO[flight.kind].hostile || ctx.owner[flight.toTile] !== ctx.me) continue;
    threats.push({
      key: `flight:${flight.id}`,
      kind: "flight",
      name: FLIGHT_INFO[flight.kind].name,
      from: flight.owner,
      troops: flight.troops,
      planes: flight.planes,
      tile: flight.toTile,
      secondsLeft: flightSecondsLeft(flight, ctx.tick, ctx.rules.tickMs),
    });
  }
  return threats.sort((a, b) => a.secondsLeft - b.secondsLeft || a.key.localeCompare(b.key));
}

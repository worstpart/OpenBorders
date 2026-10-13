/**
 * The incoming-threat warning (GAME_DESIGN.md §3.20, milestone 2.9): everything on its way
 * to hit the local player — boats sailing for their coast, hostile flights (2B.0) and missiles
 * (2B.5: a strategic warhead whose blast would reach your land counts wherever it is aimed).
 * A working SAM III of yours also gives early warning (§3.17.7): every hostile flight launched
 * within its warning reach joins the list, wherever it goes. The chips, the map markers, the
 * edge arrows and the horn all work from this one list.
 */
import type { BoatSnapshot, BuildingSnapshot, FlightSnapshot } from "../../sim/frame.ts";
import type { GameRules } from "../../sim/rules.ts";
import { levelRules, working } from "../../sim/systems/buildings.ts";
import { isMissile } from "../../sim/systems/missiles.ts";
import type { PlayerId } from "../../sim/world.ts";
import { FLIGHT_INFO, flightSecondsLeft } from "./flights.ts";

/** What is coming. */
export type ThreatKind = "boat" | "flight" | "missile";

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
  /** Early warning (a SAM III saw it launch): it isn't aimed at your land. */
  readonly warning: boolean;
}

export interface ThreatContext {
  readonly rules: GameRules;
  readonly owner: Uint16Array;
  readonly boats: readonly BoatSnapshot[];
  readonly flights: readonly FlightSnapshot[];
  /** For SAM III early warning (2B.5). */
  readonly buildings: readonly BuildingSnapshot[];
  /** Allies and teammates (their flights never threaten us). */
  readonly friends: ReadonlySet<PlayerId>;
  readonly me: PlayerId;
  readonly tick: number;
  /** Map width in tiles (0 without a map). */
  readonly width: number;
}

export const THREAT_ICON: Readonly<Record<ThreatKind, string>> = {
  boat: "⛵",
  flight: "✈",
  missile: "🚀",
};
/** The chip's verb: "Grenholm's boat lands in 9 s". */
export const THREAT_VERB: Readonly<Record<ThreatKind, string>> = {
  boat: "lands",
  flight: "arrives",
  missile: "hits",
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
      warning: false,
    });
  }
  const warners = earlyWarners(ctx);
  for (const flight of ctx.flights) {
    // Like a boat, a flight hits whatever its target tile is when it arrives.
    if (flight.owner === ctx.me || ctx.friends.has(flight.owner)) continue;
    if (!FLIGHT_INFO[flight.kind].hostile) continue;
    const atMe =
      ctx.owner[flight.toTile] === ctx.me ||
      (flight.kind === "warhead" && blastReaches(ctx, flight.toTile));
    const seen = !atMe && warners.some((w) => withinTiles(ctx, w.tile, flight.fromTile, w.reach));
    if (!atMe && !seen) continue;
    threats.push({
      key: `flight:${flight.id}`,
      kind: isMissile(flight.kind) ? "missile" : "flight",
      name: FLIGHT_INFO[flight.kind].name,
      from: flight.owner,
      troops: flight.troops,
      planes: flight.planes,
      tile: flight.toTile,
      secondsLeft: flightSecondsLeft(flight, ctx.tick, ctx.rules.tickMs),
      warning: !atMe,
    });
  }
  return threats.sort((a, b) => a.secondsLeft - b.secondsLeft || a.key.localeCompare(b.key));
}

/** The local player's working SAMs with early warning, and how far each one sees launches. */
function earlyWarners(ctx: ThreatContext): { tile: number; reach: number }[] {
  const warners: { tile: number; reach: number }[] = [];
  for (const b of ctx.buildings) {
    if (b.owner !== ctx.me || b.type !== "sam" || !working(b, ctx.tick)) continue;
    const level = levelRules(ctx.rules, "sam", b.level);
    if (level.earlyWarning)
      warners.push({ tile: b.tile, reach: (level.range ?? 0) * level.earlyWarning });
  }
  return warners;
}

/** True when a strategic warhead at `center` would scorch some of the local player's land. */
function blastReaches(ctx: ThreatContext, center: number): boolean {
  const width = ctx.width;
  const r = ctx.rules.flights.warheadRadius;
  const x0 = center % width;
  const y0 = Math.floor(center / width);
  const height = ctx.owner.length / width;
  for (let y = Math.max(0, y0 - r); y <= Math.min(height - 1, y0 + r); y++) {
    for (let x = Math.max(0, x0 - r); x <= Math.min(width - 1, x0 + r); x++) {
      if ((x - x0) ** 2 + (y - y0) ** 2 <= r * r && ctx.owner[y * width + x] === ctx.me)
        return true;
    }
  }
  return false;
}

function withinTiles(ctx: ThreatContext, a: number, b: number, range: number): boolean {
  const width = ctx.width;
  const dx = (a % width) - (b % width);
  const dy = Math.floor(a / width) - Math.floor(b / width);
  return dx * dx + dy * dy <= range * range;
}

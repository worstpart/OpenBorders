/**
 * Suppression zones (GAME_DESIGN.md §3.17.7, milestone 2B.4): an air strike on a point
 * suppresses the struck player's land around it for a while — walls there hold nothing and
 * cost nothing extra to break, Fortress Wall flak there is silent, and attacks taking that
 * land pay `suppressedLoss`× the losses. Missiles (2B.5) will suppress the same way.
 *
 * The zone belongs to the land's owner at the time of the strike (`victim`): a tile inside
 * the circle counts only while the victim still holds it. The wall hooks (walls.ts), the
 * attack cost (attacks.ts) and flak (flights.ts) ask `isSuppressed`; with no zone in force
 * that is one length check, so games without strikes pay nothing.
 */
import { withinRange } from "../geometry.ts";
import type { PlayerId, World } from "../world.ts";

/** True when `tile` lies in a suppression zone over its owner's land now. */
export function isSuppressed(world: World, tile: number): boolean {
  const zones = world.suppressions;
  if (zones.length === 0) return false;
  const owner = world.owner[tile]!;
  for (const zone of zones) {
    if (zone.victim === owner && withinRange(world.map, zone.tile, tile, zone.radius)) return true;
  }
  return false;
}

/** Starts a suppression zone over `victim`'s land around `tile` (see the header). */
export function suppress(
  world: World,
  flightId: number,
  by: PlayerId,
  victim: PlayerId,
  tile: number,
): void {
  const f = world.rules.flights;
  const untilTick = world.tick + f.suppressionTicks;
  world.suppressions.push({ tile, radius: f.suppressionRadius, victim, by, untilTick });
  world.events.push({
    type: "suppressed",
    flightId,
    by,
    victim,
    tile,
    radius: f.suppressionRadius,
    untilTick,
  });
}

/** Tick system part (step 2c, before the flights): zones whose time is up are lifted. */
export function expireSuppressions(world: World): void {
  if (world.suppressions.length === 0) return;
  if (world.suppressions.every((z) => z.untilTick > world.tick)) return;
  world.suppressions = world.suppressions.filter((z) => z.untilTick > world.tick);
}

/**
 * Orders on their way (milestone 3.6): online, an order reaches the simulation only when the
 * server's turn carrying it comes back (~100–300 ms). Meanwhile the map shows a small ring
 * where it was aimed, and the HUD says it is being sent if it takes a while — so a click
 * never seems to do nothing.
 */
import type { Command } from "../../sim/commands.ts";

/** The pending marker waits this long before showing "sending…" in the HUD (no flicker). */
export const SENDING_HINT_MS = 250;

/** The tile an order is aimed at, or null for orders without a place (alliances, gold …). */
export function orderTile(command: Command): number | null {
  switch (command.type) {
    case "attack":
      return command.focusTile >= 0 ? command.focusTile : null;
    case "spawn":
    case "boat":
    case "build":
    case "airlift":
    case "assault":
    case "airStrike":
    case "launchMissile":
    case "ping":
      return command.tile;
    case "moveWarship":
      return command.tile >= 0 ? command.tile : null;
    case "buildWall":
      return command.points.at(-1) ?? null;
    default:
      return null;
  }
}

/** The rings the map draws: one per aimed order still on its way, with its age (ms). */
export function pendingRings(
  orders: readonly { readonly command: Command; readonly sentAt: number }[],
  now: number,
): { tile: number; ageMs: number }[] {
  const rings: { tile: number; ageMs: number }[] = [];
  for (const order of orders) {
    const tile = orderTile(order.command);
    if (tile !== null) rings.push({ tile, ageMs: Math.max(0, now - order.sentAt) });
  }
  return rings;
}

/** Some order has been on its way long enough to say so in the HUD. */
export function slowOrder(orders: readonly { readonly sentAt: number }[], now: number): boolean {
  return orders.length > 0 && now - orders[0]!.sentAt >= SENDING_HINT_MS;
}

/** The connection's quality for the HUD dot: good, fair or poor (round trip in ms). */
export function latencyTone(ms: number): "good" | "fair" | "poor" {
  return ms < 150 ? "good" : ms < 300 ? "fair" : "poor";
}

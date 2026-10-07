/**
 * The incoming-threat warning (GAME_DESIGN.md §3.20, milestone 2.9): everything on its way
 * to hit the local player — today boats sailing for their coast; in Phase 2B also enemy
 * flights and missiles (add a kind and a source below; the chips, the map markers, the
 * edge arrows and the boat horn all work from this one list).
 */
import type { BoatSnapshot } from "../../sim/frame.ts";
import type { GameRules } from "../../sim/rules.ts";
import type { PlayerId } from "../../sim/world.ts";

/** What is coming. 2B adds "flight" (air assault) and "missile". */
export type ThreatKind = "boat";

export interface Threat {
  /** Stable while the threat lasts (e.g. "boat:12"): new keys sound the alarm. */
  readonly key: string;
  readonly kind: ThreatKind;
  /** Who sent it. */
  readonly from: PlayerId;
  /** Troops it carries (0 for a missile). */
  readonly troops: number;
  /** Where it hits. */
  readonly tile: number;
  readonly secondsLeft: number;
}

export interface ThreatContext {
  readonly rules: GameRules;
  readonly owner: Uint16Array;
  readonly boats: readonly BoatSnapshot[];
  readonly me: PlayerId;
  readonly tick: number;
}

export const THREAT_ICON: Readonly<Record<ThreatKind, string>> = { boat: "⛵" };

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
      from: boat.owner,
      troops: boat.troops,
      tile: boat.landingTile,
      secondsLeft: Math.max(0, ((boat.arriveTick - ctx.tick) * ctx.rules.tickMs) / 1000),
    });
  }
  return threats.sort((a, b) => a.secondsLeft - b.secondsLeft || a.key.localeCompare(b.key));
}

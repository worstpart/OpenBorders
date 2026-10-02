/**
 * Victory (GAME_DESIGN.md §3.10): control at least the land share needed to win, or be
 * the last player standing. The match then ends: the phase becomes "ended" and nothing
 * moves.
 *
 * Anti-stall: in long games the share needed slowly drops (70% → 50%), so two equal
 * players who keep cancelling each other's attacks can't stall a match forever.
 */
import type { GameRules } from "../rules.ts";
import type { World } from "../world.ts";
import { endAllAttacks } from "./attacks.ts";

/** Share of all land needed to win after `playTicks` ticks of play. */
export function winLandShare(rules: GameRules, playTicks: number): number {
  const v = rules.victory;
  const steps = Math.floor(Math.max(0, playTicks - v.declineStartTicks) / v.declineStepTicks);
  return Math.max(v.minLandShare, v.landShare - steps * v.declineStep);
}

/** Tick system. */
export function checkVictory(world: World): void {
  const playTicks = world.playStartTick >= 0 ? world.tick - world.playStartTick : 0;
  const needed = Math.ceil(winLandShare(world.rules, playTicks) * world.map.landTiles);
  const standing = world.players.filter((p) => p.alive && p.tiles > 0);

  const dominant = standing.find((p) => p.tiles >= needed);
  if (dominant) return endGame(world, dominant.id, "landShare");
  if (standing.length === 1 && world.players.length > 1) {
    return endGame(world, standing[0]!.id, "lastStanding");
  }
  if (standing.length === 0) endGame(world, null, "noneLeft");
}

function endGame(
  world: World,
  winner: number | null,
  reason: "landShare" | "lastStanding" | "noneLeft",
): void {
  world.winner = winner;
  world.phase = "ended";
  endAllAttacks(world);
  world.events.push({ type: "gameOver", winner, reason });
}

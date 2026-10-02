/**
 * Victory (GAME_DESIGN.md §3.10): control at least `landShare` of all land, or be the last
 * player standing. The match then ends: the phase becomes "ended" and nothing moves.
 * (Anti-stall — a slowly declining land requirement — comes in Phase 2.)
 */
import type { World } from "../world.ts";
import { endAllAttacks } from "./attacks.ts";

/** Tick system. */
export function checkVictory(world: World): void {
  const needed = Math.ceil(world.rules.victory.landShare * world.map.landTiles);
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

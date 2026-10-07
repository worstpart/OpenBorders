/**
 * Victory (GAME_DESIGN.md §3.10): control at least the land share needed to win, or be
 * the last player standing. The match then ends: the phase becomes "ended" and nothing
 * moves.
 *
 * Anti-stall: in long games the share needed slowly drops (70% → 50%), so two equal
 * players who keep cancelling each other's attacks can't stall a match forever.
 *
 * Team games (GAME_DESIGN.md §3.15): a team wins on its members' combined land, or when no
 * other side (team, or a teamless nation/human) has a player left — tribes can't win and
 * don't block it. Alliances never add land.
 */
import type { GameRules } from "../rules.ts";
import { isTribe, type Player, type World } from "../world.ts";
import { endAllAttacks } from "./attacks.ts";
import { unloadAllBoats } from "./naval.ts";

type Reason = "landShare" | "lastStanding" | "noneLeft";

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
  if (world.teamCount > 0 && checkTeamVictory(world, standing, needed)) return;

  const dominant = standing.find((p) => p.tiles >= needed);
  if (dominant) return endGame(world, dominant.id, 0, "landShare");
  if (standing.length === 1 && world.players.length > 1) {
    return endGame(world, standing[0]!.id, 0, "lastStanding");
  }
  if (standing.length === 0) endGame(world, null, 0, "noneLeft");
}

/** Team rules first; returns true if the game ended. Falls through to the player rules. */
function checkTeamVictory(world: World, standing: Player[], needed: number): boolean {
  const land = new Array<number>(world.teamCount + 1).fill(0);
  for (const p of standing) land[p.team]! += p.tiles;
  for (let team = 1; team <= world.teamCount; team++) {
    if (land[team]! >= needed) {
      endGame(world, topMember(standing, team), team, "landShare");
      return true;
    }
  }
  // Sides still in the game: teams, plus any teamless nation or human on their own.
  const sides = new Set<number>();
  for (const p of standing) if (!isTribe(p)) sides.add(p.team > 0 ? p.team : -p.id);
  if (sides.size !== 1) return false;
  const [side] = sides;
  if (side! > 0) endGame(world, topMember(standing, side!), side!, "lastStanding");
  else endGame(world, -side!, 0, "lastStanding");
  return true;
}

/** The team's member with the most land (the frame's `winner`). */
function topMember(standing: Player[], team: number): number {
  let best: Player | null = null;
  for (const p of standing) if (p.team === team && (!best || p.tiles > best.tiles)) best = p;
  return best!.id;
}

function endGame(world: World, winner: number | null, team: number, reason: Reason): void {
  world.winner = winner;
  world.winningTeam = team;
  world.phase = "ended";
  endAllAttacks(world);
  unloadAllBoats(world);
  world.events.push({ type: "gameOver", winner, team, reason });
}

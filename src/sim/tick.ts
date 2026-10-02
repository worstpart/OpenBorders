/**
 * One simulation tick: the systems in their fixed, documented order (ARCHITECTURE.md §5.3).
 * Later milestones slot their systems into the marked places.
 */
import type { Command, StampedCommand, Turn } from "./commands.ts";
import { buildFrame, type TickFrame } from "./frame.ts";
import { applyConfirmSpawn, applySpawnCommand, updateSpawnPhase } from "./systems/spawn.ts";
import { growTroops } from "./systems/troops.ts";
import { getPlayer, type Player, type World } from "./world.ts";

export function runTick(world: World, turn: Turn): TickFrame {
  if (turn.tick !== world.tick + 1) {
    throw new Error(`Turn for tick ${turn.tick} applied to a world at tick ${world.tick}`);
  }
  world.tick = turn.tick;
  world.changes.clear();
  world.events.length = 0;

  // 1. Commands (from humans now; bots' commands will be queued here too, see step 7).
  applyCommands(world, turn.commands);

  if (world.phase === "spawn") updateSpawnPhase(world);

  if (world.phase === "playing") {
    // 2. resolve attack collisions  — milestone 1.3
    // 3. advance attacks            — milestone 1.3
    // 4. eliminate                  — milestone 1.4
    // 5. encircle                   — milestone 1.4
    // 6. troops
    growTroops(world);
    // 7. AI thinking                — milestone 1.5
    // 8. victory check              — milestone 1.4
  }

  // 9. Report.
  return buildFrame(world);
}

function applyCommands(world: World, commands: readonly StampedCommand[]): void {
  for (const { playerId, command } of commands) {
    const player = getPlayer(world, playerId);
    const reason = player ? applyCommand(world, player, command) : "unknown player";
    if (reason !== null) {
      world.events.push({ type: "commandRejected", playerId, command: command.type, reason });
    }
  }
}

/** Executes one command. Returns why it was rejected, or null if it was applied. */
function applyCommand(world: World, player: Player, command: Command): string | null {
  if (!player.alive) return "player is eliminated";
  switch (command.type) {
    case "spawn":
      return applySpawnCommand(world, player, command.tile);
    case "confirmSpawn":
      return applyConfirmSpawn(world, player);
    default:
      return `unknown command ${(command as { type: unknown }).type}`;
  }
}

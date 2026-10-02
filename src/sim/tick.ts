/**
 * One simulation tick: the systems in their fixed, documented order (ARCHITECTURE.md §5.3).
 * Later milestones slot their systems into the marked places.
 */
import { thinkBots } from "./ai/bot.ts";
import type { Command, StampedCommand, Turn } from "./commands.ts";
import { buildFrame, type TickFrame } from "./frame.ts";
import {
  advanceAttacks,
  applyAttackCommand,
  applyRetreatCommand,
  resolveCollisions,
} from "./systems/attacks.ts";
import { eliminate } from "./systems/elimination.ts";
import { encircle } from "./systems/encirclement.ts";
import { applyConfirmSpawn, applySpawnCommand, updateSpawnPhase } from "./systems/spawn.ts";
import { growTroops } from "./systems/troops.ts";
import { checkVictory } from "./systems/victory.ts";
import { getPlayer, type Player, type World } from "./world.ts";

/**
 * Names of the tick's steps, as reported to a {@link TickProbe} (in order). Tools use
 * them to time each system; the simulation itself never reads a clock.
 */
export const TICK_STEPS = [
  "commands",
  "collisions",
  "attacks",
  "encircle",
  "eliminate",
  "troops",
  "bots",
  "victory",
  "frame",
] as const;
export type TickStep = (typeof TICK_STEPS)[number];
/** Called right after each step finishes (steps skipped in the spawn phase are not reported). */
export type TickProbe = (step: TickStep) => void;

export function runTick(world: World, turn: Turn, probe?: TickProbe): TickFrame {
  if (turn.tick !== world.tick + 1) {
    throw new Error(`Turn for tick ${turn.tick} applied to a world at tick ${world.tick}`);
  }
  world.tick = turn.tick;
  world.changes.clear();
  world.events.length = 0;

  // 1. Commands: the bots' decisions from last tick, then this turn's (human) commands.
  const botCommands = world.pendingCommands;
  world.pendingCommands = [];
  applyCommands(world, botCommands);
  applyCommands(world, turn.commands);

  if (world.phase === "spawn") updateSpawnPhase(world);
  probe?.("commands");

  if (world.phase === "playing") {
    // 2. Opposing armies cancel out.
    resolveCollisions(world);
    probe?.("collisions");
    // 3. Fronts advance; retreating armies come home.
    advanceAttacks(world);
    probe?.("attacks");
    // 4. Fully enclosed land falls to the encloser (staggered checks).
    encircle(world);
    probe?.("encircle");
    // 5. Players with no land (or a collapsed remnant under attack) are out.
    eliminate(world);
    probe?.("eliminate");
    // 6. Troops regrow.
    growTroops(world);
    probe?.("troops");
    // 7. Bots decide; their commands apply next tick through step 1.
    thinkBots(world);
    probe?.("bots");
    // 8. 70% of the land, or last one standing, wins.
    checkVictory(world);
    probe?.("victory");
  }

  // 9. Report.
  const frame = buildFrame(world);
  probe?.("frame");
  return frame;
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
    case "attack":
      return applyAttackCommand(
        world,
        player,
        command.target,
        command.focusTile,
        command.percentBp,
      );
    case "retreat":
      return applyRetreatCommand(world, player, command.attackId);
    default:
      return `unknown command ${(command as { type: unknown }).type}`;
  }
}

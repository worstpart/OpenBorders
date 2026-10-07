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
import {
  applyAllianceBreak,
  applyAllianceRenew,
  applyAllianceReply,
  applyAllianceRequest,
  updateDiplomacy,
} from "./systems/diplomacy.ts";
import {
  applyBuild,
  applyCancelBuild,
  applyUpgrade,
  updateBuildings,
} from "./systems/buildings.ts";
import { applyDonate, applyMobilize, earnGold } from "./systems/economy.ts";
import { applyBuildWall, applyCancelWall, applyUpgradeWall, updateWalls } from "./systems/walls.ts";
import { advanceBoats, applyBoatCommand, applyRecallBoat } from "./systems/naval.ts";
import { advanceTrade } from "./systems/trade.ts";
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
  "diplomacy",
  "collisions",
  "boats",
  "attacks",
  "encircle",
  "eliminate",
  "buildings",
  "troops",
  "economy",
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
  world.fortChanges.clear();
  world.events.length = 0;

  // 1. Commands: the bots' decisions from last tick, then this turn's (human) commands.
  const botCommands = world.pendingCommands;
  world.pendingCommands = [];
  applyCommands(world, botCommands);
  applyCommands(world, turn.commands);

  if (world.phase === "spawn") updateSpawnPhase(world);
  probe?.("commands");

  if (world.phase === "playing") {
    // 1b. Alliance requests and alliances run out.
    updateDiplomacy(world);
    probe?.("diplomacy");
    // 2. Opposing armies cancel out.
    resolveCollisions(world);
    probe?.("collisions");
    // 2b. Boats land (as beachhead attacks) or get home (GAME_DESIGN.md §3.18).
    advanceBoats(world);
    probe?.("boats");
    // 3. Fronts advance; retreating armies come home.
    advanceAttacks(world);
    probe?.("attacks");
    // 4. Fully enclosed land falls to the encloser (staggered checks).
    encircle(world);
    probe?.("encircle");
    // 5. Players with no land (or a collapsed remnant under attack) are out.
    eliminate(world);
    probe?.("eliminate");
    // 5b. Buildings on captured land change hands; constructions finish (walls too);
    //     bonuses add up.
    updateBuildings(world);
    updateWalls(world);
    probe?.("buildings");
    // 6. Troops regrow.
    growTroops(world);
    probe?.("troops");
    // 6b. Gold comes in (GAME_DESIGN.md §3.16); trade ships dock and set sail (§3.19).
    earnGold(world);
    advanceTrade(world);
    probe?.("economy");
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
    case "boat":
      return applyBoatCommand(world, player, command.target, command.tile, command.percentBp);
    case "recallBoat":
      return applyRecallBoat(world, player, command.boatId);
    case "allianceRequest":
      return applyAllianceRequest(world, player, command.target);
    case "allianceReply":
      return applyAllianceReply(world, player, command.from, command.accept === true);
    case "allianceRenew":
      return applyAllianceRenew(world, player, command.ally);
    case "allianceBreak":
      return applyAllianceBreak(world, player, command.ally);
    case "mobilize":
      return applyMobilize(world, player, command.percentBp);
    case "donate":
      return applyDonate(world, player, command.to, command.resource, command.percentBp);
    case "build":
      return applyBuild(world, player, command.buildingType, command.tile);
    case "upgrade":
      return applyUpgrade(world, player, command.buildingId);
    case "cancelBuild":
      return applyCancelBuild(world, player, command.buildingId);
    case "buildWall":
      return applyBuildWall(world, player, command.points);
    case "upgradeWall":
      return applyUpgradeWall(world, player, command.wallId);
    case "cancelWall":
      return applyCancelWall(world, player, command.wallId);
    default:
      return `unknown command ${(command as { type: unknown }).type}`;
  }
}

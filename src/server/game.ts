/**
 * One online game on the server (D-006): the same simulation the browsers run, fed by the
 * commands players send. Every tick it takes the queued commands — stamped with the sender
 * the connection belongs to, never a player id a client claims — runs the tick and returns
 * the turn to broadcast with the server's state hash.
 */
import type { Command, StampedCommand } from "../sim/commands.ts";
import { generateMap } from "../sim/map/generate.ts";
import { runTick } from "../sim/tick.ts";
import { createWorld, type PlayerId, type World } from "../sim/world.ts";
import type { GameConfig, ServerMessage } from "../shared/protocol.ts";

export type TurnMessage = Extract<ServerMessage, { t: "turn" }>;

export class ServerGame {
  readonly world: World;
  private queued: StampedCommand[] = [];

  constructor(config: GameConfig) {
    const map = generateMap(config.map);
    this.world = createWorld({ seed: config.seed, map, players: config.players });
  }

  get ended(): boolean {
    return this.world.phase === "ended";
  }

  /** A command from `playerId`, for the next tick. */
  queue(playerId: PlayerId, command: Command): void {
    this.queued.push({ playerId, command });
  }

  /** Runs the next tick with the queued commands; returns the turn every client must apply. */
  tick(): TurnMessage {
    const commands = this.queued;
    this.queued = [];
    const tick = this.world.tick + 1;
    const frame = runTick(this.world, { tick, commands });
    return { t: "turn", tick, commands, hash: frame.hash };
  }
}

const COMMAND_TYPES: ReadonlySet<string> = new Set([
  "spawn",
  "confirmSpawn",
  "attack",
  "boat",
  "recallBoat",
  "retreat",
  "allianceRequest",
  "allianceReply",
  "allianceRenew",
  "allianceBreak",
  "donate",
  "build",
  "upgrade",
  "cancelBuild",
  "buildWall",
  "upgradeWall",
  "cancelWall",
  "emote",
  "airlift",
  "assault",
  "airStrike",
  "launchMissile",
  "moveWarship",
  "ping",
  // "testFlight" is a development command: never accepted online.
]);

/**
 * A first check of a client's command before it reaches the simulation (milestone 3.1;
 * 3.3 adds rate limits and per-command field checks). The simulation validates every
 * command's meaning itself; this only keeps out what isn't a command at all: unknown types,
 * and values that aren't finite numbers, short strings, booleans or short number lists.
 */
export function commandProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "not a command";
  const type = (value as { type?: unknown }).type;
  if (typeof type !== "string" || !COMMAND_TYPES.has(type)) return "unknown command";
  for (const [key, field] of Object.entries(value)) {
    if (key === "type") continue;
    if (typeof field === "number" ? !Number.isFinite(field) : false) return `bad ${key}`;
    if (typeof field === "string" && field.length > 32) return `bad ${key}`;
    if (Array.isArray(field)) {
      if (field.length > 64 || !field.every((n) => typeof n === "number" && Number.isFinite(n))) {
        return `bad ${key}`;
      }
      continue;
    }
    if (!["number", "string", "boolean"].includes(typeof field)) return `bad ${key}`;
  }
  return null;
}

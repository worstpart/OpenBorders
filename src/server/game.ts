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

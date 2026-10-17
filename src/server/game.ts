/**
 * One online game on the server (D-006): the same simulation the browsers run, fed by the
 * commands players send. Every tick it takes the queued commands — stamped with the sender
 * the connection belongs to, never a player id a client claims — runs the tick and returns
 * the turn to broadcast with the server's state hash. Between ticks it can save the whole
 * world as a snapshot (3.5) for a client that drifted, rejoins or watches.
 */
import type { Command, StampedCommand } from "../sim/commands.ts";
import { generateMap } from "../sim/map/generate.ts";
import { serializeWorld } from "../sim/snapshot.ts";
import { runTick } from "../sim/tick.ts";
import { createWorld, type PlayerId, type World } from "../sim/world.ts";
import { ONLINE_RULES, type GameConfig, type ServerMessage } from "../shared/protocol.ts";

export type TurnMessage = Extract<ServerMessage, { t: "turn" }>;

export class ServerGame {
  readonly world: World;
  private queued: StampedCommand[] = [];
  /** The latest snapshot as JSON, kept until the next tick (several asking at once share it). */
  private saved: { tick: number; json: string } | null = null;

  constructor(config: GameConfig) {
    const map = generateMap(config.map);
    this.world = createWorld({
      seed: config.seed,
      map,
      players: config.players,
      rules: ONLINE_RULES,
    });
  }

  get ended(): boolean {
    return this.world.phase === "ended";
  }

  /** A command from `playerId`, for the next tick. */
  queue(playerId: PlayerId, command: Command): void {
    this.queued.push({ playerId, command });
  }

  /** The world now, as snapshot JSON (call between ticks). */
  snapshot(): { tick: number; json: string } {
    if (this.saved?.tick !== this.world.tick) {
      this.saved = { tick: this.world.tick, json: JSON.stringify(serializeWorld(this.world)) };
    }
    return this.saved;
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

/**
 * Commands are the ONLY way to change the simulation (ARCHITECTURE.md §5.5, D-005).
 * The UI, the AI and (later) the network all produce these same commands. The
 * simulation validates each one when it executes; invalid commands are rejected and
 * reported as events (they are normal in multiplayer, e.g. a stale click).
 */
import type { PlayerId } from "./world.ts";

export type Command =
  /** Choose (or move) your starting position. Spawn phase only. */
  | { readonly type: "spawn"; readonly tile: number }
  /** Lock in your spawn. The match starts once every human has confirmed. */
  | { readonly type: "confirmSpawn" }
  /**
   * Send a share of your home troops into `target`'s land (0 = expand into neutral land),
   * aimed at `focusTile`. A second attack on the same target merges into the first.
   * Percent in basis points (2500 = 25%): clients never send absolute troop numbers.
   */
  | {
      readonly type: "attack";
      readonly target: PlayerId;
      readonly focusTile: number;
      readonly percentBp: number;
    }
  /** Stop an attack; its army comes home after a delay, minus a penalty against players. */
  | { readonly type: "retreat"; readonly attackId: number };

/** A command together with the player who issued it (stamped by the host, never by the client). */
export interface StampedCommand {
  readonly playerId: PlayerId;
  readonly command: Command;
}

/** Everything the simulation needs to advance one tick. */
export interface Turn {
  readonly tick: number;
  readonly commands: readonly StampedCommand[];
}

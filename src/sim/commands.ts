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
  | { readonly type: "confirmSpawn" };

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

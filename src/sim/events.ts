/**
 * Things that happened during a tick, reported in the tick frame so the client can show
 * toasts and effects. Events describe outcomes; they never drive the simulation.
 */
import type { Command } from "./commands.ts";
import type { Phase, PlayerId } from "./world.ts";

export type SimEvent =
  | { readonly type: "phaseChanged"; readonly phase: Phase }
  | {
      readonly type: "spawned";
      readonly playerId: PlayerId;
      readonly tile: number;
      /** True when the spawn was chosen automatically (bots, or a player who didn't pick). */
      readonly automatic: boolean;
    }
  | {
      readonly type: "commandRejected";
      readonly playerId: PlayerId;
      readonly command: Command["type"];
      readonly reason: string;
    };

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
      readonly type: "attackStarted";
      readonly attackId: number;
      readonly attacker: PlayerId;
      /** 0 = expanding into neutral land. */
      readonly target: PlayerId;
    }
  | {
      readonly type: "attackEnded";
      readonly attackId: number;
      readonly attacker: PlayerId;
      readonly target: PlayerId;
      /**
       * spent: out of troops · complete: nothing left to take · retreated: came home
       * after a retreat · cancelled: destroyed by the target's opposing attack.
       */
      readonly reason: "spent" | "complete" | "retreated" | "cancelled";
      /** Troops that made it home. */
      readonly survivors: number;
    }
  | {
      readonly type: "commandRejected";
      readonly playerId: PlayerId;
      readonly command: Command["type"];
      readonly reason: string;
    };

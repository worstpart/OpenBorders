/**
 * Commands are the ONLY way to change the simulation (ARCHITECTURE.md §5.5, D-005).
 * The UI, the AI and (later) the network all produce these same commands. The
 * simulation validates each one when it executes; invalid commands are rejected and
 * reported as events (they are normal in multiplayer, e.g. a stale click).
 */
import type { BuildingType } from "./rules.ts";
import type { DonationResource, PlayerId } from "./world.ts";

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
  | { readonly type: "retreat"; readonly attackId: number }
  /**
   * Ask `target` for an alliance (GAME_DESIGN.md §3.14). If they already asked us, this
   * accepts their request.
   */
  | { readonly type: "allianceRequest"; readonly target: PlayerId }
  /** Accept or decline `from`'s open request. */
  | { readonly type: "allianceReply"; readonly from: PlayerId; readonly accept: boolean }
  /** During the renewal window: agree to extend the alliance with `ally`. */
  | { readonly type: "allianceRenew"; readonly ally: PlayerId }
  /** End the alliance with `ally` now; the breaker becomes a traitor for a while. */
  | { readonly type: "allianceBreak"; readonly ally: PlayerId }
  /**
   * Spend gold on instant home troops (GAME_DESIGN.md §3.16): up to this share of your
   * capacity (basis points), limited by your gold and the room under the cap.
   */
  | { readonly type: "mobilize"; readonly percentBp: number }
  /** Give an ally or teammate a share (basis points) of your home troops or your gold. */
  | {
      readonly type: "donate";
      readonly to: PlayerId;
      readonly resource: DonationResource;
      readonly percentBp: number;
    }
  /** Build a level-I building on one of your tiles (GAME_DESIGN.md §3.17). */
  | { readonly type: "build"; readonly buildingType: BuildingType; readonly tile: number }
  /** Upgrade one of your buildings to its next level. */
  | { readonly type: "upgrade"; readonly buildingId: number }
  /** Stop a construction or upgrade; part of the price comes back. */
  | { readonly type: "cancelBuild"; readonly buildingId: number }
  /**
   * Build a level-I wall on your land through corner points A, B, C … (tiles; straight
   * pieces between them — GAME_DESIGN.md §3.17.6, D-024).
   */
  | { readonly type: "buildWall"; readonly points: readonly number[] }
  /** Upgrade one of your walls (all of it that still stands) to its next level. */
  | { readonly type: "upgradeWall"; readonly wallId: number }
  /** Stop a wall's construction or upgrade; part of the price comes back. */
  | { readonly type: "cancelWall"; readonly wallId: number };

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

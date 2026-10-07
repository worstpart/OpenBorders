/**
 * Things that happened during a tick, reported in the tick frame so the client can show
 * toasts and effects. Events describe outcomes; they never drive the simulation.
 */
import type { Command } from "./commands.ts";
import type { BuildingType, PingKind } from "./rules.ts";
import type { DonationResource, FlightKind, Phase, PlayerId } from "./world.ts";

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
      /** A beachhead (a boat landing): the tile it landed on; -1 for a land attack. */
      readonly landingTile: number;
    }
  | {
      readonly type: "attackEnded";
      readonly attackId: number;
      readonly attacker: PlayerId;
      readonly target: PlayerId;
      /**
       * spent: out of troops · complete: nothing left to take · retreated: came home
       * after a retreat · cancelled: destroyed by the target's opposing attack ·
       * eliminated: the attacker was eliminated and the army is lost.
       */
      readonly reason: "spent" | "complete" | "retreated" | "cancelled" | "eliminated";
      /** Troops that made it home. */
      readonly survivors: number;
    }
  | {
      /** A fully enclosed piece of `playerId`'s land fell to `by`. */
      readonly type: "encircled";
      readonly playerId: PlayerId;
      readonly by: PlayerId;
      readonly tiles: number;
    }
  | {
      readonly type: "eliminated";
      readonly playerId: PlayerId;
      /** Who finished them (the biggest attacker at the time), if anyone. */
      readonly by: PlayerId | null;
      /** Gold `by` took from them (GAME_DESIGN.md §3.16). */
      readonly loot: number;
    }
  | {
      readonly type: "gameOver";
      readonly winner: PlayerId | null;
      /** Team games: the winning team (0 = none / free-for-all). */
      readonly team: number;
      readonly reason: "landShare" | "lastStanding" | "noneLeft";
    }
  | { readonly type: "allianceRequested"; readonly from: PlayerId; readonly to: PlayerId }
  | {
      /** A request was answered no, or ran out of time (`expired`). */
      readonly type: "allianceRequestEnded";
      readonly from: PlayerId;
      readonly to: PlayerId;
      readonly reason: "declined" | "expired";
    }
  | { readonly type: "allianceFormed"; readonly a: PlayerId; readonly b: PlayerId }
  | { readonly type: "allianceRenewed"; readonly a: PlayerId; readonly b: PlayerId }
  | {
      /** Ran out (`expired`), or one of them was eliminated (`eliminated`). */
      readonly type: "allianceEnded";
      readonly a: PlayerId;
      readonly b: PlayerId;
      readonly reason: "expired" | "eliminated";
    }
  | {
      /** `breaker` broke the alliance with `victim` and is now a traitor. */
      readonly type: "allianceBroken";
      readonly breaker: PlayerId;
      readonly victim: PlayerId;
    }
  | {
      /** Gold turned into home troops. */
      readonly type: "mobilized";
      readonly playerId: PlayerId;
      readonly troops: number;
      readonly gold: number;
    }
  | {
      /** A friend gave troops or gold. */
      readonly type: "donated";
      readonly from: PlayerId;
      readonly to: PlayerId;
      readonly resource: DonationResource;
      readonly amount: number;
    }
  | {
      /** A construction (level 1) or an upgrade (level 2–3) began; `gold` was paid. */
      readonly type: "buildingStarted";
      readonly buildingId: number;
      readonly playerId: PlayerId;
      readonly buildingType: BuildingType;
      readonly tile: number;
      readonly level: number;
      readonly gold: number;
    }
  | {
      /** A construction or upgrade finished: the building works at `level` now. */
      readonly type: "buildingCompleted";
      readonly buildingId: number;
      readonly playerId: PlayerId;
      readonly buildingType: BuildingType;
      readonly tile: number;
      readonly level: number;
    }
  | {
      /** A construction or upgrade was cancelled (`refund` gold came back). */
      readonly type: "buildingCancelled";
      readonly buildingId: number;
      readonly playerId: PlayerId;
      readonly refund: number;
    }
  | {
      /** `to` took the building's tile and now owns it, one level lower. */
      readonly type: "buildingCaptured";
      readonly buildingId: number;
      readonly from: PlayerId;
      readonly to: PlayerId;
      readonly buildingType: BuildingType;
      readonly tile: number;
      readonly level: number;
    }
  | {
      /** The building is gone: its tile was captured (by `by`), or its construction cancelled. */
      readonly type: "buildingDestroyed";
      readonly buildingId: number;
      readonly playerId: PlayerId;
      readonly buildingType: BuildingType;
      readonly tile: number;
      readonly by: PlayerId | null;
      readonly reason: "captured" | "cancelled";
    }
  | {
      /** A wall's construction (level 1) or upgrade began (GAME_DESIGN.md §3.17.6). */
      readonly type: "wallStarted";
      readonly wallId: number;
      readonly playerId: PlayerId;
      readonly level: number;
      readonly tiles: number;
      readonly gold: number;
    }
  | {
      /** A wall's construction or upgrade finished: it works at `level` now. */
      readonly type: "wallCompleted";
      readonly wallId: number;
      readonly playerId: PlayerId;
      readonly level: number;
    }
  | {
      readonly type: "wallCancelled";
      readonly wallId: number;
      readonly playerId: PlayerId;
      readonly refund: number;
    }
  | {
      /** One of the wall's tiles changed hands (taken by `by`, 0 = neutral): a gap. */
      readonly type: "wallBreached";
      readonly wallId: number;
      readonly playerId: PlayerId;
      readonly tile: number;
      readonly by: PlayerId;
    }
  | {
      /** The wall is gone: its last tile broke, or its construction was cancelled. */
      readonly type: "wallDestroyed";
      readonly wallId: number;
      readonly playerId: PlayerId;
      readonly by: PlayerId | null;
      readonly reason: "breached" | "cancelled";
    }
  | {
      /** A boat set sail (GAME_DESIGN.md §3.18); it lands at `arriveTick`. */
      readonly type: "boatLaunched";
      readonly boatId: number;
      readonly owner: PlayerId;
      /** Whose coast it sails for (0 = neutral land). */
      readonly target: PlayerId;
      readonly troops: number;
      readonly landingTile: number;
      readonly arriveTick: number;
    }
  | {
      /**
       * A boat reached its landing tile: its troops attack from there (`attackId`), or —
       * if that land is now the owner's or a friend's — go home (`attackId` -1).
       */
      readonly type: "boatLanded";
      readonly boatId: number;
      readonly owner: PlayerId;
      /** Who owned the landing tile when it arrived. */
      readonly target: PlayerId;
      readonly tile: number;
      readonly troops: number;
      readonly attackId: number;
    }
  | {
      /** The owner called the boat back; it sails home and arrives at `arriveTick`. */
      readonly type: "boatRecalled";
      readonly boatId: number;
      readonly owner: PlayerId;
      readonly arriveTick: number;
    }
  | {
      /** A recalled boat got home (`troops` back), or sank with its owner (`troops` 0). */
      readonly type: "boatReturned";
      readonly boatId: number;
      readonly owner: PlayerId;
      readonly troops: number;
    }
  | {
      /**
       * A trade ship docked (GAME_DESIGN.md §3.19): its owner and the Port's owner (`receiver`)
       * each earned `gold` — or, if the Port was gone or is now the owner's own, nobody did
       * (`receiver` 0, `gold` 0).
       */
      readonly type: "tradeDocked";
      readonly shipId: number;
      readonly owner: PlayerId;
      readonly receiver: PlayerId;
      readonly fromPort: number;
      readonly toPort: number;
      /** The destination Port's tile. */
      readonly tile: number;
      readonly gold: number;
    }
  | {
      /** A flight took off (GAME_DESIGN.md §3.17.7); it is over its target at `arriveTick`. */
      readonly type: "flightLaunched";
      readonly flightId: number;
      readonly owner: PlayerId;
      readonly kind: FlightKind;
      /** Who owned the target tile at launch (0 = neutral land or sea). */
      readonly target: PlayerId;
      readonly fromTile: number;
      readonly toTile: number;
      readonly planes: number;
      readonly troops: number;
      readonly arriveTick: number;
    }
  | {
      /** A flight reached its target with `planes` planes and `troops` aboard. */
      readonly type: "flightArrived";
      readonly flightId: number;
      readonly owner: PlayerId;
      readonly kind: FlightKind;
      readonly tile: number;
      /** Who owns the target tile now. */
      readonly target: PlayerId;
      readonly planes: number;
      readonly troops: number;
    }
  | {
      /**
       * `by` shot down `planes` of a flight over `tile` (with `troopsLost` aboard); it flies on
       * with `planesLeft` (0 = the flight is gone).
       */
      readonly type: "flightIntercepted";
      readonly flightId: number;
      readonly owner: PlayerId;
      readonly by: PlayerId;
      readonly tile: number;
      /** Where the shot came from (a SAM's tile, GAME_DESIGN.md §3.17.7), or -1. */
      readonly fromTile: number;
      readonly planes: number;
      readonly planesLeft: number;
      readonly troopsLost: number;
    }
  | {
      /**
       * An airlift (GAME_DESIGN.md §3.17.7) reached `to`: `troops` joined their home troops;
       * `returning` didn't fit (or `to` is no longer a friend) and fly back to `from`.
       */
      readonly type: "airliftDelivered";
      readonly flightId: number;
      readonly from: PlayerId;
      readonly to: PlayerId;
      readonly troops: number;
      readonly returning: number;
    }
  | {
      /** The flight's owner was eliminated: it is lost with everything aboard. */
      readonly type: "flightLost";
      readonly flightId: number;
      readonly owner: PlayerId;
    }
  | {
      /** An emoji (GAME_DESIGN.md §3.20): to one player, or to everyone (`to` 0). */
      readonly type: "emoted";
      readonly from: PlayerId;
      readonly to: PlayerId;
      /** Index into rules.chat.emojis. */
      readonly emoji: number;
    }
  | {
      /** A map ping for `from`'s allies and teammates. */
      readonly type: "pinged";
      readonly pingId: number;
      readonly from: PlayerId;
      readonly tile: number;
      readonly kind: PingKind;
      /** Who owned the tile (0 = neutral land or sea). */
      readonly target: PlayerId;
    }
  | {
      readonly type: "commandRejected";
      readonly playerId: PlayerId;
      readonly command: Command["type"];
      readonly reason: string;
    };

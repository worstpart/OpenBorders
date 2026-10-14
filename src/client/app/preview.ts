/**
 * "What would a click here do?" — the battle preview shown by the hover card, the
 * right-click menu and the attack chips (GAME_DESIGN.md §4.1, §5.1). It mirrors the
 * simulation's checks so the HUD never promises something the game will reject, and it
 * uses the same battle estimates as the bots (sim/battle.ts).
 */
import {
  attackLossFactor,
  battleOutlook,
  type BattleOutlook,
  type Odds,
} from "../../sim/battle.ts";
import type { PlayerSnapshot } from "../../sim/frame.ts";
import type { GameRules } from "../../sim/rules.ts";
import { wallLevel } from "../../sim/systems/walls.ts";
import type { Phase, PlayerId } from "../../sim/world.ts";
import { troopsToSend } from "./attackPercent.ts";

export type ClickPreview =
  | { readonly kind: "expand"; readonly army: number; readonly tiles: number }
  | {
      readonly kind: "attack";
      readonly army: number;
      readonly outlook: BattleOutlook;
      /** Wall level on the land clicked (0 = none, GAME_DESIGN.md §3.17.6). */
      readonly fortLevel: number;
    }
  | { readonly kind: "own" }
  | { readonly kind: "notReachable" }
  /** Allies can't attack each other (GAME_DESIGN.md §3.14). */
  | { readonly kind: "allied" }
  /** Nor can teammates (§3.15). */
  | { readonly kind: "teammate" }
  | { readonly kind: "protected"; readonly seconds: number }
  | { readonly kind: "noTroops" }
  | { readonly kind: "inactive" };

export interface PreviewContext {
  readonly rules: GameRules;
  readonly phase: Phase;
  readonly tick: number;
  readonly playStartTick: number;
  readonly me: PlayerSnapshot | undefined;
  readonly players: readonly PlayerSnapshot[];
  /** The local player's allies (empty when left out). */
  readonly allies?: ReadonlySet<PlayerId>;
  /** The local player's teammates (empty when left out). */
  readonly teammates?: ReadonlySet<PlayerId>;
  /** Border Defense level per tile (no walls when left out). */
  readonly fort?: Uint8Array;
  /** Coast a Naval Base fortifies (2B.6): tile → wall level. */
  readonly coastForts?: ReadonlyMap<number, number>;
}

/** Seconds of spawn protection left (0 once attacks on players are allowed). */
export function protectionSecondsLeft(ctx: PreviewContext): number {
  if (ctx.phase !== "playing") return 0;
  const end = ctx.playStartTick + ctx.rules.spawn.protectionTicks;
  return Math.max(0, ((end - ctx.tick) * ctx.rules.tickMs) / 1000);
}

/**
 * The preview of clicking land owned by `target` (0 = neutral) with `percent`% of home
 * troops. The attack aims at the clicked `tile`, so a wall there counts in the odds — the
 * same loss factor the simulation charges for that tile (GAME_DESIGN.md §3.17.6).
 */
export function previewClick(
  ctx: PreviewContext,
  target: PlayerId,
  percent: number,
  tile = -1,
): ClickPreview {
  const me = ctx.me;
  if (ctx.phase !== "playing" || !me?.alive) return { kind: "inactive" };
  if (target === me.id) return { kind: "own" };
  if (ctx.teammates?.has(target)) return { kind: "teammate" };
  if (!me.neighbors?.includes(target)) return { kind: "notReachable" };
  const defender = target === 0 ? null : ctx.players[target - 1];
  if (target !== 0 && !defender?.alive) return { kind: "notReachable" };
  if (ctx.allies?.has(target)) return { kind: "allied" };
  const seconds = protectionSecondsLeft(ctx);
  if (defender && seconds > 0) return { kind: "protected", seconds };
  const army = troopsToSend(me.homeTroops, percent);
  if (army < 1) return { kind: "noTroops" };
  if (!defender) {
    // Plains cost; highland and mountains cost more, so this is an upper bound.
    return {
      kind: "expand",
      army,
      tiles: Math.floor(army / ctx.rules.expansion.costPerTile.plains),
    };
  }
  const fortLevel = tile >= 0 ? Math.max(ctx.fort?.[tile] ?? 0, ctx.coastForts?.get(tile) ?? 0) : 0;
  return {
    kind: "attack",
    army,
    outlook: battleOutlook(
      ctx.rules,
      army,
      defender.homeTroops,
      defender.tiles,
      lossFactorOf(ctx.rules, me, defender, ctx.tick, fortLevel),
    ),
    fortLevel,
  };
}

/**
 * Taking a tribe's land is cheaper for anyone but a tribe (D-017), a traitor's for
 * everyone (GAME_DESIGN.md §3.14), and a wall dearer (`fortLevel`, §3.17.6).
 */
export function lossFactorOf(
  rules: GameRules,
  attacker: PlayerSnapshot | undefined,
  defender: PlayerSnapshot | undefined,
  tick: number,
  fortLevel = 0,
): number {
  return attackLossFactor(
    rules,
    attacker?.tier === "tribe",
    defender?.tier === "tribe",
    (defender?.traitorUntilTick ?? -1) > tick,
    fortLevel > 0 ? wallLevel(rules, fortLevel).loss : 1,
  );
}

export const ODDS_LABEL: Record<Odds, string> = {
  overwhelming: "Overwhelming",
  advantage: "Advantage",
  even: "Even",
  costly: "Costly",
  hopeless: "Hopeless",
};

/** One-line meaning of an outlook, e.g. "takes all their land" / "takes ~35% of their land". */
export function outcomeText(outlook: BattleOutlook): string {
  if (outlook.landShare >= 1) return "takes all their land";
  if (outlook.landShare < 0.02) return "barely moves";
  return `takes ~${Math.round(outlook.landShare * 100)}% of their land`;
}

/** How dangerous an incoming attack is for you: its odds, seen from the defender's side. */
export const THREAT_LABEL: Record<Odds, string> = {
  overwhelming: "Critical",
  advantage: "High",
  even: "Serious",
  costly: "Moderate",
  hopeless: "Low",
};

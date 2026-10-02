/**
 * "What would a click here do?" — the battle preview shown by the hover card, the
 * right-click menu and the attack chips (GAME_DESIGN.md §4.1, §5.1). It mirrors the
 * simulation's checks so the HUD never promises something the game will reject, and it
 * uses the same battle estimates as the bots (sim/battle.ts).
 */
import { battleOutlook, type BattleOutlook, type Odds } from "../../sim/battle.ts";
import type { PlayerSnapshot } from "../../sim/frame.ts";
import type { GameRules } from "../../sim/rules.ts";
import type { Phase, PlayerId } from "../../sim/world.ts";
import { troopsToSend } from "./attackPercent.ts";

export type ClickPreview =
  | { readonly kind: "expand"; readonly army: number; readonly tiles: number }
  | { readonly kind: "attack"; readonly army: number; readonly outlook: BattleOutlook }
  | { readonly kind: "own" }
  | { readonly kind: "notReachable" }
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
}

/** Seconds of spawn protection left (0 once attacks on players are allowed). */
export function protectionSecondsLeft(ctx: PreviewContext): number {
  if (ctx.phase !== "playing") return 0;
  const end = ctx.playStartTick + ctx.rules.spawn.protectionTicks;
  return Math.max(0, ((end - ctx.tick) * ctx.rules.tickMs) / 1000);
}

/** The preview of clicking land owned by `target` (0 = neutral) with `percent`% of home troops. */
export function previewClick(ctx: PreviewContext, target: PlayerId, percent: number): ClickPreview {
  const me = ctx.me;
  if (ctx.phase !== "playing" || !me?.alive) return { kind: "inactive" };
  if (target === me.id) return { kind: "own" };
  if (!me.neighbors?.includes(target)) return { kind: "notReachable" };
  const defender = target === 0 ? null : ctx.players[target - 1];
  if (target !== 0 && !defender?.alive) return { kind: "notReachable" };
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
  return {
    kind: "attack",
    army,
    outlook: battleOutlook(ctx.rules, army, defender.homeTroops, defender.tiles),
  };
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

/**
 * What the HUD shows about buildings (GAME_DESIGN.md §3.17): the build options in the
 * right-click menu, the building card, and which building a click hits. Pure functions
 * over frame snapshots; prices and placement rules come from the simulation itself.
 */
import type { BuildingSnapshot, PlayerSnapshot } from "../../sim/frame.ts";
import type { GameMap } from "../../sim/map/gameMap.ts";
import { BUILDING_TYPES, type BuildingType, type GameRules } from "../../sim/rules.ts";
import {
  buildingPrice,
  buildingsEnabled,
  levelRules,
  levelsOwned,
  MAX_LEVEL,
  placementProblem,
  type PlacementProblem,
} from "../../sim/systems/buildings.ts";
import { formatTroops } from "../format.ts";

export interface BuildContext {
  readonly rules: GameRules;
  readonly map: GameMap | null;
  readonly owner: Uint16Array;
  readonly buildings: readonly BuildingSnapshot[];
  readonly me: PlayerSnapshot | undefined;
  readonly tick: number;
  readonly playing: boolean;
}

/** One line per building type: what it is for (the build menu's subtitle). */
export const BUILDING_ROLE: Record<BuildingType, string> = {
  housing: "More troops",
  factory: "More gold",
};

/** What a level gives, in a few words per effect ("+90K troop capacity"). */
export function effectLines(rules: GameRules, type: BuildingType, level: number): string[] {
  if (level < 1) return [];
  const effect = levelRules(rules, type, level);
  const lines: string[] = [];
  if (effect.capacity) lines.push(`+${formatTroops(effect.capacity)} troop capacity`);
  if (effect.growthBonus) lines.push(`+${Math.round(effect.growthBonus * 100)}% troop growth`);
  if (effect.income) lines.push(`+${formatTroops(effect.income * 10)} gold/s`);
  if (effect.mobilizeDiscount) {
    lines.push(`Mobilize ${Math.round(effect.mobilizeDiscount * 100)}% cheaper`);
  }
  return lines;
}

/**
 * What the next level adds, for the upgrade preview: the improved numbers, and any effect
 * the level below doesn't have marked as new.
 */
export function upgradeLines(rules: GameRules, type: BuildingType, level: number): string[] {
  const now = levelRules(rules, type, level);
  const next = levelRules(rules, type, level + 1);
  const lines: string[] = [];
  if (next.capacity) lines.push(`Troop capacity +${formatTroops(next.capacity)}`);
  if (next.growthBonus) {
    lines.push(
      `${now.growthBonus ? "" : "New: "}+${Math.round(next.growthBonus * 100)}% troop growth`,
    );
  }
  if (next.income) {
    lines.push(`${now.income ? "Gold" : "New: gold"} +${formatTroops(next.income * 10)}/s`);
  }
  if (next.mobilizeDiscount) {
    lines.push(
      `${now.mobilizeDiscount ? "" : "New: "}Mobilize ${Math.round(next.mobilizeDiscount * 100)}% cheaper`,
    );
  }
  return lines;
}

export type BuildBlock = PlacementProblem | "noGold" | "notPlaying";

export interface BuildOption {
  readonly type: BuildingType;
  readonly name: string;
  readonly role: string;
  readonly price: number;
  readonly blocked: BuildBlock | null;
}

/** The build options for `tile` (empty when buildings are off or it isn't our land). */
export function buildOptions(ctx: BuildContext, tile: number): BuildOption[] {
  const me = ctx.me;
  if (!buildingsEnabled(ctx.rules) || !ctx.map || !me || ctx.owner[tile] !== me.id) return [];
  const problem = placementProblem(ctx.rules, ctx.map, ctx.owner, ctx.buildings, me.id, tile);
  return BUILDING_TYPES.map((type) => {
    const price = buildingPrice(ctx.rules, type, 1, levelsOwned(ctx.buildings, me.id, type));
    const blocked: BuildBlock | null = !ctx.playing
      ? "notPlaying"
      : (problem ?? (me.gold < price ? "noGold" : null));
    return {
      type,
      name: levelRules(ctx.rules, type, 1).name,
      role: BUILDING_ROLE[type],
      price,
      blocked,
    };
  });
}

export interface BuildBarItem {
  readonly type: BuildingType;
  readonly name: string;
  readonly role: string;
  readonly price: number;
  readonly affordable: boolean;
}

/** The build bar (GAME_DESIGN.md §3.17.13): every building with its current price. */
export function buildBarItems(ctx: BuildContext): BuildBarItem[] {
  const me = ctx.me;
  if (!buildingsEnabled(ctx.rules) || !me) return [];
  return BUILDING_TYPES.map((type) => {
    const price = buildingPrice(ctx.rules, type, 1, levelsOwned(ctx.buildings, me.id, type));
    return {
      type,
      name: levelRules(ctx.rules, type, 1).name,
      role: BUILDING_ROLE[type],
      price,
      affordable: me.gold >= price,
    };
  });
}

/** Whether the building being placed may go on `tile` now, and why not. */
export function placementCheck(
  ctx: BuildContext,
  type: BuildingType,
  tile: number,
): BuildBlock | null {
  const option = buildOptions(ctx, tile).find((o) => o.type === type);
  if (!option) return "notYourLand";
  return option.blocked;
}

export const BUILD_BLOCK_TEXT: Record<BuildBlock, string> = {
  notYourLand: "not your land",
  water: "not on water",
  tooClose: "too close to another building",
  noGold: "not enough gold",
  notPlaying: "after the match starts",
};

export interface BuildingCard {
  readonly id: number;
  readonly type: BuildingType;
  readonly mine: boolean;
  readonly owner: number;
  /** Working level (0 while first being built) and the name to show. */
  readonly level: number;
  readonly name: string;
  readonly effects: readonly string[];
  /** A construction or upgrade in progress. */
  readonly work: {
    readonly level: number;
    readonly secondsLeft: number;
    readonly progress: number;
  } | null;
  /** The next level (mine, idle, below III), with its price and what it adds. */
  readonly upgrade: {
    readonly name: string;
    readonly price: number;
    readonly lines: readonly string[];
    readonly affordable: boolean;
  } | null;
}

export function buildingCard(ctx: BuildContext, building: BuildingSnapshot): BuildingCard {
  const rules = ctx.rules;
  const mine = building.owner === ctx.me?.id;
  const working = building.readyTick >= 0;
  const shownLevel = Math.max(1, building.level);
  let upgrade: BuildingCard["upgrade"] = null;
  if (mine && !working && building.level < MAX_LEVEL) {
    const level = building.level + 1;
    const price = buildingPrice(
      rules,
      building.type,
      level,
      levelsOwned(ctx.buildings, building.owner, building.type),
    );
    upgrade = {
      name: levelRules(rules, building.type, level).name,
      price,
      lines: upgradeLines(rules, building.type, building.level),
      affordable: (ctx.me?.gold ?? 0) >= price,
    };
  }
  const total = building.readyTick - building.startTick;
  return {
    id: building.id,
    type: building.type,
    mine,
    owner: building.owner,
    level: building.level,
    name: levelRules(rules, building.type, shownLevel).name,
    effects: effectLines(rules, building.type, building.level),
    work: working
      ? {
          level: building.targetLevel,
          secondsLeft: Math.max(0, ((building.readyTick - ctx.tick) * rules.tickMs) / 1000),
          progress:
            total > 0 ? Math.min(1, Math.max(0, (ctx.tick - building.startTick) / total)) : 1,
        }
      : null,
    upgrade,
  };
}

/** The building nearest to (x, y) in tiles, within `radius` tiles, or null. */
export function buildingAtPoint(
  buildings: readonly BuildingSnapshot[],
  width: number,
  x: number,
  y: number,
  radius: number,
): BuildingSnapshot | null {
  let best: BuildingSnapshot | null = null;
  let bestDistance = radius * radius;
  for (const b of buildings) {
    const dx = (b.tile % width) + 0.5 - x;
    const dy = Math.floor(b.tile / width) + 0.5 - y;
    const d = dx * dx + dy * dy;
    if (d <= bestDistance) {
      best = b;
      bestDistance = d;
    }
  }
  return best;
}

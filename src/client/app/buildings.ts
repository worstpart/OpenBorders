/**
 * What the HUD shows about buildings and walls (GAME_DESIGN.md §3.17): the build bar, the
 * building/wall card, the wall being drawn, and which building or wall a click hits. Pure
 * functions over frame snapshots; prices and placement rules come from the simulation.
 */
import type { BuildingSnapshot, PlayerSnapshot, WallSnapshot } from "../../sim/frame.ts";
import type { GameMap } from "../../sim/map/gameMap.ts";
import { BUILDING_TYPES, type BuildingType, type GameRules } from "../../sim/rules.ts";
import {
  buildingAvailable,
  buildingPrice,
  buildingsEnabled,
  levelRules,
  levelsOwned,
  maxLevel,
  placementProblem,
  type PlacementProblem,
} from "../../sim/systems/buildings.ts";
import {
  WALL_PROBLEM_TEXT,
  wallLevel,
  wallLevelsOwned,
  wallPlan,
  wallPrice,
  wallTiles,
  type WallProblem,
} from "../../sim/systems/walls.ts";
import { formatTroops } from "../format.ts";

/** What the build bar can pick up: a building, or the wall tool (D-024). */
export type Placeable = BuildingType | "wall";

export interface BuildContext {
  readonly rules: GameRules;
  readonly map: GameMap | null;
  readonly owner: Uint16Array;
  readonly buildings: readonly BuildingSnapshot[];
  readonly walls: readonly WallSnapshot[];
  readonly me: PlayerSnapshot | undefined;
  readonly tick: number;
  readonly playing: boolean;
}

/** One line per building type: what it is for (the build menu's subtitle). */
export const BUILDING_ROLE: Record<Placeable, string> = {
  housing: "More troops",
  factory: "More gold",
  port: "Faster boats",
  wall: "Draw a defence line",
};

/** The building types this game offers (Ports only with boats). */
function availableTypes(rules: GameRules): BuildingType[] {
  return BUILDING_TYPES.filter((type) => buildingAvailable(rules, type));
}

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
  if (effect.boatSpeed) {
    lines.push(`Boats ×${effect.boatSpeed} faster within ${effect.range ?? 0} km`);
  }
  if (effect.boatSlots)
    lines.push(`+${effect.boatSlots} boat${effect.boatSlots > 1 ? "s" : ""} at sea`);
  if (effect.boatLoss) {
    lines.push(`Marines: landings lose ${Math.round((1 - effect.boatLoss) * 100)}% less`);
  }
  return lines;
}

/** What a wall level does to attackers (GAME_DESIGN.md §3.17.6). */
export function wallLines(rules: GameRules, level: number): string[] {
  const l = wallLevel(rules, level);
  return [
    `Holds an attack ~${l.holdTicks / 10} s per tile`,
    `Attackers lose ×${l.loss} + ${formatTroops(l.breakTroops)} troops per tile`,
  ];
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
  if (next.boatSpeed) lines.push(`Boats ×${next.boatSpeed} faster`);
  if (next.boatSlots) lines.push(`+${next.boatSlots} boats at sea`);
  if (next.boatLoss) {
    lines.push(
      `${now.boatLoss ? "" : "New: Marines — "}landings lose ${Math.round((1 - next.boatLoss) * 100)}% less`,
    );
  }
  return lines;
}

export type BuildBlock = PlacementProblem | "noGold" | "notPlaying" | "wall";

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
  const onWall = standingWallTiles(ctx.walls).has(tile);
  return availableTypes(ctx.rules).map((type) => {
    const price = buildingPrice(ctx.rules, type, 1, levelsOwned(ctx.buildings, me.id, type));
    const problem: BuildBlock | null =
      placementProblem(ctx.rules, ctx.map!, ctx.owner, ctx.buildings, me.id, tile, type) ??
      (onWall ? "wall" : null);
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
  readonly type: Placeable;
  readonly name: string;
  readonly role: string;
  readonly price: number;
  /** "/tile" for walls (priced per tile). */
  readonly unit: string;
  readonly affordable: boolean;
}

/** The build bar (GAME_DESIGN.md §3.17.13): every building with its price, then the wall. */
export function buildBarItems(ctx: BuildContext): BuildBarItem[] {
  const me = ctx.me;
  if (!buildingsEnabled(ctx.rules) || !me) return [];
  const items: BuildBarItem[] = availableTypes(ctx.rules).map((type) => {
    const price = buildingPrice(ctx.rules, type, 1, levelsOwned(ctx.buildings, me.id, type));
    return {
      type,
      name: levelRules(ctx.rules, type, 1).name,
      role: BUILDING_ROLE[type],
      price,
      unit: "",
      affordable: me.gold >= price,
    };
  });
  const perTile = wallTilePrice(ctx);
  items.push({
    type: "wall",
    name: "Wall",
    role: BUILDING_ROLE.wall,
    price: perTile,
    unit: "/tile",
    affordable: me.gold >= perTile * 2,
  });
  return items;
}

/** Gold per wall tile at level I for the local player now (escalation included). */
function wallTilePrice(ctx: BuildContext): number {
  const rules = ctx.rules;
  const owned = wallLevelsOwned(
    ctx.walls.map((w) => ({ owner: w.owner, targetLevel: w.targetLevel, intact: w.tiles.length })),
    ctx.me?.id ?? 0,
  );
  const factor = Math.min(
    rules.buildings.escalationMax,
    1 + (rules.buildings.escalationPerLevel * owned) / rules.walls.escalationTiles,
  );
  return Math.round(wallLevel(rules, 1).costPerTile * factor);
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
  notCoast: "a port must stand on the coast",
  tooClose: "too close to another building",
  noGold: "not enough gold",
  notPlaying: "after the match starts",
  wall: "there is a wall there",
};

const standingCache = new WeakMap<readonly WallSnapshot[], Set<number>>();

/** Every standing wall tile (cached per frame's wall list). */
export function standingWallTiles(walls: readonly WallSnapshot[]): Set<number> {
  let set = standingCache.get(walls);
  if (!set) {
    set = new Set();
    for (const w of walls) for (const t of w.tiles) set.add(t);
    standingCache.set(walls, set);
  }
  return set;
}

/** The wall being drawn (GAME_DESIGN.md §3.17.6): its line, price and whether it may go. */
export interface WallPreview {
  /** Corner points placed so far, plus the point under the mouse. */
  readonly points: readonly number[];
  /** Every tile of the line (for drawing). */
  readonly tiles: readonly number[];
  /** Tiles it would build (tiles already walled are joined, not built again). */
  readonly newTiles: number;
  readonly price: number;
  readonly problem: WallProblem | "noGold" | null;
}

/** The wall through `points` and then `hover` (if any): what a finish would build. */
export function wallPreview(
  ctx: BuildContext,
  points: readonly number[],
  hover: number | null,
): WallPreview | null {
  const map = ctx.map;
  const me = ctx.me;
  if (!map || !me) return null;
  const all = hover !== null && hover !== points.at(-1) ? [...points, hover] : [...points];
  if (all.length === 0) return null;
  const buildingTiles = new Set(ctx.buildings.map((b) => b.tile));
  const walled = standingWallTiles(ctx.walls);
  const plan = wallPlan(
    ctx.rules,
    map,
    ctx.owner,
    (t) => buildingTiles.has(t),
    (t) => walled.has(t),
    me.id,
    all,
  );
  const owned = wallLevelsOwned(
    ctx.walls.map((w) => ({ owner: w.owner, targetLevel: w.targetLevel, intact: w.tiles.length })),
    me.id,
  );
  const price = plan.tiles.length > 0 ? wallPrice(ctx.rules, 1, plan.tiles.length, owned) : 0;
  const problem =
    all.length >= 2 && plan.problem === null && me.gold < price
      ? "noGold"
      : plan.problem === "tooFewPoints"
        ? null
        : plan.problem;
  return {
    points: all,
    tiles: wallTiles(map, all),
    newTiles: plan.tiles.length,
    price,
    problem,
  };
}

export const WALL_PREVIEW_TEXT: Record<WallProblem | "noGold", string> = {
  ...WALL_PROBLEM_TEXT,
  noGold: "not enough gold",
};

export interface BuildingCard {
  readonly id: number;
  readonly type: Placeable;
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

function workOf(
  ctx: BuildContext,
  item: { readonly startTick: number; readonly readyTick: number; readonly targetLevel: number },
): BuildingCard["work"] {
  if (item.readyTick < 0) return null;
  const total = item.readyTick - item.startTick;
  return {
    level: item.targetLevel,
    secondsLeft: Math.max(0, ((item.readyTick - ctx.tick) * ctx.rules.tickMs) / 1000),
    progress: total > 0 ? Math.min(1, Math.max(0, (ctx.tick - item.startTick) / total)) : 1,
  };
}

export function buildingCard(ctx: BuildContext, building: BuildingSnapshot): BuildingCard {
  const rules = ctx.rules;
  const mine = building.owner === ctx.me?.id;
  const working = building.readyTick >= 0;
  const shownLevel = Math.max(1, building.level);
  let upgrade: BuildingCard["upgrade"] = null;
  if (mine && !working && building.level < maxLevel(rules, building.type)) {
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
  return {
    id: building.id,
    type: building.type,
    mine,
    owner: building.owner,
    level: building.level,
    name: levelRules(rules, building.type, shownLevel).name,
    effects: effectLines(rules, building.type, building.level),
    work: workOf(ctx, building),
    upgrade,
  };
}

/** A wall's card (GAME_DESIGN.md §3.17.6): its level, length, effect and upgrade. */
export function wallCard(ctx: BuildContext, wall: WallSnapshot): BuildingCard {
  const rules = ctx.rules;
  const mine = wall.owner === ctx.me?.id;
  const tiles = wall.tiles.length;
  let upgrade: BuildingCard["upgrade"] = null;
  if (mine && wall.readyTick < 0 && wall.level < rules.walls.levels.length) {
    const owned = wallLevelsOwned(
      ctx.walls.map((w) => ({
        owner: w.owner,
        targetLevel: w.targetLevel,
        intact: w.tiles.length,
      })),
      wall.owner,
    );
    const price = wallPrice(rules, wall.level + 1, tiles, owned);
    upgrade = {
      name: wallLevel(rules, wall.level + 1).name,
      price,
      lines: wallLines(rules, wall.level + 1),
      affordable: (ctx.me?.gold ?? 0) >= price,
    };
  }
  return {
    id: wall.id,
    type: "wall",
    mine,
    owner: wall.owner,
    level: wall.level,
    name: wallLevel(rules, Math.max(1, wall.level)).name,
    effects: [`${tiles} tiles standing`, ...(wall.level > 0 ? wallLines(rules, wall.level) : [])],
    work: workOf(ctx, wall),
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

/** The wall with a standing tile nearest to (x, y) in tiles, within `radius` tiles, or null. */
export function wallAtPoint(
  walls: readonly WallSnapshot[],
  width: number,
  x: number,
  y: number,
  radius: number,
): WallSnapshot | null {
  let best: WallSnapshot | null = null;
  let bestDistance = radius * radius;
  for (const w of walls) {
    for (const t of w.tiles) {
      const dx = (t % width) + 0.5 - x;
      const dy = Math.floor(t / width) + 0.5 - y;
      const d = dx * dx + dy * dy;
      if (d <= bestDistance) {
        best = w;
        bestDistance = d;
      }
    }
  }
  return best;
}

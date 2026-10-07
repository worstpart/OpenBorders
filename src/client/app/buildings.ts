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
import { tradeEnabled, tradePartners } from "../../sim/systems/trade.ts";
import {
  airliftCapacity,
  airliftCooldownLeft,
  samInterceptors,
  samRadius,
  samReady,
} from "../../sim/systems/flights.ts";
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
  port: "Trade & faster boats",
  airport: "Airlift troops to friends",
  sam: "Shoots down enemy planes",
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
  if (effect.tradeEveryTicks && tradeEnabled(rules)) {
    lines.push(`A trade ship every ${(effect.tradeEveryTicks * rules.tickMs) / 1000} s`);
  }
  if (effect.liftShare) {
    lines.push(`Airlift: up to ${Math.round(effect.liftShare * 100)}% of your troop capacity`);
    lines.push(`To friends within ${effect.range ?? 0} km`);
  }
  if (effect.missionCooldownTicks) {
    lines.push(
      `Ready again ${(effect.missionCooldownTicks * rules.tickMs) / 1000} s after each flight`,
    );
  }
  if (effect.interceptors) {
    lines.push(`Shoots down enemy planes within ${effect.range ?? 0} km`);
    lines.push(
      `${effect.interceptors} interceptor${effect.interceptors > 1 ? "s" : ""}, each reloads in ${((effect.reloadTicks ?? 0) * rules.tickMs) / 1000} s`,
    );
  }
  return lines;
}

/**
 * What a SAM level will add once missiles exist (GAME_DESIGN.md §3.17.7: 2B.5) — shown on
 * the upgrade, clearly as later, so nobody pays for it thinking it works now.
 */
const SAM_LATER: Readonly<Record<number, string>> = {
  2: "Later: also intercepts missiles (with Missile Silos)",
  3: "Later: stops strategic warheads; early warning",
};

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
  if (next.tradeEveryTicks && tradeEnabled(rules)) {
    lines.push(`Trade ships every ${(next.tradeEveryTicks * rules.tickMs) / 1000} s`);
  }
  if (next.boatSpeed) lines.push(`Boats ×${next.boatSpeed} faster`);
  if (next.boatSlots) lines.push(`+${next.boatSlots} boats at sea`);
  if (next.boatLoss) {
    lines.push(
      `${now.boatLoss ? "" : "New: Marines — "}landings lose ${Math.round((1 - next.boatLoss) * 100)}% less`,
    );
  }
  if (next.interceptors) {
    lines.push(`Radius ${next.range ?? 0} km`);
    lines.push(
      `${next.interceptors} interceptors, reload ${((next.reloadTicks ?? 0) * rules.tickMs) / 1000} s each`,
    );
    const later = SAM_LATER[level + 1];
    if (later) lines.push(later);
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
  notPlains: "an airport needs flat land (plains)",
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
  /** Your working Airport (GAME_DESIGN.md §3.17.7): the airlift it can fly now. */
  readonly airlift: {
    /** The most troops one airlift carries (a share of your capacity). */
    readonly capacity: number;
    /** Seconds until it can fly again (0 = ready). */
    readonly secondsLeft: number;
  } | null;
  /** A working SAM (GAME_DESIGN.md §3.17.7): its interceptors now. */
  readonly sam: {
    readonly ready: number;
    readonly max: number;
    /** Seconds until the next interceptor is back (0 = all ready). */
    readonly secondsToNext: number;
    /** Radius in km. */
    readonly radius: number;
  } | null;
  /** A level the game doesn't have yet (shown instead of an upgrade). */
  readonly laterLevel: string | null;
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
    effects: [...effectLines(rules, building.type, building.level), ...tradeLines(ctx, building)],
    work: workOf(ctx, building),
    upgrade,
    airlift:
      mine && building.type === "airport" && building.level >= 1 && ctx.me
        ? {
            capacity: airliftCapacity(rules, building.level, ctx.me.capacity),
            secondsLeft: (airliftCooldownLeft(building, ctx.tick) * rules.tickMs) / 1000,
          }
        : null,
    sam: samStatus(ctx, building),
    laterLevel:
      mine && !working && building.level === maxLevel(rules, building.type)
        ? (LATER_LEVELS[building.type] ?? null)
        : null,
  };
}

/** A working SAM's interceptors (anyone's: SAMs are in plain sight), or null. */
function samStatus(ctx: BuildContext, building: BuildingSnapshot): BuildingCard["sam"] {
  if (building.type !== "sam" || building.level < 1) return null;
  const rules = ctx.rules;
  const next = building.reloads.find((t) => t > ctx.tick);
  return {
    ready: samReady(rules, building, ctx.tick),
    max: samInterceptors(rules, building.level),
    secondsToNext: next === undefined ? 0 : ((next - ctx.tick) * rules.tickMs) / 1000,
    radius: samRadius(rules, building),
  };
}

/** Levels that come in later updates (Phase 2B), by type, after the top level built so far. */
const LATER_LEVELS: Partial<Record<BuildingType, string>> = {
  port: "Level III (Naval Base) comes in a later update",
  airport: "Level II (Military Airport: airborne assault) comes in a later update",
};

/** A working Port's trade (GAME_DESIGN.md §3.19): its partners, and your trade so far. */
function tradeLines(ctx: BuildContext, building: BuildingSnapshot): string[] {
  if (building.type !== "port" || building.level < 1 || !ctx.map || !tradeEnabled(ctx.rules)) {
    return [];
  }
  const partners = tradePartners(ctx.map, ctx.buildings, building, () => true).length;
  const lines = [
    partners > 0
      ? `Trades with ${partners} other Port${partners > 1 ? "s" : ""}`
      : "No other player's Port on this sea yet",
  ];
  if (building.owner === ctx.me?.id) {
    lines.push(`Your trade so far: ${formatTroops(ctx.me.tradeGold)} gold`);
  }
  return lines;
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
    airlift: null,
    sam: null,
    laterLevel: null,
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

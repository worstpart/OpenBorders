/**
 * What the HUD shows about boats (GAME_DESIGN.md §3.18): where each boat is now, the chips
 * for your boats and the ones coming for you, and the preview of a crossing under the mouse
 * (route, landing, ETA). Pure functions over frame snapshots; routes and landing rules come
 * from the simulation (naval.ts), so the preview shows exactly what a click will do.
 */
import type {
  BoatSnapshot,
  BuildingSnapshot,
  PlayerSnapshot,
  WarshipSnapshot,
} from "../../sim/frame.ts";
import { isLand, type GameMap } from "../../sim/map/gameMap.ts";
import type { GameRules } from "../../sim/rules.ts";
import {
  BOAT_PROBLEM_TEXT,
  boatSlots,
  coastTiles,
  landmassesOf,
  planBoat,
  type BoatPlan,
  type BoatProblem,
} from "../../sim/systems/naval.ts";
import { working } from "../../sim/systems/buildings.ts";

export interface BoatContext {
  readonly rules: GameRules;
  readonly map: GameMap | null;
  readonly owner: Uint16Array;
  readonly buildings: readonly BuildingSnapshot[];
  readonly boats: readonly BoatSnapshot[];
  readonly me: PlayerSnapshot | undefined;
  readonly tick: number;
  readonly playing: boolean;
}

/** How far along its route a boat is at `tick` (fraction allowed), in route steps. */
/** A ship following a fixed route: a boat, or a trade ship (which is never recalled). */
export interface Voyage {
  readonly route: Int32Array;
  readonly launchTile: number;
  readonly landingTile: number;
  readonly launchTick: number;
  readonly tilesPerTick: number;
  /** Boats only: the tick it turned back, or -1. */
  readonly recallTick?: number;
}

export function boatSteps(boat: Voyage, tick: number): number {
  const steps = boat.route.length + 1;
  if (boat.recallTick === undefined || boat.recallTick < 0)
    return Math.min(steps, Math.max(0, tick - boat.launchTick) * boat.tilesPerTick);
  const turned = Math.min(steps, (boat.recallTick - boat.launchTick) * boat.tilesPerTick);
  return Math.max(0, turned - Math.max(0, tick - boat.recallTick) * boat.tilesPerTick);
}

/** The tile at route step `k` (0 = the launch coast, route.length + 1 = the landing coast). */
function stepTile(boat: Voyage, k: number): number {
  if (k <= 0) return boat.launchTile;
  if (k > boat.route.length) return boat.landingTile;
  return boat.route[k - 1]!;
}

/** A boat's position (tile coordinates, tile centres at .5) and heading at `tick`. */
export function boatPosition(
  boat: Voyage,
  width: number,
  tick: number,
): { x: number; y: number; dx: number; dy: number } {
  const steps = boatSteps(boat, tick);
  const k = Math.floor(steps);
  const f = steps - k;
  const a = stepTile(boat, k);
  const b = stepTile(boat, k + 1);
  const ax = (a % width) + 0.5;
  const ay = Math.floor(a / width) + 0.5;
  const bx = (b % width) + 0.5;
  const by = Math.floor(b / width) + 0.5;
  const back = (boat.recallTick ?? -1) >= 0 ? -1 : 1;
  return {
    x: ax + (bx - ax) * f,
    y: ay + (by - ay) * f,
    dx: (bx - ax) * back,
    dy: (by - ay) * back,
  };
}

/**
 * The era a boat is drawn in (D-028): the level of its owner's best Port in range of its
 * launch coast — the Port that sped it up (naval.ts) — or level I without one.
 */
export function boatLevel(
  rules: GameRules,
  width: number,
  buildings: readonly BuildingSnapshot[],
  owner: number,
  launchTile: number,
): number {
  let best = 1;
  const x = launchTile % width;
  const y = Math.floor(launchTile / width);
  for (const b of buildings) {
    if (b.type !== "port" || b.owner !== owner || b.level <= best) continue;
    const range = rules.buildings.types.port.levels[b.level - 1]?.range ?? 0;
    const dx = (b.tile % width) - x;
    const dy = Math.floor(b.tile / width) - y;
    if (dx * dx + dy * dy <= range * range) best = b.level;
  }
  return best;
}

/** A boat in the attack chips: one of yours, or one sailing for your coast. */
export interface BoatChip {
  readonly id: number;
  readonly mine: boolean;
  /** Mine: who it sails for (0 = open land); incoming: who sent it. */
  readonly other: number;
  readonly troops: number;
  readonly secondsLeft: number;
  readonly recalled: boolean;
}

export function boatChips(ctx: BoatContext): BoatChip[] {
  const me = ctx.me?.id ?? 0;
  const chips: BoatChip[] = [];
  for (const boat of ctx.boats) {
    const mine = boat.owner === me;
    if (!mine && (boat.recallTick >= 0 || ctx.owner[boat.landingTile] !== me)) continue;
    chips.push({
      id: boat.id,
      mine,
      other: mine ? boat.target : boat.owner,
      troops: boat.troops,
      secondsLeft: Math.max(0, ((boat.arriveTick - ctx.tick) * ctx.rules.tickMs) / 1000),
      recalled: boat.recallTick >= 0,
    });
  }
  return chips;
}

/**
 * True when a click on `tile` sends a boat: land whose owner we don't border, or land on a
 * landmass where we own nothing (open land across the sea, though we border open land here).
 */
export function needsBoat(ctx: BoatContext, tile: number): boolean {
  const me = ctx.me;
  const map = ctx.map;
  if (!me || !map || !ctx.rules.naval.enabled || !isLand(map, tile)) return false;
  const target = ctx.owner[tile]!;
  if (target === me.id) return false;
  if (!(me.neighbors ?? []).includes(target)) return true;
  return !myLandmasses(ctx, me.id).has(landmassesOf(map)[tile]!);
}

const landmassUse = new WeakMap<Uint16Array, { tick: number; me: number; masses: Set<number> }>();

/** The landmasses where the local player owns land (refreshed at most once per tick). */
function myLandmasses(ctx: BoatContext, me: number): Set<number> {
  const cached = landmassUse.get(ctx.owner);
  if (cached && cached.tick === ctx.tick && cached.me === me) return cached.masses;
  const labels = landmassesOf(ctx.map!);
  const masses = new Set<number>();
  for (let tile = 0; tile < ctx.owner.length; tile++) {
    if (ctx.owner[tile] === me) masses.add(labels[tile]!);
  }
  landmassUse.set(ctx.owner, { tick: ctx.tick, me, masses });
  return masses;
}

/** A crossing as the hover card and the map preview show it. */
export interface BoatPreview {
  readonly target: number;
  readonly tile: number;
  /** The plan, or why there can't be one (no coast, no route, no free boat). */
  readonly plan: BoatPlan | null;
  readonly problem: BoatProblem | "noBoat" | null;
  readonly seconds: number;
}

const ownCoastCache = new WeakMap<Uint16Array, { tick: number; me: number; tiles: number[] }>();

/** The local player's coast tiles (refreshed at most once per tick). */
function ownCoast(ctx: BoatContext, me: number): number[] {
  const cached = ownCoastCache.get(ctx.owner);
  if (cached && cached.tick === ctx.tick && cached.me === me) return cached.tiles;
  const tiles: number[] = [];
  for (const tile of coastTiles(ctx.map!)) if (ctx.owner[tile] === me) tiles.push(tile);
  ownCoastCache.set(ctx.owner, { tick: ctx.tick, me, tiles });
  return tiles;
}

/** The crossing a click on `tile` would start (null when the click isn't a boat). */
export function boatPreview(ctx: BoatContext, tile: number): BoatPreview | null {
  if (!needsBoat(ctx, tile) || !ctx.playing) return null;
  const me = ctx.me!;
  const target = ctx.owner[tile]!;
  const atSea = ctx.boats.filter((b) => b.owner === me.id).length;
  // Ports struck from the air (2B.4) add nothing until they work again, as in the sim.
  const ports = ctx.buildings.filter((b) => b.type === "port" && working(b, ctx.tick));
  const plan = planBoat(
    ctx.rules,
    ctx.map!,
    ctx.owner,
    ports,
    me.id,
    ownCoast(ctx, me.id),
    target,
    tile,
  );
  if (typeof plan === "string") return { target, tile, plan: null, problem: plan, seconds: 0 };
  const full = atSea >= boatSlots(ctx.rules, ports, me.id);
  return {
    target,
    tile,
    plan,
    problem: full ? "noBoat" : null,
    seconds: (plan.ticks * ctx.rules.tickMs) / 1000,
  };
}

export const BOAT_PREVIEW_TEXT: Record<BoatProblem | "noBoat", string> = {
  ...BOAT_PROBLEM_TEXT,
  noBoat: "all your boats are at sea",
};

/** A warship's current leg as a voyage, so it is placed like a boat (2B.6). */
export function warshipVoyage(ship: WarshipSnapshot): Voyage {
  return {
    route: ship.route,
    launchTile: ship.fromTile,
    landingTile: ship.toTile,
    launchTick: ship.legTick,
    tilesPerTick: ship.tilesPerTick,
  };
}

/** A warship's drawn width in CSS px at a zoom level (render/boats.ts). */
export function warshipSize(zoom: number): number {
  return Math.max(20, Math.min(52, zoom * 6.5));
}

/**
 * The local player's warship at sea drawn under the map point (x, y) (tile units), or null:
 * the nearest within its drawn half-width (`radius`, tile units).
 */
export function warshipAtPoint(
  ships: readonly WarshipSnapshot[],
  me: number,
  width: number,
  tick: number,
  x: number,
  y: number,
  radius: number,
): WarshipSnapshot | null {
  let best: WarshipSnapshot | null = null;
  let bestD = radius * radius;
  for (const ship of ships) {
    if (ship.owner !== me || ship.readyTick >= 0) continue;
    const at = boatPosition(warshipVoyage(ship), width, tick);
    const d = (at.x - x) ** 2 + (at.y - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = ship;
    }
  }
  return best;
}

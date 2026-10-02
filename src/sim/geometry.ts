/**
 * The unified range system (GAME_DESIGN.md §3.17.5, ARCHITECTURE.md §5.7): every "how far,
 * in range, how long" question in the game goes through these functions, so building
 * spacing, zones, radii, ranges, flight times and the HUD's rings all measure the map the
 * same way. Distances are straight lines in tiles (the HUD shows 1 tile as 1 km).
 *
 * Deterministic: squared distances are exact integers, and range checks compare them
 * with r² — no square root. `distance` uses Math.sqrt, which IEEE 754 rounds exactly.
 */
import type { GameMap } from "./map/gameMap.ts";

/** Squared straight-line distance between two tiles (an exact integer). */
export function distanceSq(map: GameMap, a: number, b: number): number {
  const dx = (a % map.width) - (b % map.width);
  const dy = Math.floor(a / map.width) - Math.floor(b / map.width);
  return dx * dx + dy * dy;
}

/** Straight-line distance between two tiles, in tiles. */
export function distance(map: GameMap, a: number, b: number): number {
  return Math.sqrt(distanceSq(map, a, b));
}

/** True when `b` is within `range` tiles of `a` (inclusive). */
export function withinRange(map: GameMap, a: number, b: number, range: number): boolean {
  return distanceSq(map, a, b) <= range * range;
}

/** Whole ticks to cover `tiles` at `tilesPerTick` (at least one). */
export function travelTicks(tiles: number, tilesPerTick: number): number {
  return Math.max(1, Math.ceil(tiles / tilesPerTick));
}

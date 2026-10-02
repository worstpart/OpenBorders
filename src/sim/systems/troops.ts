/**
 * Troop capacity and regeneration (GAME_DESIGN.md §3.4).
 *
 *   capacity  M = capacityBase + capacityScale · L^capacityExponent
 *   growth    g = growthFloor · (1 − x) + growthScale · M^growthExponent · 4x(1 − x),  x = T / M
 *             clamped so that home + field troops never exceed M
 *
 * The 4x(1−x) term peaks at half capacity: troops grow fastest at 50%, and not at all
 * at the cap — so sitting on a full army is wasted potential.
 */
import { detPow } from "../math/detmath.ts";
import type { GameRules } from "../rules.ts";
import type { Player, World } from "../world.ts";

/** Troop capacity for a player owning `tiles` tiles. Integer. */
export function troopCapacity(rules: GameRules, tiles: number): number {
  const t = rules.troops;
  return Math.floor(t.capacityBase + t.capacityScale * detPow(tiles, t.capacityExponent));
}

/** Troops gained in one tick. Integer, never negative. */
export function troopGrowth(
  rules: GameRules,
  homeTroops: number,
  fieldTroops: number,
  capacity: number,
): number {
  const room = capacity - homeTroops - fieldTroops;
  if (room <= 0) return 0;
  const t = rules.troops;
  const x = homeTroops / capacity;
  const peak = t.growthScale * detPow(capacity, t.growthExponent);
  const growth = t.growthFloor * (1 - x) + peak * 4 * x * (1 - x);
  return Math.max(0, Math.min(room, Math.floor(growth)));
}

/** Troops a player starts with right after spawning on `tiles` tiles. */
export function startingTroops(rules: GameRules, tiles: number): number {
  return Math.floor(rules.troops.startShare * troopCapacity(rules, tiles));
}

/** Tick system: refresh capacity and regenerate troops for every living player. */
export function growTroops(world: World): void {
  for (const player of world.players) {
    if (!player.alive) continue;
    regenerate(world.rules, player);
  }
}

function regenerate(rules: GameRules, player: Player): void {
  player.capacity = troopCapacity(rules, player.tiles);
  const growth =
    player.tiles > 0
      ? troopGrowth(rules, player.homeTroops, player.fieldTroops, player.capacity)
      : 0;
  player.homeTroops += growth;
  player.lastGrowth = growth;
}

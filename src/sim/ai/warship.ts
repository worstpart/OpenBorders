/**
 * How nations use their warships (the user after playing 2B.6: "bots don't engage in much
 * combat"). Left alone, warships guard their Naval Base's waters (systems/warships.ts). At war
 * with someone who has a Port on the same sea, a nation sends **one** warship — its oldest at
 * sea — to blockade the enemy Port nearest its Base: open water just off that Port, where it
 * sinks the enemy's boats and takes their trade. The others stay home. When no such war is on,
 * it calls the blockader home.
 */
import type { Command } from "../commands.ts";
import { distanceSq } from "../geometry.ts";
import { areFriendly } from "../systems/diplomacy.ts";
import { seasOf, touchesSea } from "../systems/naval.ts";
import { findBuilding } from "../systems/buildings.ts";
import { patrolTiles, warshipTile } from "../systems/warships.ts";
import { isTribe, NEUTRAL, type Player, type PlayerId, type World } from "../world.ts";

/** How far off the enemy Port the blockader patrols (tiles). */
const BLOCKADE_RANGE = 10;

/** A nation's warship orders for this think; empty for none. */
export function decideWarships(world: World, bot: Player, actions: readonly Command[]): Command[] {
  if (world.warships.length === 0) return [];
  const mine = world.warships.filter((s) => s.owner === bot.id && s.readyTick < 0);
  if (mine.length === 0) return [];
  const rules = world.rules.warships;

  const wars = new Set<PlayerId>();
  for (const a of world.attacks) {
    if (a.retreatTick >= 0 || a.target === NEUTRAL) continue;
    if (a.attacker === bot.id) wars.add(a.target);
    else if (a.target === bot.id) wars.add(a.attacker);
  }
  for (const c of actions) {
    if ((c.type === "attack" || c.type === "boat") && c.target !== NEUTRAL) wars.add(c.target);
  }
  for (const id of [...wars]) {
    const p = world.players[id - 1];
    if (!p || !p.alive || isTribe(p) || areFriendly(world, bot.id, id)) wars.delete(id);
  }

  const blockader = mine[0]!; // the oldest at sea
  const others = mine.slice(1).filter((s) => s.patrolTile >= 0);
  const home: Command[] = others.map((s) => ({ type: "moveWarship", warshipId: s.id, tile: -1 }));
  const base = findBuilding(world, blockader.base);
  if (!base || wars.size === 0) {
    if (blockader.patrolTile >= 0) {
      home.push({ type: "moveWarship", warshipId: blockader.id, tile: -1 });
    }
    return home;
  }

  // The enemy Port nearest the Base, on its sea.
  const { map } = world;
  const { body } = seasOf(map);
  const here = warshipTile(blockader, rules.tilesPerTick, world.tick);
  const sea = [body[here]!];
  let target = -1;
  let best = Infinity;
  for (const b of world.buildings) {
    if (b.type !== "port" || b.level < 1 || !wars.has(b.owner)) continue;
    if (!touchesSea(map, body, b.tile, sea)) continue;
    const d = distanceSq(map, base.tile, b.tile);
    if (d < best) {
      best = d;
      target = b.tile;
    }
  }
  if (target < 0) {
    if (blockader.patrolTile >= 0) {
      home.push({ type: "moveWarship", warshipId: blockader.id, tile: -1 });
    }
    return home;
  }
  // Already blockading it: nothing to change.
  if (
    blockader.patrolTile >= 0 &&
    distanceSq(map, blockader.patrolTile, target) <= BLOCKADE_RANGE * BLOCKADE_RANGE
  ) {
    return home;
  }
  // Open water off that Port: the point of its patrol area nearest the Port.
  const area = patrolTiles(map, target, BLOCKADE_RANGE, rules.offshore);
  let spot = -1;
  let spotD = Infinity;
  for (const t of area) {
    if (body[t] !== sea[0]) continue;
    const d = distanceSq(map, t, target);
    if (d < spotD) {
      spotD = d;
      spot = t;
    }
  }
  if (spot >= 0) home.push({ type: "moveWarship", warshipId: blockader.id, tile: spot });
  return home;
}

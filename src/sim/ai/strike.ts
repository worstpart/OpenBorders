/**
 * How nations use an Air Base's air strikes (GAME_DESIGN.md §3.17.7, milestone 2B.4).
 *
 * A strike costs nothing but its 30 s cooldown, so a nation with a ready, working Air Base
 * always sends it at its best target, if one is worth `strikeMinValue` gold:
 *
 *  - a building of an enemy it is at war with (an army between them either way, or one it
 *    sends this think), worth the gold of the level it would lose — SAMs count
 *    `strikeSamWeight`× (they stand between the nation and its assaults: strike them first),
 *    Airports `strikeAirportWeight`×. SAMs and Airports of any other non-friend nation or
 *    human count half: clearing the sky before a war is worth something too;
 *  - the walls in front of one of its armies (within `WALL_NEAR` tiles of where it attacks):
 *    a suppression worth `suppressionWorth`× the gold of the wall tiles it would cover.
 *
 * The fighters the hostile SAMs on the route would shoot down (interceptorsOnRoute) are
 * counted: a building target needs `strikeDamagePlanes` fighters through to lose a level — with
 * fewer it is only disabled, worth a quarter (a SAM) or a tenth (anything else) — and a route
 * that loses every fighter is never flown.
 */
import type { Command } from "../commands.ts";
import { distanceSq, withinRange } from "../geometry.ts";
import type { BuildingType } from "../rules.ts";
import { levelRules, working } from "../systems/buildings.ts";
import { areFriendly } from "../systems/diplomacy.ts";
import {
  airportRange,
  interceptorsOnRoute,
  STRIKE_LEVEL,
  strikeCooldownLeft,
} from "../systems/flights.ts";
import { isSuppressed } from "../systems/suppression.ts";
import { wallLevel } from "../systems/walls.ts";
import {
  getPlayer,
  isTribe,
  NEUTRAL,
  type Building,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";

/** Wall tiles this close to where an army attacks count as "in front of it". */
const WALL_NEAR = 12;

/** The bot's Air Base if one works and its fighters are ready, or null. */
function readyAirBase(world: World, bot: Player): Building | null {
  if (!world.rules.flights.enabled) return null;
  for (const b of world.buildings) {
    if (b.owner !== bot.id || b.type !== "airport" || b.level < STRIKE_LEVEL) continue;
    if (working(b, world.tick) && strikeCooldownLeft(b, world.tick) === 0) return b;
  }
  return null;
}

/** A nation's air strike for this think (see the header), or null. */
export function decideStrike(
  world: World,
  bot: Player,
  actions: readonly Command[],
): Command | null {
  const base = readyAirBase(world, bot);
  if (!base) return null;
  const rules = world.rules;
  const ai = rules.ai;
  const f = rules.flights;
  const range = airportRange(rules, base);
  const hostile = (id: PlayerId) => {
    if (id === NEUTRAL || id === bot.id) return false;
    const p = getPlayer(world, id);
    return p !== undefined && p.alive && !isTribe(p) && !areFriendly(world, bot.id, id);
  };

  // Who the bot is at war with: armies either way, or what it sends this think.
  const wars = new Set<PlayerId>();
  for (const a of world.attacks) {
    if (a.retreatTick >= 0 || a.target === NEUTRAL) continue;
    if (a.attacker === bot.id) wars.add(a.target);
    else if (a.target === bot.id) wars.add(a.attacker);
  }
  for (const c of actions) {
    if ((c.type === "attack" || c.type === "boat") && c.target !== NEUTRAL) wars.add(c.target);
    if (c.type === "assault") wars.add(world.owner[c.tile]!);
  }

  const sams = world.buildings.filter((b) => b.type === "sam" && b.level >= 1);
  const samHostile = (owner: PlayerId) => owner !== bot.id && !areFriendly(world, bot.id, owner);
  const arriving = (tile: number) =>
    f.strikePlanes -
    interceptorsOnRoute(rules, world.map, sams, samHostile, base.tile, tile, "fighter", world.tick)
      .interceptors;

  let best = -1;
  let bestValue = ai.strikeMinValue;

  for (const b of world.buildings) {
    if (!hostile(b.owner) || !withinRange(world.map, base.tile, b.tile, range)) continue;
    const atWar = wars.has(b.owner);
    const air = b.type === "sam" || b.type === "airport";
    if (!atWar && !air) continue;
    // The gold of the level it would lose (a construction: what its first level costs).
    const gold = levelRules(rules, b.type, Math.max(1, b.level)).cost;
    const weight =
      typeWeight(ai.strikeSamWeight, ai.strikeAirportWeight, b.type) * (atWar ? 1 : 0.5);
    if (gold * weight <= bestValue) continue; // the route check below is the dear part
    const through = arriving(b.tile);
    if (through <= 0) continue;
    const damage = through >= f.strikeDamagePlanes || b.level < 1;
    const value = gold * weight * (damage ? 1 : b.type === "sam" ? 0.25 : 0.1);
    if (value > bestValue) {
      best = b.tile;
      bestValue = value;
    }
  }

  // Walls in front of the bot's armies.
  for (const a of world.attacks) {
    if (a.attacker !== bot.id || a.retreatTick >= 0 || !hostile(a.target)) continue;
    const zone = wallZone(world, a.target, a.focusTile);
    if (!zone || !withinRange(world.map, base.tile, zone.center, range)) continue;
    const value = zone.gold * ai.suppressionWorth;
    if (value <= bestValue || arriving(zone.center) <= 0) continue;
    best = zone.center;
    bestValue = value;
  }

  return best < 0 ? null : { type: "airStrike", buildingId: base.id, tile: best };
}

function typeWeight(sam: number, airport: number, type: BuildingType): number {
  return type === "sam" ? sam : type === "airport" ? airport : 1;
}

/**
 * Where to suppress `target`'s walls in front of an army aimed at `focus`: their standing wall
 * tile nearest it (within WALL_NEAR, not suppressed already), and the gold of the wall tiles a
 * zone there would cover (each tile: what its levels cost per tile). Null: no wall there.
 */
function wallZone(
  world: World,
  target: PlayerId,
  focus: number,
): { center: number; gold: number } | null {
  const { map } = world;
  const standing: number[] = [];
  for (const w of world.walls) {
    if (w.owner !== target || w.level < 1) continue;
    for (const t of w.tiles)
      if (world.wallAt[t] === w.id && world.owner[t] === target) standing.push(t);
  }
  let center = -1;
  let nearest = WALL_NEAR * WALL_NEAR;
  for (const t of standing) {
    const d = distanceSq(map, t, focus);
    if (d < nearest || (d === nearest && center >= 0 && t < center)) {
      center = t;
      nearest = d;
    }
  }
  if (center < 0 || isSuppressed(world, center)) return null;
  const radius = world.rules.flights.suppressionRadius;
  let gold = 0;
  for (const t of standing) {
    if (!withinRange(map, center, t, radius)) continue;
    const level = world.fortLevel[t]!;
    for (let l = 1; l <= level; l++) gold += wallLevel(world.rules, l).costPerTile;
  }
  return { center, gold };
}

/**
 * How nations use a Missile Silo (GAME_DESIGN.md §3.17.8, milestone 2B.5).
 *
 * Missiles cost gold, so a nation fires only when it pays:
 *
 *  - the **strategic warhead** (Silo III, ready, gold for it) only at a **runaway leader** — a
 *    nation or human who isn't a friend and holds at least `warheadLeaderShare` of all owned
 *    land — at the spot (among the leader's buildings and start) where it scorches the most of
 *    the leader's land, never where it would hit the bot's allies, and never into a SAM III
 *    with an interceptor ready on the route;
 *  - otherwise a **strike missile** or, from a Silo II+, a **bunker buster** at an enemy it is
 *    at war with (armies either way, or one it sends this think): the target is worth the gold
 *    of the levels the enemies' buildings there would lose (the crater's and the buster's
 *    splash included, D-033) (SAMs ×`strikeSamWeight`, Airports
 *    ×`strikeAirportWeight`, as for air strikes) plus the troops it kills (a gold a troop),
 *    and it fires only when that is at least
 *    `missileValueFactor`× what the launch costs. SAM II+ on the route shoot missiles down one
 *    by one, so it fires one more missile than the interceptors ready there (saturation) — if
 *    its Silo has them, and the value covers them all.
 */
import type { Command } from "../commands.ts";
import { withinRange } from "../geometry.ts";
import type { BuildingType } from "../rules.ts";
import { levelRules } from "../systems/buildings.ts";
import { areFriendly, isAllied } from "../systems/diplomacy.ts";
import { interceptorsOnRoute } from "../systems/flights.ts";
import {
  missileBlast,
  missileCost,
  siloRange,
  siloReady,
  warheadCooldownLeft,
  warheadTiles,
} from "../systems/missiles.ts";
import {
  getPlayer,
  isTribe,
  NEUTRAL,
  type Building,
  type MissileKind,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";

/**
 * The runaway leader a nation would aim a warhead at (see the header), or null: the player who
 * isn't the bot or a friend of theirs holding the most land, if that is at least
 * `warheadLeaderShare` of all owned land.
 */
export function runawayLeader(world: World, bot: Player): Player | null {
  let total = 0;
  let leader: Player | null = null;
  for (const p of world.players) {
    if (!p.alive) continue;
    total += p.tiles;
    if (p.id === bot.id || isTribe(p) || areFriendly(world, bot.id, p.id)) continue;
    if (!leader || p.tiles > leader.tiles) leader = p;
  }
  if (!leader || total === 0) return null;
  return leader.tiles >= total * world.rules.ai.warheadLeaderShare ? leader : null;
}

/** The bot's working Silo with the most missiles ready (ties: the higher level, then lower id). */
function readySilo(world: World, bot: Player): Building | null {
  let best: Building | null = null;
  let bestReady = 0;
  for (const b of world.buildings) {
    if (b.owner !== bot.id || b.type !== "silo") continue;
    const ready = siloReady(world.rules, b, world.tick);
    if (ready > bestReady || (ready === bestReady && ready > 0 && b.level > best!.level)) {
      best = b;
      bestReady = ready;
    }
  }
  return best;
}

/** A nation's missile launches for this think (see the header); empty for none. */
export function decideMissiles(world: World, bot: Player, actions: readonly Command[]): Command[] {
  const rules = world.rules;
  if (!rules.flights.enabled) return [];
  const silo = readySilo(world, bot);
  if (!silo) return [];
  const warhead = decideWarhead(world, bot, silo);
  if (warhead) return [warhead];
  return decideConventional(world, bot, silo, actions);
}

function decideWarhead(world: World, bot: Player, silo: Building): Command | null {
  const rules = world.rules;
  if (silo.level < 3 || warheadCooldownLeft(silo, world.tick) > 0) return null;
  if (bot.gold < missileCost(rules, "warhead")) return null;
  const leader = runawayLeader(world, bot);
  if (!leader) return null;
  const range = siloRange(rules, silo);
  const candidates: number[] = [];
  if (leader.spawnTile >= 0 && world.owner[leader.spawnTile] === leader.id) {
    candidates.push(leader.spawnTile);
  }
  for (const b of world.buildings) if (b.owner === leader.id) candidates.push(b.tile);
  const sams = world.buildings.filter((b) => b.type === "sam" && b.level >= 3);
  const samHostile = (owner: PlayerId) => owner !== bot.id && !areFriendly(world, bot.id, owner);
  let best = -1;
  let bestTiles = 0;
  for (const tile of candidates) {
    if (!withinRange(world.map, silo.tile, tile, range)) continue;
    let theirs = 0;
    let allies = false;
    for (const t of warheadTiles(world, bot.id, tile)) {
      const owner = world.owner[t]!;
      if (owner === leader.id) theirs++;
      else if (isAllied(world, bot.id, owner)) allies = true;
    }
    if (allies || theirs <= bestTiles) continue;
    const stopped = interceptorsOnRoute(
      rules,
      world.map,
      sams,
      samHostile,
      silo.tile,
      tile,
      "missile",
      world.tick,
      "warhead",
    ).interceptors;
    if (stopped > 0) continue;
    best = tile;
    bestTiles = theirs;
  }
  return best < 0
    ? null
    : { type: "launchMissile", buildingId: silo.id, tile: best, missile: "warhead" };
}

function decideConventional(
  world: World,
  bot: Player,
  silo: Building,
  actions: readonly Command[],
): Command[] {
  const rules = world.rules;
  const ai = rules.ai;
  const f = rules.flights;
  const hostile = (id: PlayerId) => {
    if (id === NEUTRAL || id === bot.id) return false;
    const p = getPlayer(world, id);
    return p !== undefined && p.alive && !isTribe(p) && !areFriendly(world, bot.id, id);
  };
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
  const targets = world.buildings.filter((b) => hostile(b.owner));
  if (wars.size === 0 || targets.length === 0) return [];

  const range = siloRange(rules, silo);
  const ready = siloReady(rules, silo, world.tick);
  const cost = missileCost(rules, "missile");
  const blast = missileBlast(rules, silo.level);
  const affordable = Math.min(ready, Math.floor(bot.gold / cost));
  if (affordable < 1) return [];
  /** Gold of `levels` levels off building `b` (from its top), weighted like air strikes. */
  const levelsWorth = (b: Building, levels: number) => {
    let gold = 0;
    const top = Math.max(1, b.level);
    for (let l = top; l > top - levels && l >= 1; l--) gold += levelRules(rules, b.type, l).cost;
    return gold * typeWeight(ai.strikeSamWeight, ai.strikeAirportWeight, b.type);
  };

  const sams = world.buildings.filter((b) => b.type === "sam" && b.level >= 2);
  const samHostile = (owner: PlayerId) => owner !== bot.id && !areFriendly(world, bot.id, owner);
  let best: { tile: number; kind: MissileKind; count: number; value: number } | null = null;
  for (const b of targets) {
    if (!wars.has(b.owner) || !withinRange(world.map, silo.tile, b.tile, range)) continue;
    // The strike missile around this building, and the bunker buster on it (its splash
    // costs the neighbours a level, D-033).
    let around = 0;
    let splash = 0;
    for (const other of targets) {
      if (withinRange(world.map, b.tile, other.tile, blast.missileRadius)) {
        around += levelsWorth(other, f.missileLevels);
      }
      if (other !== b && withinRange(world.map, b.tile, other.tile, blast.busterSplashRadius)) {
        splash += levelsWorth(other, f.busterSplashLevels);
      }
    }
    // People killed count too, at a gold a troop (rules.economy.goldPerTroop) — the crater's
    // share of the owner's land as well (its area stands in for the land it would burn).
    const owner = getPlayer(world, b.owner)!;
    const home = owner.homeTroops * rules.economy.goldPerTroop;
    const craterShare = Math.min(
      1,
      (Math.PI * blast.craterRadius * blast.craterRadius) / Math.max(1, owner.tiles),
    );
    const options: { kind: MissileKind; value: number }[] = [
      { kind: "missile", value: around + home * (f.missileTroopShare + craterShare) },
    ];
    if (silo.level >= 2) {
      options.push({
        kind: "buster",
        value: levelsWorth(b, f.busterLevels) + splash + home * f.busterTroopShare,
      });
    }
    for (const option of options) {
      if (best && option.value <= best.value) continue;
      if (option.value < ai.missileValueFactor * cost) continue;
      const stopped = interceptorsOnRoute(
        rules,
        world.map,
        sams,
        samHostile,
        silo.tile,
        b.tile,
        "missile",
        world.tick,
        option.kind,
      ).interceptors;
      const count = stopped + 1;
      if (count > affordable || option.value < ai.missileValueFactor * cost * count) continue;
      best = { tile: b.tile, kind: option.kind, count, value: option.value };
    }
  }
  if (!best) return [];
  const launch: Command = {
    type: "launchMissile",
    buildingId: silo.id,
    tile: best.tile,
    missile: best.kind,
  };
  return Array.from({ length: best.count }, () => launch);
}

function typeWeight(sam: number, airport: number, type: BuildingType): number {
  return type === "sam" ? sam : type === "airport" ? airport : 1;
}

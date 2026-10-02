/**
 * Bot opponents (GAME_DESIGN.md §3.11, D-012).
 *
 * Bots run inside the deterministic simulation and play by the same rules as people:
 * they see what a player sees (the map, everyone's troops, the attacks in progress) and
 * act only through ordinary commands, which are queued and validated next tick like any
 * other. They get no bonuses.
 *
 * Each bot thinks every 2–5 s and, in order of urgency:
 *  1. counters an incoming army (opposing armies cancel out, so this is cheap defence);
 *  2. reinforces an attack that can no longer win — or retreats it if it can't afford to;
 *  3. waits until its troops regrow toward the sweet spot (growth is fastest at 50%);
 *  4. expands toward the nearest open land while there is some;
 *  5. attacks the neighbour where it expects to gain the most land. Fights follow the
 *     Lanchester square law (GAME_DESIGN.md §3.6), so the bot can predict how much of a
 *     target's land an army takes before it stalls; it attacks when that share is big
 *     enough for its personality — more readily when its troops sit at the cap, where
 *     they don't grow, and the longer they sit there the less it demands ("boredom"). Attacking leaves it depleted and open to a counter-attack: the
 *     "grow or strike?" tension the game is built on.
 * Personalities change the thresholds and preferences, not the rules.
 */
import { expectedLandShare, tileCostOfAll as tileCostOfAllTiles } from "../battle.ts";
import type { Command } from "../commands.ts";
import { isLand, tileAt, Terrain } from "../map/gameMap.ts";
import type { PersonalityRules } from "../rules.ts";
import { isSpawnProtected } from "../systems/spawn.ts";
import {
  getPlayer,
  NEUTRAL,
  type Attack,
  type Player,
  type PlayerId,
  type World,
} from "../world.ts";

/** Tick system (step 7): bots that are due think and queue commands for the next tick. */
export function thinkBots(world: World): void {
  const ai = world.rules.ai;
  for (const bot of world.players) {
    const brain = bot.brain;
    if (!brain || !bot.alive || bot.tiles === 0) continue;
    if (brain.nextThinkTick < 0) {
      // First think: staggered so bots don't all act on the same tick.
      brain.nextThinkTick = world.tick + world.rng.nextIntBetween(1, ai.thinkMaxTicks);
      continue;
    }
    if (world.tick < brain.nextThinkTick) continue;
    brain.nextThinkTick = world.tick + world.rng.nextIntBetween(ai.thinkMinTicks, ai.thinkMaxTicks);
    const command = decide(world, bot, ai.personalities[brain.personality], brain.idleThinks);
    if (command) world.pendingCommands.push({ playerId: bot.id, command });
    const wasting = bot.capacity > 0 && bot.homeTroops >= ai.wastingAt * bot.capacity;
    brain.idleThinks = !command && wasting ? brain.idleThinks + 1 : 0;
  }
}

/** What a bot sees along its border. */
interface Surroundings {
  /** A neutral land tile next to the bot's land, or -1. */
  neutralFront: number;
  /** For each neighbouring player, one of their tiles next to the bot's land. */
  neighborFront: Map<PlayerId, number>;
  /** Average position of the bot's border tiles (≈ the middle of its territory). */
  centerX: number;
  centerY: number;
}

function decide(
  world: World,
  bot: Player,
  style: PersonalityRules,
  idleThinks: number,
): Command | null {
  const ai = world.rules.ai;
  const mine = world.attacks.filter((a) => a.attacker === bot.id && a.retreatTick < 0);
  const incoming = world.attacks.filter((a) => a.target === bot.id && a.retreatTick < 0);
  const around = survey(world, bot);

  // 1. Counter the biggest incoming army we can match (not just the biggest one: a huge
  //    army we can't stop mustn't keep us from stopping a small one).
  const counterable = incoming
    .filter((a) => bot.homeTroops >= ai.counterAbove * a.troops)
    .sort((a, b) => b.troops - a.troops || a.id - b.id);
  for (const threat of counterable) {
    const focus = around.neighborFront.get(threat.attacker);
    if (focus === undefined) continue;
    const share = Math.min(0.9, (ai.counterSize * threat.troops) / bot.homeTroops);
    return attackCommand(threat.attacker, focus, share);
  }

  const fill = bot.capacity > 0 ? bot.homeTroops / bot.capacity : 0;

  // 2. An attack that can't win any more: reinforce it if we can afford to, otherwise
  //    retreat (saves 80% of what's left).
  for (const attack of mine) {
    if (attack.target === NEUTRAL) continue;
    const defender = getPlayer(world, attack.target)!;
    if (attack.troops < ai.retreatBelow * defender.homeTroops) {
      const boost = fill >= style.attackAt ? reinforce(world, bot, style, attack, around) : null;
      return boost ?? { type: "retreat", attackId: attack.id };
    }
  }

  // 4. Expand while there is open land next to us.
  if (around.neutralFront >= 0) {
    const expansion = mine.find((a) => a.target === NEUTRAL);
    const needsArmy = !expansion || expansion.troops < ai.expansionTopUpBelow;
    if (needsArmy && fill >= style.expandAt) {
      const focus = expansionFocus(world, bot, around);
      return attackCommand(NEUTRAL, focus, style.expandShare);
    }
    if (!style.attacksWhileExpanding) return null;
  }

  // 3 + 5. Attack a neighbour we can beat, once we've regrown enough.
  if (fill < style.attackAt || isSpawnProtected(world)) return null;
  const war = mine.find((a) => a.target !== NEUTRAL);
  if (war) return reinforce(world, bot, style, war, around); // one war at a time
  const choice = chooseTarget(world, bot, style, around, incoming, idleThinks);
  if (!choice) return null;
  return attackCommand(choice.target.id, choice.focus, choice.share);
}

function attackCommand(target: PlayerId, focusTile: number, share: number): Command {
  const percentBp = Math.max(1, Math.min(10_000, Math.round(share * 10_000)));
  return { type: "attack", target, focusTile, percentBp };
}

function survey(world: World, bot: Player): Surroundings {
  const { width } = world.map;
  const o = world.owner;
  let neutralFront = -1;
  const neighborFront = new Map<PlayerId, number>();
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  const look = (tile: number): void => {
    const owner = o[tile]!;
    if (owner === bot.id) return;
    if (owner === NEUTRAL) {
      if (neutralFront < 0 && isLand(world.map, tile)) neutralFront = tile;
    } else if (!neighborFront.has(owner)) {
      neighborFront.set(owner, tile);
    }
  };
  for (const tile of bot.border) {
    const x = tile % width;
    sumX += x;
    sumY += (tile - x) / width;
    count++;
    if (tile >= width) look(tile - width);
    if (tile + width < o.length) look(tile + width);
    if (x > 0) look(tile - 1);
    if (x < width - 1) look(tile + 1);
  }
  return {
    neutralFront,
    neighborFront,
    centerX: count > 0 ? sumX / count : 0,
    centerY: count > 0 ? sumY / count : 0,
  };
}

/**
 * Where to aim an expansion: the nearest open land just beyond the bot's territory,
 * found by sampling around it (easier terrain preferred, a little randomness so bots
 * don't all look alike). Falls back to any neutral tile on the front.
 */
function expansionFocus(world: World, bot: Player, around: Surroundings): number {
  const { map, rng } = world;
  const radius = Math.sqrt(bot.tiles / Math.PI);
  const reach = Math.ceil(radius + world.rules.ai.expansionLookAhead);
  let best = around.neutralFront;
  let bestScore = Infinity;
  for (let k = 0; k < 24; k++) {
    const x = Math.round(around.centerX) + rng.nextIntBetween(-reach, reach);
    const y = Math.round(around.centerY) + rng.nextIntBetween(-reach, reach);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
    const tile = tileAt(map, x, y);
    if (world.owner[tile] !== NEUTRAL || !isLand(map, tile)) continue;
    const dx = x - around.centerX;
    const dy = y - around.centerY;
    const terrain = map.terrain[tile];
    const penalty = terrain === Terrain.Mountain ? 25 : terrain === Terrain.Highland ? 8 : 0;
    const score = Math.sqrt(dx * dx + dy * dy) + penalty + rng.nextFloat() * 10;
    if (score < bestScore) {
      bestScore = score;
      best = tile;
    }
  }
  return best;
}

/**
 * The neighbour worth attacking: one we can beat with a clear edge (army ≥ edge × their
 * home troops, within what we're willing to commit), preferring land that's cheap per
 * defending troop, players busy elsewhere, and whoever is attacking us.
 */
/**
 * Tops up a war we can still finish: an army that runs out halfway through a big
 * territory just lets the defender regrow.
 */
function reinforce(
  world: World,
  bot: Player,
  style: PersonalityRules,
  war: Attack,
  around: Surroundings,
): Command | null {
  const target = getPlayer(world, war.target)!;
  if (!target.alive) return null;
  const missing = armyToTakeAll(world, target, style) - war.troops;
  if (missing <= 0 || missing > style.attackMaxShare * bot.homeTroops) return null;
  const focus =
    world.owner[war.focusTile] === target.id ? war.focusTile : around.neighborFront.get(target.id);
  if (focus === undefined) return null;
  return attackCommand(target.id, focus, missing / bot.homeTroops);
}

/**
 * Troops needed to take all of `target`'s land: the bigger of a clear Lanchester edge over
 * their home troops, and the fixed cost of taking every tile (even an undefended tile
 * costs at least half the base loss, a bit more on rough terrain), with a margin for
 * their regrowth during the attack.
 */
function armyToTakeAll(world: World, target: Player, style: PersonalityRules): number {
  return Math.max(style.attackEdge * Math.max(1, target.homeTroops), tileCostOfAll(world, target));
}

function tileCostOfAll(world: World, target: Player): number {
  return tileCostOfAllTiles(world.rules, target.tiles, target.homeTroops);
}

function chooseTarget(
  world: World,
  bot: Player,
  style: PersonalityRules,
  around: Surroundings,
  incoming: Attack[],
  idleThinks: number,
): { target: Player; focus: number; share: number } | null {
  const ai = world.rules.ai;
  const wasting = bot.capacity > 0 && bot.homeTroops >= ai.wastingAt * bot.capacity;
  const boredom = Math.max(0, 1 - idleThinks / ai.boredomThinks);
  const minGain = style.minLandGain * (wasting ? ai.wastingGainFactor * boredom : 1);
  let best: { target: Player; focus: number; share: number } | null = null;
  let bestScore = 0;
  for (const [id, frontTile] of around.neighborFront) {
    const target = getPlayer(world, id)!;
    if (!target.alive) continue;
    const defenders = Math.max(1, target.homeTroops);
    // Send enough to take everything if we can afford it, otherwise all we're willing to.
    const army = Math.min(
      armyToTakeAll(world, target, style),
      style.attackMaxShare * bot.homeTroops,
    );
    const gain = Math.min(
      expectedLandShare(world.rules, army, defenders),
      army / tileCostOfAll(world, target),
    );
    if (gain < minGain) continue;
    const busy = world.attacks.some((a) => a.attacker === id && a.retreatTick < 0);
    const hostile = incoming.some((a) => a.attacker === id);
    const targetFill = target.capacity > 0 ? target.homeTroops / target.capacity : 1;
    const score =
      gain *
      target.tiles *
      (1 + (busy ? style.preferBusyTargets : 0)) *
      (hostile ? 1.5 : 1) *
      (2 - Math.min(1, targetFill)) * // depleted players are vulnerable
      (gain >= 0.99 ? 2 : 1); // finishing a player off shrinks the field
    if (score > bestScore) {
      bestScore = score;
      // Aim at the heart of their land (their start) if they still hold it: it splits
      // them and cuts off pockets for encirclement.
      const heart = target.spawnTile >= 0 && world.owner[target.spawnTile] === id;
      best = { target, focus: heart ? target.spawnTile : frontTile, share: army / bot.homeTroops };
    }
  }
  return best;
}

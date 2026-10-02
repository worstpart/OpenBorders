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
 *
 * That is how a **nation** plays (GAME_DESIGN.md §3.13); its difficulty sets how often it
 * thinks and whether it counters and reinforces. **Tribes** — weak filler bots — think
 * every 4–8 s and only expand, or make small attacks on neighbours they can beat.
 *
 * Alliances (GAME_DESIGN.md §3.14): tribes accept every request and renewal and go after
 * traitors; nations answer, ask, renew and betray by threat, strength and shared enemies.
 */
import {
  attackLossFactor,
  expectedLandShare,
  tileCostOfAll as tileCostOfAllTiles,
} from "../battle.ts";
import type { Command } from "../commands.ts";
import { isLand, tileAt, Terrain } from "../map/gameMap.ts";
import { mix32 } from "../math/hash.ts";
import { terrainValue, type DifficultyRules, type PersonalityRules } from "../rules.ts";
import {
  allianceCount,
  findRequest,
  getAlliance,
  inRenewWindow,
  isAllied,
  isTraitor,
} from "../systems/diplomacy.ts";
import { isSpawnProtected } from "../systems/spawn.ts";
import {
  getPlayer,
  isTribe,
  NEUTRAL,
  nextScratchStamp,
  requestKey,
  type Alliance,
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
    const tribe = brain.tier === "tribe";
    const pace = tribe ? world.rules.tribe : ai.difficulties[brain.difficulty];
    if (brain.nextThinkTick < 0) {
      // First think: staggered so bots don't all act on the same tick.
      brain.nextThinkTick = world.tick + world.rng.nextIntBetween(1, pace.thinkMaxTicks);
      continue;
    }
    if (world.tick < brain.nextThinkTick) continue;
    brain.nextThinkTick =
      world.tick + world.rng.nextIntBetween(pace.thinkMinTicks, pace.thinkMaxTicks);
    const around = survey(world, bot);
    const style = ai.personalities[brain.personality];
    const skill = ai.difficulties[brain.difficulty];
    const talk = !world.rules.diplomacy.enabled
      ? []
      : tribe
        ? tribeDiplomacy(world, bot)
        : nationDiplomacy(world, bot, style, skill, around);
    for (const command of talk) world.pendingCommands.push({ playerId: bot.id, command });
    const decided = tribe
      ? decideTribe(world, bot, around)
      : decide(world, bot, style, skill, brain.idleThinks, around);
    const actions: readonly Command[] =
      decided === null ? [] : Array.isArray(decided) ? decided : [decided as Command];
    for (const command of actions) world.pendingCommands.push({ playerId: bot.id, command });
    const wasting = bot.capacity > 0 && bot.homeTroops >= ai.wastingAt * bot.capacity;
    brain.idleThinks = actions.length === 0 && wasting ? brain.idleThinks + 1 : 0;
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
  skill: DifficultyRules,
  idleThinks: number,
  around: Surroundings,
): Command | readonly Command[] | null {
  const ai = world.rules.ai;
  const mine = world.attacks.filter((a) => a.attacker === bot.id && a.retreatTick < 0);
  const incoming = world.attacks.filter((a) => a.target === bot.id && a.retreatTick < 0);

  // 1. Counter the biggest incoming army we can match (not just the biggest one: a huge
  //    army we can't stop mustn't keep us from stopping a small one).
  const counterable = (skill.counters ? incoming : [])
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
      const boost =
        skill.reinforces && fill >= style.attackAt
          ? reinforce(world, bot, style, attack, around)
          : null;
      return boost ?? { type: "retreat", attackId: attack.id };
    }
  }

  // 4. Expand while there is open land next to us — sending what that land costs, not a
  //    share of the pool, and calling back an army far bigger than what's left to take.
  if (around.neutralFront >= 0) {
    const expansion = mine.find((a) => a.target === NEUTRAL);
    const plan = planExpansion(world, bot, style.expandShare * bot.homeTroops);
    if (
      expansion &&
      expansion.troops > ai.expansionRecallAbove * bot.capacity &&
      expansion.troops > 2 * planExpansion(world, bot, expansion.troops).army
    ) {
      return { type: "retreat", attackId: expansion.id };
    }
    const topUpBelow = Math.max(ai.expansionTopUpBelow, plan.perTick * ai.expansionTopUpTicks);
    const needsArmy = !expansion || expansion.troops < topUpBelow;
    if (needsArmy && fill >= style.expandAt) {
      const focus = expansionFocus(world, bot, around);
      return attackCommand(NEUTRAL, focus, plan.army / Math.max(1, bot.homeTroops));
    }
    if (!style.attacksWhileExpanding) return null;
  }

  // 3 + 5. Attack a neighbour we can beat, once we've regrown enough.
  if (fill < style.attackAt || isSpawnProtected(world)) return null;
  // One war at a time against a nation; tribes are eaten several at once (§3.13).
  const wars = mine.filter((a) => a.target !== NEUTRAL);
  const nationWar = wars.find((a) => !isTribe(getPlayer(world, a.target)));
  if (nationWar) return skill.reinforces ? reinforce(world, bot, style, nationWar, around) : null;
  if (wars.length >= ai.maxTribeWars) {
    return skill.reinforces ? reinforce(world, bot, style, wars[0]!, around) : null;
  }
  const choice = chooseTarget(world, bot, style, skill, around, incoming, idleThinks, wars);
  if (!choice) return null;
  const attack = attackCommand(choice.target.id, choice.focus, choice.share);
  // Betrayal: break the alliance first; both commands apply next tick, in this order.
  return choice.betray ? [{ type: "allianceBreak", ally: choice.target.id }, attack] : attack;
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
 * How big an expansion should be, up to `budget`. A front takes at most one layer of
 * tiles per layer delay, so it can only spend so many troops per tick (`perTick`, from
 * the open land touching the bot's border); the army carries enough for
 * `expansionHorizonTicks` of that, at least a full-speed army, and no more than the open
 * land within reach costs (flooded from the border) plus a margin. Sending a share of a
 * big pool instead would park most of it in a front that can't use it — and field troops
 * count toward the cap, so the pool at home would stop growing.
 */
function planExpansion(
  world: World,
  bot: Player,
  budget: number,
): { army: number; perTick: number } {
  const { map } = world;
  const ai = world.rules.ai;
  const { costPerTile: costs, layerDelayTicks, fullSpeedArmy } = world.rules.expansion;
  const marks = world.scratchMarks;
  const queue = world.scratchQueue;
  const stamp = nextScratchStamp(world);
  const limit = budget / ai.expansionMargin;
  let cost = 0;
  let head = 0;
  let tail = 0;
  const visit = (tile: number): void => {
    if (marks[tile] === stamp || world.owner[tile] !== NEUTRAL || !isLand(map, tile)) return;
    marks[tile] = stamp;
    queue[tail++] = tile;
    cost += terrainValue(costs, map.terrain[tile]!);
  };
  const neighbours = (tile: number): void => {
    const x = tile % map.width;
    if (tile >= map.width) visit(tile - map.width);
    if (tile + map.width < marks.length) visit(tile + map.width);
    if (x > 0) visit(tile - 1);
    if (x < map.width - 1) visit(tile + 1);
  };
  for (const tile of bot.border) neighbours(tile);
  const perTick = cost / layerDelayTicks;
  while (head < tail && cost < limit) neighbours(queue[head++]!);
  const wanted = Math.min(cost * ai.expansionMargin, perTick * ai.expansionHorizonTicks);
  const army = Math.min(budget, Math.max(fullSpeedArmy, wanted));
  return { army, perTick };
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
  const missing = armyToTakeAll(world, bot, target, style) - war.troops;
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
function armyToTakeAll(world: World, bot: Player, target: Player, style: PersonalityRules): number {
  return Math.max(
    style.attackEdge * Math.max(1, target.homeTroops),
    tileCostOfAll(world, bot, target),
  );
}

function tileCostOfAll(world: World, bot: Player, target: Player): number {
  return tileCostOfAllTiles(
    world.rules,
    target.tiles,
    target.homeTroops,
    lossFactor(world, bot, target),
  );
}

/** Tribes' land is cheaper to take for everyone else (D-017). */
function lossFactor(world: World, bot: Player, target: Player): number {
  return attackLossFactor(world.rules, isTribe(bot), isTribe(target));
}

function chooseTarget(
  world: World,
  bot: Player,
  style: PersonalityRules,
  skill: DifficultyRules,
  around: Surroundings,
  incoming: Attack[],
  idleThinks: number,
  wars: Attack[],
): { target: Player; focus: number; share: number; betray: boolean } | null {
  const ai = world.rules.ai;
  const wasting = bot.capacity > 0 && bot.homeTroops >= ai.wastingAt * bot.capacity;
  const boredom = Math.max(0, 1 - idleThinks / ai.boredomThinks);
  const minGain = style.minLandGain * (wasting ? ai.wastingGainFactor * boredom : 1);
  let best: { target: Player; focus: number; share: number; betray: boolean } | null = null;
  let bestScore = 0;
  for (const [id, frontTile] of around.neighborFront) {
    const target = getPlayer(world, id)!;
    if (!target.alive || wars.some((a) => a.target === id)) continue;
    // Allies are off limits — unless this nation is the kind to betray them (below).
    const alliance = getAlliance(world, bot.id, id);
    if (alliance && !willBetray(bot, alliance, id, style, skill)) continue;
    const defenders = Math.max(1, target.homeTroops);
    // Send enough to take everything if we can afford it, otherwise all we're willing to.
    const army = Math.min(
      armyToTakeAll(world, bot, target, style),
      style.attackMaxShare * bot.homeTroops,
    );
    const gain = Math.min(
      expectedLandShare(world.rules, army, defenders, lossFactor(world, bot, target)),
      army / tileCostOfAll(world, bot, target),
    );
    if (gain < minGain) continue;
    if (alliance && gain < skill.betrayMinGain) continue;
    const busy = world.attacks.some((a) => a.attacker === id && a.retreatTick < 0);
    const grudge = (bot.brain?.grudges.get(id) ?? -1) > world.tick;
    const hostile = grudge || incoming.some((a) => a.attacker === id);
    const targetFill = target.capacity > 0 ? target.homeTroops / target.capacity : 1;
    const score =
      gain *
      target.tiles *
      (1 + (busy ? style.preferBusyTargets : 0)) *
      (hostile ? 1.5 : 1) *
      (2 - Math.min(1, targetFill)) * // depleted players are vulnerable
      (gain >= 0.99 ? 2 : 1) * // finishing a player off shrinks the field
      (isTribe(target) ? ai.tribePreference : 1) * // eat the tribes first
      (isTraitor(world, target) ? ai.traitorPreference : 1); // punish betrayal
    if (score > bestScore) {
      bestScore = score;
      // Aim at the heart of their land (their start) if they still hold it: it splits
      // them and cuts off pockets for encirclement.
      const heart = target.spawnTile >= 0 && world.owner[target.spawnTile] === id;
      best = {
        target,
        focus: heart ? target.spawnTile : frontTile,
        share: army / bot.homeTroops,
        betray: alliance !== undefined,
      };
    }
  }
  return best;
}

/**
 * A tribe's whole mind (GAME_DESIGN.md §3.13): expand while open land is near; otherwise,
 * once regrown, attack a random neighbour it can beat with a small share of its troops.
 * No counters, no reinforcing, no retreats — tribes are cheap and predictable.
 */
function decideTribe(world: World, bot: Player, around: Surroundings): Command | null {
  const rules = world.rules.tribe;
  const ai = world.rules.ai;
  const fill = bot.capacity > 0 ? bot.homeTroops / bot.capacity : 0;
  const mine = world.attacks.filter((a) => a.attacker === bot.id && a.retreatTick < 0);
  const atWar = mine.some((a) => a.target !== NEUTRAL);

  // Traitors first, even while open land remains (GAME_DESIGN.md §3.14).
  if (fill >= rules.attackAt && !atWar && !isSpawnProtected(world)) {
    for (const [id, frontTile] of around.neighborFront) {
      if (isTraitor(world, getPlayer(world, id)) && !isAllied(world, bot.id, id)) {
        return attackCommand(id, frontTile, rules.attackShare);
      }
    }
  }

  if (around.neutralFront >= 0) {
    if (fill < rules.expandAt) return null;
    const expansion = mine.find((a) => a.target === NEUTRAL);
    const plan = planExpansion(world, bot, 0.5 * bot.homeTroops);
    const topUpBelow = Math.max(ai.expansionTopUpBelow, plan.perTick * ai.expansionTopUpTicks);
    if (expansion && expansion.troops >= topUpBelow) return null;
    const focus = expansionFocus(world, bot, around);
    return attackCommand(NEUTRAL, focus, plan.army / Math.max(1, bot.homeTroops));
  }

  if (fill < rules.attackAt || isSpawnProtected(world)) return null;
  if (atWar) return null; // one war at a time
  const army = rules.attackShare * bot.homeTroops;
  const beatable: [PlayerId, number][] = [];
  for (const [id, frontTile] of around.neighborFront) {
    const target = getPlayer(world, id)!;
    if (!target.alive || isAllied(world, bot.id, id)) continue;
    const gain = expectedLandShare(
      world.rules,
      army,
      Math.max(1, target.homeTroops),
      lossFactor(world, bot, target),
    );
    if (gain >= rules.minLandGain) beatable.push([id, frontTile]);
  }
  if (beatable.length === 0) return null;
  const [target, focus] = beatable[world.rng.nextInt(beatable.length)]!;
  return attackCommand(target, focus, rules.attackShare);
}

/** A tribe accepts every request and renews every alliance (GAME_DESIGN.md §3.14). */
function tribeDiplomacy(world: World, bot: Player): Command[] {
  const commands: Command[] = [];
  for (const request of world.allianceRequests) {
    if (request.to === bot.id) {
      commands.push({ type: "allianceReply", from: request.from, accept: true });
    }
  }
  for (const alliance of world.alliances.values()) {
    const ally = otherSide(alliance, bot.id);
    if (ally !== null && needsMyRenewal(world, alliance, bot.id)) {
      commands.push({ type: "allianceRenew", ally });
    }
  }
  return commands;
}

/**
 * A nation's diplomacy on each think: answer every request, renew the alliances it still
 * wants, and ask at most one bordering player for an alliance (GAME_DESIGN.md §3.14).
 */
function nationDiplomacy(
  world: World,
  bot: Player,
  style: PersonalityRules,
  skill: DifficultyRules,
  around: Surroundings,
): Command[] {
  const commands: Command[] = [];
  let count = allianceCount(world, bot.id);
  for (const request of world.allianceRequests) {
    if (request.to !== bot.id) continue;
    const other = getPlayer(world, request.from)!;
    const accept = welcomes(world, bot, other, style, skill, around, count, false);
    if (accept) count++;
    commands.push({ type: "allianceReply", from: request.from, accept });
  }
  for (const alliance of world.alliances.values()) {
    const ally = otherSide(alliance, bot.id);
    if (ally === null || !needsMyRenewal(world, alliance, bot.id)) continue;
    const other = getPlayer(world, ally)!;
    if (welcomes(world, bot, other, style, skill, around, count, true)) {
      commands.push({ type: "allianceRenew", ally });
    }
  }

  // Ask the strongest bordering player it would welcome (each one at most every 90 s).
  const every = world.rules.ai.allyRequestEveryTicks;
  let ask: Player | null = null;
  for (const id of around.neighborFront.keys()) {
    const other = getPlayer(world, id)!;
    if (isTribe(other) || isAllied(world, bot.id, id)) continue;
    if (findRequest(world, bot.id, id) || findRequest(world, id, bot.id)) continue;
    const last = world.lastRequestTick.get(requestKey(bot.id, id));
    if (last !== undefined && world.tick - last < every) continue;
    if (ask && strength(other) <= strength(ask)) continue;
    if (welcomes(world, bot, other, style, skill, around, count, false)) ask = other;
  }
  if (ask) commands.push({ type: "allianceRequest", target: ask.id });
  return commands;
}

/**
 * Would this nation have `other` as an ally (now, or for another term when renewing)?
 * Never tribes (they're food), traitors, whoever betrayed it lately, a runaway leader,
 * anyone once only two contenders are left, or a player it is beating. A neighbour is
 * welcome if clearly stronger (appeasement), fighting the same enemy, or not much weaker
 * while the nation is at war with someone else (a safe flank); a far-away player if it
 * isn't much weaker. Easy and Medium nations sometimes answer at random.
 */
function welcomes(
  world: World,
  bot: Player,
  other: Player,
  style: PersonalityRules,
  skill: DifficultyRules,
  around: Surroundings,
  count: number,
  renewing: boolean,
): boolean {
  const ai = world.rules.ai;
  if (!other.alive || isTribe(other) || isTraitor(world, other)) return false;
  if ((bot.brain?.grudges.get(other.id) ?? -1) > world.tick) return false;
  if (!renewing && count >= ai.maxAlliances) return false;
  if (other.tiles >= ai.allyLeaderShare * world.map.landTiles) return false;
  if (contenders(world) <= 2) return false;
  const myWar = world.attacks.find(
    (a) => a.attacker === bot.id && a.target === other.id && a.retreatTick < 0,
  );
  if (myWar) {
    const gain = expectedLandShare(
      world.rules,
      myWar.troops,
      Math.max(1, other.homeTroops),
      lossFactor(world, bot, other),
    );
    if (gain >= ai.allyRefuseWhenWinning) return false;
  }
  const ratio = strength(other) / Math.max(1, strength(bot));
  let want: boolean;
  if (around.neighborFront.has(other.id)) {
    const enemies = enemiesOf(world, bot.id);
    enemies.delete(other.id);
    let shared = false;
    for (const id of enemiesOf(world, other.id)) if (enemies.has(id)) shared = true;
    want =
      ratio >= style.allyWithout || shared || (enemies.size > 0 && ratio >= ai.allyMinStrength);
  } else {
    want = ratio >= ai.allyMinStrength;
  }
  if (skill.allyConfusion > 0 && world.rng.nextFloat() < skill.allyConfusion) want = !want;
  return want;
}

/**
 * Whether this nation is the kind to betray this ally: decided once per alliance from the
 * difficulty's chance × the personality's betrayal factor. (A random draw on every think
 * would turn every alliance into a betrayal sooner or later.)
 */
function willBetray(
  bot: Player,
  alliance: Alliance,
  ally: PlayerId,
  style: PersonalityRules,
  skill: DifficultyRules,
): boolean {
  const chance = skill.betrayChance * style.betrayal;
  if (chance <= 0) return false;
  if (chance >= 1) return true;
  const roll = mix32(mix32(Math.imul(bot.id, 0x9e3779b1) ^ ally) ^ alliance.formedTick);
  return roll / 0x1_0000_0000 < chance;
}

/** Nations and humans still in the game. */
function contenders(world: World): number {
  let count = 0;
  for (const p of world.players) if (p.alive && !isTribe(p)) count++;
  return count;
}

/** Non-tribe players this player is fighting (attacking or attacked by). */
function enemiesOf(world: World, id: PlayerId): Set<PlayerId> {
  const enemies = new Set<PlayerId>();
  for (const a of world.attacks) {
    if (a.retreatTick >= 0 || a.target === NEUTRAL) continue;
    const other = a.attacker === id ? a.target : a.target === id ? a.attacker : NEUTRAL;
    if (other !== NEUTRAL && !isTribe(getPlayer(world, other))) enemies.add(other);
  }
  return enemies;
}

/** Troops at home and in the field. */
function strength(player: Player): number {
  return player.homeTroops + player.fieldTroops;
}

function otherSide(alliance: Alliance, id: PlayerId): PlayerId | null {
  return alliance.a === id ? alliance.b : alliance.b === id ? alliance.a : null;
}

/** The alliance is in its renewal window and `id` hasn't renewed yet. */
function needsMyRenewal(world: World, alliance: Alliance, id: PlayerId): boolean {
  const done = alliance.a === id ? alliance.renewA : alliance.renewB;
  return !done && inRenewWindow(world, alliance);
}

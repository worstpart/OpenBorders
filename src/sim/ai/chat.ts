/**
 * How nations use emojis and pings (GAME_DESIGN.md §3.20, milestone 2.9).
 *
 *  - **Friends' pings steer them.** A friend's (ally's or teammate's) "attack here" ping on a
 *    player's land makes that player a preferred target, aimed at the pinged spot; a friend's
 *    "defend here" ping makes whoever attacks that friend a preferred target. "Watch out" is
 *    for people; nations ignore it.
 *  - **They ping their human friends**: "attack here" where they strike a player, and
 *    "defend here" at the front when they are being overrun.
 *  - **They answer people's emojis** and react to a person's betrayal, alliance or attack
 *    with one — sometimes (rules.chat.nationEmoteChance).
 *
 * Tribes do none of this. Everything here only involves people's pings and emojis, so
 * bots-only games (the headless runner) play exactly as before 2.9.
 */
import type { Command } from "../commands.ts";
import { areFriendly } from "../systems/diplomacy.ts";
import { getPlayer, isTribe, NEUTRAL, type Player, type PlayerId, type World } from "../world.ts";

/** What a nation's friends asked for with pings, right now. */
export interface PingIntel {
  /** Players a friend wants attacked, and the pinged tile (still theirs) to aim at. */
  readonly attack: Map<PlayerId, number>;
  /** Players attacking a friend who asked for help. */
  readonly defend: Set<PlayerId>;
}

/** The friends' pings a nation acts on, or null when there are none (the usual case). */
export function pingIntel(world: World, bot: Player): PingIntel | null {
  if (world.pings.length === 0) return null;
  let intel: { attack: Map<PlayerId, number>; defend: Set<PlayerId> } | null = null;
  for (const ping of world.pings) {
    if (ping.from === bot.id || !areFriendly(world, bot.id, ping.from)) continue;
    if (ping.kind === "attack") {
      const target = world.owner[ping.tile]!;
      if (target === NEUTRAL || target === bot.id || areFriendly(world, bot.id, target)) continue;
      intel ??= { attack: new Map(), defend: new Set() };
      intel.attack.set(target, ping.tile); // the latest ping on them wins
    } else if (ping.kind === "defend") {
      for (const a of world.attacks) {
        if (a.target !== ping.from || a.retreatTick >= 0 || a.attacker === bot.id) continue;
        if (areFriendly(world, bot.id, a.attacker)) continue;
        intel ??= { attack: new Map(), defend: new Set() };
        intel.defend.add(a.attacker);
      }
    }
  }
  return intel;
}

/** How much more a nation wants to attack `id` because of its friends' pings (1 = no ping). */
export function pingPreference(world: World, intel: PingIntel | null, id: PlayerId): number {
  if (!intel) return 1;
  const chat = world.rules.chat;
  return (
    (intel.attack.has(id) ? chat.pingAttackPreference : 1) *
    (intel.defend.has(id) ? chat.pingDefendPreference : 1)
  );
}

/** The nation's living human friends (allies or teammates). */
function humanFriends(world: World, bot: Player): Player[] {
  const friends: Player[] = [];
  for (const p of world.players) {
    if (p.kind === "human" && p.alive && p.id !== bot.id && areFriendly(world, bot.id, p.id)) {
      friends.push(p);
    }
  }
  return friends;
}

/**
 * A ping for the nation's human friends after it decided its actions: "attack here" where
 * it strikes a player, or "defend here" where it is being overrun. Null when it has no human
 * friend, pinged recently, or has nothing to say.
 */
export function nationPing(
  world: World,
  bot: Player,
  actions: readonly Command[],
  incomingTroops: number,
): Command | null {
  const chat = world.rules.chat;
  if (!chat.enabled) return null;
  if (bot.lastPingTick >= 0 && world.tick - bot.lastPingTick < chat.nationPingCooldownTicks) {
    return null;
  }
  if (humanFriends(world, bot).length === 0) return null;
  // Wars on nations and people are news; eating tribes isn't.
  const worthIt = (id: PlayerId) => id !== NEUTRAL && !isTribe(getPlayer(world, id));
  for (const c of actions) {
    if (c.type === "attack" && worthIt(c.target)) {
      return { type: "ping", tile: c.focusTile, kind: "attack" };
    }
    if (c.type === "boat" && worthIt(c.target)) {
      return { type: "ping", tile: c.tile, kind: "attack" };
    }
  }
  if (incomingTroops > chat.nationHelpThreshold * Math.max(1, bot.homeTroops)) {
    let biggest = null;
    for (const a of world.attacks) {
      if (a.target !== bot.id || a.retreatTick >= 0) continue;
      if (!biggest || a.troops > biggest.troops) biggest = a;
    }
    if (biggest) return { type: "ping", tile: biggest.focusTile, kind: "defend" };
  }
  return null;
}

/** Emoji indexes by the emoji itself (so reordering rules.chat.emojis can't break replies). */
function emojiIndex(world: World, emoji: string): number {
  return world.rules.chat.emojis.indexOf(emoji);
}

const FRIENDLY = ["👋", "🤝", "👍", "😀", "❤️", "🙏"];
const RUDE = ["👎", "😂", "😠", "💀", "🎯"];

/** Are `bot` and `other` fighting (an attack either way), or does the bot hold a grudge? */
function hostile(world: World, bot: Player, other: PlayerId): boolean {
  if ((bot.brain?.grudges.get(other) ?? -1) > world.tick) return true;
  return world.attacks.some(
    (a) =>
      a.retreatTick < 0 &&
      ((a.attacker === bot.id && a.target === other) ||
        (a.attacker === other && a.target === bot.id)),
  );
}

/** A nation's answer to an emoji from a person (an emoji, not chosen at random yet). */
function replyTo(world: World, bot: Player, from: Player, emoji: string): string {
  const angry = hostile(world, bot, from.id);
  const stronger = bot.homeTroops + bot.fieldTroops > 1.5 * (from.homeTroops + from.fieldTroops);
  if (emoji === "🏳️") return angry ? "💀" : "🤝";
  if (FRIENDLY.includes(emoji)) {
    if (angry) return "👎";
    return areFriendly(world, bot.id, from.id) ? "❤️" : "👋";
  }
  if (RUDE.includes(emoji)) return stronger ? "😂" : "😠";
  return angry ? "😂" : "👋";
}

/**
 * Tick system (with the bots): nations react to this tick's events that involve a person —
 * an emoji sent to them, a betrayal, a new alliance, an attack. Queued like any bot command.
 */
export function nationChatter(world: World): void {
  const chat = world.rules.chat;
  if (!chat.enabled) return;
  const said = new Set<PlayerId>();
  const say = (bot: Player | undefined, to: Player | undefined, emoji: string, chance = 1) => {
    if (!bot?.alive || bot.brain?.tier !== "nation" || !to || to.kind !== "human") return;
    if (said.has(bot.id)) return;
    if (bot.lastEmoteTick >= 0 && world.tick - bot.lastEmoteTick < chat.emoteCooldownTicks) return;
    const index = emojiIndex(world, emoji);
    if (index < 0) return;
    // Only drawn when a person is involved, so bots-only games keep their random sequence.
    if (world.rng.nextFloat() >= chance * chat.nationEmoteChance) return;
    said.add(bot.id);
    world.pendingCommands.push({
      playerId: bot.id,
      command: { type: "emote", to: to.id, emoji: index },
    });
  };
  for (const event of world.events) {
    switch (event.type) {
      case "emoted": {
        if (event.to === 0) break;
        const bot = getPlayer(world, event.to);
        const from = getPlayer(world, event.from);
        const emoji = chat.emojis[event.emoji];
        if (bot && from && emoji) say(bot, from, replyTo(world, bot, from, emoji));
        break;
      }
      case "allianceBroken":
        say(getPlayer(world, event.victim), getPlayer(world, event.breaker), "😠");
        break;
      case "allianceFormed": {
        const a = getPlayer(world, event.a);
        const b = getPlayer(world, event.b);
        say(a, b, "🤝", 0.5);
        say(b, a, "🤝", 0.5);
        break;
      }
      case "attackStarted": {
        if (event.target === NEUTRAL) break;
        const bot = getPlayer(world, event.target);
        const attacker = getPlayer(world, event.attacker);
        if (!bot || !attacker) break;
        const weaker = bot.homeTroops < attacker.homeTroops;
        say(bot, attacker, weaker ? "😱" : "😠", 0.3);
        break;
      }
    }
  }
}

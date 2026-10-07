/**
 * Emojis and map pings (GAME_DESIGN.md §3.20, milestone 2.9) — the only way to talk in a
 * game: no free text. An emoji goes to one player or to everyone and shows over the
 * sender's land for a few seconds. A ping is a marker on the map ("attack here", "defend
 * here", "watch out") for the pinger's allies and teammates; nations act on their friends'
 * pings (ai/chat.ts). Both are ordinary commands, so they work the same in multiplayer,
 * where the server will also forward pings only to the pinger's friends.
 */
import { PING_KINDS, type PingKind } from "../rules.ts";
import { getPlayer, type Player, type PlayerId, type World } from "../world.ts";

/** Handles `emote`. Returns a rejection reason, or null on success. */
export function applyEmote(
  world: World,
  player: Player,
  to: PlayerId,
  emoji: number,
): string | null {
  const rules = world.rules.chat;
  if (!rules.enabled) return "chat is off in this game";
  if (world.phase === "ended") return "the game is over";
  if (!Number.isInteger(emoji) || emoji < 0 || emoji >= rules.emojis.length) return "no such emoji";
  if (to !== 0) {
    if (!Number.isInteger(to) || to === player.id) return "invalid player";
    if (!getPlayer(world, to)?.alive) return "that player is gone";
  }
  if (player.lastEmoteTick >= 0 && world.tick - player.lastEmoteTick < rules.emoteCooldownTicks) {
    return "too soon after your last emoji";
  }
  player.lastEmoteTick = world.tick;
  world.events.push({ type: "emoted", from: player.id, to, emoji });
  return null;
}

/** Handles `ping`. Returns a rejection reason, or null on success. */
export function applyPing(
  world: World,
  player: Player,
  tile: number,
  kind: PingKind,
): string | null {
  const rules = world.rules.chat;
  if (!rules.enabled) return "chat is off in this game";
  if (world.phase === "ended") return "the game is over";
  if (!Number.isInteger(tile) || tile < 0 || tile >= world.owner.length) return "invalid tile";
  if (!PING_KINDS.includes(kind)) return "no such ping";
  if (player.lastPingTick >= 0 && world.tick - player.lastPingTick < rules.pingCooldownTicks) {
    return "too soon after your last ping";
  }
  player.lastPingTick = world.tick;
  // A player's oldest ping goes when they already have the most allowed.
  const mine = world.pings.filter((p) => p.from === player.id);
  if (mine.length >= rules.maxPingsPerPlayer) {
    const oldest = mine[0]!;
    world.pings = world.pings.filter((p) => p !== oldest);
  }
  const ping = {
    id: world.nextPingId++,
    from: player.id,
    tile,
    kind,
    target: world.owner[tile]!,
    tick: world.tick,
    expiresTick: world.tick + rules.pingTicks,
  };
  world.pings.push(ping);
  world.events.push({
    type: "pinged",
    pingId: ping.id,
    from: ping.from,
    tile,
    kind,
    target: ping.target,
  });
  return null;
}

/** Tick system (after commands): pings run out, and an eliminated player's pings go. */
export function updateChat(world: World): void {
  if (world.pings.length === 0) return;
  world.pings = world.pings.filter(
    (p) => p.expiresTick > world.tick && getPlayer(world, p.from)?.alive === true,
  );
}

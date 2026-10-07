/**
 * What the HUD shows of emojis and map pings (GAME_DESIGN.md §3.20): which pings the local
 * player sees (their own and their friends'), the emojis showing over players' land, and
 * the ping a key press drops. Pure functions over frame data.
 */
import type { SimEvent } from "../../sim/events.ts";
import type { PingSnapshot } from "../../sim/frame.ts";
import type { GameRules, PingKind } from "../../sim/rules.ts";
import type { PlayerId } from "../../sim/world.ts";

export interface PingInfo {
  readonly icon: string;
  readonly label: string;
  /** Ring colour on the map. */
  readonly color: string;
}

export const PING_INFO: Readonly<Record<PingKind, PingInfo>> = {
  attack: { icon: "🎯", label: "Attack here", color: "#ff7a66" },
  defend: { icon: "🛡️", label: "Defend here", color: "#6cc4ff" },
  watch: { icon: "⚠️", label: "Watch out", color: "#ffd25a" },
};

/** Pings are only for the pinger's allies and teammates (and the pinger). */
export function visiblePings(
  pings: readonly PingSnapshot[],
  me: PlayerId,
  friends: ReadonlySet<PlayerId>,
): PingSnapshot[] {
  return pings.filter((p) => p.from === me || friends.has(p.from));
}

/**
 * The ping the ping key drops on a tile: "attack here" on an enemy's land, "defend here" on
 * ours or a friend's, "watch out" anywhere else (open land, the sea).
 */
export function quickPingKind(
  owner: PlayerId,
  land: boolean,
  me: PlayerId,
  friends: ReadonlySet<PlayerId>,
): PingKind {
  if (!land || owner === 0) return "watch";
  return owner === me || friends.has(owner) ? "defend" : "attack";
}

/** An emoji showing over its sender's land. */
export interface Emote {
  readonly from: PlayerId;
  /** 0 = to everyone. */
  readonly to: PlayerId;
  readonly emoji: string;
  /** The tick it was sent. */
  readonly tick: number;
}

/**
 * Adds this tick's emojis the local player gets to see — to everyone, to them, or theirs —
 * and drops the ones that have shown long enough. A player's newer emoji replaces the older.
 */
export function updateEmotes(
  list: readonly Emote[],
  events: readonly SimEvent[],
  me: PlayerId,
  tick: number,
  rules: GameRules,
): Emote[] {
  let next = list.filter((e) => tick - e.tick < rules.chat.emoteShowTicks);
  for (const event of events) {
    if (event.type !== "emoted") continue;
    if (event.to !== 0 && event.to !== me && event.from !== me) continue;
    const emoji = rules.chat.emojis[event.emoji];
    if (!emoji) continue;
    next = next.filter((e) => e.from !== event.from);
    next.push({ from: event.from, to: event.to, emoji, tick });
  }
  return next;
}

/** How far through its showing time an emoji is (0 → 1). */
export function emoteAge(emote: Emote, tick: number, rules: GameRules): number {
  return Math.min(1, Math.max(0, (tick - emote.tick) / rules.chat.emoteShowTicks));
}

/** Ticks until the local player may send their next emoji / ping (0 = now). */
export function cooldownLeft(lastTick: number, cooldownTicks: number, tick: number): number {
  return lastTick < 0 ? 0 : Math.max(0, lastTick + cooldownTicks - tick);
}

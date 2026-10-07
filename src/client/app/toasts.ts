/**
 * Toasts (GAME_DESIGN.md §5.1): short, auto-dismissing messages at the top center, at
 * most three at a time. Only moments that matter to the local player become toasts —
 * a feed of every bot skirmish would be noise.
 */
import type { SimEvent } from "../../sim/events.ts";
import { DEFAULT_RULES } from "../../sim/rules.ts";
import type { PlayerId } from "../../sim/world.ts";
import { levelRules } from "../../sim/systems/buildings.ts";
import { formatTroops } from "../format.ts";
import { effectLines } from "./buildings.ts";
import { PING_INFO } from "./chat.ts";

const TRAITOR_SECONDS = (DEFAULT_RULES.diplomacy.traitorTicks * DEFAULT_RULES.tickMs) / 1000;
const TRAITOR_DISCOUNT = Math.round((1 - DEFAULT_RULES.diplomacy.traitorLoss) * 100);

export type ToastTone = "info" | "success" | "danger";

export interface ToastInput {
  readonly text: string;
  readonly tone: ToastTone;
  /** A player whose color marks the toast. */
  readonly player?: PlayerId;
}

export interface Toast extends ToastInput {
  readonly id: number;
}

export const MAX_TOASTS = 3;
/** Smaller encirclements (slivers cut off along a front) happen all the time: not news. */
export const ENCIRCLE_TOAST_MIN_TILES = 25;
export const TOAST_MS = 4_500;
/**
 * Above this many players (milestone 2.0 big lobbies) other players' eliminations are only
 * news when they bordered you — with 125 bots, a toast per elimination would be a flood.
 */
export const BIG_LOBBY_PLAYERS = 16;

/** Adds a toast, dropping the oldest beyond `max`. */
export function addToast(list: readonly Toast[], toast: Toast, max = MAX_TOASTS): Toast[] {
  return [...list, toast].slice(-max);
}

/**
 * The toasts a tick's events produce for the local player. `isNews` decides whether
 * another player's elimination (not by us), or a betrayal between others, is worth a toast.
 * Alliance requests to us become diplomacy cards, not toasts. `teamOf` gives a player's
 * team in team games (GAME_DESIGN.md §3.15): a teammate's elimination is always news.
 * `friends` (allies and teammates) are the players whose pings we see (§3.20).
 */
export function toastsForEvents(
  events: readonly SimEvent[],
  me: PlayerId,
  nameOf: (id: PlayerId) => string,
  isNews: (eliminated: PlayerId) => boolean = () => true,
  teamOf: (id: PlayerId) => number = () => 0,
  friends: ReadonlySet<PlayerId> = new Set(),
): ToastInput[] {
  const toasts: ToastInput[] = [];
  const myTeam = teamOf(me);
  for (const event of events) {
    switch (event.type) {
      case "attackStarted":
        if (event.target === me) {
          toasts.push({
            text:
              event.landingTile >= 0
                ? `${nameOf(event.attacker)} landed on your coast`
                : `${nameOf(event.attacker)} is attacking you`,
            tone: "danger",
            player: event.attacker,
          });
        }
        break;
      case "boatLaunched":
        // The incoming-threat warning (GAME_DESIGN.md §3.18); the chip counts down.
        if (event.target === me) {
          toasts.push({
            text: `⛵ ${nameOf(event.owner)}'s boat is heading for your coast`,
            tone: "danger",
            player: event.owner,
          });
        }
        break;
      case "boatLanded":
        if (event.owner === me && event.attackId < 0) {
          toasts.push({
            text: "Your boat's landing spot is friendly now — its troops came home",
            tone: "info",
          });
        }
        break;
      case "attackEnded":
        if (event.attacker === me && event.target !== 0) {
          if (event.reason === "cancelled") {
            toasts.push({
              text: `${nameOf(event.target)}'s army cancelled out your attack`,
              tone: "info",
              player: event.target,
            });
          } else if (event.reason === "spent") {
            toasts.push({
              text: `Your attack on ${nameOf(event.target)} ran out of troops`,
              tone: "info",
              player: event.target,
            });
          }
        }
        break;
      case "encircled":
        if (event.tiles < ENCIRCLE_TOAST_MIN_TILES) break;
        if (event.by === me) {
          toasts.push({
            text: `You encircled ${event.tiles.toLocaleString("en-US")} tiles of ${nameOf(event.playerId)}`,
            tone: "success",
            player: event.playerId,
          });
        } else if (event.playerId === me) {
          toasts.push({
            text: `${nameOf(event.by)} encircled ${event.tiles.toLocaleString("en-US")} of your tiles`,
            tone: "danger",
            player: event.by,
          });
        }
        break;
      case "eliminated":
        if (event.playerId === me) break; // the defeat card says it
        if (myTeam !== 0 && teamOf(event.playerId) === myTeam) {
          toasts.push({
            text:
              event.by !== null
                ? `${nameOf(event.by)} eliminated your teammate ${nameOf(event.playerId)}`
                : `Your teammate ${nameOf(event.playerId)} was eliminated`,
            tone: "danger",
            player: event.playerId,
          });
          break;
        }
        if (event.by !== me && !isNews(event.playerId)) break;
        toasts.push(
          event.by === me
            ? {
                text:
                  `You eliminated ${nameOf(event.playerId)}` +
                  (event.loot >= 1 ? ` and took ${formatTroops(event.loot)} gold` : ""),
                tone: "success",
                player: event.playerId,
              }
            : {
                text:
                  event.by !== null
                    ? `${nameOf(event.by)} eliminated ${nameOf(event.playerId)}`
                    : `${nameOf(event.playerId)} was eliminated`,
                tone: "info",
                player: event.playerId,
              },
        );
        break;
      case "allianceRequested":
        if (event.from === me) {
          toasts.push({
            text: `Alliance request sent to ${nameOf(event.to)}`,
            tone: "info",
            player: event.to,
          });
        }
        break;
      case "allianceRequestEnded":
        if (event.from === me) {
          toasts.push({
            text:
              event.reason === "declined"
                ? `${nameOf(event.to)} declined your alliance`
                : `${nameOf(event.to)} didn't answer your alliance request`,
            tone: "info",
            player: event.to,
          });
        }
        break;
      case "allianceFormed":
      case "allianceRenewed": {
        const other = event.a === me ? event.b : event.b === me ? event.a : null;
        if (other === null) break;
        toasts.push({
          text:
            event.type === "allianceFormed"
              ? `You are now allied with ${nameOf(other)}`
              : `Alliance with ${nameOf(other)} renewed`,
          tone: "success",
          player: other,
        });
        break;
      }
      case "allianceEnded": {
        const other = event.a === me ? event.b : event.b === me ? event.a : null;
        if (other === null || event.reason !== "expired") break;
        toasts.push({
          text: `Your alliance with ${nameOf(other)} has ended`,
          tone: "info",
          player: other,
        });
        break;
      }
      case "allianceBroken":
        if (event.breaker === me) {
          toasts.push({
            text: `You betrayed ${nameOf(event.victim)} — you're a traitor for ${TRAITOR_SECONDS} s`,
            tone: "danger",
            player: event.victim,
          });
        } else if (event.victim === me) {
          toasts.push({
            text: `${nameOf(event.breaker)} betrayed you! Attacking them costs ${TRAITOR_DISCOUNT}% less for ${TRAITOR_SECONDS} s`,
            tone: "danger",
            player: event.breaker,
          });
        } else if (isNews(event.breaker) || isNews(event.victim)) {
          toasts.push({
            text: `${nameOf(event.breaker)} betrayed ${nameOf(event.victim)}`,
            tone: "info",
            player: event.breaker,
          });
        }
        break;
      case "donated": {
        const what = `${formatTroops(event.amount)} ${event.resource === "gold" ? "gold" : "troops"}`;
        if (event.to === me) {
          toasts.push({
            text: `${nameOf(event.from)} sent you ${what}`,
            tone: "success",
            player: event.from,
          });
        } else if (event.from === me) {
          toasts.push({
            text: `You sent ${nameOf(event.to)} ${what}`,
            tone: "info",
            player: event.to,
          });
        }
        break;
      }
      case "buildingCompleted":
        if (event.playerId === me) {
          const effects = effectLines(DEFAULT_RULES, event.buildingType, event.level);
          toasts.push({
            text:
              `${levelRules(DEFAULT_RULES, event.buildingType, event.level).name} ready` +
              (effects.length > 0 ? ` — ${effects.join(", ")}` : ""),
            tone: "success",
          });
        }
        break;
      case "buildingCaptured": {
        const name = levelRules(DEFAULT_RULES, event.buildingType, event.level).name;
        if (event.from === me) {
          toasts.push({
            text: `${nameOf(event.to)} took over your ${name}`,
            tone: "danger",
            player: event.to,
          });
        } else if (event.to === me) {
          toasts.push({
            text: `You took over ${nameOf(event.from)}'s ${name}`,
            tone: "success",
            player: event.from,
          });
        }
        break;
      }
      case "wallCompleted":
        if (event.playerId === me) {
          toasts.push({
            text: `${DEFAULT_RULES.walls.levels[event.level - 1]!.name} ready`,
            tone: "success",
          });
        }
        break;
      case "wallDestroyed":
        if (event.playerId === me && event.reason === "breached") {
          toasts.push({
            text:
              event.by !== null ? `${nameOf(event.by)} broke through your wall` : "Your wall fell",
            tone: "danger",
            player: event.by ?? undefined,
          });
        }
        break;
      case "buildingDestroyed":
        if (event.reason !== "captured") break;
        if (event.playerId === me) {
          toasts.push({
            text:
              event.by !== null
                ? `${nameOf(event.by)} destroyed your ${levelRules(DEFAULT_RULES, event.buildingType, 1).name}`
                : `Your ${levelRules(DEFAULT_RULES, event.buildingType, 1).name} was destroyed`,
            tone: "danger",
            player: event.by ?? undefined,
          });
        } else if (event.by === me) {
          toasts.push({
            text: `You destroyed ${nameOf(event.playerId)}'s ${levelRules(DEFAULT_RULES, event.buildingType, 1).name}`,
            tone: "success",
            player: event.playerId,
          });
        }
        break;
      case "emoted":
        // Emojis to us (GAME_DESIGN.md §3.20); the bubble also shows over their land.
        if (event.to === me && event.from !== me) {
          const emoji = DEFAULT_RULES.chat.emojis[event.emoji];
          if (emoji)
            toasts.push({
              text: `${nameOf(event.from)}: ${emoji}`,
              tone: "info",
              player: event.from,
            });
        }
        break;
      case "pinged":
        if (event.from !== me && friends.has(event.from)) {
          const info = PING_INFO[event.kind];
          toasts.push({
            text: `${nameOf(event.from)}: ${info.icon} ${info.label}${event.target !== 0 && event.target !== me && event.target !== event.from ? ` — ${nameOf(event.target)}` : ""}`,
            tone: event.kind === "watch" ? "danger" : "info",
            player: event.from,
          });
        }
        break;
      case "phaseChanged":
        if (event.phase === "playing") {
          toasts.push({ text: "The match has started — expand!", tone: "info" });
        }
        break;
    }
  }
  return toasts;
}

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
import { isMissile } from "../../sim/systems/missiles.ts";
import type { FlightKind } from "../../sim/world.ts";
import { FLIGHT_INFO } from "./flights.ts";

const BUSTER_LEVELS = DEFAULT_RULES.flights.busterLevels;

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
 * another player's elimination (not by us) is worth a toast; every betrayal is.
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
  // The kind of flight that arrived last: the buildings it strikes are its doing. A missile's
  // hits are summed into one toast (missileHit / warheadDetonated) instead of one per building.
  let arrived: FlightKind | null = null;
  let mineHit = 0;
  for (const event of events) {
    switch (event.type) {
      case "flightArrived":
        arrived = event.kind;
        mineHit = 0;
        break;
      case "missileHit": {
        const info = FLIGHT_INFO[event.missile];
        const levels = event.missile === "buster" ? BUSTER_LEVELS : 1;
        if (event.owner === me) {
          toasts.push({
            text:
              event.buildings > 0
                ? `${info.icon} Your ${info.name} hit ${event.buildings} building${event.buildings > 1 ? "s" : ""}: −${levels} level${levels > 1 ? "s" : ""} each`
                : event.missile === "buster"
                  ? `${info.icon} Your bunker buster found nothing to hit`
                  : `${info.icon} Your strike missile hit — no buildings there; defences suppressed`,
            tone: "success",
            ...(event.victim ? { player: event.victim } : {}),
          });
        } else if (mineHit > 0 || event.victim === me) {
          toasts.push({
            text:
              mineHit > 0
                ? `${info.icon} ${nameOf(event.owner)}'s ${info.name} hit ${mineHit} of your buildings (−${levels} level${levels > 1 ? "s" : ""})`
                : `${info.icon} ${nameOf(event.owner)}'s strike missile knocked out your defences there`,
            tone: "danger",
            player: event.owner,
          });
        }
        break;
      }
      case "warheadDetonated": {
        const mine = event.victims.find((v) => v.id === me);
        if (mine) {
          toasts.push({
            text: `☢ ${nameOf(event.owner)}'s strategic warhead scorched ${mine.tiles.toLocaleString("en-US")} tiles of your land (−${formatTroops(mine.troops)} troops)`,
            tone: "danger",
            player: event.owner,
          });
        } else if (event.owner === me) {
          const worst = [...event.victims].sort((a, b) => b.tiles - a.tiles)[0];
          toasts.push({
            text: worst
              ? `☢ Your warhead scorched ${event.tiles.toLocaleString("en-US")} tiles — ${nameOf(worst.id)} lost ${formatTroops(worst.troops)} troops`
              : "☢ Your warhead hit empty land",
            tone: "success",
            ...(worst ? { player: worst.id } : {}),
          });
        } else {
          // Everyone hears of a warhead (it is rare, and it changes the game).
          const worst = [...event.victims].sort((a, b) => b.tiles - a.tiles)[0];
          toasts.push({
            text: worst
              ? `☢ ${nameOf(event.owner)}'s strategic warhead struck ${nameOf(worst.id)}`
              : `☢ ${nameOf(event.owner)}'s strategic warhead struck empty land`,
            tone: "info",
            player: event.owner,
          });
        }
        break;
      }
      case "attackStarted":
        if (event.target === me) {
          toasts.push({
            text: event.airborne
              ? `🪂 ${nameOf(event.attacker)}'s airborne troops landed on your land`
              : event.landingTile >= 0
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
      case "flightLaunched": {
        // Hostile flights join the incoming-threat warning (GAME_DESIGN.md §3.17.7).
        const info = FLIGHT_INFO[event.kind];
        if (event.kind === "airlift" && event.target === me && event.owner !== me) {
          toasts.push({
            text: `✈ ${nameOf(event.owner)} is airlifting ${formatTroops(event.troops)} troops to you`,
            tone: "success",
            player: event.owner,
          });
        }
        if (
          event.target === me &&
          event.owner !== me &&
          info.hostile &&
          !friends.has(event.owner)
        ) {
          toasts.push({
            text: `${info.icon} ${nameOf(event.owner)}'s ${info.name} is heading for your land`,
            tone: "danger",
            player: event.owner,
          });
        }
        break;
      }
      case "flightIntercepted": {
        // SAMs (GAME_DESIGN.md §3.17.7) and Fortress Wall flak (2B.3): our planes lost, or our hit.
        const weapon = event.weapon === "flak" ? "Fortress Wall flak" : "SAM";
        if (isMissile(event.kind)) {
          const info = FLIGHT_INFO[event.kind];
          if (event.owner === me) {
            toasts.push({
              text: `💥 ${nameOf(event.by)}'s SAM shot down your ${info.name}`,
              tone: "danger",
              player: event.by,
            });
          } else if (event.by === me) {
            toasts.push({
              text: `🎯 Your SAM shot down ${nameOf(event.owner)}'s ${info.name}`,
              tone: "success",
              player: event.owner,
            });
          }
          break;
        }
        if (event.planes === 0) {
          // Only an escort fighter (2B.4): it took the shot meant for a plane.
          if (event.owner === me) {
            toasts.push({
              text: `🛡 ${nameOf(event.by)}'s ${weapon} shot down an escort fighter — your planes fly on`,
              tone: "info",
              player: event.by,
            });
          } else if (event.by === me) {
            toasts.push({
              text: `🎯 Your ${weapon} shot down one of ${nameOf(event.owner)}'s escort fighters`,
              tone: "success",
              player: event.owner,
            });
          }
          break;
        }
        if (event.owner === me) {
          const troops =
            event.troopsLost >= 1 ? ` (−${formatTroops(event.troopsLost)} troops)` : "";
          toasts.push({
            text:
              event.planesLeft === 0
                ? `💥 ${nameOf(event.by)}'s ${event.weapon === "flak" ? weapon : "SAMs"} shot down your last plane${troops}`
                : `💥 ${nameOf(event.by)}'s ${weapon} shot down ${event.planes === 1 ? "one of your planes" : `${event.planes} of your planes`}${troops}`,
            tone: "danger",
            player: event.by,
          });
        } else if (event.by === me) {
          toasts.push({
            text: `🎯 Your ${weapon} shot down one of ${nameOf(event.owner)}'s planes`,
            tone: "success",
            player: event.owner,
          });
        }
        break;
      }
      case "buildingStruck": {
        // Missiles (2B.5) are summed up by missileHit / warheadDetonated.
        if (arrived !== null && isMissile(arrived)) {
          if (event.playerId === me) mineHit++;
          break;
        }
        // Air strikes (GAME_DESIGN.md §3.17.7, 2B.4): the victim and the striker hear of it.
        const name = levelRules(
          DEFAULT_RULES,
          event.buildingType,
          Math.max(1, event.levelBefore),
        ).name;
        const seconds = (DEFAULT_RULES.flights.strikeDisableTicks * DEFAULT_RULES.tickMs) / 1000;
        const what =
          event.level === 0
            ? "destroyed"
            : event.level < event.levelBefore
              ? `down to level ${event.level}, out of action ${seconds} s`
              : `out of action ${seconds} s`;
        if (event.playerId === me) {
          toasts.push({
            text: `💥 ${nameOf(event.by)}'s air strike hit your ${name}: ${what}`,
            tone: "danger",
            player: event.by,
          });
        } else if (event.by === me) {
          toasts.push({
            text: `💥 Air strike hit ${nameOf(event.playerId)}'s ${name}: ${what}`,
            tone: "success",
            player: event.playerId,
          });
        }
        break;
      }
      case "suppressed": {
        const seconds = (DEFAULT_RULES.flights.suppressionTicks * DEFAULT_RULES.tickMs) / 1000;
        if (event.victim === me) {
          toasts.push({
            text: `💥 ${nameOf(event.by)}'s air strike knocked out your defences within ${event.radius} km for ${seconds} s`,
            tone: "danger",
            player: event.by,
          });
        } else if (event.by === me) {
          toasts.push({
            text: `💥 Air strike: ${nameOf(event.victim)}'s walls there are down for ${seconds} s — attack now`,
            tone: "success",
            player: event.victim,
          });
        }
        break;
      }
      case "assaultLanded":
        // Our airborne assault arrived (GAME_DESIGN.md §3.17.7, 2B.3). The target hears of it
        // from attackStarted.
        if (event.owner === me) {
          toasts.push(
            event.attackId >= 0
              ? {
                  text: `🪂 Assault landed: ${formatTroops(event.troops)} troops attack ${event.target === 0 ? "open land" : nameOf(event.target)}`,
                  tone: "success",
                  player: event.target === 0 ? undefined : event.target,
                }
              : {
                  text: "🪂 The landing site isn't an enemy's any more — the troops didn't attack",
                  tone: "info",
                },
          );
        }
        break;
      case "airliftDelivered":
        if (event.from === me) {
          const back =
            event.returning >= 1
              ? ` — ${formatTroops(event.returning)} didn't fit and fly back`
              : "";
          toasts.push(
            event.troops >= 1
              ? {
                  text: `✈ Airlift landed: ${formatTroops(event.troops)} troops joined ${nameOf(event.to)}${back}`,
                  tone: "success",
                  player: event.to,
                }
              : {
                  text: `✈ ${nameOf(event.to)} couldn't take your airlift — it flies back`,
                  tone: "info",
                  player: event.to,
                },
          );
        } else if (event.to === me && event.troops >= 1) {
          toasts.push({
            text: `✈ ${nameOf(event.from)}'s airlift landed: +${formatTroops(event.troops)} troops`,
            tone: "success",
            player: event.from,
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
        } else {
          // Every betrayal is news, in any lobby (the user's request after playing 2.9).
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

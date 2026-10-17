/**
 * The online protocol (Phase 3, D-006): the messages between a browser and the game server,
 * as JSON over one WebSocket. Shared by both sides; no packages.
 *
 * Flow: create or join a lobby → the creator starts → every client receives the game config
 * (map spec, seed, players) and its player id, regenerates the map and runs the same
 * simulation from the server's turns. The server runs the simulation too; each turn carries
 * the server's state hash after that tick, so a client can tell when it has drifted.
 */
import type { Command, StampedCommand } from "../sim/commands.ts";
import { MAP_DIMENSIONS, MAP_SIZE_NAMES, MAP_STYLES, type MapSpec } from "../sim/map/generate.ts";
import type { Difficulty } from "../sim/rules.ts";
import type { PlayerId, PlayerSetup } from "../sim/world.ts";

/** Bumped when the messages change; a client and server of different versions refuse each other. */
export const PROTOCOL_VERSION = 2;

/** Where the game server listens for WebSockets (same origin as the page in production). */
export const SOCKET_PATH = "/ws";

/** Largest message either side accepts, in bytes (a command is a few hundred). */
export const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;

/** Humans per online game (D-035; bots fill the rest, D-036). */
export const MAX_HUMANS = 16;

/** The creator's choices on the start screen. */
export interface OnlineSettings {
  readonly map: MapSpec;
  readonly mode: "ffa" | "teams";
  readonly teams: number;
  readonly difficulty: Difficulty;
  /** Bots that fill the game (D-036), named by the creator's client. */
  readonly nations: readonly string[];
  readonly tribes: readonly string[];
}

/** Everything a client needs to run the same game as the server. */
export interface GameConfig {
  readonly map: MapSpec;
  readonly seed: number;
  readonly players: readonly PlayerSetup[];
}

export interface LobbyPlayer {
  readonly name: string;
  readonly connected: boolean;
  /** Pressed Ready (the creator always counts as ready). */
  readonly ready: boolean;
}

/** What the lobby shows about the game (the creator's settings, without the bots' names). */
export interface LobbySummary {
  readonly map: MapSpec;
  readonly mode: "ffa" | "teams";
  readonly teams: number;
  readonly difficulty: Difficulty;
  readonly nations: number;
  readonly tribes: number;
}

export function lobbySummary(settings: OnlineSettings): LobbySummary {
  return {
    map: settings.map,
    mode: settings.mode,
    teams: settings.teams,
    difficulty: settings.difficulty,
    nations: settings.nations.length,
    tribes: settings.tribes.length,
  };
}

/** Longest player name (D-035). */
export const MAX_NAME_LENGTH = 16;

/**
 * A player's name as the game shows it (D-035): spaces trimmed and collapsed, only letters
 * (any alphabet), digits, spaces and basic punctuation kept, at most 16 characters. Null when
 * nothing usable is left.
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const kept = raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} ._'!?&()-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  const name = [...kept].slice(0, MAX_NAME_LENGTH).join("").trim();
  return name.length > 0 ? name : null;
}

/** `name`, or "name (2)", "name (3)" … — the first one nobody in `taken` has. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate =
      [...name]
        .slice(0, MAX_NAME_LENGTH - suffix.length)
        .join("")
        .trim() + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

export type ClientMessage =
  | { readonly t: "hello"; readonly version: number }
  | { readonly t: "create"; readonly settings: OnlineSettings; readonly name: string }
  | { readonly t: "join"; readonly gameId: string; readonly name: string }
  /** In the lobby: change your name, or say you're (not) ready. */
  | { readonly t: "name"; readonly name: string }
  | { readonly t: "ready"; readonly ready: boolean }
  | { readonly t: "start" }
  | { readonly t: "command"; readonly command: Command };

export type ServerMessage =
  /** You are in lobby `gameId` as `you` (an index into `players`); `creator` may start it. */
  | {
      readonly t: "lobby";
      readonly gameId: string;
      readonly players: readonly LobbyPlayer[];
      readonly you: number;
      readonly creator: boolean;
      readonly summary: LobbySummary;
    }
  | { readonly t: "start"; readonly config: GameConfig; readonly playerId: PlayerId }
  /** Tick `tick`'s commands, and the server's state hash after running it. */
  | {
      readonly t: "turn";
      readonly tick: number;
      readonly commands: readonly StampedCommand[];
      readonly hash: number;
    }
  | { readonly t: "error"; readonly message: string };

const DIFFICULTIES: readonly string[] = ["easy", "medium", "hard"];

/**
 * Checks a creator's settings before a game is made from them (the server never trusts the
 * shape of a client's message). Returns a reason, or null when they're fine.
 */
export function settingsProblem(value: unknown): string | null {
  if (!isObject(value)) return "settings missing";
  const s = value as Partial<OnlineSettings>;
  const map = s.map as Partial<MapSpec> | undefined;
  if (!isObject(map)) return "map missing";
  if (!isUint32(map.seed)) return "bad map seed";
  if (!MAP_STYLES.includes(map.style as never)) return "bad map style";
  const size = MAP_SIZE_NAMES.find(
    (name) =>
      MAP_DIMENSIONS[name].width === map.width && MAP_DIMENSIONS[name].height === map.height,
  );
  if (!size) return "bad map size";
  if (s.mode !== "ffa" && s.mode !== "teams") return "bad mode";
  if (!Number.isInteger(s.teams) || s.teams! < (s.mode === "teams" ? 2 : 0) || s.teams! > 8) {
    return "bad team count";
  }
  if (!DIFFICULTIES.includes(s.difficulty as string)) return "bad difficulty";
  if (!isNameList(s.nations, 200) || !isNameList(s.tribes, 400)) return "bad bot list";
  return null;
}

/** The players of a game: the humans in join order, then the creator's nations and tribes. */
export function gamePlayers(settings: OnlineSettings, humans: readonly string[]): PlayerSetup[] {
  const teams = settings.mode === "teams" ? settings.teams : 0;
  // Humans and nations are dealt round-robin onto the teams, tribes stay teamless (§3.15).
  const team = (index: number) => (teams > 0 ? (index % teams) + 1 : 0);
  return [
    ...humans.map((name, k) => ({ name, kind: "human" as const, team: team(k) })),
    ...settings.nations.map((name, k) => ({
      name,
      kind: "bot" as const,
      tier: "nation" as const,
      difficulty: settings.difficulty,
      team: team(humans.length + k),
    })),
    ...settings.tribes.map((name) => ({ name, kind: "bot" as const, tier: "tribe" as const })),
  ];
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUint32(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 0x100000000;
}

function isNameList(value: unknown, max: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((name) => typeof name === "string" && name.length >= 1 && name.length <= 24)
  );
}

/**
 * The online protocol (Phase 3, D-006): the messages between a browser and the game server,
 * as JSON over one WebSocket. Shared by both sides; no packages.
 *
 * Flow: create or join a lobby → the creator starts → every client receives the game config
 * (map spec, seed, players) and its player id, regenerates the map and runs the same
 * simulation from the server's turns. The server runs the simulation too; each turn carries
 * the server's state hash after that tick, so a client can tell when it has drifted.
 *
 * Repair, rejoin, watching (3.5): a client that drifted sends `desync` and gets a `sync` — a
 * snapshot of the server's world (sim/snapshot.ts) — then the turns after it, on the same
 * socket and in order, so nothing is missed. Each player gets a secret rejoin token at the
 * start; `rejoin` with it puts a reconnecting browser back in its country (`start` with
 * `midGame`, then a `sync`). `join` on a game already running makes the browser a
 * spectator (player 0): it gets the same, and its commands are ignored.
 */
import type { Command, StampedCommand } from "../sim/commands.ts";
import type { WorldSnapshot } from "../sim/snapshot.ts";
import { MAP_DIMENSIONS, MAP_SIZE_NAMES, MAP_STYLES, type MapSpec } from "../sim/map/generate.ts";
import { makeRules, type Difficulty } from "../sim/rules.ts";
import type { PlayerId, PlayerSetup } from "../sim/world.ts";

/** Bumped when the messages change; a client and server of different versions refuse each other. */
export const PROTOCOL_VERSION = 7;

/**
 * The rules of every online game — the server and each browser build the world with exactly
 * these. The default rules, plus a 60 s spawn phase so a player who never picks a spot
 * can't hold everyone up (3.4).
 */
export const ONLINE_RULES = makeRules({ spawn: { timeoutTicks: 600 } });

/** Where the game server listens for WebSockets (same origin as the page in production). */
export const SOCKET_PATH = "/ws";

/** Largest message either side accepts, in bytes (a command is a few hundred). */
export const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;

/** Humans per online game (D-035; bots fill the rest, D-036). */
export const MAX_HUMANS = 16;

/** Spectators per running game (3.5). */
export const MAX_WATCHERS = 32;

/**
 * A running game nobody plays any more (every human disconnected) keeps going this long, so a
 * reload or a dropped connection can rejoin it; then it stops (3.5). Seats are otherwise kept
 * for the whole game — a missing player's country stands idle.
 */
export const EMPTY_GAME_GRACE_MS = 120_000;

/**
 * A finished game stays on the server this long (3.6): a player whose connection dropped
 * just before the end rejoins and still sees the end card. It no longer counts as running.
 */
export const FINISHED_GAME_KEEP_MS = 120_000;

/** One connection asks for a repair snapshot at most this often (3.5). */
export const RESYNC_COOLDOWN_MS = 5_000;

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
  /** Team games: the team this player picked or was put on (1..teams); 0 in free-for-all. */
  readonly team: number;
  /** Signed in (3.7): the account name whose profile this player has; null for guests. */
  readonly profile: string | null;
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
export function uniqueName(name: string, taken: { has(name: string): boolean }): string {
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
  /** Join a lobby — or, once the game runs, watch it (3.5). */
  | { readonly t: "join"; readonly gameId: string; readonly name: string }
  /** Back into a running game with the token its `start` gave (3.5). */
  | { readonly t: "rejoin"; readonly gameId: string; readonly token: string }
  /** This client's state differs from the server's after `tick`: send a snapshot (3.5). */
  | { readonly t: "desync"; readonly tick: number }
  /** In the lobby: change your name, or say you're (not) ready. */
  | { readonly t: "name"; readonly name: string }
  | { readonly t: "ready"; readonly ready: boolean }
  /** The creator lists the game for strangers (public) or keeps it to the link (3.4). */
  | { readonly t: "visibility"; readonly public: boolean }
  /** Team games, in the lobby: play on this team (3.6). */
  | { readonly t: "team"; readonly team: number }
  /** Measures the connection (3.6): the server answers `pong` with the same `at`. */
  | { readonly t: "ping"; readonly at: number }
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
      /** Listed on everyone's start screen (3.4). */
      readonly public: boolean;
      /** A public game starts by itself this many ms from now; null = no countdown. */
      readonly startsIn: number | null;
    }
  /**
   * The game runs: `playerId` is yours (0: you watch). `rejoin` is your secret seat token
   * ("" for spectators); `midGame`: a `sync` follows — wait for it instead of playing turns.
   */
  | {
      readonly t: "start";
      readonly gameId: string;
      readonly config: GameConfig;
      readonly playerId: PlayerId;
      readonly rejoin: string;
      readonly midGame: boolean;
    }
  /** The server's whole game state; the turns that follow continue from its tick (3.5). */
  | { readonly t: "sync"; readonly snapshot: WorldSnapshot }
  /** A human player lost their connection, or is back (3.5). */
  | { readonly t: "presence"; readonly playerId: PlayerId; readonly connected: boolean }
  /** Tick `tick`'s commands, and the server's state hash after running it. */
  | {
      readonly t: "turn";
      readonly tick: number;
      readonly commands: readonly StampedCommand[];
      readonly hash: number;
    }
  /** The answer to `ping` (3.6). */
  | { readonly t: "pong"; readonly at: number }
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

/** A human in a game about to start: their name, and the team they picked (team games). */
export interface GameHuman {
  readonly name: string;
  /** 1..teams; 0 (or out of range) = put on a team like a newcomer. */
  readonly team: number;
}

/**
 * The team a newcomer joins (3.6): the one with the fewest members so far, the lowest on a
 * tie — dealing everyone this way is round-robin.
 */
export function smallestTeam(teams: number, members: readonly number[]): number {
  const sizes = new Array<number>(teams + 1).fill(0);
  for (const team of members) if (team >= 1 && team <= teams) sizes[team]!++;
  let best = 1;
  for (let team = 2; team <= teams; team++) if (sizes[team]! < sizes[best]!) best = team;
  return best;
}

/**
 * The teams of a game's nations once the humans have theirs (3.6): each nation joins the
 * smallest team — on a tie the one with fewer humans (they are the stronger players), then
 * the lowest — so the sides end up as even as the humans' choices allow.
 */
export function nationTeams(
  teams: number,
  humanTeams: readonly number[],
  nations: number,
): number[] {
  const sizes = new Array<number>(teams + 1).fill(0);
  const humans = new Array<number>(teams + 1).fill(0);
  for (const team of humanTeams) {
    sizes[team]!++;
    humans[team]!++;
  }
  const dealt: number[] = [];
  for (let k = 0; k < nations; k++) {
    let best = 1;
    for (let team = 2; team <= teams; team++) {
      const fewer =
        sizes[team]! < sizes[best]! ||
        (sizes[team] === sizes[best] && humans[team]! < humans[best]!);
      if (fewer) best = team;
    }
    sizes[best]!++;
    dealt.push(best);
  }
  return dealt;
}

/**
 * The players of a game: the humans in join order, then the creator's nations and tribes.
 * Team games (§3.15): humans play on the team they picked in the lobby (3.6), or are dealt
 * like newcomers; the nations then even the teams out (nationTeams). Tribes stay teamless.
 */
export function gamePlayers(
  settings: OnlineSettings,
  humans: readonly (string | GameHuman)[],
): PlayerSetup[] {
  const teams = settings.mode === "teams" ? settings.teams : 0;
  const humanTeams: number[] = [];
  for (const human of humans) {
    const wanted = typeof human === "string" ? 0 : human.team;
    const team =
      teams === 0 ? 0 : wanted >= 1 && wanted <= teams ? wanted : smallestTeam(teams, humanTeams);
    humanTeams.push(team);
  }
  const nations = teams === 0 ? [] : nationTeams(teams, humanTeams, settings.nations.length);
  return [
    ...humans.map((human, k) => ({
      name: typeof human === "string" ? human : human.name,
      kind: "human" as const,
      team: humanTeams[k]!,
    })),
    ...settings.nations.map((name, k) => ({
      name,
      kind: "bot" as const,
      tier: "nation" as const,
      difficulty: settings.difficulty,
      team: nations[k] ?? 0,
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

/** Where the start screen reads the open public games (3.4). */
export const OPEN_GAMES_PATH = "/api/games";

/** Seconds a public game waits once it has two players, then starts by itself (3.4). */
export const PUBLIC_COUNTDOWN_MS = 30_000;

/** Humans needed before a public game's countdown runs. */
export const PUBLIC_MIN_PLAYERS = 2;

/** One open public game on the start screen's list. */
export interface OpenGame {
  readonly gameId: string;
  /** The creator's name. */
  readonly creator: string;
  readonly players: number;
  readonly maxPlayers: number;
  readonly summary: LobbySummary;
  readonly startsIn: number | null;
  /** Already playing: the start screen offers to watch it (3.5). */
  readonly running: boolean;
}

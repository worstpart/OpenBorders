/**
 * The browser's side of an online game (Phase 3): the WebSocket to the game server, the
 * lobby state the lobby screen shows (ui.online), and handing the server's turns and
 * snapshots to the NetworkHost once the game has started.
 *
 * 3.5: the seat's rejoin token is kept in localStorage, so a reload or a reopened link puts
 * the player back in their country; a dropped connection is retried a few times by itself
 * (the game freezes meanwhile and catches up from a snapshot); a link to a game already
 * running opens it to watch.
 */
import type { Command } from "../../sim/commands.ts";
import type { WorldSnapshot } from "../../sim/snapshot.ts";
import type { PlayerId } from "../../sim/world.ts";
import {
  PROTOCOL_VERSION,
  OPEN_GAMES_PATH,
  SOCKET_PATH,
  type OpenGame,
  type ClientMessage,
  type GameConfig,
  type OnlineSettings,
  type ServerMessage,
} from "../../shared/protocol.ts";
import type { ServerTurn } from "../../host/networkHost.ts";
import { ui, type OnlineState } from "./uiState.svelte.ts";

/**
 * Development only: the local game server's port — 8787, or another one saved in
 * localStorage "openborder.devServerPort" (to test a second server next to a running one).
 */
function devServerPort(): number {
  try {
    const port = Number(localStorage.getItem("openborder.devServerPort"));
    return Number.isInteger(port) && port > 0 ? port : 8787;
  } catch {
    return 8787;
  }
}

/** The game server's WebSocket address: the page's own server, or port 8787 in development. */
export function serverUrl(location: { protocol: string; host: string; hostname: string }): string {
  if (import.meta.env.DEV) return `ws://${location.hostname}:${devServerPort()}${SOCKET_PATH}`;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${SOCKET_PATH}`;
}

const NAME_KEY = "openborder.name";
const REJOIN_KEY = "openborder.rejoin";
/** A saved seat older than this is forgotten (no game runs that long). */
const REJOIN_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Waits before each reconnect attempt after a dropped connection (about 30 s in all). */
export const RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000];
/** The server closes with this code on purpose (kicked, replaced by another tab): no retry. */
const POLICY_CLOSE = 1008;

/** The name this browser last played under online (D-035), or "" the first time. */
export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Private windows may refuse; the name just isn't remembered.
  }
}

/** This browser's seat in a running online game (3.5). */
export interface SavedSeat {
  readonly gameId: string;
  readonly token: string;
  readonly savedAt: number;
}

/**
 * Where seats are kept: this tab's own copy first (it survives a reload, and two tabs of one
 * browser in the same game never swap seats), then the browser's (a link reopened in a new
 * tab after the old one was closed).
 */
const seatStores = (): Storage[] => [sessionStorage, localStorage];

/** The seat saved for `gameId`, if any and recent. */
export function savedSeat(gameId: string, now = Date.now()): SavedSeat | null {
  for (const store of seatStores()) {
    try {
      const seat = JSON.parse(store.getItem(REJOIN_KEY) ?? "null") as SavedSeat | null;
      if (!seat || seat.gameId !== gameId || typeof seat.token !== "string") continue;
      if (now - seat.savedAt < REJOIN_MAX_AGE_MS) return seat;
    } catch {
      // No storage here (a private window may refuse): try the next.
    }
  }
  return null;
}

function saveSeat(gameId: string, token: string): void {
  const seat: SavedSeat = { gameId, token, savedAt: Date.now() };
  for (const store of seatStores()) {
    try {
      store.setItem(REJOIN_KEY, JSON.stringify(seat));
    } catch {
      // Without storage a reload can't rejoin; the game itself goes on.
    }
  }
}

/** Forgets this tab's seat, and the browser's when it is the same one (or the one used). */
function forgetSeat(): void {
  let mine = "";
  for (const store of seatStores()) {
    try {
      const seat = JSON.parse(store.getItem(REJOIN_KEY) ?? "null") as SavedSeat | null;
      if (store === sessionStorage) mine = seat?.token ?? "";
      if (store === sessionStorage || mine === "" || seat?.token === mine) {
        store.removeItem(REJOIN_KEY);
      }
    } catch {
      // Nothing saved.
    }
  }
}

/** The open public games (3.4) from the game server; [] when it can't be reached. */
export async function fetchOpenGames(): Promise<OpenGame[]> {
  const base = import.meta.env.DEV ? `http://${location.hostname}:${devServerPort()}` : "";
  try {
    const response = await fetch(`${base}${OPEN_GAMES_PATH}`, { cache: "no-store" });
    if (!response.ok) return [];
    const body = (await response.json()) as { games?: OpenGame[] };
    return Array.isArray(body.games) ? body.games : [];
  } catch {
    return [];
  }
}

/** The link that joins game `gameId` (shared by its creator). */
export function gameLink(gameId: string, location: { origin: string; pathname: string }): string {
  return `${location.origin}${location.pathname}?game=${encodeURIComponent(gameId)}`;
}

/** Puts the game's link in the address bar, so a reload comes back to it (3.5). */
function showLinkInAddressBar(gameId: string): void {
  try {
    const url = `${location.pathname}?game=${encodeURIComponent(gameId)}`;
    if (`${location.pathname}${location.search}` !== url) history.replaceState(null, "", url);
  } catch {
    // Not in a browser page (tests).
  }
}

export interface OnlineHandlers {
  /**
   * A game to run: the creator started it, or (`midGame`) this browser rejoined or came to
   * watch — a snapshot follows. `playerId` 0 = watching.
   */
  start(config: GameConfig, playerId: PlayerId, midGame: boolean): void;
  /** After a dropped connection came back: the running game waits for a snapshot. */
  resumed(): void;
  /** A human player lost their connection, or is back. */
  presence(playerId: PlayerId, connected: boolean): void;
}

/** Where a running game's turns and snapshots go. */
export interface GameSink {
  turn(turn: ServerTurn): void;
  sync(snapshot: WorldSnapshot): void;
}

type Delivery = { readonly turn: ServerTurn } | { readonly snapshot: WorldSnapshot };

export class OnlineSession {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly intent: ClientMessage;
  private readonly handlers: OnlineHandlers;
  private sink: GameSink | null = null;
  private early: Delivery[] = [];
  private closedByUs = false;
  /** Set by the game's `start`: what a reconnect asks for. */
  private game: { id: string; token: string; playerId: PlayerId } | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, intent: ClientMessage, handlers: OnlineHandlers) {
    this.url = url;
    this.intent = intent;
    this.handlers = handlers;
    ui.online = {
      status: "connecting",
      gameId: "",
      players: [],
      you: 0,
      creator: false,
      error: "",
      summary: null,
      public: false,
      startsAt: null,
      watching: false,
      catchingUp: false,
      reconnecting: 0,
    };
    this.open();
  }

  static create(settings: OnlineSettings, handlers: OnlineHandlers): OnlineSession {
    return new OnlineSession(
      serverUrl(location),
      { t: "create", settings, name: savedName() },
      handlers,
    );
  }

  /** Joins a lobby by its link — back into your own seat if this browser has one (3.5). */
  static join(gameId: string, handlers: OnlineHandlers): OnlineSession {
    const seat = savedSeat(gameId);
    return new OnlineSession(
      serverUrl(location),
      seat ? { t: "rejoin", gameId, token: seat.token } : { t: "join", gameId, name: savedName() },
      handlers,
    );
  }

  /** A new name in the lobby (the server cleans it and makes it unique; remembered here). */
  rename(name: string): void {
    saveName(name);
    this.post({ t: "name", name });
  }

  setReady(ready: boolean): void {
    this.post({ t: "ready", ready });
  }

  /** The creator lists the game for strangers, or makes it link-only again (3.4). */
  setPublic(listed: boolean): void {
    this.post({ t: "visibility", public: listed });
  }

  /** The creator starts the game for everyone in the lobby. */
  start(): void {
    this.post({ t: "start" });
  }

  command(command: Command): void {
    this.post({ t: "command", command });
  }

  /** This browser's game drifted from the server's at `tick`: ask for a snapshot (3.5). */
  desync(tick: number): void {
    this.post({ t: "desync", tick });
  }

  /** Where turns and snapshots go once the game runs (ones that came earlier first). */
  attach(sink: GameSink): void {
    this.sink = sink;
    const early = this.early;
    this.early = [];
    for (const item of early) this.deliver(item);
  }

  /** Development checks only: drops the connection as a network failure would (3.5). */
  debugDrop(): void {
    this.socket?.close(4000, "debug drop");
  }

  /** Leaves the game for good: the seat is forgotten (3.5). */
  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    forgetSeat();
    ui.online = null;
  }

  private open(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.post({ t: "hello", version: PROTOCOL_VERSION });
      const game = this.game;
      // A reconnect asks for its seat back (or to watch again); the first connection does
      // what the page asked.
      if (!game) this.post(this.intent);
      else if (game.playerId > 0) this.post({ t: "rejoin", gameId: game.id, token: game.token });
      else this.post({ t: "join", gameId: game.id, name: savedName() });
    };
    socket.onmessage = (event) => this.receive(JSON.parse(String(event.data)) as ServerMessage);
    socket.onclose = (event) => {
      if (this.socket !== socket || this.closedByUs || !ui.online) return;
      const online = ui.online;
      // A running game tries to come back by itself, unless the server meant to close it.
      if (online.status === "playing" && event.code !== POLICY_CLOSE) {
        if (this.attempt < RECONNECT_DELAYS_MS.length) {
          const delay = RECONNECT_DELAYS_MS[this.attempt]!;
          this.attempt++;
          ui.online = { ...online, reconnecting: this.attempt };
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.closedByUs) this.open();
          }, delay);
          return;
        }
      }
      const reason =
        event.code === POLICY_CLOSE && event.reason === "replaced"
          ? "This game was opened in another tab."
          : online.status === "playing"
            ? "Lost the connection to the server."
            : online.error || "Couldn't reach the game server.";
      ui.online = { ...online, status: "error", reconnecting: 0, error: reason };
    };
  }

  private post(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private deliver(item: Delivery): void {
    if (!this.sink) this.early.push(item);
    else if ("turn" in item) this.sink.turn(item.turn);
    else this.sink.sync(item.snapshot);
  }

  private receive(message: ServerMessage): void {
    const online = ui.online;
    if (!online) return;
    switch (message.t) {
      case "lobby":
        showLinkInAddressBar(message.gameId);
        ui.online = {
          ...online,
          status: "lobby",
          gameId: message.gameId,
          players: message.players,
          you: message.you,
          creator: message.creator,
          summary: message.summary,
          public: message.public,
          startsAt: message.startsIn === null ? null : Date.now() + message.startsIn,
          error: "",
        };
        break;
      case "start": {
        const resumed = this.game?.id === message.gameId && this.game.playerId === message.playerId;
        this.attempt = 0;
        this.game = { id: message.gameId, token: message.rejoin, playerId: message.playerId };
        if (message.rejoin) saveSeat(message.gameId, message.rejoin);
        showLinkInAddressBar(message.gameId);
        ui.online = {
          ...online,
          status: "playing",
          gameId: message.gameId,
          error: "",
          watching: message.playerId === 0,
          catchingUp: message.midGame,
          reconnecting: 0,
        };
        if (resumed) this.handlers.resumed();
        else this.handlers.start(message.config, message.playerId, message.midGame);
        break;
      }
      case "turn":
        this.deliver({ turn: message });
        break;
      case "sync":
        this.deliver({ snapshot: message.snapshot });
        break;
      case "presence":
        this.handlers.presence(message.playerId, message.connected);
        break;
      case "error": {
        // A rejoin the server refused: the seat is gone (the game ended, the server restarted).
        const refused = online.status !== "playing" || online.reconnecting > 0;
        if (refused) forgetSeat();
        ui.online = {
          ...online,
          status: refused ? "error" : online.status,
          reconnecting: 0,
          error: message.message,
        };
        if (refused) this.closeQuietly();
        break;
      }
    }
  }

  /** Stops reconnecting after a refusal, keeping the error on screen. */
  private closeQuietly(): void {
    this.closedByUs = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}

/** The connection banner over a running online game (3.5), or null when all is well. */
export function onlineBanner(online: OnlineState | null): {
  readonly text: string;
  readonly tone: "info" | "warn" | "error";
} | null {
  if (!online || online.status === "lobby" || online.status === "connecting") return null;
  if (online.status === "error")
    return { text: `${online.error} Esc opens the menu to leave.`, tone: "error" };
  if (online.reconnecting > 0) {
    return {
      text: `Connection lost — reconnecting (try ${online.reconnecting} of ${RECONNECT_DELAYS_MS.length})…`,
      tone: "warn",
    };
  }
  if (online.catchingUp) return { text: "Catching up with the game…", tone: "info" };
  if (online.error) return { text: online.error, tone: "warn" };
  if (online.watching) return { text: "👁 Watching — you're a spectator", tone: "info" };
  return null;
}

/**
 * The browser's side of an online game (Phase 3): the WebSocket to the game server, the
 * lobby state the lobby screen shows (ui.online), and handing the server's turns to the
 * NetworkHost once the game has started.
 */
import type { Command } from "../../sim/commands.ts";
import type { PlayerId } from "../../sim/world.ts";
import {
  PROTOCOL_VERSION,
  SOCKET_PATH,
  type ClientMessage,
  type GameConfig,
  type OnlineSettings,
  type ServerMessage,
} from "../../shared/protocol.ts";
import type { ServerTurn } from "../../host/networkHost.ts";
import { ui } from "./uiState.svelte.ts";

/** The game server's WebSocket address: the page's own server, or port 8787 in development. */
export function serverUrl(location: { protocol: string; host: string; hostname: string }): string {
  if (import.meta.env.DEV) return `ws://${location.hostname}:8787${SOCKET_PATH}`;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${SOCKET_PATH}`;
}

/** The link that joins game `gameId` (shared by its creator). */
export function gameLink(gameId: string, location: { origin: string; pathname: string }): string {
  return `${location.origin}${location.pathname}?game=${encodeURIComponent(gameId)}`;
}

export interface OnlineHandlers {
  /** The creator started the game: run it. */
  start(config: GameConfig, playerId: PlayerId): void;
}

export class OnlineSession {
  private readonly socket: WebSocket;
  private readonly handlers: OnlineHandlers;
  private turnSink: ((turn: ServerTurn) => void) | null = null;
  private early: ServerTurn[] = [];
  private closedByUs = false;

  constructor(url: string, intent: ClientMessage, handlers: OnlineHandlers) {
    this.handlers = handlers;
    ui.online = {
      status: "connecting",
      gameId: "",
      players: [],
      you: 0,
      creator: false,
      error: "",
      outOfSync: false,
    };
    this.socket = new WebSocket(url);
    this.socket.onopen = () => {
      this.post({ t: "hello", version: PROTOCOL_VERSION });
      this.post(intent);
    };
    this.socket.onmessage = (event) =>
      this.receive(JSON.parse(String(event.data)) as ServerMessage);
    this.socket.onclose = () => {
      if (this.closedByUs || !ui.online) return;
      const playing = ui.online.status === "playing";
      ui.online = {
        ...ui.online,
        status: "error",
        error: playing
          ? "Lost the connection to the server."
          : ui.online.error || "Couldn't reach the game server.",
      };
    };
  }

  static create(settings: OnlineSettings, handlers: OnlineHandlers): OnlineSession {
    return new OnlineSession(serverUrl(location), { t: "create", settings }, handlers);
  }

  static join(gameId: string, handlers: OnlineHandlers): OnlineSession {
    return new OnlineSession(serverUrl(location), { t: "join", gameId }, handlers);
  }

  /** The creator starts the game for everyone in the lobby. */
  start(): void {
    this.post({ t: "start" });
  }

  command(command: Command): void {
    this.post({ t: "command", command });
  }

  /** Where the turns go once the game runs (turns that came earlier are passed on first). */
  attach(sink: (turn: ServerTurn) => void): void {
    this.turnSink = sink;
    const early = this.early;
    this.early = [];
    for (const turn of early) sink(turn);
  }

  close(): void {
    this.closedByUs = true;
    this.socket.close();
    ui.online = null;
  }

  private post(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private receive(message: ServerMessage): void {
    const online = ui.online;
    if (!online) return;
    switch (message.t) {
      case "lobby":
        ui.online = {
          ...online,
          status: "lobby",
          gameId: message.gameId,
          players: message.players,
          you: message.you,
          creator: message.creator,
          error: "",
        };
        break;
      case "start":
        ui.online = { ...online, status: "playing" };
        this.handlers.start(message.config, message.playerId);
        break;
      case "turn":
        if (this.turnSink) this.turnSink(message);
        else this.early.push(message);
        break;
      case "error":
        ui.online = {
          ...online,
          status: online.status === "playing" ? "playing" : "error",
          error: message.message,
        };
        break;
    }
  }
}

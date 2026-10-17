/**
 * Lobbies and running games (milestones 3.1–3.2): who is in which game, the lobby → start →
 * turns flow, and what happens when people leave. Sockets and threads stay outside (Peer,
 * GameRunner), so this logic is tested without either.
 */
import type { Command } from "../sim/commands.ts";
import {
  gamePlayers,
  MAX_HUMANS,
  PROTOCOL_VERSION,
  settingsProblem,
  type ClientMessage,
  type GameConfig,
  type OnlineSettings,
  type ServerMessage,
} from "../shared/protocol.ts";
import { commandProblem, type TurnMessage } from "./game.ts";

/** One connected browser. */
export interface Peer {
  send(message: ServerMessage): void;
  close(reason: string): void;
}

/** A running game's simulation (a worker thread on the server; in-thread in tests). */
export interface GameRunner {
  command(playerId: number, command: Command): void;
  stop(): void;
}

export interface GameEvents {
  turn(turn: TurnMessage): void;
  /** The game is over (or failed with `error`); its runner has stopped itself. */
  ended(error?: string): void;
}

export type RunnerFactory = (config: GameConfig, events: GameEvents) => GameRunner;

export interface LobbyOptions {
  readonly startRunner: RunnerFactory;
  /** An unguessable game id (until 3.4 the link is the only way in). */
  readonly newGameId: () => string;
  /** A game seed. */
  readonly newSeed: () => number;
  /** Games this server runs at once (lobbies included). */
  readonly maxGames?: number;
  readonly log?: (line: string) => void;
}

interface Member {
  peer: Peer | null;
  readonly name: string;
  /** Set when the game starts: 1.. in join order. */
  playerId: number;
}

interface Room {
  readonly id: string;
  readonly settings: OnlineSettings;
  members: Member[];
  runner: GameRunner | null;
  started: boolean;
}

/** What a connection does with the messages its browser sends. */
export interface Connection {
  receive(message: unknown): void;
  closed(): void;
}

export class Lobbies {
  private readonly rooms = new Map<string, Room>();
  private readonly options: LobbyOptions;

  constructor(options: LobbyOptions) {
    this.options = options;
  }

  get gameCount(): number {
    return this.rooms.size;
  }

  connect(peer: Peer): Connection {
    let greeted = false;
    let room: Room | null = null;
    let member: Member | null = null;
    const fail = (message: string) => peer.send({ t: "error", message });

    return {
      receive: (raw) => {
        const message = raw as ClientMessage;
        if (typeof raw !== "object" || raw === null || typeof message.t !== "string") {
          peer.close("not a message");
          return;
        }
        if (message.t === "hello") {
          if (message.version !== PROTOCOL_VERSION) {
            fail("This page is out of date — reload it to play online.");
            peer.close("version");
            return;
          }
          greeted = true;
          return;
        }
        if (!greeted) {
          peer.close("no hello");
          return;
        }
        switch (message.t) {
          case "create": {
            if (room) return fail("already in a game");
            const problem = settingsProblem(message.settings);
            if (problem) return fail(`can't create the game: ${problem}`);
            if (this.rooms.size >= (this.options.maxGames ?? 20)) {
              return fail("The server is full right now — try again in a few minutes.");
            }
            room = {
              id: this.uniqueId(),
              settings: message.settings,
              members: [],
              runner: null,
              started: false,
            };
            this.rooms.set(room.id, room);
            member = this.addMember(room, peer);
            this.log(`game ${room.id} created`);
            this.sendLobby(room);
            return;
          }
          case "join": {
            if (room) return fail("already in a game");
            const target =
              typeof message.gameId === "string" ? this.rooms.get(message.gameId) : undefined;
            if (!target) return fail("That game doesn't exist (any more).");
            if (target.started) return fail("That game has already started.");
            if (target.members.length >= MAX_HUMANS) return fail("That game is full.");
            room = target;
            member = this.addMember(room, peer);
            this.sendLobby(room);
            return;
          }
          case "start": {
            if (!room || !member || room.started) return;
            if (room.members[0] !== member) return fail("Only the game's creator can start it.");
            this.start(room);
            return;
          }
          case "command": {
            if (!room?.runner || !member || member.playerId === 0) return;
            if (commandProblem(message.command)) return; // 3.3 counts these
            room.runner.command(member.playerId, message.command);
            return;
          }
          default:
            peer.close("unknown message");
        }
      },
      closed: () => {
        if (!room || !member) return;
        const left = room;
        member.peer = null;
        if (!left.started) {
          // Leaving a lobby frees the place; the next in line becomes the creator.
          left.members = left.members.filter((m) => m !== member);
          if (left.members.length === 0) this.close(left);
          else this.sendLobby(left);
        } else if (!left.members.some((m) => m.peer)) {
          // Nobody left to play for: stop the simulation. (A player who leaves keeps their
          // land and stops acting, D-036; rejoining comes in 3.5.)
          this.close(left);
        }
        room = null;
        member = null;
      },
    };
  }

  private addMember(room: Room, peer: Peer): Member {
    const taken = new Set(room.members.map((m) => m.name));
    let n = room.members.length + 1;
    while (taken.has(`Player ${n}`)) n++;
    const member: Member = { peer, name: `Player ${n}`, playerId: 0 };
    room.members.push(member);
    return member;
  }

  private sendLobby(room: Room): void {
    const players = room.members.map((m) => ({ name: m.name, connected: m.peer !== null }));
    room.members.forEach((m, you) => {
      m.peer?.send({ t: "lobby", gameId: room.id, players, you, creator: you === 0 });
    });
  }

  private start(room: Room): void {
    room.started = true;
    room.members.forEach((m, k) => (m.playerId = k + 1));
    const config: GameConfig = {
      map: room.settings.map,
      seed: this.options.newSeed(),
      players: gamePlayers(
        room.settings,
        room.members.map((m) => m.name),
      ),
    };
    for (const m of room.members) m.peer?.send({ t: "start", config, playerId: m.playerId });
    this.log(
      `game ${room.id} started: ${room.members.length} humans, ${config.players.length} players`,
    );
    room.runner = this.options.startRunner(config, {
      turn: (turn) => {
        for (const m of room.members) m.peer?.send(turn);
      },
      ended: (error) => {
        if (error) {
          this.log(`game ${room.id} failed: ${error}`);
          for (const m of room.members)
            m.peer?.send({ t: "error", message: "The game stopped on the server." });
        } else this.log(`game ${room.id} ended`);
        room.runner = null;
        this.rooms.delete(room.id);
      },
    });
  }

  private close(room: Room): void {
    room.runner?.stop();
    room.runner = null;
    this.rooms.delete(room.id);
    this.log(`game ${room.id} closed`);
  }

  private uniqueId(): string {
    let id = this.options.newGameId();
    while (this.rooms.has(id)) id = this.options.newGameId();
    return id;
  }

  private log(line: string): void {
    this.options.log?.(line);
  }
}

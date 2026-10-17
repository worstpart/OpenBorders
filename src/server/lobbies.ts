/**
 * Lobbies and running games (milestones 3.1–3.5): who is in which game, public listing, the
 * lobby → (countdown →) start → turns flow, what happens when people leave, and (3.5)
 * repair snapshots, rejoining a seat with its token, and spectators. Sockets and threads stay
 * outside (Peer, GameRunner), so this logic is tested without either.
 */
import type { Command } from "../sim/commands.ts";
import {
  cleanName,
  EMPTY_GAME_GRACE_MS,
  gamePlayers,
  lobbySummary,
  uniqueName,
  MAX_HUMANS,
  MAX_WATCHERS,
  PROTOCOL_VERSION,
  PUBLIC_COUNTDOWN_MS,
  PUBLIC_MIN_PLAYERS,
  RESYNC_COOLDOWN_MS,
  settingsProblem,
  type ClientMessage,
  type GameConfig,
  type OpenGame,
  type OnlineSettings,
  type ServerMessage,
} from "../shared/protocol.ts";
import { isBlockedName } from "../shared/nameFilter.ts";
import type { TurnMessage } from "./game.ts";
import { CommandBudget, commandProblem } from "./validate.ts";

/** One connected browser. */
export interface Peer {
  send(message: ServerMessage): void;
  /** A message already encoded as JSON (one encoding shared by everyone it goes to). */
  sendText(text: string): void;
  close(reason: string): void;
}

/** A running game's simulation (a worker thread on the server; in-thread in tests). */
export interface GameRunner {
  command(playerId: number, command: Command): void;
  /** Asks for a snapshot between two ticks; it comes back through GameEvents.snapshot. */
  snapshot(): void;
  stop(): void;
}

export interface GameEvents {
  turn(turn: TurnMessage): void;
  /** The snapshot asked for, as JSON, in order with the turns (null: it failed — a bug). */
  snapshot(json: string | null): void;
  /** The game is over (or failed with `error`); its runner has stopped itself. */
  ended(error?: string): void;
}

export type RunnerFactory = (config: GameConfig, events: GameEvents) => GameRunner;

export interface LobbyOptions {
  readonly startRunner: RunnerFactory;
  /** An unguessable game id (a private game's link is the only way in). */
  readonly newGameId: () => string;
  /** A game seed. */
  readonly newSeed: () => number;
  /** A player's secret rejoin token (3.5); made like a game id by default. */
  readonly newToken?: () => string;
  /** Games this server runs at once (lobbies included). */
  readonly maxGames?: number;
  /** Games one address may have created and not yet finished (3.3). */
  readonly maxGamesPerAddress?: number;
  /** The clock for sending budgets and countdowns (ms); Date.now by default. */
  readonly now?: () => number;
  /** Runs `fn` after `ms`; returns a cancel function (setTimeout by default). */
  readonly schedule?: (fn: () => void, ms: number) => () => void;
  readonly log?: (line: string) => void;
}

interface Member {
  peer: Peer | null;
  /** Cleaned and unique in the game (D-035). */
  name: string;
  /** Pressed Ready in the lobby (the creator needs not). */
  ready: boolean;
  /** Set when the game starts: 1.. in join order. */
  playerId: number;
  /** Set when the game starts: the secret that gives this seat back (3.5). */
  token: string;
}

interface Room {
  readonly id: string;
  readonly settings: OnlineSettings;
  members: Member[];
  runner: GameRunner | null;
  started: boolean;
  /** Where its creator connected from (games per address, 3.3). */
  readonly address: string;
  /** Listed on everyone's start screen (3.4). */
  public: boolean;
  /** When a public game starts by itself (ms on the server clock), or null. */
  startsAt: number | null;
  cancelCountdown: (() => void) | null;
  /** Set when the game starts. */
  config: GameConfig | null;
  /** Spectators of the running game (3.5). */
  readonly watchers: Set<Peer>;
  /** Connections waiting for the snapshot asked for (3.5). */
  readonly waiting: Set<Peer>;
  /** Every human left the running game: it stops when this runs out (3.5). */
  cancelEmpty: (() => void) | null;
}

/** What a connection does with the messages its browser sends. */
export interface Connection {
  receive(message: unknown): void;
  closed(): void;
}

export class Lobbies {
  private readonly rooms = new Map<string, Room>();
  private readonly options: LobbyOptions;

  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(options: LobbyOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.schedule =
      options.schedule ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      });
  }

  /**
   * The public games for the start screen: open lobbies (3.4), fullest first, then running
   * games to watch (3.5); at most 20.
   */
  openGames(): OpenGame[] {
    const now = this.now();
    return [...this.rooms.values()]
      .filter((r) => r.public && (r.started ? r.runner !== null : r.members.length < MAX_HUMANS))
      .sort((a, b) => Number(a.started) - Number(b.started) || b.members.length - a.members.length)
      .slice(0, 20)
      .map((r) => ({
        gameId: r.id,
        creator: r.members[0]?.name ?? "",
        players: r.members.length,
        maxPlayers: MAX_HUMANS,
        summary: lobbySummary(r.settings),
        startsIn: r.startsAt === null ? null : Math.max(0, r.startsAt - now),
        running: r.started,
      }));
  }

  get gameCount(): number {
    return this.rooms.size;
  }

  /** A new browser connection, from `address` (its IP, as the server sees it). */
  connect(peer: Peer, address = ""): Connection {
    let greeted = false;
    const budget = new CommandBudget(this.now);
    let room: Room | null = null;
    let member: Member | null = null;
    /** Watching `room` (3.5): no member, commands ignored. */
    let watching = false;
    let lastResync = -Infinity;
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
        // Everything after the hello spends from this connection's budget (3.3).
        const verdict = budget.take();
        if (verdict === "kick") {
          peer.close("too many messages");
          return;
        }
        if (verdict === "drop") return;
        switch (message.t) {
          case "create": {
            if (room) return fail("already in a game");
            const problem = settingsProblem(message.settings);
            if (problem) return fail(`can't create the game: ${problem}`);
            if (this.rooms.size >= (this.options.maxGames ?? 20)) {
              return fail("The server is full right now — try again in a few minutes.");
            }
            const mine = [...this.rooms.values()].filter((r) => r.address === address).length;
            if (address && mine >= (this.options.maxGamesPerAddress ?? 3)) {
              return fail("You already have several games open — finish or leave one first.");
            }
            room = {
              id: this.uniqueId(),
              settings: message.settings,
              members: [],
              runner: null,
              started: false,
              address,
              public: false,
              startsAt: null,
              cancelCountdown: null,
              config: null,
              watchers: new Set(),
              waiting: new Set(),
              cancelEmpty: null,
            };
            this.rooms.set(room.id, room);
            member = this.addMember(room, peer, message.name);
            this.log(`game ${room.id} created`);
            this.sendLobby(room);
            return;
          }
          case "join": {
            if (room) return fail("already in a game");
            const target =
              typeof message.gameId === "string" ? this.rooms.get(message.gameId) : undefined;
            if (!target) return fail("That game doesn't exist (any more).");
            if (target.started) {
              // A running game: watch it (3.5).
              if (!target.config || !target.runner) return fail("That game has ended.");
              if (target.watchers.size >= MAX_WATCHERS) {
                return fail("That game has as many watchers as it can take.");
              }
              room = target;
              watching = true;
              target.watchers.add(peer);
              peer.send({
                t: "start",
                gameId: target.id,
                config: target.config,
                playerId: 0,
                rejoin: "",
                midGame: true,
              });
              this.requestSnapshot(target, peer);
              return;
            }
            if (target.members.length >= MAX_HUMANS) return fail("That game is full.");
            room = target;
            member = this.addMember(room, peer, message.name);
            this.updateCountdown(room);
            this.sendLobby(room);
            return;
          }
          case "rejoin": {
            if (room) return fail("already in a game");
            const target =
              typeof message.gameId === "string" ? this.rooms.get(message.gameId) : undefined;
            const token = typeof message.token === "string" ? message.token : "";
            const seat =
              target?.started && token.length > 0
                ? target.members.find((m) => m.token === token)
                : undefined;
            if (!target || !seat || !target.config || !target.runner) {
              return fail("That game has ended.");
            }
            // The seat moves to this connection; an older one still open (another tab, or a
            // socket not known to be dead yet) is closed.
            const old = seat.peer;
            seat.peer = peer;
            room = target;
            member = seat;
            old?.close("replaced");
            target.cancelEmpty?.();
            target.cancelEmpty = null;
            peer.send({
              t: "start",
              gameId: target.id,
              config: target.config,
              playerId: seat.playerId,
              rejoin: seat.token,
              midGame: true,
            });
            this.requestSnapshot(target, peer);
            if (!old) {
              this.broadcast(target, { t: "presence", playerId: seat.playerId, connected: true });
            }
            this.log(`game ${target.id}: player ${seat.playerId} rejoined`);
            return;
          }
          case "desync": {
            if (!room?.runner || (!member && !watching)) return;
            const now = this.now();
            if (now - lastResync < RESYNC_COOLDOWN_MS) return;
            lastResync = now;
            const who = member ? `player ${member.playerId}` : "a watcher";
            this.log(`game ${room.id}: ${who} out of sync at tick ${Number(message.tick)}`);
            this.requestSnapshot(room, peer);
            return;
          }
          case "name": {
            if (!room || !member || room.started) return;
            const name = cleanName(message.name);
            if (!name) return fail("Names need a letter or a digit.");
            if (isBlockedName(name)) return fail("Please pick another name.");
            const others = room.members.filter((m) => m !== member);
            member.name = uniqueName(name, this.takenNames(room, others));
            this.sendLobby(room);
            return;
          }
          case "visibility": {
            if (!room || !member || room.started) return;
            if (room.members[0] !== member) return fail("Only the game's creator can do that.");
            room.public = message.public === true;
            this.log(`game ${room.id} is ${room.public ? "public" : "private"}`);
            this.updateCountdown(room);
            this.sendLobby(room);
            return;
          }
          case "ready": {
            if (!room || !member || room.started) return;
            member.ready = message.ready === true;
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
            if (commandProblem(message.command)) {
              if (budget.strike() === "kick") peer.close("malformed commands");
              return;
            }
            room.runner.command(member.playerId, message.command as Command);
            return;
          }
          default:
            peer.close("unknown message");
        }
      },
      closed: () => {
        if (!room) return;
        const left = room;
        left.waiting.delete(peer);
        if (watching) {
          left.watchers.delete(peer);
          room = null;
          watching = false;
          return;
        }
        // Not ours any more when a rejoin took the seat over.
        if (!member || member.peer !== peer) {
          room = null;
          member = null;
          return;
        }
        member.peer = null;
        if (!left.started) {
          // Leaving a lobby frees the place; the next in line becomes the creator.
          left.members = left.members.filter((m) => m !== member);
          if (left.members.length === 0) this.close(left);
          else {
            this.updateCountdown(left);
            this.sendLobby(left);
          }
        } else {
          // A player who leaves keeps their land and stops acting (D-036) until they rejoin
          // (3.5). With no human left the game runs on a while for a rejoin, then stops.
          this.broadcast(left, { t: "presence", playerId: member.playerId, connected: false });
          if (!left.members.some((m) => m.peer)) this.stopWhenEmpty(left);
        }
        room = null;
        member = null;
      },
    };
  }

  private addMember(room: Room, peer: Peer, requested: unknown): Member {
    const taken = this.takenNames(room, room.members);
    let name = cleanName(requested);
    if (name && isBlockedName(name)) name = null;
    if (!name) {
      let n = room.members.length + 1;
      while (taken.has(`Player ${n}`)) n++;
      name = `Player ${n}`;
    }
    const member: Member = {
      peer,
      name: uniqueName(name, taken),
      ready: false,
      playerId: 0,
      token: "",
    };
    room.members.push(member);
    return member;
  }

  /** Names a new or renamed player can't take: the other humans' and the bots'. */
  private takenNames(room: Room, members: readonly Member[]): Set<string> {
    return new Set([
      ...members.map((m) => m.name),
      ...room.settings.nations,
      ...room.settings.tribes,
    ]);
  }

  private sendLobby(room: Room): void {
    const players = room.members.map((m, k) => ({
      name: m.name,
      connected: m.peer !== null,
      ready: k === 0 || m.ready,
    }));
    const summary = lobbySummary(room.settings);
    const startsIn = room.startsAt === null ? null : Math.max(0, room.startsAt - this.now());
    room.members.forEach((m, you) => {
      m.peer?.send({
        t: "lobby",
        gameId: room.id,
        players,
        you,
        creator: you === 0,
        summary,
        public: room.public,
        startsIn,
      });
    });
  }

  /**
   * A public game with enough players counts down and then starts by itself (3.4), so
   * strangers never wait on a creator who walked away; fewer players stop the clock.
   */
  private updateCountdown(room: Room): void {
    const due = room.public && !room.started && room.members.length >= PUBLIC_MIN_PLAYERS;
    if (due && room.startsAt === null) {
      room.startsAt = this.now() + PUBLIC_COUNTDOWN_MS;
      room.cancelCountdown = this.schedule(() => {
        room.cancelCountdown = null;
        if (!room.started && this.rooms.get(room.id) === room) this.start(room);
      }, PUBLIC_COUNTDOWN_MS);
    } else if (!due && room.startsAt !== null) {
      room.cancelCountdown?.();
      room.cancelCountdown = null;
      room.startsAt = null;
    }
  }

  private start(room: Room): void {
    room.started = true;
    room.cancelCountdown?.();
    room.cancelCountdown = null;
    room.startsAt = null;
    const newToken = this.options.newToken ?? this.options.newGameId;
    room.members.forEach((m, k) => {
      m.playerId = k + 1;
      m.token = newToken();
    });
    const config: GameConfig = {
      map: room.settings.map,
      seed: this.options.newSeed(),
      players: gamePlayers(
        room.settings,
        room.members.map((m) => m.name),
      ),
    };
    room.config = config;
    for (const m of room.members) {
      m.peer?.send({
        t: "start",
        gameId: room.id,
        config,
        playerId: m.playerId,
        rejoin: m.token,
        midGame: false,
      });
    }
    this.log(
      `game ${room.id} started: ${room.members.length} humans, ${config.players.length} players`,
    );
    room.runner = this.options.startRunner(config, {
      turn: (turn) => this.broadcast(room, turn),
      snapshot: (json) => {
        const waiting = [...room.waiting];
        room.waiting.clear();
        if (json === null) {
          this.log(`game ${room.id}: a snapshot failed`);
          for (const peer of waiting) {
            peer.send({ t: "error", message: "Couldn't catch up with the game on the server." });
          }
          return;
        }
        // The snapshot's JSON goes out as it came from the game's thread, never re-encoded.
        const text = `{"t":"sync","snapshot":${json}}`;
        for (const peer of waiting) peer.sendText(text);
      },
      ended: (error) => {
        if (error) {
          this.log(`game ${room.id} failed: ${error}`);
          this.broadcast(room, { t: "error", message: "The game stopped on the server." });
        } else this.log(`game ${room.id} ended`);
        room.runner = null;
        room.cancelEmpty?.();
        room.cancelEmpty = null;
        room.waiting.clear();
        this.rooms.delete(room.id);
      },
    });
  }

  /** Every player and watcher of `room` gets `message` (encoded once). */
  private broadcast(room: Room, message: ServerMessage): void {
    const text = JSON.stringify(message);
    for (const m of room.members) m.peer?.sendText(text);
    for (const peer of room.watchers) peer.sendText(text);
  }

  /** `peer` gets a snapshot of the running game, then the turns after it (3.5). */
  private requestSnapshot(room: Room, peer: Peer): void {
    const asked = room.waiting.size > 0;
    room.waiting.add(peer);
    // One snapshot answers everyone waiting when it comes.
    if (!asked) room.runner?.snapshot();
  }

  /** Every human left `room`'s game: it stops after EMPTY_GAME_GRACE_MS unless one rejoins. */
  private stopWhenEmpty(room: Room): void {
    if (room.cancelEmpty) return;
    this.log(`game ${room.id}: every player left; it stops in ${EMPTY_GAME_GRACE_MS / 1000} s`);
    room.cancelEmpty = this.schedule(() => {
      room.cancelEmpty = null;
      if (this.rooms.get(room.id) !== room || room.members.some((m) => m.peer)) return;
      this.broadcast(room, { t: "error", message: "The game ended: every player left." });
      this.close(room);
    }, EMPTY_GAME_GRACE_MS);
  }

  private close(room: Room): void {
    room.cancelCountdown?.();
    room.cancelCountdown = null;
    room.cancelEmpty?.();
    room.cancelEmpty = null;
    room.waiting.clear();
    room.runner?.stop();
    room.runner = null;
    this.rooms.delete(room.id);
    this.log(`game ${room.id} closed`);
  }

  private uniqueId(): string {
    for (let tries = 0; tries < 100; tries++) {
      const id = this.options.newGameId();
      if (!this.rooms.has(id)) return id;
    }
    throw new Error("no free game id");
  }

  private log(line: string): void {
    this.options.log?.(line);
  }
}

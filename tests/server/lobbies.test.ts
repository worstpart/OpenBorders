/** Milestone 3.1: lobbies, starting a game, stamping commands, leaving (no sockets, no threads). */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import { MAP_DIMENSIONS } from "../../src/sim/map/generate.ts";
import { commandProblem, ServerGame } from "../../src/server/game.ts";
import { Lobbies, type GameEvents, type Peer } from "../../src/server/lobbies.ts";
import {
  cleanName,
  gamePlayers,
  PROTOCOL_VERSION,
  settingsProblem,
  type GameConfig,
  type OnlineSettings,
  type ServerMessage,
  uniqueName,
} from "../../src/shared/protocol.ts";

const SETTINGS: OnlineSettings = {
  map: { seed: 1, ...MAP_DIMENSIONS.normal, style: "continent" },
  mode: "ffa",
  teams: 0,
  difficulty: "medium",
  nations: ["Avalon", "Borea"],
  tribes: ["Ash"],
};

interface FakePeer extends Peer {
  inbox: ServerMessage[];
  closedWith: string | null;
}

function fakePeer(): FakePeer {
  const peer: FakePeer = {
    inbox: [],
    closedWith: null,
    send: (m) => peer.inbox.push(m),
    close: (reason) => (peer.closedWith = reason),
  };
  return peer;
}

function setup() {
  const runners: {
    config: GameConfig;
    events: GameEvents;
    commands: [number, Command][];
    stopped: boolean;
  }[] = [];
  let ids = 0;
  const lobbies = new Lobbies({
    startRunner: (config, events) => {
      const runner = { config, events, commands: [] as [number, Command][], stopped: false };
      runners.push(runner);
      return {
        command: (playerId, command) => runner.commands.push([playerId, command]),
        stop: () => (runner.stopped = true),
      };
    },
    newGameId: () => `game${++ids}`,
    newSeed: () => 1234,
    maxGames: 2,
  });
  const join = () => {
    const peer = fakePeer();
    const connection = lobbies.connect(peer);
    connection.receive({ t: "hello", version: PROTOCOL_VERSION });
    return { peer, connection };
  };
  return { lobbies, runners, join };
}

const last = (peer: FakePeer) => peer.inbox.at(-1);

describe("lobbies", () => {
  it("create → join by id → start: everyone gets the same config and their own player id", () => {
    const { runners, join } = setup();
    const a = join();
    a.connection.receive({ t: "create", settings: SETTINGS });
    expect(last(a.peer)).toMatchObject({ t: "lobby", gameId: "game1", you: 0, creator: true });
    const b = join();
    b.connection.receive({ t: "join", gameId: "game1" });
    expect(last(b.peer)).toMatchObject({ t: "lobby", you: 1, creator: false });
    expect(last(a.peer)).toMatchObject({ players: [{ name: "Player 1" }, { name: "Player 2" }] });

    b.connection.receive({ t: "start" }); // only the creator may
    expect(last(b.peer)).toMatchObject({ t: "error" });
    a.connection.receive({ t: "start" });
    const startA = a.peer.inbox.find((m) => m.t === "start");
    const startB = b.peer.inbox.find((m) => m.t === "start");
    expect(startA).toMatchObject({ playerId: 1 });
    expect(startB).toMatchObject({ playerId: 2 });
    expect(startA?.t === "start" && startA.config).toEqual(startB?.t === "start" && startB.config);
    expect(runners).toHaveLength(1);
    expect(runners[0]!.config.players.map((p) => p.name)).toEqual([
      "Player 1",
      "Player 2",
      "Avalon",
      "Borea",
      "Ash",
    ]);

    // Turns go to everyone.
    runners[0]!.events.turn({ t: "turn", tick: 1, commands: [], hash: 7 });
    expect(last(a.peer)).toEqual({ t: "turn", tick: 1, commands: [], hash: 7 });
    expect(last(b.peer)).toEqual({ t: "turn", tick: 1, commands: [], hash: 7 });
  });

  it("stamps commands with the sender's own player id and drops what isn't a command", () => {
    const { runners, join } = setup();
    const a = join();
    a.connection.receive({ t: "create", settings: SETTINGS });
    const b = join();
    b.connection.receive({ t: "join", gameId: "game1" });
    a.connection.receive({ t: "start" });
    b.connection.receive({ t: "command", command: { type: "confirmSpawn", playerId: 1 } });
    b.connection.receive({ t: "command", command: { type: "testFlight", from: 1, to: 2 } });
    b.connection.receive({ t: "command", command: { type: "spawn", tile: Infinity } });
    a.connection.receive({ t: "command", command: { type: "spawn", tile: 5 } });
    expect(runners[0]!.commands).toEqual([
      [2, { type: "confirmSpawn", playerId: 1 }], // the claimed id is ignored: the sim reads the stamp
      [1, { type: "spawn", tile: 5 }],
    ]);
  });

  it("refuses bad settings, unknown games, a full server and missing hellos", () => {
    const { join, lobbies } = setup();
    const a = join();
    a.connection.receive({
      t: "create",
      settings: { ...SETTINGS, map: { ...SETTINGS.map, width: 5 } },
    });
    expect(last(a.peer)).toMatchObject({ t: "error", message: expect.stringMatching(/map size/) });
    a.connection.receive({ t: "join", gameId: "nope" });
    expect(last(a.peer)).toMatchObject({ t: "error" });
    join().connection.receive({ t: "create", settings: SETTINGS });
    join().connection.receive({ t: "create", settings: SETTINGS });
    const c = join();
    c.connection.receive({ t: "create", settings: SETTINGS });
    expect(last(c.peer)).toMatchObject({ t: "error", message: expect.stringMatching(/full/) });
    const rude = fakePeer();
    lobbies.connect(rude).receive({ t: "create", settings: SETTINGS });
    expect(rude.closedWith).toBe("no hello");
    const old = fakePeer();
    lobbies.connect(old).receive({ t: "hello", version: PROTOCOL_VERSION + 1 });
    expect(old.closedWith).toBe("version");
  });

  it("leaving: the lobby passes to the next player; the game stops when every human has left", () => {
    const { runners, join, lobbies } = setup();
    const a = join();
    a.connection.receive({ t: "create", settings: SETTINGS });
    const b = join();
    b.connection.receive({ t: "join", gameId: "game1" });
    a.connection.closed();
    expect(last(b.peer)).toMatchObject({
      t: "lobby",
      you: 0,
      creator: true,
      players: [{ name: "Player 2" }],
    });
    const c = join();
    c.connection.receive({ t: "join", gameId: "game1" });
    b.connection.receive({ t: "start" });
    expect(runners).toHaveLength(1);
    b.connection.closed();
    expect(runners[0]!.stopped).toBe(false); // c still plays
    c.connection.closed();
    expect(runners[0]!.stopped).toBe(true);
    expect(lobbies.gameCount).toBe(0);
  });
});

describe("the server's game", () => {
  it("runs the config's world and returns each tick's turn with its hash", () => {
    const config: GameConfig = {
      map: SETTINGS.map,
      seed: 99,
      players: gamePlayers(SETTINGS, ["A", "B"]),
    };
    const game = new ServerGame(config);
    game.queue(1, { type: "spawn", tile: 0 });
    const turn = game.tick();
    expect(turn).toMatchObject({
      t: "turn",
      tick: 1,
      commands: [{ playerId: 1, command: { type: "spawn", tile: 0 } }],
    });
    expect(game.tick()).toMatchObject({ tick: 2, commands: [] });
    expect(game.world.players.map((p) => p.kind)).toEqual(["human", "human", "bot", "bot", "bot"]);
  });

  it("settings and commands are checked for shape", () => {
    expect(settingsProblem(SETTINGS)).toBeNull();
    expect(settingsProblem({ ...SETTINGS, difficulty: "insane" })).toMatch(/difficulty/);
    expect(settingsProblem({ ...SETTINGS, nations: ["x".repeat(40)] })).toMatch(/bot list/);
    expect(commandProblem({ type: "attack", target: 0, focusTile: 4, percentBp: 5000 })).toBeNull();
    expect(commandProblem({ type: "buildWall", points: [1, 2, 3] })).toBeNull();
    expect(commandProblem({ type: "attack", target: { nested: 1 } })).toMatch(/target/);
    expect(commandProblem({ type: "nuke" })).toMatch(/unknown/);
    expect(commandProblem(null)).toMatch(/not a command/);
  });

  it("teams: humans and nations are dealt round-robin, tribes stay teamless", () => {
    const players = gamePlayers({ ...SETTINGS, mode: "teams", teams: 2 }, ["A", "B", "C"]);
    expect(players.map((p) => p.team ?? 0)).toEqual([1, 2, 1, 2, 1, 0]);
  });
});

describe("names and ready (3.2, D-035)", () => {
  it("cleans names: trimmed, collapsed, safe characters only, at most 16", () => {
    expect(cleanName("  Sam   the  Bold ")).toBe("Sam the Bold");
    expect(cleanName("<b>Zoë</b>")).toBe("bZoëb");
    expect(cleanName("Ünïcødé-Name_1\u0000\n")).toBe("Ünïcødé-Name_1"); // control characters go
    expect(cleanName("a".repeat(30))).toBe("a".repeat(16));
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("<<>>")).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(uniqueName("Sam", new Set(["Sam"]))).toBe("Sam (2)");
    expect(uniqueName("Sam", new Set(["Sam", "Sam (2)"]))).toBe("Sam (3)");
    expect(uniqueName("abcdefghijklmnop", new Set(["abcdefghijklmnop"]))).toBe("abcdefghijkl (2)");
  });

  it("joining with a name, renaming, duplicates and bot names, ready flags, the summary", () => {
    const { join } = setup();
    const a = join();
    a.connection.receive({ t: "create", settings: SETTINGS, name: "  Sam " });
    const b = join();
    b.connection.receive({ t: "join", gameId: "game1", name: "Sam" });
    const lobby = () => {
      const m = last(a.peer);
      if (m?.t !== "lobby") throw new Error("no lobby");
      return m;
    };
    expect(lobby().players.map((p) => p.name)).toEqual(["Sam", "Sam (2)"]);
    expect(lobby().players.map((p) => p.ready)).toEqual([true, false]); // the creator counts as ready
    expect(lobby().summary).toEqual({
      map: SETTINGS.map,
      mode: "ffa",
      teams: 0,
      difficulty: "medium",
      nations: 2,
      tribes: 1,
    });
    b.connection.receive({ t: "name", name: "Avalon" }); // a nation's name
    expect(lobby().players[1]!.name).toBe("Avalon (2)");
    b.connection.receive({ t: "name", name: "!!" });
    expect(lobby().players[1]!.name).toBe("!!");
    b.connection.receive({ t: "name", name: "<>" });
    expect(last(b.peer)).toMatchObject({ t: "error" });
    b.connection.receive({ t: "ready", ready: true });
    expect(lobby().players.map((p) => p.ready)).toEqual([true, true]);
    b.connection.receive({ t: "ready", ready: "yes" });
    expect(lobby().players[1]!.ready).toBe(false); // only `true` counts
  });

  it("the creator may start with players not ready; names reach the game", () => {
    const { join, runners } = setup();
    const a = join();
    a.connection.receive({ t: "create", settings: SETTINGS, name: "Host" });
    const b = join();
    b.connection.receive({ t: "join", gameId: "game1", name: "Guest" });
    a.connection.receive({ t: "start" });
    expect(runners[0]!.config.players.slice(0, 2).map((p) => p.name)).toEqual(["Host", "Guest"]);
    b.connection.receive({ t: "name", name: "Late" }); // ignored once started
    expect(runners[0]!.config.players[1]!.name).toBe("Guest");
  });
});

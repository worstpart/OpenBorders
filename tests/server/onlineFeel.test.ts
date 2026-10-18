/**
 * Milestone 3.6 on the server: teams picked in the lobby, the connection measured (ping →
 * pong), and a finished game kept a little while for rejoins without counting as running.
 */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import { MAP_DIMENSIONS } from "../../src/sim/map/generate.ts";
import { Lobbies, type GameEvents, type Peer } from "../../src/server/lobbies.ts";
import {
  FINISHED_GAME_KEEP_MS,
  gamePlayers,
  PROTOCOL_VERSION,
  smallestTeam,
  type GameConfig,
  type OnlineSettings,
  type ServerMessage,
} from "../../src/shared/protocol.ts";

const TEAMS: OnlineSettings = {
  map: { seed: 1, ...MAP_DIMENSIONS.normal, style: "continent" },
  mode: "teams",
  teams: 2,
  difficulty: "medium",
  nations: ["Avalon", "Borea", "Corvia", "Dunmar"],
  tribes: ["Ash"],
};

interface FakePeer extends Peer {
  inbox: ServerMessage[];
}

function setup(maxGames = 20) {
  let now = 0;
  let ids = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const runners: {
    config: GameConfig;
    events: GameEvents;
    commands: [number, Command][];
    snapshots: number;
    stopped: boolean;
  }[] = [];
  const lobbies = new Lobbies({
    startRunner: (config, events) => {
      const runner = {
        config,
        events,
        commands: [] as [number, Command][],
        snapshots: 0,
        stopped: false,
      };
      runners.push(runner);
      return {
        command: (playerId, command) => runner.commands.push([playerId, command]),
        snapshot: () => runner.snapshots++,
        stop: () => (runner.stopped = true),
      };
    },
    newGameId: () => `g${++ids}`,
    newSeed: () => 5,
    newToken: () => `secret${++ids}`,
    maxGames,
    maxGamesPerAddress: 1,
    now: () => now,
    schedule: (fn, ms) => {
      const timer = { at: now + ms, fn, live: true };
      timers.push(timer);
      return () => (timer.live = false);
    },
  });
  const advance = (ms: number) => {
    now += ms;
    for (const t of timers) {
      if (t.live && t.at <= now) {
        t.live = false;
        t.fn();
      }
    }
  };
  const connect = (address = "") => {
    const peer: FakePeer = {
      inbox: [],
      send: (m) => peer.inbox.push(m),
      sendText: (text) => peer.inbox.push(JSON.parse(text) as ServerMessage),
      close: () => {},
    };
    const connection = lobbies.connect(peer, address);
    connection.receive({ t: "hello", version: PROTOCOL_VERSION });
    return { peer, connection };
  };
  return { lobbies, runners, connect, advance };
}

const lobbyOf = (peer: FakePeer) => {
  const m = peer.inbox.filter((x) => x.t === "lobby").at(-1);
  if (m?.t !== "lobby") throw new Error("no lobby");
  return m;
};

describe("teams picked in the lobby (3.6)", () => {
  it("newcomers go to the smallest team; nations then even the teams out", () => {
    expect(smallestTeam(3, [])).toBe(1);
    expect(smallestTeam(3, [1])).toBe(2);
    expect(smallestTeam(3, [1, 2, 3, 1])).toBe(2);
    expect(smallestTeam(2, [2, 2])).toBe(1);
    // Three friends on team 1: three nations join team 2, then the fourth too (a tie, and
    // team 2 has fewer humans) → 3 v 4.
    const players = gamePlayers(TEAMS, [
      { name: "A", team: 1 },
      { name: "B", team: 1 },
      { name: "C", team: 1 },
    ]);
    expect(players.map((p) => p.team ?? 0)).toEqual([1, 1, 1, 2, 2, 2, 2, 0]);
    // A team out of range counts as no choice (team 1); the nations: 2, 2, 1, 2 → 2 v 3.
    const alone = gamePlayers(TEAMS, [{ name: "A", team: 9 }]);
    expect(alone.map((p) => p.team ?? 0)).toEqual([1, 2, 2, 1, 2, 0]);
    // Free-for-all: nobody has a team.
    const ffa = gamePlayers({ ...TEAMS, mode: "ffa", teams: 0 }, [{ name: "A", team: 2 }]);
    expect(ffa.every((p) => (p.team ?? 0) === 0)).toBe(true);
  });

  it("players switch teams in the lobby and keep them when the game starts", () => {
    const { connect, runners } = setup();
    const a = connect();
    a.connection.receive({ t: "create", settings: TEAMS, name: "Ann" });
    const b = connect();
    b.connection.receive({ t: "join", gameId: "g1", name: "Bo" });
    expect(lobbyOf(b.peer).players.map((p) => p.team)).toEqual([1, 2]);
    b.connection.receive({ t: "team", team: 1 });
    expect(lobbyOf(a.peer).players.map((p) => p.team)).toEqual([1, 1]);
    // Out of range, not a number: ignored.
    b.connection.receive({ t: "team", team: 3 });
    b.connection.receive({ t: "team", team: "2" as never });
    b.connection.receive({ t: "team", team: 1.5 });
    expect(lobbyOf(a.peer).players.map((p) => p.team)).toEqual([1, 1]);
    // A third player goes to the empty team.
    const c = connect();
    c.connection.receive({ t: "join", gameId: "g1", name: "Cy" });
    expect(lobbyOf(c.peer).players.map((p) => p.team)).toEqual([1, 1, 2]);
    a.connection.receive({ t: "start" });
    const teams = runners[0]!.config.players.map((p) => p.team ?? 0);
    // Ann, Bo on 1, Cy on 2; nations to the smaller team, ties to fewer humans: 2, 2, 1, 2.
    expect(teams).toEqual([1, 1, 2, 2, 2, 1, 2, 0]);
    // No switching once it runs.
    b.connection.receive({ t: "team", team: 2 });
    expect(runners[0]!.config.players[1]!.team).toBe(1);
  });

  it("free-for-all lobbies have no teams to pick", () => {
    const { connect } = setup();
    const a = connect();
    a.connection.receive({ t: "create", settings: { ...TEAMS, mode: "ffa", teams: 0 } });
    a.connection.receive({ t: "team", team: 1 });
    expect(lobbyOf(a.peer).players[0]!.team).toBe(0);
  });
});

describe("the connection measured (3.6)", () => {
  it("a ping comes straight back as a pong with the same time; junk is ignored", () => {
    const { connect } = setup();
    const a = connect();
    a.connection.receive({ t: "ping", at: 1234.5 });
    expect(a.peer.inbox.at(-1)).toEqual({ t: "pong", at: 1234.5 });
    const before = a.peer.inbox.length;
    a.connection.receive({ t: "ping", at: "soon" as never });
    a.connection.receive({ t: "ping", at: Number.NaN });
    expect(a.peer.inbox.length).toBe(before);
  });
});

describe("finished games (3.6)", () => {
  it("are kept a while for rejoins, but aren't listed, watched, played or counted", () => {
    const { connect, runners, advance, lobbies } = setup(1);
    const a = connect("1.2.3.4");
    a.connection.receive({ t: "create", settings: TEAMS, name: "Ann" });
    a.connection.receive({ t: "visibility", public: true });
    a.connection.receive({ t: "start" });
    const start = a.peer.inbox.find((m) => m.t === "start");
    const token = start?.t === "start" ? start.rejoin : "";
    expect(lobbies.openGames()).toHaveLength(1);
    const runner = runners[0]!;
    runner.events.ended();
    expect(runner.stopped).toBe(false); // the final world stays for snapshots
    expect(lobbies.openGames()).toHaveLength(0);
    expect(lobbies.gameCount).toBe(0);
    // Commands go nowhere; nobody can come to watch.
    a.connection.receive({ t: "command", command: { type: "confirmSpawn" } });
    expect(runner.commands).toEqual([]);
    const watcher = connect();
    watcher.connection.receive({ t: "join", gameId: "g1", name: "Eve" });
    expect(watcher.peer.inbox.at(-1)).toEqual({ t: "error", message: "That game has ended." });
    // Neither the server's limit nor this address's counts it: a new game can be made.
    const next = connect("1.2.3.4");
    next.connection.receive({ t: "create", settings: TEAMS, name: "Ann" });
    expect(next.peer.inbox.at(-1)).toMatchObject({ t: "lobby" });
    // A player who lost the connection just before the end rejoins and gets its last state.
    a.connection.closed();
    const back = connect();
    back.connection.receive({ t: "rejoin", gameId: "g1", token });
    expect(back.peer.inbox.at(-1)).toMatchObject({ t: "start", midGame: true });
    expect(runner.snapshots).toBe(1);
    runner.events.snapshot('{"tick":9}');
    expect(back.peer.inbox.at(-1)).toMatchObject({ t: "sync" });
    // Then it is closed for good.
    advance(FINISHED_GAME_KEEP_MS);
    expect(runner.stopped).toBe(true);
  });
});

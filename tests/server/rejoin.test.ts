/** Milestone 3.5: repair snapshots, rejoining with a token, spectators, the empty-game grace. */
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/sim/commands.ts";
import { generateMap, MAP_DIMENSIONS } from "../../src/sim/map/generate.ts";
import { deserializeWorld, type WorldSnapshot } from "../../src/sim/snapshot.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import { ServerGame } from "../../src/server/game.ts";
import { Lobbies, type GameEvents, type Peer } from "../../src/server/lobbies.ts";
import {
  EMPTY_GAME_GRACE_MS,
  gamePlayers,
  MAX_WATCHERS,
  ONLINE_RULES,
  PROTOCOL_VERSION,
  RESYNC_COOLDOWN_MS,
  type GameConfig,
  type OnlineSettings,
  type ServerMessage,
} from "../../src/shared/protocol.ts";

const SETTINGS: OnlineSettings = {
  map: { seed: 1, ...MAP_DIMENSIONS.normal, style: "continent" },
  mode: "ffa",
  teams: 0,
  difficulty: "medium",
  nations: ["Avalon"],
  tribes: [],
};

interface FakePeer extends Peer {
  inbox: ServerMessage[];
  closedWith: string | null;
}

function setup() {
  let now = 0;
  let ids = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const runners: {
    events: GameEvents;
    commands: [number, Command][];
    snapshots: number;
    stopped: boolean;
  }[] = [];
  const lobbies = new Lobbies({
    startRunner: (_config, events) => {
      const runner = { events, commands: [] as [number, Command][], snapshots: 0, stopped: false };
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
  const connect = () => {
    const peer: FakePeer = {
      inbox: [],
      closedWith: null,
      send: (m) => peer.inbox.push(m),
      sendText: (text) => peer.inbox.push(JSON.parse(text) as ServerMessage),
      close: (reason) => (peer.closedWith = reason),
    };
    const connection = lobbies.connect(peer, "");
    connection.receive({ t: "hello", version: PROTOCOL_VERSION });
    return { peer, connection };
  };
  /** Two players in a started game g1; the runner is runners[0]. */
  const started = () => {
    const a = connect();
    a.connection.receive({ t: "create", settings: SETTINGS, name: "Ann" });
    const b = connect();
    b.connection.receive({ t: "join", gameId: "g1", name: "Bo" });
    a.connection.receive({ t: "visibility", public: true });
    a.connection.receive({ t: "start" });
    return { a, b, runner: runners[0]! };
  };
  return { lobbies, runners, connect, started, advance };
}

const startOf = (peer: FakePeer) => {
  const m = peer.inbox.filter((x) => x.t === "start").at(-1);
  if (m?.t !== "start") throw new Error("no start");
  return m;
};
const SNAPSHOT_JSON = '{"version":1,"tick":40,"hash":9,"mapKey":1,"rulesKey":2,"state":{}}';

describe("rejoin tokens (3.5)", () => {
  it("every player gets their own secret token at the start", () => {
    const { started } = setup();
    const { a, b } = started();
    expect(startOf(a.peer)).toMatchObject({ gameId: "g1", playerId: 1, midGame: false });
    expect(startOf(b.peer)).toMatchObject({ playerId: 2, midGame: false });
    expect(startOf(a.peer).rejoin).toMatch(/^secret/);
    expect(startOf(a.peer).rejoin).not.toBe(startOf(b.peer).rejoin);
  });

  it("a dropped player rejoins their own country: start mid-game, a snapshot, then the turns", () => {
    const { started, connect } = setup();
    const { a, b, runner } = started();
    const token = startOf(b.peer).rejoin;
    b.connection.closed();
    expect(a.peer.inbox.at(-1)).toEqual({ t: "presence", playerId: 2, connected: false });

    const back = connect();
    back.connection.receive({ t: "rejoin", gameId: "g1", token });
    expect(startOf(back.peer)).toMatchObject({ playerId: 2, rejoin: token, midGame: true });
    expect(a.peer.inbox.at(-1)).toEqual({ t: "presence", playerId: 2, connected: true });
    expect(runner.snapshots).toBe(1);
    // A turn before the snapshot reaches it too (the client drops it); the snapshot comes as
    // it was made, then the turns after it.
    runner.events.turn({ t: "turn", tick: 40, commands: [], hash: 1 });
    runner.events.snapshot(SNAPSHOT_JSON);
    runner.events.turn({ t: "turn", tick: 41, commands: [], hash: 2 });
    expect(back.peer.inbox.slice(-3).map((m) => m.t)).toEqual(["turn", "sync", "turn"]);
    const sync = back.peer.inbox.find((m) => m.t === "sync");
    expect(sync?.t === "sync" && sync.snapshot.tick).toBe(40);
    // Only the one who asked gets the snapshot.
    expect(a.peer.inbox.some((m) => m.t === "sync")).toBe(false);
    // Their commands are theirs again.
    back.connection.receive({ t: "command", command: { type: "confirmSpawn" } });
    expect(runner.commands).toEqual([[2, { type: "confirmSpawn" }]]);
  });

  it("a rejoin takes the seat from a connection still open (another tab), which is closed", () => {
    const { started, connect } = setup();
    const { a, runner } = started();
    const token = startOf(a.peer).rejoin;
    const tab = connect();
    tab.connection.receive({ t: "rejoin", gameId: "g1", token });
    expect(a.peer.closedWith).toBe("replaced");
    a.connection.closed(); // the old socket's close arrives later: it changes nothing
    runner.events.turn({ t: "turn", tick: 1, commands: [], hash: 1 });
    expect(tab.peer.inbox.at(-1)).toMatchObject({ t: "turn", tick: 1 });
    tab.connection.receive({ t: "command", command: { type: "confirmSpawn" } });
    expect(runner.commands).toEqual([[1, { type: "confirmSpawn" }]]);
  });

  it("a wrong token, a lobby or a finished game can't be rejoined", () => {
    const { started, connect, runners } = setup();
    started();
    const guess = connect();
    guess.connection.receive({ t: "rejoin", gameId: "g1", token: "secret1" + "x" });
    expect(guess.peer.inbox.at(-1)).toEqual({ t: "error", message: "That game has ended." });
    const empty = connect();
    empty.connection.receive({ t: "rejoin", gameId: "g1", token: "" });
    expect(empty.peer.inbox.at(-1)).toMatchObject({ t: "error" });
    runners[0]!.events.ended();
    const late = connect();
    late.connection.receive({ t: "rejoin", gameId: "g1", token: "secret2" });
    expect(late.peer.inbox.at(-1)).toMatchObject({ t: "error" });
  });

  it("a game nobody plays runs on 2 minutes for a rejoin, then stops", () => {
    const { started, connect, advance, lobbies } = setup();
    const { a, b, runner } = started();
    const token = startOf(a.peer).rejoin;
    a.connection.closed();
    b.connection.closed();
    advance(EMPTY_GAME_GRACE_MS - 1_000);
    expect(runner.stopped).toBe(false);
    const back = connect();
    back.connection.receive({ t: "rejoin", gameId: "g1", token });
    advance(EMPTY_GAME_GRACE_MS * 2);
    expect(runner.stopped).toBe(false); // someone came back: the clock stopped
    back.connection.closed();
    advance(EMPTY_GAME_GRACE_MS);
    expect(runner.stopped).toBe(true);
    expect(lobbies.gameCount).toBe(0);
  });
});

describe("spectators (3.5)", () => {
  it("joining a running game watches it: player 0, snapshot, turns, commands ignored", () => {
    const { started, connect, lobbies } = setup();
    const { runner } = started();
    expect(lobbies.openGames()).toEqual([expect.objectContaining({ running: true })]);
    const w = connect();
    w.connection.receive({ t: "join", gameId: "g1", name: "Watcher" });
    expect(startOf(w.peer)).toMatchObject({ playerId: 0, rejoin: "", midGame: true });
    expect(runner.snapshots).toBe(1);
    runner.events.snapshot(SNAPSHOT_JSON);
    runner.events.turn({ t: "turn", tick: 41, commands: [], hash: 2 });
    expect(w.peer.inbox.slice(-2).map((m) => m.t)).toEqual(["sync", "turn"]);
    w.connection.receive({ t: "command", command: { type: "confirmSpawn" } });
    expect(runner.commands).toEqual([]);
    // Watchers don't keep a game alive, and leaving tells nobody.
    w.connection.closed();
    expect(w.peer.inbox.at(-1)).toMatchObject({ t: "turn" });
  });

  it("at most MAX_WATCHERS watch one game", () => {
    const { started, connect } = setup();
    started();
    for (let k = 0; k < MAX_WATCHERS; k++) {
      connect().connection.receive({ t: "join", gameId: "g1", name: "w" });
    }
    const one = connect();
    one.connection.receive({ t: "join", gameId: "g1", name: "w" });
    expect(one.peer.inbox.at(-1)).toMatchObject({ t: "error" });
  });
});

describe("repair snapshots (3.5)", () => {
  it("a drifted client gets a snapshot; asking again within the cooldown is ignored", () => {
    const { started, advance } = setup();
    const { a, runner } = started();
    a.connection.receive({ t: "desync", tick: 12 });
    expect(runner.snapshots).toBe(1);
    runner.events.snapshot(SNAPSHOT_JSON);
    expect(a.peer.inbox.at(-1)).toMatchObject({ t: "sync" });
    a.connection.receive({ t: "desync", tick: 13 });
    expect(runner.snapshots).toBe(1);
    advance(RESYNC_COOLDOWN_MS);
    a.connection.receive({ t: "desync", tick: 60 });
    expect(runner.snapshots).toBe(2);
  });

  it("everyone waiting shares one snapshot; a failed one tells them", () => {
    const { started, connect } = setup();
    const { a, b, runner } = started();
    a.connection.receive({ t: "desync", tick: 12 });
    b.connection.receive({ t: "desync", tick: 12 });
    connect().connection.receive({ t: "join", gameId: "g1", name: "w" });
    expect(runner.snapshots).toBe(1);
    runner.events.snapshot(null);
    expect(a.peer.inbox.at(-1)).toMatchObject({ t: "error" });
    expect(b.peer.inbox.at(-1)).toMatchObject({ t: "error" });
    // Nobody waits any more: the next request asks again.
    b.connection.receive({ t: "desync", tick: 99 });
    expect(runner.snapshots).toBe(1); // b's cooldown
    a.connection.receive({ t: "desync", tick: 99 });
    expect(runner.snapshots).toBe(1); // a's cooldown too
  });

  it("the server game's snapshot rebuilds its exact world", () => {
    const config: GameConfig = {
      map: SETTINGS.map,
      seed: 3,
      players: gamePlayers(SETTINGS, ["A"]),
    };
    const game = new ServerGame(config);
    for (let k = 0; k < 30; k++) game.tick();
    const { tick, json } = game.snapshot();
    expect(tick).toBe(30);
    expect(game.snapshot().json).toBe(json); // the same tick: made once
    const world = deserializeWorld(
      JSON.parse(json) as WorldSnapshot,
      generateMap(config.map),
      ONLINE_RULES,
    );
    expect(hashWorld(world)).toBe(hashWorld(game.world));
    game.tick();
    expect(game.snapshot().tick).toBe(31);
  }, 30_000); // two Normal maps are generated: slow on a busy machine
});

/** Milestone 3.4: public games, the start countdown and the name blocklist (D-035). */
import { describe, expect, it } from "vitest";
import { MAP_DIMENSIONS } from "../../src/sim/map/generate.ts";
import { Lobbies, type Peer } from "../../src/server/lobbies.ts";
import { isBlockedName } from "../../src/shared/nameFilter.ts";
import {
  PROTOCOL_VERSION,
  PUBLIC_COUNTDOWN_MS,
  type GameConfig,
  type OnlineSettings,
  type ServerMessage,
} from "../../src/shared/protocol.ts";

const SETTINGS: OnlineSettings = {
  map: { seed: 1, ...MAP_DIMENSIONS.normal, style: "archipelago" },
  mode: "ffa",
  teams: 0,
  difficulty: "hard",
  nations: ["Avalon"],
  tribes: [],
};

function setup() {
  let now = 1_000;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const started: GameConfig[] = [];
  let ids = 0;
  const lobbies = new Lobbies({
    startRunner: (config) => {
      started.push(config);
      return { command: () => {}, stop: () => {} };
    },
    newGameId: () => `g${++ids}`,
    newSeed: () => 7,
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
  const player = (address: string) => {
    const inbox: ServerMessage[] = [];
    const peer: Peer = { send: (m) => inbox.push(m), close: () => {} };
    const connection = lobbies.connect(peer, address);
    connection.receive({ t: "hello", version: PROTOCOL_VERSION });
    const lobby = () => {
      const m = inbox.filter((x) => x.t === "lobby").at(-1);
      if (m?.t !== "lobby") throw new Error("no lobby yet");
      return m;
    };
    return { connection, inbox, lobby };
  };
  return { lobbies, advance, player, started };
}

describe("public games (3.4)", () => {
  it("private by default; the creator lists it; it shows on the open-games list", () => {
    const { lobbies, player } = setup();
    const a = player("1.1.1.1");
    a.connection.receive({ t: "create", settings: SETTINGS, name: "Host" });
    expect(a.lobby().public).toBe(false);
    expect(lobbies.openGames()).toEqual([]);
    a.connection.receive({ t: "visibility", public: true });
    expect(a.lobby().public).toBe(true);
    expect(lobbies.openGames()).toEqual([
      {
        gameId: "g1",
        creator: "Host",
        players: 1,
        maxPlayers: 16,
        summary: expect.objectContaining({ nations: 1, difficulty: "hard" }),
        startsIn: null,
      },
    ]);
    const b = player("2.2.2.2");
    b.connection.receive({ t: "join", gameId: "g1", name: "Guest" });
    b.connection.receive({ t: "visibility", public: false }); // only the creator may
    expect(b.inbox.at(-1)).toMatchObject({ t: "error" });
    a.connection.receive({ t: "visibility", public: false });
    expect(lobbies.openGames()).toEqual([]);
  });

  it("two players start a 30 s countdown; at zero the game starts by itself and leaves the list", () => {
    const { lobbies, advance, player, started } = setup();
    const a = player("1.1.1.1");
    a.connection.receive({ t: "create", settings: SETTINGS, name: "Host" });
    a.connection.receive({ t: "visibility", public: true });
    const b = player("2.2.2.2");
    b.connection.receive({ t: "join", gameId: "g1", name: "Guest" });
    expect(b.lobby().startsIn).toBe(PUBLIC_COUNTDOWN_MS);
    advance(10_000);
    expect(lobbies.openGames()[0]!.startsIn).toBe(PUBLIC_COUNTDOWN_MS - 10_000);
    const c = player("3.3.3.3");
    c.connection.receive({ t: "join", gameId: "g1", name: "Third" });
    expect(c.lobby().startsIn).toBe(PUBLIC_COUNTDOWN_MS - 10_000); // a joiner doesn't reset it
    advance(PUBLIC_COUNTDOWN_MS - 10_000);
    expect(started).toHaveLength(1);
    expect(started[0]!.players.slice(0, 3).map((p) => p.name)).toEqual(["Host", "Guest", "Third"]);
    expect(c.inbox.some((m) => m.t === "start")).toBe(true);
    expect(lobbies.openGames()).toEqual([]);
  });

  it("the countdown stops when players drop below two, and the creator may start early", () => {
    const { advance, player, started } = setup();
    const a = player("1.1.1.1");
    a.connection.receive({ t: "create", settings: SETTINGS, name: "Host" });
    a.connection.receive({ t: "visibility", public: true });
    const b = player("2.2.2.2");
    b.connection.receive({ t: "join", gameId: "g1", name: "Guest" });
    b.connection.closed();
    expect(a.lobby().startsIn).toBeNull();
    advance(PUBLIC_COUNTDOWN_MS * 2);
    expect(started).toHaveLength(0);
    const c = player("3.3.3.3");
    c.connection.receive({ t: "join", gameId: "g1", name: "Again" });
    a.connection.receive({ t: "start" });
    expect(started).toHaveLength(1);
    advance(PUBLIC_COUNTDOWN_MS); // the old countdown must not start it twice
    expect(started).toHaveLength(1);
  });

  it("the list shows the fullest open games first and leaves out full and private ones", () => {
    const { lobbies, player } = setup();
    const make = (address: string, listed: boolean) => {
      const p = player(address);
      p.connection.receive({ t: "create", settings: SETTINGS, name: address });
      if (listed) p.connection.receive({ t: "visibility", public: true });
      return p.lobby().gameId;
    };
    const small = make("1.1.1.1", true);
    make("2.2.2.2", false);
    const big = make("3.3.3.3", true);
    for (let k = 0; k < 2; k++) {
      player(`9.9.9.${k}`).connection.receive({ t: "join", gameId: big, name: "x" });
    }
    expect(lobbies.openGames().map((g) => g.gameId)).toEqual([big, small]);
  });
});

describe("the name blocklist (D-035)", () => {
  it("catches offensive names, also disguised, and spares ordinary ones", () => {
    for (const bad of ["fuck", "Big Shit", "sh1t", "F.U.C.K", "b!tch", "kys", "a$$hole"]) {
      expect(isBlockedName(bad), bad).toBe(true);
    }
    for (const ok of ["Bassist", "Grapes", "Nazir", "Cucumber", "Kyshawn", "Dickens", "Sam (2)"]) {
      expect(isBlockedName(ok), ok).toBe(false);
    }
  });

  it("a blocked name becomes Player N on joining, and a rename to one is refused", () => {
    const { player } = setup();
    const a = player("1.1.1.1");
    a.connection.receive({ t: "create", settings: SETTINGS, name: "sh1thead" });
    expect(a.lobby().players[0]!.name).toBe("Player 1");
    a.connection.receive({ t: "name", name: "Big Shit" });
    expect(a.inbox.at(-1)).toMatchObject({ t: "error", message: expect.stringMatching(/another/) });
    expect(a.lobby().players[0]!.name).toBe("Player 1");
  });
});

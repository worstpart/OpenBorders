/**
 * NetworkHost (3.5): a client fed the server's turns notices a drift, asks for a snapshot,
 * drops turns until it comes and continues exactly in step; a mid-game join starts from its
 * first snapshot. (Without Web Workers here, NetworkHost runs a manual-clock LocalHost.)
 */
import { afterEach, describe, expect, it } from "vitest";
import { NetworkHost, type ServerTurn } from "../../src/host/networkHost.ts";
import type { RestoredState } from "../../src/host/host.ts";
import type { TickFrame } from "../../src/sim/frame.ts";
import { generateMap, MAP_DIMENSIONS } from "../../src/sim/map/generate.ts";
import type { WorldSnapshot } from "../../src/sim/snapshot.ts";
import { hashWorld } from "../../src/sim/stateHash.ts";
import { ServerGame } from "../../src/server/game.ts";
import { gamePlayers, ONLINE_RULES, type GameConfig } from "../../src/shared/protocol.ts";

const CONFIG: GameConfig = {
  map: { seed: 4, ...MAP_DIMENSIONS.normal, style: "continent" },
  seed: 21,
  players: gamePlayers(
    {
      map: { seed: 4, ...MAP_DIMENSIONS.normal, style: "continent" },
      mode: "ffa",
      teams: 0,
      difficulty: "medium",
      nations: ["Avalon", "Borea", "Corvia"],
      tribes: ["Ash", "Birch"],
    },
    ["Ann"],
  ),
};
const MAP = generateMap(CONFIG.map);

let hosts: NetworkHost[] = [];
afterEach(() => {
  for (const host of hosts) host.dispose();
  hosts = [];
});

function client(options: { awaitSnapshot?: boolean } = {}) {
  const resyncs: number[] = [];
  const restored: RestoredState[] = [];
  const frames: TickFrame[] = [];
  const host = new NetworkHost({
    localPlayerId: 1,
    sendCommand: () => {},
    onResync: (tick) => resyncs.push(tick),
    onRestored: (state) => restored.push(state),
    ...options,
  });
  hosts.push(host);
  host.onFrame((frame) => frames.push(frame));
  const start = () =>
    host.start({ seed: CONFIG.seed, map: MAP, players: CONFIG.players, rules: ONLINE_RULES });
  return { host, resyncs, restored, frames, start };
}

const snapshotOf = (game: ServerGame) => JSON.parse(game.snapshot().json) as WorldSnapshot;
const play = (game: ServerGame, ticks: number): ServerTurn[] =>
  Array.from({ length: ticks }, () => game.tick());

// Each test has the server generate a Normal map: slow on a busy machine.
describe("NetworkHost repair (3.5)", { timeout: 30_000 }, () => {
  it("a corrupted client asks for a snapshot, drops turns until it comes, then runs in step", async () => {
    const server = new ServerGame(CONFIG);
    const c = client();
    await c.start();
    for (const turn of play(server, 20)) c.host.receiveTurn(turn);
    expect(c.resyncs).toEqual([]);
    expect(c.frames.at(-1)!.hash).toBe(hashWorld(server.world));

    c.host.debugCorrupt();
    const [drifted, ...more] = play(server, 5);
    c.host.receiveTurn(drifted!);
    expect(c.resyncs).toEqual([21]);
    expect(c.host.catchingUp).toBe(true);
    // Turns until the snapshot are from before it: dropped.
    const ran = c.frames.length;
    for (const turn of more) c.host.receiveTurn(turn);
    expect(c.frames.length).toBe(ran);

    c.host.receiveSnapshot(snapshotOf(server));
    expect(c.host.catchingUp).toBe(false);
    expect(c.restored).toHaveLength(1);
    expect(c.restored[0]!.frame.tick).toBe(25);
    expect(c.restored[0]!.frame.hash).toBe(hashWorld(server.world));
    expect([...c.restored[0]!.owner]).toEqual([...server.world.owner]);
    for (const turn of play(server, 30)) c.host.receiveTurn(turn);
    expect(c.resyncs).toEqual([21]);
    expect(c.frames.at(-1)!.tick).toBe(55);
    expect(c.frames.at(-1)!.hash).toBe(hashWorld(server.world));
    expect(c.host.repairCount).toBe(1);
  });

  it("a missed turn counts as a drift", async () => {
    const server = new ServerGame(CONFIG);
    const c = client();
    await c.start();
    const turns = play(server, 4);
    c.host.receiveTurn(turns[0]!);
    c.host.receiveTurn(turns[2]!);
    expect(c.resyncs).toEqual([3]);
  });

  it("a mid-game join starts from its first snapshot — never from tick 0", async () => {
    const server = new ServerGame(CONFIG);
    play(server, 40);
    const c = client({ awaitSnapshot: true });
    c.host.receiveTurn(play(server, 1)[0]!); // before the snapshot: dropped
    const snapshot = snapshotOf(server);
    const after = play(server, 3);
    c.host.receiveSnapshot(snapshot);
    for (const turn of after) c.host.receiveTurn(turn); // while the world is being built
    const initial = await c.start();
    expect(initial.frame.tick).toBe(41);
    expect(initial.fort).toBeDefined();
    expect(c.restored).toEqual([]); // the start itself carries the snapshot's state
    expect(c.frames.at(-1)!.tick).toBe(44);
    expect(c.frames.at(-1)!.hash).toBe(hashWorld(server.world));
    expect(c.resyncs).toEqual([]);
  });

  it("after a dropped connection it waits for the rejoin's snapshot", async () => {
    const server = new ServerGame(CONFIG);
    const c = client();
    await c.start();
    for (const turn of play(server, 10)) c.host.receiveTurn(turn);
    c.host.awaitSnapshot();
    play(server, 7); // missed while offline
    c.host.receiveTurn(play(server, 1)[0]!); // sent before the snapshot: dropped
    c.host.receiveSnapshot(snapshotOf(server));
    for (const turn of play(server, 2)) c.host.receiveTurn(turn);
    expect(c.resyncs).toEqual([]);
    expect(c.frames.at(-1)!.tick).toBe(20);
    expect(c.frames.at(-1)!.hash).toBe(hashWorld(server.world));
  });
});

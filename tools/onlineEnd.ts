// End-of-game check (milestone 3.6) against a running game server: two players on the same
// team with no nations — the game is won the moment play starts (no other side is left).
// Then one player reconnects with its seat token and must get the finished world (its end
// card), a spectator opening the link must be told the game has ended, and the server must
// no longer count it as running.
//   npm start            (in another terminal)
//   node tools/onlineEnd.ts [ws://localhost:8787/ws]
import { WebSocket } from "ws";
import { MAP_DIMENSIONS } from "../src/sim/map/generate.ts";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type OnlineSettings,
  type ServerMessage,
} from "../src/shared/protocol.ts";

const url = process.argv[2] ?? "ws://localhost:8787/ws";
const health = url.replace(/^ws/, "http").replace(/\/ws$/, "/health");

const settings: OnlineSettings = {
  map: { seed: 3, ...MAP_DIMENSIONS.normal, style: "continent" },
  mode: "teams",
  teams: 2,
  difficulty: "easy",
  nations: [],
  tribes: ["Ash", "Birch"],
};

interface Conn {
  ws: WebSocket;
  inbox: ServerMessage[];
  send(m: ClientMessage): void;
  next(t: ServerMessage["t"], ms?: number): Promise<ServerMessage>;
}

function connect(first: ClientMessage): Promise<Conn> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const waiters: { t: string; resolve: (m: ServerMessage) => void }[] = [];
    const conn: Conn = {
      ws,
      inbox: [],
      send: (m) => ws.send(JSON.stringify(m)),
      next: (t, ms = 30_000) =>
        new Promise((res, rej) => {
          const seen = conn.inbox.find((m) => m.t === t);
          if (seen) {
            conn.inbox.splice(conn.inbox.indexOf(seen), 1);
            return res(seen);
          }
          const timer = setTimeout(() => rej(new Error(`no ${t} within ${ms} ms`)), ms);
          waiters.push({
            t,
            resolve: (m) => {
              clearTimeout(timer);
              res(m);
            },
          });
        }),
    };
    ws.on("message", (data) => {
      const m = JSON.parse(data.toString()) as ServerMessage;
      const k = waiters.findIndex((w) => w.t === m.t);
      if (k >= 0) waiters.splice(k, 1)[0]!.resolve(m);
      else if (m.t !== "turn") conn.inbox.push(m);
      else lastTurn = Math.max(lastTurn, m.tick);
    });
    ws.on("open", () => {
      conn.send({ t: "hello", version: PROTOCOL_VERSION });
      conn.send(first);
      resolve(conn);
    });
  });
}

let lastTurn = 0;
const checks: [string, boolean][] = [];
const check = (what: string, ok: boolean) => {
  checks.push([what, ok]);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
};

/** Games the server counts as running (lobbies included). */
const liveGames = async () =>
  Number(/^ok (\d+) games/.exec(await (await fetch(health)).text())?.[1]);
// Other games may be running on a shared server: this one must drop out of the count.
const before = await liveGames();
const a = await connect({ t: "create", settings, name: "End A" });
const lobby = (await a.next("lobby")) as Extract<ServerMessage, { t: "lobby" }>;
const b = await connect({ t: "join", gameId: lobby.gameId, name: "End B" });
await b.next("lobby");
b.send({ t: "team", team: 1 });
b.send({ t: "ready", ready: true });
await new Promise((r) => setTimeout(r, 300));
a.send({ t: "start" });
const startA = (await a.next("start")) as Extract<ServerMessage, { t: "start" }>;
const startB = (await b.next("start")) as Extract<ServerMessage, { t: "start" }>;
check(
  "both humans play on team 1",
  startA.config.players.slice(0, 2).every((p) => p.team === 1),
);
// Spawn somewhere free and confirm: play starts, and with no other side the team has won.
for (const [conn, tile] of [
  [a, 100_000],
  [b, 160_000],
] as const) {
  conn.send({ t: "command", command: { type: "spawn", tile } });
  conn.send({ t: "command", command: { type: "confirmSpawn" } });
}
const began = Date.now();
let ended = false;
while (Date.now() - began < 90_000) {
  await new Promise((r) => setTimeout(r, 500));
  if (lastTurn > 0 && (await liveGames()) <= before) {
    ended = true;
    break;
  }
}
check(`the game ended and isn't counted as running (last turn ${lastTurn})`, ended);

// B lost the connection right at the end: its seat still brings back the final world.
b.ws.terminate();
const back = await connect({ t: "rejoin", gameId: startB.gameId, token: startB.rejoin });
const rejoined = await back.next("start").catch(() => null);
check("a rejoin after the end is accepted", rejoined?.t === "start" && rejoined.midGame);
const sync = await back.next("sync").catch(() => null);
const phase = sync?.t === "sync" ? (sync.snapshot as { state?: { phase?: string } }) : null;
check(
  `the rejoin gets the finished world (tick ${sync?.t === "sync" ? sync.snapshot.tick : "?"})`,
  JSON.stringify(phase).includes('"phase":"ended"'),
);

const watcher = await connect({ t: "join", gameId: startA.gameId, name: "End Watcher" });
const refused = await watcher.next("error").catch(() => null);
check(
  `a spectator is told it ended ("${refused?.t === "error" ? refused.message : "?"}")`,
  refused?.t === "error" && /ended/.test(refused.message),
);

for (const conn of [a, back, watcher]) conn.ws.close();
const ok = checks.every(([, passed]) => passed);
console.log(ok ? "OK" : "FAILED");
process.exit(ok ? 0 : 1);
